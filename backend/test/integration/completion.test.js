// TICKET-COMPLETION on a real database: closeReason/closedAt, CSAT, work logs and
// the comment rules.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { bootApp, loginAs } from '../../testkit/boot.js'
import { createTicket, act, fetchTicket } from '../../testkit/helpers.js'

describe('ticket completion (real database)', () => {
  let ctx, emp, emp2, mgr, tech, tech2, techInfra, admin

  before(async () => {
    ctx = await bootApp()
    const { app } = ctx
    ;[emp, emp2, mgr, tech, tech2, techInfra, admin] = await Promise.all(
      ['emp@t.test', 'emp2@t.test', 'mgr.svc@t.test', 'tech.svc@t.test', 'tech.svc2@t.test', 'tech.infra@t.test', 'admin@t.test'].map((e) => loginAs(app, e)),
    )
  })
  after(() => ctx.stop())

  // OPEN -> ASSIGNED (claim) -> IN_PROGRESS -> RESOLVED; returns the ticket as the API last returned it
  const toResolved = async () => {
    let t = await createTicket(emp, ctx.fx.categories.hardware._id)
    t = (await act(tech, t, 'claim')).body.payload
    t = (await act(tech, t, 'start')).body.payload
    t = (await act(tech, t, 'resolve', { resolutionSummary: 'replaced the charger' })).body.payload
    return t
  }
  const csat = (agent, t, body) => agent.post(`/ticket-api/tickets/${t.publicId}/csat`).send(body)

  test('confirm sets closeReason and closedAt; CSAT rules; reopen clears them but keeps the old rating until it is overwritten', async () => {
    let t = await toResolved()
    assert.equal(t.closeReason, undefined)

    // not closed yet
    assert.equal((await csat(emp, t, { rating: 5 })).status, 400)

    let r = await act(emp, t, 'confirm')
    assert.equal(r.status, 200, JSON.stringify(r.body))
    t = r.body.payload
    assert.equal(t.status, 'CLOSED'); assert.equal(t.closeReason, 'CONFIRMED'); assert.ok(t.closedAt)

    // validation, ownership
    for (const rating of [0, 6, 2.5, '5', null, undefined]) {
      assert.equal((await csat(emp, t, { rating })).status, 400, `rating ${rating}`)
    }
    assert.equal((await csat(emp, t, { rating: 4, comment: 'x'.repeat(501) })).status, 400)
    assert.equal((await csat(emp2, t, { rating: 5 })).status, 404, 'another employee')
    assert.equal((await csat(tech, t, { rating: 5 })).status, 404, 'staff are not the requester')

    // the requester rates once
    r = await csat(emp, t, { rating: 3, comment: '  slow but fixed  ' })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.equal(r.body.payload.csat.rating, 3); assert.equal(r.body.payload.csat.comment, 'slow but fixed')
    assert.equal((await csat(emp, t, { rating: 5 })).status, 409, 'second rating in the same closure')

    // reopen from CLOSED (window is measured from closedAt) clears the close fields, keeps the rating
    t = await fetchTicket(emp, t)
    r = await act(emp, t, 'reopen', { note: 'broke again' })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    t = r.body.payload
    assert.equal(t.status, 'REOPENED'); assert.equal(t.closeReason, undefined); assert.equal(t.closedAt, undefined)
    assert.equal(t.csat.rating, 3)
    assert.equal((await csat(emp, t, { rating: 5 })).status, 400, 'a reopened ticket cannot be rated')

    // close it again: a new rating overwrites the old one
    t = (await act(tech, t, 'start')).body.payload
    t = (await act(tech, t, 'resolve', { resolutionSummary: 'new charger and port' })).body.payload
    t = (await act(emp, t, 'confirm')).body.payload
    assert.ok(t.closedAt)
    r = await csat(emp, t, { rating: 5 })
    assert.equal(r.status, 201); assert.equal(r.body.payload.csat.rating, 5)
  })

  test('a CLOSED ticket closed before closedAt existed can still be reopened (falls back to resolution.confirmedAt)', async () => {
    const { TicketModel } = await import('../../models/TicketModel.js')
    let t = await toResolved()
    t = (await act(emp, t, 'confirm')).body.payload
    await TicketModel.updateOne({ _id: t._id }, { $unset: { closedAt: '', closeReason: '' } })
    t = await fetchTicket(emp, t)
    assert.equal((await act(emp, t, 'reopen', { note: 'again' })).status, 200)
  })

  test('work logs: only the assigned technician adds; the team (and admin) reads; validation and terminal tickets', async () => {
    const { fx } = ctx
    let t = await createTicket(emp, fx.categories.hardware._id)
    const add = (agent, body) => agent.post(`/worklog-api/${t.publicId}`).send(body)
    t = (await act(tech, t, 'claim')).body.payload

    assert.equal((await add(tech2, { description: 'looked at it', minutesSpent: 10 })).status, 404, 'a technician who is not assigned')
    assert.equal((await add(mgr, { description: 'x', minutesSpent: 10 })).status, 403, 'managers do not log work')
    assert.equal((await add(emp, { description: 'x', minutesSpent: 10 })).status, 403)
    for (const body of [{}, { description: '', minutesSpent: 5 }, { description: 'a', minutesSpent: 0 }, { description: 'a', minutesSpent: 1441 }, { description: 'a', minutesSpent: 1.5 }, { description: 'a', minutesSpent: '5' }, { description: 'x'.repeat(1001), minutesSpent: 5 }]) {
      assert.equal((await add(tech, body)).status, 400, JSON.stringify(body).slice(0, 60))
    }
    let r = await add(tech, { description: 'swapped the charger', minutesSpent: 25 })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.equal((await add(tech, { description: 'tested for an hour', minutesSpent: 60 })).status, 201)

    r = await mgr.get(`/worklog-api/${t.publicId}`)
    assert.equal(r.status, 200); assert.equal(r.body.payload.total, 2); assert.equal(r.body.payload.totalMinutes, 85)
    assert.equal(r.body.payload.items[0].description, 'tested for an hour', 'newest first')
    assert.ok(r.body.payload.items[0].technician.firstName)
    assert.equal((await tech2.get(`/worklog-api/${t.publicId}`)).status, 200, 'any technician of the team can read')
    assert.equal((await admin.get(`/worklog-api/${t.publicId}`)).status, 200)
    assert.equal((await techInfra.get(`/worklog-api/${t.publicId}`)).status, 404, 'other team')
    assert.equal((await emp.get(`/worklog-api/${t.publicId}`)).status, 403, 'the requester does not see work logs')

    // finished tickets accept no more work
    t = (await act(tech, t, 'start')).body.payload
    t = (await act(tech, t, 'resolve', { resolutionSummary: 'done' })).body.payload
    assert.equal((await add(tech, { description: 'late note', minutesSpent: 5 })).status, 201, 'RESOLVED still accepts work')
    t = (await act(emp, t, 'confirm')).body.payload
    assert.equal((await add(tech, { description: 'too late', minutesSpent: 5 })).status, 400)
  })

  test('comment rules: who may reply publicly, internal-only for other team technicians, finished tickets, first response, no version bump', async () => {
    const { fx } = ctx
    let t = await createTicket(emp, fx.categories.hardware._id)
    const say = (agent, text, isInternal = false) => agent.post(`/ticket-api/tickets/${t.publicId}/comments`).send({ text, isInternal })

    assert.equal((await say(emp, '')).status, 400)
    assert.equal((await say(emp, 'x'.repeat(2001))).status, 400)
    assert.equal((await say(emp2, 'hello')).status, 403, 'someone else')
    assert.equal((await say(techInfra, 'hello', true)).status, 403, 'other team')
    assert.equal((await say(tech, 'public reply', false)).status, 403, 'a team technician who is not assigned cannot reply publicly')
    assert.equal((await say(tech, 'INTERNAL: looks like a charger', true)).status, 201)
    assert.equal((await say(mgr, 'we are on it')).status, 201, 'team manager')
    assert.equal((await say(admin, 'admin here')).status, 201)

    // assign: the assigned technician may reply publicly, and that is the first response
    t = (await act(mgr, t, 'assign', { technicianId: String(fx.users.techSvc._id) })).body.payload
    let before = await fetchTicket(tech, t)
    assert.equal(before.sla.firstRespondedAt, undefined)
    const versionBefore = before.version
    const r = await say(tech, 'Hi, I picked this up')
    assert.equal(r.status, 201); assert.equal(r.body.payload.isInternal, false)
    const after = await fetchTicket(tech, t)
    assert.ok(after.sla.firstRespondedAt, 'first public reply by the assignee stamps firstRespondedAt')
    assert.equal(after.version, versionBefore, 'a comment does not bump version')
    const stamped = after.sla.firstRespondedAt
    await say(tech, 'second reply')
    assert.equal((await fetchTicket(tech, t)).sla.firstRespondedAt, stamped, 'the first response time is kept')

    // the requester hears about public replies, not internal notes
    const mine = (await emp.get('/notification-api/my-notifications?limit=50')).body.payload.items
    assert.ok(mine.some((n) => n.type === 'COMMENT_ADDED' && n.message.includes(t.publicId)))
    assert.ok(!mine.some((n) => n.message.toLowerCase().includes('internal note')))

    // a transition made with the version from before the comments still works
    assert.equal((await act(tech, t, 'start')).status, 200)

    // no comments on finished tickets
    let c = await createTicket(emp, fx.categories.hardware._id)
    c = (await act(emp, c, 'cancel', { note: 'not needed' })).body.payload
    assert.equal((await emp.post(`/ticket-api/tickets/${c.publicId}/comments`).send({ text: 'hello?' })).status, 400)
    assert.equal((await mgr.post(`/ticket-api/tickets/${c.publicId}/comments`).send({ text: 'note', isInternal: true })).status, 400)

    // RESOLVED still takes a reply (the requester answers before confirming)
    const resolved = await toResolved()
    assert.equal((await emp.post(`/ticket-api/tickets/${resolved.publicId}/comments`).send({ text: 'thanks, checking' })).status, 201)
  })

  test('notifications carry the aligned types: RESOLUTION_PENDING on resolve, TICKET_CLOSED on confirm, TICKET_ON_HOLD on hold', async () => {
    const { fx } = ctx
    let t = await createTicket(emp, fx.categories.hardware._id)
    t = (await act(tech, t, 'claim')).body.payload
    t = (await act(tech, t, 'start')).body.payload
    t = (await act(tech, t, 'hold', { note: 'waiting for a part' })).body.payload
    t = (await act(tech, t, 'resume')).body.payload
    t = (await act(tech, t, 'resolve', { resolutionSummary: 'done' })).body.payload
    await act(emp, t, 'confirm')
    const empTypes = (await emp.get('/notification-api/my-notifications?limit=50')).body.payload.items.filter((n) => n.message.includes(t.publicId)).map((n) => n.type)
    assert.ok(empTypes.includes('TICKET_ON_HOLD')); assert.ok(empTypes.includes('RESOLUTION_PENDING'))
    const techTypes = (await tech.get('/notification-api/my-notifications?limit=50')).body.payload.items.filter((n) => n.message.includes(t.publicId)).map((n) => n.type)
    assert.ok(techTypes.includes('TICKET_CLOSED'))
  })

  test('mark-read with a malformed id is a 400, not a 500', async () => {
    assert.equal((await emp.put('/notification-api/mark-read/not-an-id')).status, 400)
    assert.equal((await emp.put('/notification-api/mark-all-read')).status, 200)
  })
})
