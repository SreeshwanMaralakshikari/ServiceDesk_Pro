// Audit trail, the account-keyed login limiter (F-045) and the password length
// rule, on a real database.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import { bootApp, loginAs, PASSWORD } from '../../testkit/boot.js'
import { createTicket, act } from '../../testkit/helpers.js'

describe('audit trail and account hardening (real database)', () => {
  let ctx, emp, mgr, tech, admin, assetMgr, AuditLogModel

  before(async () => {
    ctx = await bootApp()
    ;[emp, mgr, tech, admin, assetMgr] = await Promise.all(
      ['emp@t.test', 'mgr.svc@t.test', 'tech.svc@t.test', 'admin@t.test', 'assets@t.test'].map((e) => loginAs(ctx.app, e)),
    )
    AuditLogModel = (await import('../../models/AuditLogModel.js')).AuditLogModel
  })
  after(() => ctx.stop())

  const trail = async (entityRef) => (await admin.get(`/admin-api/audit-logs?entityRef=${entityRef}&limit=50`)).body.payload.items

  test('every ticket transition writes an entry with actor, before and after; only an admin can read the log', async () => {
    const { fx } = ctx
    let t = await createTicket(emp, fx.categories.hardware._id)
    t = (await act(mgr, t, 'assign', { technicianId: String(fx.users.techSvc._id) })).body.payload
    t = (await act(tech, t, 'start')).body.payload
    await emp.post(`/ticket-api/tickets/${t.publicId}/comments`).send({ text: 'thanks' })
    t = (await act(tech, t, 'resolve', { resolutionSummary: 'done' })).body.payload
    t = (await act(emp, t, 'confirm')).body.payload
    await emp.post(`/ticket-api/tickets/${t.publicId}/csat`).send({ rating: 4 })
    await mgr.patch(`/ticket-api/tickets/${t.publicId}/priority`).send({ priority: 'HIGH', version: t.version }) // CLOSED: rejected, must NOT be logged

    const entries = await trail(t.publicId)
    const actions = entries.map((e) => e.action).reverse() // oldest first
    assert.deepEqual(actions, ['TICKET_CREATED', 'TICKET_ASSIGN', 'TICKET_START', 'TICKET_COMMENT_ADDED', 'TICKET_RESOLVE', 'TICKET_CONFIRM', 'TICKET_CSAT'])
    const assign = entries.find((e) => e.action === 'TICKET_ASSIGN')
    assert.equal(assign.actor.email, 'mgr.svc@t.test'); assert.equal(assign.entityType, 'TICKET')
    assert.equal(assign.before.status, 'OPEN'); assert.equal(assign.after.status, 'ASSIGNED')
    assert.equal(assign.before.version, 0); assert.equal(assign.after.version, 1)
    assert.ok(assign.ip, 'the caller address is recorded')
    assert.ok(!JSON.stringify(entries).includes('thanks'), 'comment text is never copied into the log')

    // readers
    for (const agent of [emp, mgr, tech, assetMgr]) assert.equal((await agent.get('/admin-api/audit-logs')).status, 403)
    assert.equal((await request(ctx.app).get('/admin-api/audit-logs')).status, 401)
  })

  test('assets, knowledge base, users, login and password change are logged too', async () => {
    const { fx } = ctx
    let r = await assetMgr.post('/asset-api/assets').send({ name: 'Audit laptop', type: 'HARDWARE', assetClass: 'Laptop' })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    const asset = r.body.payload
    r = await assetMgr.patch(`/asset-api/assets/${asset.publicId}/activate`).send({ version: asset.version })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.deepEqual((await trail(asset.publicId)).map((e) => e.action).reverse(), ['ASSET_CREATED', 'ASSET_ACTIVATE'])

    r = await tech.post('/kb-api/articles').send({ title: 'Audit article', summary: 'summary', content: 'content here', categoryId: String(fx.categories.hardware._id), tags: [] })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    const article = r.body.payload
    r = await mgr.patch(`/kb-api/articles/${article.publicId}/publish`).send({ version: article.version })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.deepEqual((await trail(article.publicId)).map((e) => e.action).reverse(), ['KB_CREATED', 'KB_PUBLISH'])

    r = await admin.post('/admin-api/users').send({ firstName: 'New', email: 'new.emp@t.test', password: 'Passw0rd!Passw0rd!', role: 'EMPLOYEE', department: String(fx.departments.hr._id) })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    r = await admin.patch(`/admin-api/users/${r.body.payload._id}/status`).send({ isActive: false })
    assert.equal(r.status, 200)
    const byType = (await admin.get('/admin-api/audit-logs?entityType=USER&limit=50')).body.payload.items.map((e) => e.action)
    assert.ok(byType.includes('USER_CREATED')); assert.ok(byType.includes('USER_STATUS_CHANGED')); assert.ok(byType.includes('LOGIN'))
    assert.ok(!JSON.stringify(byType).includes('Passw0rd'))
  })

  test('filters are typed: a bad actor id is a 400, repeated or operator keys are ignored, pages are clamped', async () => {
    assert.equal((await admin.get('/admin-api/audit-logs?actor=nope')).status, 400)
    let r = await admin.get('/admin-api/audit-logs?action=TICKET_CREATED&action=LOGIN')
    assert.equal(r.status, 200)
    r = await admin.get('/admin-api/audit-logs?action[$ne]=LOGIN&entityType[]=TICKET')
    assert.equal(r.status, 200); assert.ok(r.body.payload.total > 0, 'ignored filters return the unfiltered log')
    r = await admin.get('/admin-api/audit-logs?limit=1000&page=-2')
    assert.equal(r.status, 200); assert.ok(r.body.payload.items.length <= 50); assert.equal(r.body.payload.page, 1)
  })

  test('the log is immutable through the model, and a failed audit write never breaks the request', async () => {
    const entry = await AuditLogModel.findOne()
    entry.action = 'TAMPERED'
    await assert.rejects(() => entry.save(), /immutable/)
    await assert.rejects(() => AuditLogModel.updateOne({ _id: entry._id }, { action: 'TAMPERED' }), /immutable/)
    await assert.rejects(() => AuditLogModel.deleteMany({}), /immutable/)
    await assert.rejects(() => AuditLogModel.findOneAndUpdate({ _id: entry._id }, { action: 'X' }), /immutable/)
    assert.notEqual((await AuditLogModel.findById(entry._id)).action, 'TAMPERED')

    const original = AuditLogModel.create
    const logged = []
    const log = console.log
    console.log = (...a) => logged.push(a.join(' '))
    AuditLogModel.create = async () => { throw new Error('audit database is down') }
    try {
      const t = await createTicket(emp, ctx.fx.categories.hardware._id)
      const r = await act(tech, t, 'claim')
      assert.equal(r.status, 200, 'the claim still succeeds'); assert.equal(r.body.payload.status, 'ASSIGNED')
    } finally {
      AuditLogModel.create = original
      console.log = log
    }
    assert.ok(logged.some((l) => l.includes('audit log write failed')), 'the failure is logged')
  })

  test('F-045: the login limiter is keyed on the account, so rotating forged X-Forwarded-For addresses does not help', async () => {
    const attempt = (n, email, password) => request(ctx.app).post('/auth/login').set('X-Forwarded-For', `10.9.0.${n}`).send({ email, password })
    for (let i = 1; i <= 20; i++) assert.equal((await attempt(i, 'emp2@t.test', 'wrong-password')).status, 401, `attempt ${i}`)
    assert.equal((await attempt(21, 'emp2@t.test', 'wrong-password')).status, 429, 'the 21st failure for the same account, from a brand-new address')
    assert.equal((await attempt(22, 'emp2@t.test', PASSWORD)).status, 429, 'even the right password waits out the window')
    // other accounts are not affected, and case does not create a second bucket
    assert.equal((await attempt(23, 'EMP2@T.TEST', 'wrong-password')).status, 429)
    assert.equal((await attempt(24, 'tech.svc2@t.test', PASSWORD)).status, 200)
  })

  test('change password: 12-72 characters, old one stops working, the change is logged', async () => {
    const agent = await loginAs(ctx.app, 'tech.svc2@t.test')
    const put = (body) => agent.put('/auth/password').send(body)
    assert.equal((await put({ currentPassword: PASSWORD })).status, 400)
    assert.equal((await put({ currentPassword: PASSWORD, newPassword: 'short1!' })).status, 400)
    assert.equal((await put({ currentPassword: PASSWORD, newPassword: 'x'.repeat(73) })).status, 400)
    assert.equal((await put({ currentPassword: 'not the password', newPassword: 'Another-long-pass-1' })).status, 401)
    assert.equal((await put({ currentPassword: PASSWORD, newPassword: 'Another-long-pass-1' })).status, 200)
    assert.equal((await request(ctx.app).post('/auth/login').set('X-Forwarded-For', '10.9.1.1').send({ email: 'tech.svc2@t.test', password: PASSWORD })).status, 401)
    assert.equal((await request(ctx.app).post('/auth/login').set('X-Forwarded-For', '10.9.1.2').send({ email: 'tech.svc2@t.test', password: 'Another-long-pass-1' })).status, 200)
    const actions = (await admin.get('/admin-api/audit-logs?entityType=USER&limit=50')).body.payload.items.map((e) => e.action)
    assert.ok(actions.includes('PASSWORD_CHANGED'))
  })
})
