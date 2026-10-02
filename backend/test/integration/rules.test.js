// Create-time rules, pagination/filter hardening, role<->department validation,
// published-only KB suggestions and the per-user AI limiter, on a real database.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { bootApp, loginAs } from '../../testkit/boot.js'
import { createTicket, act } from '../../testkit/helpers.js'

describe('rules and hardening (real database)', () => {
  let ctx, emp, mgr, tech, admin, assetMgr, anon
  const J = (v) => JSON.stringify(v)

  before(async () => {
    ctx = await bootApp({ AI_RATE_LIMIT_MAX: '3' })
    const { app } = ctx
    ;[emp, mgr, tech, admin, assetMgr] = await Promise.all(
      ['emp@t.test', 'mgr.svc@t.test', 'tech.svc@t.test', 'admin@t.test', 'assets@t.test'].map((e) => loginAs(app, e)),
    )
    const { default: request } = await import('supertest')
    anon = request(app)
  })
  after(() => ctx.stop())

  test('priority on create: must be an active policy; TEST is staff-only; case-insensitive; default from category', async () => {
    const cat = ctx.fx.categories.hardware._id
    const post = (agent, priority) => agent.post('/ticket-api/tickets').send({ title: 'T', description: 'D', categoryId: String(cat), priority })
    assert.equal((await post(emp, 'NOPE')).status, 400)
    assert.equal((await post(emp, 'RETIRED')).status, 400, 'inactive policy')
    assert.equal((await post(emp, 'TEST')).status, 400, 'employee cannot use the level-0 TEST priority')
    assert.equal((await post(emp, ['HIGH'])).status, 400, 'array')
    assert.equal((await post(emp, { $ne: 1 })).status, 400, 'object')
    const high = await post(emp, 'high')
    assert.equal(high.status, 201); assert.equal(high.body.payload.priority, 'HIGH')
    const dflt = await post(emp, undefined)
    assert.equal(dflt.status, 201); assert.equal(dflt.body.payload.priority, 'MEDIUM')
    const test = await post(admin, 'TEST')
    assert.equal(test.status, 201); assert.equal(test.body.payload.priority, 'TEST')
  })

  test('pagination is clamped: limit=0, limit=1000, page=abc, page=-3 never return the whole collection or NaN', async () => {
    for (let i = 0; i < 3; i++) await createTicket(emp, ctx.fx.categories.hardware._id, { title: `page ${i}` })
    const get = (qs) => emp.get(`/ticket-api/tickets${qs}`)
    for (const qs of ['?limit=0', '?limit=-5', '?limit=abc', '?limit=1000', '?page=abc', '?page=-3', '?page=0']) {
      const r = await get(qs)
      assert.equal(r.status, 200, qs)
      const p = r.body.payload
      assert.ok(Number.isFinite(p.totalPages) && p.totalPages >= 1, `${qs}: totalPages ${p.totalPages}`)
      assert.ok(p.page >= 1, `${qs}: page ${p.page}`)
      assert.ok(p.items.length <= 50, qs)
    }
    const one = (await get('?limit=1&page=2')).body.payload
    assert.equal(one.items.length, 1); assert.equal(one.page, 2); assert.ok(one.total >= 3); assert.equal(one.totalPages, one.total)
    assert.equal((await assetMgr.get('/asset-api/assets?limit=0')).status, 200)
    const n = await emp.get('/notification-api/my-notifications?limit=0')
    assert.equal(n.status, 200); assert.ok('totalPages' in n.body.payload)
    assert.ok('totalPages' in (await emp.get('/kb-api/articles')).body.payload)
  })

  test('crafted filters (repeated keys, operator keys) are ignored, not passed to MongoDB', async () => {
    for (const qs of ['?q=a&q=b', '?status=OPEN&status=CLOSED', '?status[$ne]=OPEN', '?priority[]=HIGH', '?category[$gt]=', '?q[$ne]=x']) {
      const r = await emp.get(`/ticket-api/tickets${qs}`)
      assert.equal(r.status, 200, `${qs} -> ${r.status} ${J(r.body)}`)
    }
    assert.equal((await assetMgr.get('/asset-api/assets?q=a&q=b&status=A&status=B')).status, 200)
    const scoped = await emp.get('/ticket-api/tickets?status[$ne]=XXX')
    assert.ok(scoped.body.payload.items.every((t) => String(t.requester._id) === String(ctx.fx.users.emp._id)), 'scope still applies')
  })

  test('an Admin cannot assign a technician from another team', async () => {
    const t = await createTicket(emp, ctx.fx.categories.hardware._id)
    let r = await act(admin, t, 'assign', { technicianId: String(ctx.fx.users.techInfra._id) })
    assert.equal(r.status, 400)
    assert.match(r.body.message, /department/)
    r = await act(admin, t, 'assign', { technicianId: String(ctx.fx.users.techSvc._id) })
    assert.equal(r.status, 200)
    assert.equal((await act(admin, r.body.payload, 'reassign', { technicianId: String(ctx.fx.users.techNoDept._id) })).status, 400, 'a technician without a team is not assignable')
  })

  test('role <-> department kind is validated on admin create and on self-register', async () => {
    const { departments: d } = ctx.fx
    const create = (body) => admin.post('/admin-api/users').send({ firstName: 'N', password: 'Passw0rd!Passw0rd!', ...body })
    assert.equal((await create({ email: 'a1@t.test', role: 'TECHNICIAN', department: String(d.hr._id) })).status, 400, 'technician in a business dept')
    assert.equal((await create({ email: 'a2@t.test', role: 'TECHNICIAN' })).status, 400, 'technician without a dept')
    assert.equal((await create({ email: 'a3@t.test', role: 'MANAGER', department: String(d.hr._id) })).status, 400)
    assert.equal((await create({ email: 'a4@t.test', role: 'EMPLOYEE', department: String(d.svc._id) })).status, 400, 'employee in an IT team')
    assert.equal((await create({ email: 'a5@t.test', role: 'EMPLOYEE', department: '64b000000000000000000000' })).status, 400, 'unknown dept')
    assert.equal((await create({ email: 'a6@t.test', role: 'TECHNICIAN', department: String(d.svc._id) })).status, 201)
    assert.equal((await create({ email: 'a7@t.test', role: 'EMPLOYEE', department: String(d.hr._id) })).status, 201)
    assert.equal((await create({ email: 'a8@t.test', role: 'ASSET_MANAGER' })).status, 201, 'department optional')

    const register = (department, email) => anon.post('/auth/users').send({ firstName: 'S', email, password: 'Passw0rd!Passw0rd!', department })
    assert.equal((await register(String(d.svc._id), 'r1@t.test')).status, 400, 'self-register into an IT team')
    assert.equal((await register(String(d.hr._id), 'r2@t.test')).status, 201)
  })

  test('KB suggestions return PUBLISHED articles only, for Admin, Manager and Technician alike', async () => {
    const { KnowledgeArticleModel } = await import('../../models/KnowledgeArticleModel.js')
    const { categories, users } = ctx.fx
    const mk = (n, status, author) => KnowledgeArticleModel.create({
      publicId: `KB-2026-0010${n}`, title: `Laptop boot problem ${n}`, summary: 'S', content: 'laptop boot power', category: categories.hardware._id,
      author: author._id, status, history: [{ toStatus: status, by: author._id }],
    })
    const pub = await mk(1, 'PUBLISHED', users.techSvc)
    const draftOwn = await mk(2, 'DRAFT', users.techSvc)
    const draftOther = await mk(3, 'DRAFT', users.mgrSvc)
    const archived = await mk(4, 'ARCHIVED', users.admin)
    const t = await createTicket(emp, categories.hardware._id, { title: 'Laptop boot problem' })
    for (const [name, agent] of [['admin', admin], ['manager', mgr], ['technician', tech]]) {
      const r = await agent.get(`/ai-api/kb-suggestions/${t.publicId}`)
      assert.equal(r.status, 200, `${name}: ${J(r.body)}`)
      const ids = r.body.payload.articles.map((a) => a.publicId)
      assert.ok(ids.includes(pub.publicId), `${name} sees the published article`)
      for (const hidden of [draftOwn, draftOther, archived]) assert.ok(!ids.includes(hidden.publicId), `${name} must not see ${hidden.publicId}`)
      assert.ok(r.body.payload.articles.every((a) => a.status === 'PUBLISHED'))
    }
  })

  test('AI routes are rate limited per user (AI_RATE_LIMIT_MAX=3 here)', async () => {
    const classify = () => emp.post('/ai-api/classify-ticket').send({ title: 'wifi is down', description: 'no internet' })
    for (let i = 0; i < 3; i++) assert.equal((await classify()).status, 200)
    const blocked = await classify()
    assert.equal(blocked.status, 429)
    // another user has their own bucket
    assert.equal((await admin.post('/ai-api/classify-ticket').send({ title: 'wifi is down' })).status, 200)
  })

  test('login limiter counts failures only: ten good logins never lock an account out', async () => {
    for (let i = 0; i < 12; i++) assert.equal((await anon.post('/auth/login').send({ email: 'emp@t.test', password: 'Passw0rd!' })).status, 200)
    for (let i = 0; i < 10; i++) assert.equal((await anon.post('/auth/login').send({ email: 'emp@t.test', password: 'wrong' })).status, 401)
    assert.equal((await anon.post('/auth/login').send({ email: 'emp@t.test', password: 'wrong' })).status, 429)
  })

  test('/health reports db and cron state and a version', async () => {
    const r = await anon.get('/health')
    assert.equal(r.status, 200)
    assert.equal(r.body.payload.db, 'up')
    assert.ok(['not-started', 'running', 'disabled'].includes(r.body.payload.cron.sla))
    assert.ok(r.body.payload.version)
  })
})
