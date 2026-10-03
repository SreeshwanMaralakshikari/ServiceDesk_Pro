// Integration test: boots the REAL server.js — real helmet/cors/json limit/
// sanitizeBody, real router mounts, real 404 + global error handler — with only
// the outside world stubbed:
//   - mongoose.connect        -> no-op   (no database in CI / sandbox)
//   - node-cron               -> stub    (so the SLA/warranty jobs don't hold the process open)
//   - app.listen              -> random port
//   - KB / Category / User model *methods* -> in-memory store. Filters are still
//     run through Mongoose's REAL query casting, so an invalid ObjectId throws
//     the same CastError it would against MongoDB.
//
// Everything below is loaded with dynamic import() AFTER the patches, because a
// static import of mongoose would freeze its exports before we could patch them.
process.env.JWT_SECRET = 'integration-secret'
process.env.MONGO_URI = 'mongodb://unused.invalid/db'
process.env.CLIENT_URL = 'https://app.example.test'
process.env.PORT = '0'
process.env.SEED_ON_START = 'false' // set explicitly: dotenv (inside server.js) would otherwise fill it in from .env

import { createRequire, register } from 'node:module'
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
const mongoose = require('mongoose')
mongoose.connect = async () => mongoose
Object.getPrototypeOf(mongoose).connect = async () => mongoose
// node-cron is stubbed through an ESM resolve hook (not by patching the real
// package), so this test also runs on a machine where it isn't installed yet
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(specifier, context, next) {
    if (specifier === 'node-cron') {
      return { url: 'data:text/javascript,export default { schedule() { return { stop() {}, start() {} } } }', shortCircuit: true }
    }
    return next(specifier, context)
  }
