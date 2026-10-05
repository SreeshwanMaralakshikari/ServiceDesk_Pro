// Pure-logic tests for the SECURE-CORE helpers (no database, no network).
// The same behaviours are proven against a real MongoDB in test/integration/.
process.env.AI_RATE_LIMIT_MAX = '2'

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import exp from 'express'
import { getPagination, toPage } from '../utils/pagination.js'
import { asText } from '../utils/queryParams.js'
import { buildTicketScope, buildTicketQuery } from '../utils/buildTicketQuery.js'
import { toTicketView, toTicketListItem, canSeeInternal } from '../utils/ticketView.js'
import { atomicTransition, isValidVersion } from '../utils/atomicTransition.js'
import { aiLimiter, loginLimiter } from '../middlewares/rateLimiters.js'
import { applyUpdate } from '../testkit/applyUpdate.js'
import { APP_TIME_ZONE } from '../utils/timezone.js'
import { statusRefusal } from '../utils/statusRefusal.js'
import { isTransitionAllowed } from '../utils/ticketTransitions.js'
import { isAssetTransitionAllowed } from '../utils/assetTransitions.js'
import { isKbTransitionAllowed } from '../utils/kbTransitions.js'

const DEPT = '64b00000000000000000aaaa'
const OTHER = '64b00000000000000000bbbb'
const ticket = (over = {}) => ({
  department: DEPT,
  comments: [{ text: 'public', isInternal: false }, { text: 'secret', isInternal: true }],
  ...over,
})

describe('pagination', () => {
  test('clamps page and limit, never NaN, never unbounded', () => {
    assert.deepEqual(getPagination({}), { page: 1, limit: 20, skip: 0 })
    assert.equal(getPagination({ limit: '0' }).limit, 20)
    assert.equal(getPagination({ limit: '-5' }).limit, 1)
    assert.equal(getPagination({ limit: '1000' }).limit, 50)
    assert.equal(getPagination({ limit: 'abc' }).limit, 20)
    assert.equal(getPagination({ page: 'abc' }).page, 1)
    assert.equal(getPagination({ page: '-3' }).page, 1)
    assert.equal(getPagination({ page: '0' }).page, 1)
    assert.deepEqual(getPagination({ page: '3', limit: '10' }), { page: 3, limit: 10, skip: 20 })
    assert.equal(getPagination({ limit: ['5', '6'] }).limit, 20, 'array from a repeated key')
    assert.equal(getPagination(undefined).page, 1)
  })
  test('toPage builds the list payload', () => {
    assert.deepEqual(toPage(['a'], 41, { page: 2, limit: 20 }), { items: ['a'], total: 41, page: 2, totalPages: 3 })
    assert.equal(toPage([], 0, { page: 1, limit: 20 }).totalPages, 0)
  })
})

describe('typed query filters', () => {
  test('asText accepts only non-blank strings', () => {
    assert.equal(asText(' abc '), 'abc')
    for (const bad of ['', '   ', ['a', 'b'], { $ne: 1 }, 5, null, undefined]) assert.equal(asText(bad), undefined)
  })
  test('buildTicketQuery drops arrays/objects instead of forwarding them', () => {
    const q = buildTicketQuery({ role: 'ADMIN' }, { q: ['a', 'b'], status: { $ne: 'X' }, priority: ['HIGH'], category: undefined })
    assert.deepEqual(q, { isDeleted: false })
    assert.deepEqual(buildTicketQuery({ role: 'ADMIN' }, { q: 'vpn', status: 'OPEN' }), { isDeleted: false, status: 'OPEN', $text: { $search: 'vpn' } })
  })
})

describe('ticket scope', () => {
  test('staff without a department match nothing', () => {
    for (const role of ['TECHNICIAN', 'MANAGER']) {
      assert.deepEqual(buildTicketScope({ role, id: 'u1' }), { _id: null })
      assert.deepEqual(buildTicketScope({ role, id: 'u1', department: undefined }), { _id: null })
      assert.deepEqual(buildTicketScope({ role, id: 'u1', department: DEPT }), { department: DEPT })
    }
  })
  test('other roles', () => {
    assert.deepEqual(buildTicketScope({ role: 'ADMIN' }), {})
    assert.deepEqual(buildTicketScope({ role: 'EMPLOYEE', id: 'u9' }), { requester: 'u9' })
    assert.deepEqual(buildTicketScope({ role: 'ASSET_MANAGER' }), { _id: null })
    assert.deepEqual(buildTicketScope({ role: 'SOMETHING_ELSE' }), { _id: null })
  })
})

