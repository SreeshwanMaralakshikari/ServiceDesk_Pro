// Real MongoDB (mongodb-memory-server) + the real app.js: the full ticket
// lifecycle through HTTP, including the required `version` and the 400/403/409 rules.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { bootApp, loginAs } from '../../testkit/boot.js'
import { createTicket, act, fetchTicket } from '../../testkit/helpers.js'

describe('ticket lifecycle (real database)', () => {
  let ctx, emp, mgr, tech, techInfra, admin

  before(async () => {
    ctx = await bootApp()
    const { app } = ctx
    ;[emp, mgr, tech, techInfra, admin] = await Promise.all(
      ['emp@t.test', 'mgr.svc@t.test', 'tech.svc@t.test', 'tech.infra@t.test', 'admin@t.test'].map((e) => loginAs(app, e)),
    )
  })
  after(() => ctx.stop())

  test('create -> assign -> start -> hold -> resume -> resolve -> confirm -> reopen, versions increment each step', async () => {
    const { fx } = ctx
    let t = await createTicket(emp, fx.categories.hardware._id)
    assert.equal(t.status, 'OPEN')
    assert.equal(t.priority, 'MEDIUM') // category default
    assert.equal(t.version, 0)
    assert.ok(t.sla.resolutionDueAt, 'SLA clock started on creation')

    let r = await act(mgr, t, 'assign', { technicianId: String(fx.users.techSvc._id) })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    t = r.body.payload
    assert.equal(t.status, 'ASSIGNED'); assert.equal(t.version, 1)
    assert.equal(String(t.assignedTo), String(fx.users.techSvc._id))

    r = await act(tech, t, 'start'); t = r.body.payload
    assert.equal(t.status, 'IN_PROGRESS'); assert.ok(t.sla.firstRespondedAt)

    assert.equal((await act(tech, t, 'hold')).status, 400, 'hold needs a reason')
    r = await act(tech, t, 'hold', { note: 'waiting for a part' }); t = r.body.payload
    assert.equal(t.status, 'ON_HOLD'); assert.ok(t.sla.pausedAt)

    r = await act(tech, t, 'resume'); t = r.body.payload
    assert.equal(t.status, 'IN_PROGRESS'); assert.equal(t.sla.pausedAt, undefined)

    assert.equal((await act(tech, t, 'resolve')).status, 400, 'resolve needs a summary')
    r = await act(tech, t, 'resolve', { resolutionSummary: 'replaced the charger' }); t = r.body.payload
    assert.equal(t.status, 'RESOLVED'); assert.equal(t.resolution.summary, 'replaced the charger')

    r = await act(emp, t, 'confirm'); t = r.body.payload
    assert.equal(t.status, 'CLOSED'); assert.equal(t.resolution.confirmedByRequester, true)

    r = await act(emp, t, 'reopen', { note: 'it broke again' }); t = r.body.payload
    assert.equal(t.status, 'REOPENED'); assert.equal(t.reopenCount, 1); assert.equal(t.resolution.summary, undefined)
    assert.equal(t.version, 7)

    const detail = await fetchTicket(admin, t)
    assert.deepEqual(detail.statusHistory.map((h) => h.to), ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REOPENED'])
  })

  test('approval-required category: PENDING_APPROVAL has no SLA clock until a manager approves', async () => {
    const { fx } = ctx
    let t = await createTicket(emp, fx.categories.newHardware._id)
    assert.equal(t.status, 'PENDING_APPROVAL'); assert.equal(t.sla.startedAt, undefined)
    assert.equal((await act(emp, t, 'approve')).status, 403)
    assert.equal((await act(mgr, t, 'reject')).status, 400, 'reject needs a note')
    const r = await act(mgr, t, 'approve'); t = r.body.payload
    assert.equal(t.status, 'OPEN'); assert.ok(t.sla.startedAt); assert.ok(t.sla.resolutionDueAt)
  })

  test('claim by a technician of the team; cancel by the requester', async () => {
    const { fx } = ctx
    let t = await createTicket(emp, fx.categories.hardware._id)
    let r = await act(tech, t, 'claim'); t = r.body.payload
    assert.equal(t.status, 'ASSIGNED'); assert.equal(String(t.assignedTo), String(fx.users.techSvc._id))
    r = await act(emp, t, 'cancel', { note: 'no longer needed' })
    assert.equal(r.status, 200); assert.equal(r.body.payload.status, 'CANCELLED')
  })

  test('version is required: missing -> 400, stale -> 409, nothing changes', async () => {
    const { fx } = ctx
    const t = await createTicket(emp, fx.categories.hardware._id)
    let r = await mgr.patch(`/ticket-api/tickets/${t.publicId}/assign`).send({ technicianId: String(fx.users.techSvc._id) })
    assert.equal(r.status, 400); assert.match(r.body.message, /version/)
    r = await mgr.patch(`/ticket-api/tickets/${t.publicId}/assign`) // no body at all
    assert.equal(r.status, 400)
    r = await act(mgr, { ...t, version: 99 }, 'assign', { technicianId: String(fx.users.techSvc._id) })
    assert.equal(r.status, 409)
    assert.equal((await fetchTicket(mgr, t)).status, 'OPEN')
    assert.equal((await fetchTicket(mgr, t)).version, 0)
  })

  test('wrong role -> 403, other team -> 403, wrong status -> 400, unknown action -> 400', async () => {
    const { fx } = ctx
    const t = await createTicket(emp, fx.categories.hardware._id)
    assert.equal((await act(emp, t, 'assign', { technicianId: String(fx.users.techSvc._id) })).status, 403)
    assert.equal((await act(techInfra, t, 'claim')).status, 403, 'technician of another team')
    assert.equal((await act(tech, t, 'resolve', { resolutionSummary: 'x' })).status, 400, 'cannot resolve an OPEN ticket')
    assert.equal((await act(mgr, t, 'explode')).status, 400)
    const claimed = (await act(tech, t, 'claim')).body.payload
    assert.equal((await act(techInfra, claimed, 'start')).status, 403)
    assert.equal((await act(tech, claimed, 'claim')).status, 400, 'claiming an ASSIGNED ticket with the current version')
  })

  test('priority change is manager/admin, version-guarded, and validated against active policies', async () => {
    const { fx } = ctx
    const t = await createTicket(emp, fx.categories.hardware._id)
    const patch = (agent, body) => agent.patch(`/ticket-api/tickets/${t.publicId}/priority`).send(body)
    assert.equal((await patch(emp, { priority: 'HIGH', version: 0 })).status, 403)
    assert.equal((await patch(mgr, { priority: 'HIGH' })).status, 400, 'version required')
    assert.equal((await patch(mgr, { priority: 'NOPE', version: 0 })).status, 400)
    assert.equal((await patch(mgr, { priority: 'RETIRED', version: 0 })).status, 400, 'inactive policy')
    assert.equal((await patch(mgr, { priority: 'HIGH', version: 5 })).status, 409)
    const r = await patch(mgr, { priority: 'HIGH', version: 0 })
    assert.equal(r.status, 200); assert.equal(r.body.payload.priority, 'HIGH'); assert.equal(r.body.payload.version, 1)
  })
})
