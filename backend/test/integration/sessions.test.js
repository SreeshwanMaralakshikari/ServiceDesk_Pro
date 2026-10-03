// logout, password-change session revocation, cookie lifetime and error mapping on a real database
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import { bootApp, loginAs, PASSWORD } from '../../testkit/boot.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const NEW_PASSWORD = 'A-brand-new-password-42'

describe('sessions and error handling (real database)', () => {
  let ctx
  before(async () => { ctx = await bootApp({ JWT_EXPIRES_IN: '2h' }) })
  after(() => ctx.stop())

  test('logout is POST: it clears the cookie, and the old GET route is gone', async () => {
    const agent = await loginAs(ctx.app, 'emp2@t.test')
    assert.equal((await agent.get('/auth/check-auth')).status, 200)
    const get = await agent.get('/auth/logout')
    assert.equal(get.status, 404)
    const out = await agent.post('/auth/logout')
    assert.equal(out.status, 200)
    assert.match(String(out.headers['set-cookie']), /token=;/)
    assert.equal((await agent.get('/auth/check-auth')).status, 401)
  })

  test('cookie lifetime follows JWT_EXPIRES_IN (2h -> 7200 seconds)', async () => {
    const res = await request(ctx.app).post('/auth/login').send({ email: 'emp@t.test', password: PASSWORD })
    assert.equal(res.status, 200)
    assert.match(String(res.headers['set-cookie']), /Max-Age=7200/)
  })

  test('changing the password signs out every other session, and the new password logs in', async () => {
    const a = await loginAs(ctx.app, 'tech.svc2@t.test')
    const b = await loginAs(ctx.app, 'tech.svc2@t.test') // a second device
    await sleep(1100) // tokens carry whole seconds; the change must land in a later second
    assert.equal((await a.put('/auth/password').send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })).status, 200)
    assert.equal((await a.get('/auth/check-auth')).status, 401, 'cookie cleared on the device that changed it')
    const stale = await b.get('/auth/check-auth')
    assert.equal(stale.status, 401, 'the other device is signed out')
    assert.equal((await request(ctx.app).post('/auth/login').send({ email: 'tech.svc2@t.test', password: PASSWORD })).status, 401, 'old password no longer works')
    const fresh = request.agent(ctx.app)
    assert.equal((await fresh.post('/auth/login').send({ email: 'tech.svc2@t.test', password: NEW_PASSWORD })).status, 200)
    assert.equal((await fresh.get('/auth/check-auth')).status, 200, 'a session started after the change works')
  })

  test('a user who never changed their password keeps working sessions', async () => {
    const agent = await loginAs(ctx.app, 'mgr.svc@t.test')
    await sleep(1100)
    assert.equal((await agent.get('/auth/check-auth')).status, 200)
  })

  test('malformed JSON is 400, not 500', async () => {
    const res = await request(ctx.app).post('/auth/login').set('Content-Type', 'application/json').send('{"email": ')
    assert.equal(res.status, 400)
    assert.equal(res.body.error, 'invalid JSON body')
  })

  test('duplicate email on register is 409 and does not echo the address', async () => {
    const body = { firstName: 'Dup', email: 'dup@t.test', password: 'A-long-password-123', department: String(ctx.fx.departments.hr._id) }
    assert.equal((await request(ctx.app).post('/auth/users').send(body)).status, 201)
    const again = await request(ctx.app).post('/auth/users').send(body)
    assert.equal(again.status, 409)
    assert.ok(!JSON.stringify(again.body).includes('dup@t.test'), 'value not echoed')
  })
})