describe('ticket serializer', () => {
  test('internal comments reach only ADMIN and staff of the owning team', () => {
    assert.equal(canSeeInternal(ticket(), { role: 'ADMIN' }), true)
    assert.equal(canSeeInternal(ticket(), { role: 'TECHNICIAN', department: DEPT }), true)
    assert.equal(canSeeInternal(ticket(), { role: 'MANAGER', department: DEPT }), true)
    assert.equal(canSeeInternal(ticket(), { role: 'TECHNICIAN', department: OTHER }), false)
    assert.equal(canSeeInternal(ticket(), { role: 'TECHNICIAN' }), false, 'no department')
    assert.equal(canSeeInternal(ticket(), { role: 'EMPLOYEE', department: DEPT }), false)
    assert.equal(canSeeInternal(ticket(), { role: 'ASSET_MANAGER' }), false)
  })
  test('toTicketView filters for everyone else and keeps them for the team', () => {
    assert.equal(toTicketView(ticket(), { role: 'EMPLOYEE' }).comments.length, 1)
    assert.equal(toTicketView(ticket(), { role: 'EMPLOYEE' }).comments[0].text, 'public')
    assert.equal(toTicketView(ticket(), { role: 'TECHNICIAN', department: OTHER }).comments.length, 1)
    assert.equal(toTicketView(ticket(), { role: 'TECHNICIAN', department: DEPT }).comments.length, 2)
    assert.equal(toTicketView(ticket({ comments: undefined }), { role: 'EMPLOYEE' }).comments.length, 0)
  })
  test('works with a populated department and does not mutate the input', () => {
    const t = ticket({ department: { _id: DEPT, name: 'Svc' } })
    assert.equal(toTicketView(t, { role: 'MANAGER', department: DEPT }).comments.length, 2)
    toTicketView(t, { role: 'EMPLOYEE' })
    assert.equal(t.comments.length, 2)
  })
  test('list items never carry comments', () => {
    assert.equal('comments' in toTicketListItem(ticket()), false)
  })
})

describe('atomicTransition decision logic (fake model)', () => {
  const fakeModel = (stored, { updateResult }) => {
    const calls = []
    return {
      calls,
      findOneAndUpdate: async (filter, update, opts) => { calls.push({ filter, update, opts }); return updateResult },
      findOne: () => ({ select: async () => stored }),
    }
  }
  const base = { doc: { _id: 'id1' }, action: 'claim', noun: 'ticket', from: ['OPEN'], version: 0 }

  test('builds the guarded filter and $inc version', async () => {
    const M = fakeModel(null, { updateResult: { ok: true } })
    const r = await atomicTransition({ Model: M, ...base, set: { status: 'ASSIGNED' }, unset: { x: '' }, push: { statusHistory: { to: 'ASSIGNED' } } })
    assert.deepEqual(r, { doc: { ok: true } })
    const { filter, update, opts } = M.calls[0]
    assert.deepEqual(filter, { _id: 'id1', isDeleted: false, status: { $in: ['OPEN'] }, version: 0 })
    assert.deepEqual(update.$inc, { version: 1 })
    assert.deepEqual(update.$set, { status: 'ASSIGNED' })
    assert.equal(opts.returnDocument, 'after'); assert.equal(opts.runValidators, true)
  })
  test('null result: gone -> 404, stale -> 409, wrong status -> 400', async () => {
    let r = await atomicTransition({ Model: fakeModel(null, { updateResult: null }), ...base })
    assert.equal(r.error.status, 404)
    r = await atomicTransition({ Model: fakeModel({ isDeleted: true }, { updateResult: null }), ...base })
    assert.equal(r.error.status, 404)
    r = await atomicTransition({ Model: fakeModel({ status: 'ASSIGNED', version: 1 }, { updateResult: null }), ...base })
    assert.equal(r.error.status, 409, 'the loser of a claim race: status AND version changed')
    r = await atomicTransition({ Model: fakeModel({ status: 'ASSIGNED', version: 0 }, { updateResult: null }), ...base })
    assert.equal(r.error.status, 400); assert.match(r.error.message, /^cannot claim a ticket that is assigned$/)
    r = await atomicTransition({ Model: fakeModel({ status: 'OPEN', version: 0 }, { updateResult: null }), ...base })
    assert.equal(r.error.status, 409, 'a guard we cannot explain is treated as a conflict')
  })
  test('isValidVersion', () => {
    assert.equal(isValidVersion(0), true); assert.equal(isValidVersion(7), true)
    for (const bad of [undefined, null, '1', -1, 1.5, NaN, {}]) assert.equal(isValidVersion(bad), false)
  })
})