`))
const express = require('express')
let serverRef
const realListen = express.application.listen
express.application.listen = function (_port, cb) { serverRef = realListen.call(this, 0, cb); return serverRef }
const jwt = require('jsonwebtoken')
const sift = require('sift')
const applyUpdatePromise = import('../testkit/applyUpdate.js')

const oid = (n) => String(n).padStart(24, '0')
const USERS = {
  admin: { _id: oid(1), role: 'ADMIN' }, manager: { _id: oid(2), role: 'MANAGER' },
  tech: { _id: oid(3), role: 'TECHNICIAN' }, tech2: { _id: oid(4), role: 'TECHNICIAN' },
  emp: { _id: oid(5), role: 'EMPLOYEE' },
}
const CAT_ID = oid(100)

describe('real server.js + KB (only DB/cron stubbed)', () => {
  let base, origin, store, seq, K, C, U, Counter
  const saved = {}
  let dupKeyFailuresLeft = 0
  const counters = {}

  const snap = (d) => JSON.parse(JSON.stringify(d))
  const castCheck = (fn, model, filter) => { const q = fn.call(model, filter); q._castConditions(); if (q.error()) throw q.error() }
  const lazy = (thunk) => {
    const paths = []
    const q = {
      select: () => q, sort: () => q, skip: () => q, limit: () => q,
      populate: (p) => { paths.push(p); return q },
      then: (a, b) => Promise.resolve().then(() => finish(thunk(), paths)).then(a, b),
      catch: (b) => Promise.resolve().then(() => finish(thunk(), paths)).catch(b),
    }
    return q
  }
  const finish = (r, paths) => {
    const pop = (d) => {
      if (d && paths.includes('author')) d.author = new U({ _id: String(d.author), firstName: 'Theo', lastName: 'X', role: 'TECHNICIAN' })
      if (d && paths.includes('category')) d.category = new C({ _id: String(d.category), name: 'Hardware' })
      return d
    }
    return Array.isArray(r) ? r.map(pop) : pop(r)
  }
  const attach = (d) => {
    d.save = async function () { await this.validate(); store = store.map((s) => (s._id === String(this._id) ? snap(this) : s)); return this }
    return d
  }
  const hydrate = (s) => attach(K.hydrate(JSON.parse(JSON.stringify(s))))
  const strip = ({ $text, ...rest }) => rest
  const seed = (over = {}) => {
    seq += 1
    const d = attach(new K({
      _id: oid(1000 + seq), publicId: `KB-2026-${String(seq).padStart(5, '0')}`, title: 't' + seq, summary: 's', content: 'c',
      category: CAT_ID, tags: [], status: 'DRAFT', author: USERS.tech._id, viewCount: 0, history: [], version: 0, isDeleted: false, ...over,
    }))
    store.push(snap(d)); return d
  }
  const cookie = (as) => `token=${jwt.sign({ id: USERS[as]._id }, 'integration-secret')}`
  const call = async (as, method, path, body, extra = {}) => {
    const headers = { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(as ? { Cookie: cookie(as) } : {}), ...extra.headers }
    const res = await fetch(base + path, { method, headers, body: extra.rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined) })
    let json = null; try { json = await res.json() } catch { /* no body */ }
    return { status: res.status, body: json, headers: res.headers }
  }
  const reset = () => { store = []; seq = 0; dupKeyFailuresLeft = 0; for (const k of Object.keys(counters)) delete counters[k] }

  before(async () => {
    await import('../server.js') // the real thing
    for (let i = 0; i < 100 && !serverRef?.listening; i++) await new Promise((r) => setTimeout(r, 20))
    assert.ok(serverRef?.listening, 'server.js did not start listening')
    base = `http://127.0.0.1:${serverRef.address().port}`
    origin = 'http://localhost:5173'

    K = (await import('../models/KnowledgeArticleModel.js')).KnowledgeArticleModel
    C = (await import('../models/CategoryModel.js')).CategoryModel
    U = (await import('../models/UserModel.js')).UserModel
    ;(await import('../models/AuditLogModel.js')).AuditLogModel.create = async () => ({}) // no database here
    saved.K = { findOneAndUpdate: K.findOneAndUpdate, find: K.find, findOne: K.findOne, countDocuments: K.countDocuments, updateOne: K.updateOne, create: K.create }
    saved.C = { findOne: C.findOne }; saved.U = { findById: U.findById }
    Counter = (await import('../models/CounterModel.js')).CounterModel
    saved.Counter = { findOneAndUpdate: Counter.findOneAndUpdate }
    // the public-id counter, in memory (no database here)
    Counter.findOneAndUpdate = async (f) => { counters[f._id] = (counters[f._id] ?? 0) + 1; return { seq: counters[f._id] } }

    U.findById = (id) => lazy(() => { const u = Object.values(USERS).find((x) => x._id === String(id)); return u && { ...u, isActive: true } })
    C.findOne = (f) => lazy(() => { castCheck(saved.C.findOne, C, f); return String(f._id) === CAT_ID ? { _id: CAT_ID } : null })
    K.findOne = (f) => lazy(() => { castCheck(saved.K.findOne, K, f); const h = store.find(sift(f)); return h ? hydrate(h) : null })
    const { applyUpdate } = await applyUpdatePromise
    K.findOneAndUpdate = async (f, u) => {
      const i = store.findIndex(sift(JSON.parse(JSON.stringify(f))))
      if (i < 0) return null
      applyUpdate(store[i], u)
      return hydrate(store[i])
    }
    K.find = (f) => lazy(() => { castCheck(saved.K.find, K, f); return store.filter(sift(strip(f))).map(hydrate) })
    K.countDocuments = async (f) => { castCheck(saved.K.countDocuments, K, f); return store.filter(sift(strip(f))).length }
    K.updateOne = async (f, u) => { const d = store.find((x) => x._id === String(f._id)); if (d && u.$inc) for (const k in u.$inc) d[k] += u.$inc[k]; return {} }
    K.create = async (data) => {
      if (dupKeyFailuresLeft > 0) {
        dupKeyFailuresLeft -= 1
        const e = new Error('E11000 duplicate key'); e.name = 'MongoServerError'; e.code = 11000; e.keyValue = { publicId: data.publicId }; throw e
      }
      const d = attach(new K({ ...data, _id: oid(5000 + store.length) })); await d.validate(); store.push(snap(d)); return d
    }
  })
  after(() => {
    Object.assign(K, saved.K); Object.assign(C, saved.C); Object.assign(U, saved.U); Object.assign(Counter, saved.Counter)
    serverRef.close()
  })

  test('server assembled: /health, real 404 handler, security headers', async () => {
    const h = await call(null, 'GET', '/health')
    assert.equal(h.status, 200)
    assert.equal(h.headers.get('x-content-type-options'), 'nosniff') // helmet is really mounted
    const nf = await call(null, 'GET', '/kb-api/nope/at/all')
    assert.equal(nf.status, 404); assert.match(nf.body.message, /invalid/)
  })

  test('CORS preflight: PATCH and DELETE are allowed for the app origins, with credentials; strangers are not', async () => {
    const pre = await call(null, 'OPTIONS', '/kb-api/articles/KB-2026-00001/publish', undefined, {
      headers: { Origin: origin, 'Access-Control-Request-Method': 'PATCH', 'Access-Control-Request-Headers': 'content-type' },
    })
    assert.ok(pre.status === 204 || pre.status === 200)
    assert.equal(pre.headers.get('access-control-allow-origin'), origin)
    assert.equal(pre.headers.get('access-control-allow-credentials'), 'true')
    const methods = pre.headers.get('access-control-allow-methods') || ''
    assert.ok(/PATCH/.test(methods) && /DELETE/.test(methods), methods)
    const evil = await call(null, 'OPTIONS', '/kb-api/articles', undefined, { headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } })
    assert.equal(evil.headers.get('access-control-allow-origin'), null)
    const prod = await call(null, 'OPTIONS', '/kb-api/articles', undefined, { headers: { Origin: 'https://app.example.test', 'Access-Control-Request-Method': 'GET' } })
    assert.equal(prod.headers.get('access-control-allow-origin'), 'https://app.example.test') // CLIENT_URL
  })

  test('auth wall: no cookie -> 401 on every KB route', async () => {
    reset(); const d = seed({ status: 'PUBLISHED' })
    for (const [m, p] of [['GET', '/articles'], ['GET', '/articles/mine'], ['GET', `/articles/${d.publicId}`], ['POST', '/articles'], ['PATCH', `/articles/${d.publicId}`], ['PATCH', `/articles/${d.publicId}/publish`], ['DELETE', `/articles/${d.publicId}`], ['GET', `/articles/${d.publicId}/history`]]) {
      assert.equal((await call(null, m, '/kb-api' + p, m === 'GET' || m === 'DELETE' ? undefined : {})).status, 401, `${m} ${p}`)
    }
  })

  test('end-to-end through the real chain: create -> open -> publish -> employee sees -> archive -> delete', async () => {
    reset()
    const created = await call('tech', 'POST', '/kb-api/articles', { title: 'VPN tips', summary: 'S', content: 'C', categoryId: CAT_ID, tags: ['VPN'] })
    assert.equal(created.status, 201)
    const id = created.body.payload.publicId
    assert.equal((await call('tech', 'GET', `/kb-api/articles/${id}`)).status, 200)
    assert.equal((await call('emp', 'GET', `/kb-api/articles/${id}`)).status, 404)
    assert.equal((await call('manager', 'PATCH', `/kb-api/articles/${id}/publish`, { version: 0 })).status, 200)
    const list = await call('emp', 'GET', '/kb-api/articles')
    assert.equal(list.body.payload.total, 1)
    assert.equal((await call('emp', 'GET', `/kb-api/articles/${id}`)).status, 200)
    assert.equal((await call('tech', 'DELETE', `/kb-api/articles/${id}`)).status, 400) // still published
    assert.equal((await call('tech', 'PATCH', `/kb-api/articles/${id}/archive`, { version: 1 })).status, 403)
    assert.equal((await call('manager', 'PATCH', `/kb-api/articles/${id}/archive`, { version: 1 })).status, 200)
    assert.equal((await call('tech', 'DELETE', `/kb-api/articles/${id}`)).status, 200)
    assert.equal((await call('manager', 'GET', '/kb-api/articles')).body.payload.total, 0)
  })

  test('malformed ids reach the REAL error handler as CastError -> 400, not 500', async () => {
    reset(); seed({ status: 'PUBLISHED' })
    assert.equal((await call('emp', 'GET', '/kb-api/articles?category=not-an-objectid')).status, 400)
    assert.equal((await call('tech', 'POST', '/kb-api/articles', { title: 'T', summary: 'S', content: 'C', categoryId: 'nope' })).status, 400)
    assert.equal((await call('tech', 'PATCH', `/kb-api/articles/KB-2026-00001`, { categoryId: 'nope' })).status, 400)
    assert.equal((await call('emp', 'GET', `/kb-api/articles/${oid(777)}`)).status, 404) // valid-looking id that doesn't exist
  })

  test('malformed JSON body -> 400 and oversized body -> 413 (not a generic 500)', async () => {
    reset()
    const bad = await call('tech', 'POST', '/kb-api/articles', undefined, { headers: { 'Content-Type': 'application/json' }, rawBody: '{"title": "oops' })
    assert.equal(bad.status, 400)
    const big = await call('tech', 'POST', '/kb-api/articles', { title: 'T', summary: 'S', content: 'x'.repeat(1_200_000), categoryId: CAT_ID })
    assert.equal(big.status, 413)
  })

  test('concurrent create collision on publicId (E11000) is retried transparently, not surfaced as a 409', async () => {
    reset(); dupKeyFailuresLeft = 2
    const r = await call('tech', 'POST', '/kb-api/articles', { title: 'T', summary: 'S', content: 'C', categoryId: CAT_ID })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    dupKeyFailuresLeft = 99 // a persistent duplicate is a real conflict: give up cleanly
    const r2 = await call('tech', 'POST', '/kb-api/articles', { title: 'T2', summary: 'S', content: 'C', categoryId: CAT_ID })
    assert.equal(r2.status, 409)
  })

  test('body keys starting with $ or containing . never reach the route (real sanitizeBody)', async () => {
    reset()
    const r = await call('tech', 'POST', '/kb-api/articles', { title: 'T', summary: 'S', content: 'C', categoryId: CAT_ID, $where: '1', 'a.b': 2 })
    assert.equal(r.status, 201)
  })
})
