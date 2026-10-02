// Integration test: boots the REAL server.js (real helmet/cors/json limit/
// sanitizeBody, real router mounts, real 404 + global error handler) with
// only the outside world stubbed — same technique as test/kb.integration.test.js:
//   - mongoose.connect   -> no-op
//   - node-cron          -> stub (via an ESM resolve hook)
//   - app.listen         -> random port
//   - Category/SLAPolicy/Ticket/KnowledgeArticle/User/AiLog model *methods*,
//     and groqClient's methods -> in-memory / stubbed, no real network call
process.env.JWT_SECRET = 'integration-secret'
process.env.MONGO_URI = 'mongodb://unused.invalid/db'
process.env.CLIENT_URL = 'https://app.example.test'
process.env.PORT = '0'
process.env.SEED_ON_START = 'false' // set explicitly: dotenv (inside server.js) would otherwise fill it in from .env
delete process.env.GROQ_API_KEY // the real key in backend/.env must never leak into this test

import { createRequire, register } from 'node:module'
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
const mongoose = require('mongoose')
mongoose.connect = async () => mongoose
Object.getPrototypeOf(mongoose).connect = async () => mongoose
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

const oid = (n) => String(n).padStart(24, '0')
const USERS = {
  admin: { _id: oid(1), role: 'ADMIN' }, manager: { _id: oid(2), role: 'MANAGER', department: oid(200) },
  tech: { _id: oid(3), role: 'TECHNICIAN', department: oid(200) }, emp: { _id: oid(5), role: 'EMPLOYEE' },
}
const CAT_NETWORK = oid(100)

