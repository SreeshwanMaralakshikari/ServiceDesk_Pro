// Internal notes must never reach an Employee (list, detail, every PATCH
// response) and staff without a department must see nothing.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { bootApp, loginAs } from '../../testkit/boot.js'
import { createTicket, act, fetchTicket, noInternal } from '../../testkit/helpers.js'

describe('ticket visibility (real database)', () => {
  let ctx, emp, emp2, mgr, tech, techInfra, techNoDept, mgrNoDept, assetMgr

  before(async () => {
    ctx = await bootApp()
    const { app } = ctx
    ;[emp, emp2, mgr, tech, techInfra, techNoDept, mgrNoDept, assetMgr] = await Promise.all(
      ['emp@t.test', 'emp2@t.test', 'mgr.svc@t.test', 'tech.svc@t.test', 'tech.infra@t.test', 'tech.nodept@t.test', 'mgr.nodept@t.test', 'assets@t.test'].map((e) => loginAs(app, e)),
    )
  })
  after(() => ctx.stop())

  const comment = (agent, ticket, text, isInternal) =>
    agent.post(`/ticket-api/tickets/${ticket.publicId}/comments`).send({ text, isInternal })

  test('an Employee never receives internal comments: list, detail, and PATCH responses', async () => {
    const { fx } = ctx
    let t = await createTicket(emp, fx.categories.hardware._id)
    assert.equal((await comment(tech, t, 'INTERNAL: suspect the mainboard', true)).status, 201)
    assert.equal((await comment(mgr, t, 'Hi, we are looking into it', false)).status, 201) // a team technician who is not assigned can only add internal notes
    assert.equal((await comment(emp, t, 'Thanks!', true)).status, 201) // an employee cannot make a note internal
    assert.equal((await comment(emp2, t, 'let me in', false)).status, 403)

    // list: no comments at all, for anybody
    const list = await emp.get('/ticket-api/tickets')
    assert.equal(list.status, 200)
    assert.ok(list.body.payload.items.length >= 1)
    for (const item of list.body.payload.items) assert.equal('comments' in item, false)
    const staffList = await mgr.get('/ticket-api/tickets')
    for (const item of staffList.body.payload.items) assert.equal('comments' in item, false)

    // detail: the employee gets the two public comments, staff get all three
    const empDetail = await fetchTicket(emp, t)
    assert.equal(empDetail.comments.length, 2); assert.ok(noInternal(empDetail))
    assert.ok(!JSON.stringify(empDetail).includes('mainboard'))
    const staffDetail = await fetchTicket(tech, t)
    assert.equal(staffDetail.comments.length, 3)
    assert.ok(JSON.stringify(staffDetail).includes('mainboard'))

    // PATCH responses the employee triggers: related-asset, then cancel
    let r = await emp.patch(`/ticket-api/tickets/${t.publicId}/related-asset`).send({})
    assert.equal(r.status, 200); assert.ok(noInternal(r.body.payload)); assert.ok(!JSON.stringify(r.body).includes('mainboard'))
    r = await act(emp, t, 'cancel', { note: 'fixed it myself' })
    assert.equal(r.status, 200); assert.ok(noInternal(r.body.payload)); assert.ok(!JSON.stringify(r.body).includes('mainboard'))

    // staff PATCH responses keep the internal notes (the team needs them)
    const t2 = await createTicket(emp, fx.categories.hardware._id)
    await comment(tech, t2, 'INTERNAL: check the warranty', true)
    r = await mgr.patch(`/ticket-api/tickets/${t2.publicId}/priority`).send({ priority: 'HIGH', version: 0 })
    assert.equal(r.status, 200); assert.ok(JSON.stringify(r.body).includes('check the warranty'))
  })

  test('the Employee confirm and reopen responses are clean too', async () => {
    const { fx } = ctx
    let t = await createTicket(emp, fx.categories.hardware._id)
    await comment(mgr, t, 'INTERNAL: cost centre is wrong', true)
    t = (await act(tech, t, 'claim')).body.payload
    t = (await act(tech, t, 'start')).body.payload
    t = (await act(tech, t, 'resolve', { resolutionSummary: 'done' })).body.payload
    let r = await act(emp, t, 'reopen', { note: 'not fixed' })
    assert.equal(r.status, 200); assert.ok(noInternal(r.body.payload)); assert.ok(!JSON.stringify(r.body).includes('cost centre'))
    t = r.body.payload
    t = (await act(tech, t, 'start')).body.payload
    t = (await act(tech, t, 'resolve', { resolutionSummary: 'really done' })).body.payload
    r = await act(emp, t, 'confirm')
    assert.equal(r.status, 200); assert.ok(noInternal(r.body.payload)); assert.ok(!JSON.stringify(r.body).includes('cost centre'))
  })

  test('other requesters and other teams cannot see the ticket at all', async () => {
    const { fx } = ctx
    const t = await createTicket(emp, fx.categories.hardware._id)
    assert.equal((await emp2.get(`/ticket-api/tickets/${t.publicId}`)).status, 404)
    assert.equal((await techInfra.get(`/ticket-api/tickets/${t.publicId}`)).status, 404)
    const empty = await emp2.get('/ticket-api/tickets')
    assert.ok(empty.body.payload.items.every((i) => i.publicId !== t.publicId))
    assert.equal((await assetMgr.get('/ticket-api/tickets')).body.payload.total, 0)
  })

  test('a technician or manager without a department sees nothing', async () => {
    const { fx } = ctx
    const t = await createTicket(emp, fx.categories.hardware._id)
    for (const agent of [techNoDept, mgrNoDept]) {
      const list = await agent.get('/ticket-api/tickets')
      assert.equal(list.status, 200)
      assert.equal(list.body.payload.total, 0); assert.deepEqual(list.body.payload.items, [])
      assert.equal((await agent.get(`/ticket-api/tickets/${t.publicId}`)).status, 404)
      assert.equal((await comment(agent, t, 'hello', false)).status, 403)
      assert.equal((await act(agent, t, 'claim')).status, 403)
    }
    // the assignment picker must not list every technician for a team-less manager
    const techs = await mgrNoDept.get('/ticket-api/team-technicians')
    assert.equal(techs.status, 200); assert.deepEqual(techs.body.payload, [])
    const own = await mgr.get('/ticket-api/team-technicians')
    assert.equal(own.body.payload.length, 2)
  })
})