describe('update applier used by the stubbed tests', () => {
  test('$set/$unset/$push/$pop/$inc with dotted paths', () => {
    const d = { status: 'OPEN', version: 0, sla: { a: 1, b: 2 }, history: ['x'] }
    applyUpdate(d, { $set: { status: 'ASSIGNED', 'sla.c': 3 }, $unset: { 'sla.a': '' }, $push: { history: 'y' }, $inc: { version: 1 } })
    assert.deepEqual(d, { status: 'ASSIGNED', version: 1, sla: { b: 2, c: 3 }, history: ['x', 'y'] })
    applyUpdate(d, { $pop: { history: 1 }, $inc: { version: -1 } })
    assert.deepEqual(d.history, ['x']); assert.equal(d.version, 0)
  })
})

describe('rate limiters', () => {
  const listen = (app) => new Promise((resolve) => { const s = app.listen(0, () => resolve(s)) })

  test('AI limiter is per user and answers 429 with a JSON message', async () => {
    const app = exp()
    app.use((req, res, next) => { req.user = { id: req.get('x-user') }; next() })
    app.get('/ai', aiLimiter, (req, res) => res.json({ ok: true }))
    const server = await listen(app)
    const url = `http://127.0.0.1:${server.address().port}/ai`
    try {
      const hit = async (user) => (await fetch(url, { headers: { 'x-user': user } })).status
      assert.deepEqual([await hit('a'), await hit('a'), await hit('a')], [200, 200, 429])
      assert.equal(await hit('b'), 200, 'a different user has their own bucket')
      const blocked = await fetch(url, { headers: { 'x-user': 'a' } })
      assert.match((await blocked.json()).message, /Too many AI requests/)
    } finally { server.close() }
  })

  test('login limiter ignores successful requests', async () => {
    const app = exp()
    app.post('/login', loginLimiter, (req, res) => res.status(req.get('x-ok') === '1' ? 200 : 401).json({}))
    const server = await listen(app)
    const url = `http://127.0.0.1:${server.address().port}/login`
    try {
      const post = async (ok) => (await fetch(url, { method: 'POST', headers: { 'x-ok': ok ? '1' : '0' } })).status
      for (let i = 0; i < 15; i++) assert.equal(await post(true), 200)
      for (let i = 0; i < 10; i++) assert.equal(await post(false), 401)
      assert.equal(await post(false), 429)
    } finally { server.close() }
  })
})

test('timezone constant', () => assert.equal(APP_TIME_ZONE, 'Asia/Kolkata'))

describe('statusRefusal (F-103)', () => {
  test('reads as a sentence: article, lower-case status, no underscores', () => {
    assert.equal(statusRefusal('assign', 'ASSIGNED', 'ticket'), 'cannot assign a ticket that is assigned')
    assert.equal(statusRefusal('resolve', 'IN_PROGRESS', 'ticket'), 'cannot resolve a ticket that is in progress')
    assert.equal(statusRefusal('retire', 'IN_REPAIR', 'asset'), 'cannot retire an asset that is in repair')
    assert.equal(statusRefusal('publish', 'PENDING_APPROVAL', 'article'), 'cannot publish an article that is pending approval')
    assert.equal(statusRefusal('use', 'ASSIGNED', 'replacement asset'), 'cannot use a replacement asset that is assigned')
  })
  test('the transition checkers use it', () => {
    assert.equal(isTransitionAllowed('assign', 'ASSIGNED', 'MANAGER').reason, 'cannot assign a ticket that is assigned')
    assert.equal(isAssetTransitionAllowed('activate', 'IN_STOCK', 'ADMIN', {}).reason, 'cannot activate an asset that is in stock')
    assert.equal(isKbTransitionAllowed('publish', 'ARCHIVED', 'ADMIN').reason, 'cannot publish an article that is archived')
  })
})