describe('real server.js + /ai-api (only DB/cron/groq stubbed)', () => {
  let base, origin
  let categories, priorities, ticketStore, kbStore, aiLogs, chatCompletionCalls
  let Category, SLAPolicy, Ticket, KB, User, AiLog, groq
  const saved = {}

  const chain = (result) => {
    let arr = Array.isArray(result) ? [...result] : result
    const q = {
      select: () => q,
      sort: (spec) => {
        if (Array.isArray(arr) && spec) {
          const entries = Object.entries(spec)
          arr = [...arr].sort((a, b) => { for (const [k, d] of entries) { const c = (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * d; if (c !== 0) return c } return 0 })
        }
        return q
      },
      limit: (n) => { if (Array.isArray(arr)) arr = arr.slice(0, n); return q },
      then: (a, b) => Promise.resolve(arr).then(a, b),
      catch: (b) => Promise.resolve(arr).catch(b),
    }
    return q
  }
  const matchesText = (doc, search) => {
    const words = new Set((search || '').toLowerCase().match(/[a-z0-9]+/g) || [])
    const hay = `${doc.title} ${doc.summary} ${doc.content || ''} ${(doc.tags || []).join(' ')}`.toLowerCase()
    return [...words].some((w) => w.length > 2 && hay.includes(w))
  }
  const matchesFilter = (doc, filter) => {
    const { $text, $or, ...rest } = filter
    if ($text && !matchesText(doc, $text.$search)) return false
    if ($or && !$or.some((cond) => sift(cond)(doc))) return false
    return sift(rest)(doc)
  }
  const castCheck = (fn, model, filter) => { const q = fn.call(model, filter); if (q?._castConditions) { q._castConditions(); if (q.error()) throw q.error() } }

  const cookie = (as) => `token=${jwt.sign({ id: USERS[as]._id }, 'integration-secret')}`
  const call = async (as, method, path, body, extra = {}) => {
    const headers = { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(as ? { Cookie: cookie(as) } : {}), ...extra.headers }
    const res = await fetch(base + path, { method, headers, body: extra.rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined) })
    let json = null; try { json = await res.json() } catch { /* no body */ }
    return { status: res.status, body: json, headers: res.headers }
  }

  before(async () => {
    await import('../server.js') // the real thing
    for (let i = 0; i < 100 && !serverRef?.listening; i++) await new Promise((r) => setTimeout(r, 20))
    assert.ok(serverRef?.listening, 'server.js did not start listening')
    base = `http://127.0.0.1:${serverRef.address().port}`
    origin = 'http://localhost:5173'

    Category = (await import('../models/CategoryModel.js')).CategoryModel
    SLAPolicy = (await import('../models/SLAPolicyModel.js')).SLAPolicyModel
    Ticket = (await import('../models/TicketModel.js')).TicketModel
    KB = (await import('../models/KnowledgeArticleModel.js')).KnowledgeArticleModel
    User = (await import('../models/UserModel.js')).UserModel
    AiLog = (await import('../models/AiLogModel.js')).AiLogModel
    groq = (await import('../config/groq.js')).groqClient

    for (const [k, obj, names] of [
      ['cat', Category, ['find']], ['sla', SLAPolicy, ['find']], ['ticket', Ticket, ['findOne']],
      ['kb', KB, ['find']], ['user', User, ['findById']], ['log', AiLog, ['create', 'findOne']], ['groq', groq, ['isConfigured', 'chatCompletion']],
    ]) { saved[k] = {}; for (const n of names) saved[k][n] = obj[n] }

    User.findById = (id) => chain(Object.values(USERS).find((u) => u._id === String(id)) && { ...Object.values(USERS).find((u) => u._id === String(id)), isActive: true })
    Category.find = (f) => { castCheck(saved.cat.find, Category, f); return chain(categories.filter(sift(f))) }
    SLAPolicy.find = (f) => { castCheck(saved.sla.find, SLAPolicy, f); return chain(priorities.filter(sift(f))) }
    Ticket.findOne = (f) => { castCheck(saved.ticket.findOne, Ticket, f); return chain(ticketStore.find(sift(f)) || null) }
    KB.find = (f) => { castCheck(saved.kb.find, KB, f); return chain(kbStore.filter((d) => matchesFilter(d, f))) }
    AiLog.findOne = () => chain(null) // no earlier classification to reuse
    AiLog.create = async (data) => { await new AiLog(data).validate(); const d = { _id: oid(9000 + aiLogs.length), ...data }; aiLogs.push(d); return d }
  })
  after(() => {
    for (const [k, obj] of [['cat', Category], ['sla', SLAPolicy], ['ticket', Ticket], ['kb', KB], ['user', User], ['log', AiLog], ['groq', groq]]) Object.assign(obj, saved[k])
    serverRef.close()
  })

  const reset = () => {
    categories = [{ _id: CAT_NETWORK, name: 'Network', isActive: true }]
    priorities = [{ _id: oid(301), priority: 'MEDIUM', level: 2, isActive: true }, { _id: oid(303), priority: 'HIGH', level: 3, isActive: true }]
    ticketStore = []; kbStore = []; aiLogs = []; chatCompletionCalls = []
    groq.isConfigured = () => false
    groq.chatCompletion = async (args) => { chatCompletionCalls.push(args); return '{}' }
  }
  const seedTicket = (over = {}) => { const t = { _id: oid(2000 + ticketStore.length), publicId: `TKT-2026-${String(ticketStore.length + 1).padStart(5, '0')}`, title: 'Wifi down', category: CAT_NETWORK, department: oid(200), requester: USERS.emp._id, isDeleted: false, ...over }; ticketStore.push(t); return t }
  const seedArticle = (over = {}) => { const a = { _id: oid(3000 + kbStore.length), publicId: `KB-2026-${String(kbStore.length + 1).padStart(5, '0')}`, title: 'Wifi fix', summary: 's', content: 'c', tags: [], category: CAT_NETWORK, status: 'PUBLISHED', author: USERS.tech._id, viewCount: 0, isDeleted: false, ...over }; kbStore.push(a); return a }

  test('mounted on the real app: health check and security headers still work alongside /ai-api', async () => {
    const h = await call(null, 'GET', '/health')
    assert.equal(h.status, 200)
    assert.equal(h.headers.get('x-content-type-options'), 'nosniff')
  })

  test('CORS preflight for /ai-api behaves like every other router (same app, same middleware)', async () => {
    const pre = await call(null, 'OPTIONS', '/ai-api/classify-ticket', undefined, { headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } })
    assert.ok(pre.status === 204 || pre.status === 200)
    assert.equal(pre.headers.get('access-control-allow-origin'), origin)
  })

  test('auth wall: no cookie -> 401 on both routes', async () => {
    reset(); const t = seedTicket()
    assert.equal((await call(null, 'POST', '/ai-api/classify-ticket', {})).status, 401)
    assert.equal((await call(null, 'GET', `/ai-api/kb-suggestions/${t.publicId}`)).status, 401)
  })

  test('end-to-end: no key configured -> classify-ticket falls back; technician then gets a matching KB suggestion', async () => {
    reset()
    const c = await call('emp', 'POST', '/ai-api/classify-ticket', { title: 'Wifi network is down', description: 'urgent' })
    assert.equal(c.status, 200)
    assert.equal(c.body.payload.source, 'fallback')
    assert.equal(c.body.payload.categoryName, 'Network')
    assert.equal(c.body.payload.priority, 'HIGH')

    const t = seedTicket({ title: 'Wifi network is down' })
    seedArticle({ title: 'Wifi troubleshooting' })
    const s = await call('tech', 'GET', `/ai-api/kb-suggestions/${t.publicId}`)
    assert.equal(s.status, 200)
    assert.equal(s.body.payload.articles.length, 1)
    assert.equal(aiLogs.filter((l) => l.kind === 'CLASSIFY_TICKET').length, 1)
    assert.equal(aiLogs.filter((l) => l.kind === 'KB_SUGGESTIONS').length, 1)
  })

  test('end-to-end with the AI path exercised: valid model response maps back to a real category/priority', async () => {
    reset()
    groq.isConfigured = () => true
    groq.chatCompletion = async () => '{"categoryName":"Network","priority":"HIGH","probableIssue":"Router outage"}'
    const r = await call('emp', 'POST', '/ai-api/classify-ticket', { title: 'Wifi down' })
    assert.equal(r.body.payload.source, 'ai')
    assert.equal(r.body.payload.categoryId, CAT_NETWORK)
  })

  test('malformed ticket id reaches the REAL error handler safely (404, not 500)', async () => {
    reset()
    assert.equal((await call('tech', 'GET', '/ai-api/kb-suggestions/not-an-id!!')).status, 404)
  })

  test('malformed JSON body -> 400, oversized body -> 413 (the real body-parser limit, ahead of our own input caps)', async () => {
    reset()
    const bad = await call('emp', 'POST', '/ai-api/classify-ticket', undefined, { headers: { 'Content-Type': 'application/json' }, rawBody: '{"title": "oops' })
    assert.equal(bad.status, 400)
    const big = await call('emp', 'POST', '/ai-api/classify-ticket', { title: 'x'.repeat(1_200_000) })
    assert.equal(big.status, 413)
  })

  test('$where / dotted-key injection in the body never reaches the route (real sanitizeBody)', async () => {
    reset()
    const r = await call('emp', 'POST', '/ai-api/classify-ticket', { title: 'ok', $where: '1', 'a.b': 2 })
    assert.equal(r.status, 200)
  })

  test('GROQ_API_KEY from the real .env never leaks into this test run', async () => {
    // this test file deletes it at the top; the assertion also guards
    // against the value being copied back in by something else importing dotenv
    assert.equal(process.env.GROQ_API_KEY, undefined)
  })
})
