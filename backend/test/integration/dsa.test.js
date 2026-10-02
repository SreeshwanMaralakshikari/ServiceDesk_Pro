// DSA features on a real database: auto-assign, suggested technicians, the
// technician queue, similar tickets and the unified timeline.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { bootApp, loginAs } from '../../testkit/boot.js'
import { createTicket, act } from '../../testkit/helpers.js'

describe('DSA features (real database)', () => {
  let ctx, admin, mgr, emp, emp2, tech, tech2, techInfra, techNoDept, assetMgr, fx
  const J = (v) => JSON.stringify(v)
  const id = (doc) => String(doc._id)

  const setCategory = async (category, body) => {
    const r = await admin.patch(`/admin-api/categories/${id(category)}`).send(body)
    assert.equal(r.status, 200, J(r.body))
  }
  const setSkills = async (user, skills) => {
    const r = await admin.patch(`/admin-api/users/${id(user)}`).send({ skills })
    assert.equal(r.status, 200, J(r.body))
  }

  before(async () => {
    ctx = await bootApp()
    fx = ctx.fx
    ;[admin, mgr, emp, emp2, tech, tech2, techInfra, techNoDept, assetMgr] = await Promise.all(
      ['admin@t.test', 'mgr.svc@t.test', 'emp@t.test', 'emp2@t.test', 'tech.svc@t.test', 'tech.svc2@t.test', 'tech.infra@t.test', 'tech.nodept@t.test', 'assets@t.test'].map((e) => loginAs(ctx.app, e)),
    )
  })
  after(() => ctx.stop())

  test('suggested technicians: ranked by skills then load, scoped to the ticket team', async () => {
    await setSkills(fx.users.techSvc, ['vpn'])
    await setSkills(fx.users.techSvc2, ['printer', 'wifi'])
    await setCategory(fx.categories.hardware, { skills: ['printer'] })
    const t = await createTicket(emp, id(fx.categories.hardware))
    assert.equal(t.status, 'OPEN', 'autoAssign is off by default')

    const r = await mgr.get(`/ticket-api/tickets/${t.publicId}/suggested-technicians`)
    assert.equal(r.status, 200, J(r.body))
    assert.equal(r.body.payload[0].email, 'tech.svc2@t.test')
    assert.equal(r.body.payload[0].recommended, true)
    assert.deepEqual(r.body.payload[0].matchedSkills, ['printer'])
    assert.equal(r.body.payload.length, 1, 'only skilled technicians are in the pool when someone matches')
    assert.ok(!('password' in r.body.payload[0]))

    assert.equal((await admin.get(`/ticket-api/tickets/${t.publicId}/suggested-technicians`)).status, 200)
    assert.equal((await emp.get(`/ticket-api/tickets/${t.publicId}/suggested-technicians`)).status, 403)
    assert.equal((await tech.get(`/ticket-api/tickets/${t.publicId}/suggested-technicians`)).status, 403)
    const infraMgr = await loginAs(ctx.app, 'mgr.nodept@t.test')
    assert.equal((await infraMgr.get(`/ticket-api/tickets/${t.publicId}/suggested-technicians`)).status, 404)
    assert.equal((await mgr.get('/ticket-api/tickets/SD-NOPE/suggested-technicians')).status, 404)

    // no skills wanted: everyone in the team, lowest load first
    await setCategory(fx.categories.hardware, { skills: [] })
    const r2 = await mgr.get(`/ticket-api/tickets/${t.publicId}/suggested-technicians`)
    assert.equal(r2.body.payload.length, 2)
  })

  test('team-technicians now carries skills and open ticket counts', async () => {
    const r = await mgr.get('/ticket-api/team-technicians')
    assert.equal(r.status, 200)
    assert.ok(r.body.payload.every((x) => Array.isArray(x.skills) && Number.isInteger(x.openTickets)))
  })

  test('auto-assign on create: skilled pool first, then lowest load, audited and notified', async () => {
    await setCategory(fx.categories.hardware, { autoAssign: true, skills: ['printer'] })
    const t = await createTicket(emp, id(fx.categories.hardware))
    assert.equal(t.status, 'ASSIGNED')
    assert.equal(t.assignmentMethod, 'AUTO')
    assert.equal(String(t.assignedTo), id(fx.users.techSvc2))
    assert.ok(t.statusHistory.at(-1).note.startsWith('auto-assigned'))

    const logs = (await admin.get('/admin-api/audit-logs?action=TICKET_AUTO_ASSIGNED')).body.payload.items
    assert.ok(logs.some((l) => l.entityRef === t.publicId && !l.actor))
    const n = (await tech2.get('/notification-api/my-notifications')).body.payload
    assert.ok(JSON.stringify(n).includes(t.publicId))

    // nobody has the skill: the technician with the lowest load gets it (Theo has none open)
    await setCategory(fx.categories.hardware, { skills: ['kubernetes'] })
    const t2 = await createTicket(emp, id(fx.categories.hardware))
    assert.equal(String(t2.assignedTo), id(fx.users.techSvc))
    // the next one balances out: Tina and Theo now both carry one, tie -> least recently assigned (Tina)
    const t3 = await createTicket(emp, id(fx.categories.hardware))
    assert.equal(String(t3.assignedTo), id(fx.users.techSvc2))
  })

  test('auto-assign never touches approval tickets until approved; off means off', async () => {
    await setCategory(fx.categories.newHardware, { autoAssign: true })
    const t = await createTicket(emp, id(fx.categories.newHardware))
    assert.equal(t.status, 'PENDING_APPROVAL')
    assert.equal(t.assignedTo, undefined)
    const r = await act(mgr, t, 'approve')
    assert.equal(r.status, 200, J(r.body))
    assert.equal(r.body.payload.status, 'ASSIGNED')
    assert.equal(r.body.payload.assignmentMethod, 'AUTO')

    // a category without autoAssign leaves the ticket for people
    const net = await createTicket(emp, id(fx.categories.network))
    assert.equal(net.status, 'OPEN')
    assert.equal(net.assignmentMethod, undefined)
  })

  test('auto-assign is skipped when the team has no active technician', async () => {
    await setCategory(fx.categories.network, { autoAssign: true })
    await admin.patch(`/admin-api/users/${id(fx.users.techInfra)}/status`).send({ isActive: false })
    const t = await createTicket(emp, id(fx.categories.network))
    assert.equal(t.status, 'OPEN')
    await admin.patch(`/admin-api/users/${id(fx.users.techInfra)}/status`).send({ isActive: true })
    await setCategory(fx.categories.network, { autoAssign: false })
  })

  test('auto-assign loses cleanly to a manual claim that got there first', async () => {
    await setCategory(fx.categories.hardware, { autoAssign: false })
    const t = await createTicket(emp, id(fx.categories.hardware))
    const { TicketModel } = await import('../../models/TicketModel.js')
    const stale = await TicketModel.findOne({ publicId: t.publicId })
    const claimed = await act(tech, t, 'claim')
    assert.equal(claimed.status, 200)
    assert.equal(claimed.body.payload.assignmentMethod, 'CLAIM')

    await setCategory(fx.categories.hardware, { autoAssign: true })
    const { autoAssignTicket } = await import('../../utils/autoAssign.js')
    assert.equal(await autoAssignTicket(stale), null, 'stale version: nothing is overwritten')
    const after = (await tech.get(`/ticket-api/tickets/${t.publicId}`)).body.payload
    assert.equal(String(after.assignedTo._id), id(fx.users.techSvc))
    assert.equal(after.assignmentMethod, 'CLAIM')
    await setCategory(fx.categories.hardware, { autoAssign: false })
  })

  test('manual assign records assignmentMethod MANUAL', async () => {
    const t = await createTicket(emp, id(fx.categories.hardware))
    const r = await act(mgr, t, 'assign', { technicianId: id(fx.users.techSvc2) })
    assert.equal(r.body.payload.assignmentMethod, 'MANUAL')
  })

  test('queue: urgency-ordered for the technician, unassigned list for the team, nothing for others', async () => {
    const low = await createTicket(emp, id(fx.categories.hardware), { priority: 'LOW', title: 'queue low' })
    const med = await createTicket(emp, id(fx.categories.hardware), { priority: 'MEDIUM', title: 'queue medium' })
    const high = await createTicket(emp, id(fx.categories.hardware), { priority: 'HIGH', title: 'queue high' })
    const mine = new Set([low.publicId, med.publicId, high.publicId])

    const r = await tech.get('/tech-api/queue')
    assert.equal(r.status, 200, J(r.body))
    const open = r.body.payload.unassigned.filter((x) => mine.has(x.publicId)).map((x) => x.publicId)
    assert.deepEqual(open, [high.publicId, med.publicId, low.publicId], 'soonest due date first')
    assert.ok(r.body.payload.unassigned.every((x) => x.urgency && !('comments' in x)))
    assert.ok(!r.body.payload.unassigned.some((x) => x.publicId && x.status !== 'OPEN'))

    // claiming moves a ticket from the open list to "mine"
    const claim = await act(tech, med, 'claim')
    assert.equal(claim.status, 200)
    const r2 = (await tech.get('/tech-api/queue')).body.payload
    assert.ok(r2.mine.some((x) => x.publicId === med.publicId))
    assert.ok(!r2.unassigned.some((x) => x.publicId === med.publicId))
    assert.ok(r2.mine.every((x) => ['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'REOPENED'].includes(x.status)))
    // another technician's tickets are not in my list
    assert.ok(r2.mine.every((x) => String(x.assignedTo) === id(fx.users.techSvc)))

    // other team and teamless technicians never see this team's tickets
    const other = (await techInfra.get('/tech-api/queue')).body.payload
    assert.ok(!other.unassigned.some((x) => mine.has(x.publicId)))
    assert.deepEqual((await techNoDept.get('/tech-api/queue')).body.payload, { mine: [], unassigned: [] })

    assert.equal((await mgr.get('/tech-api/queue')).status, 403)
    assert.equal((await emp.get('/tech-api/queue')).status, 403)
    assert.equal((await request401()).status, 401)
  })
  const request401 = async () => (await import('supertest')).default(ctx.app).get('/tech-api/queue')

  test('similar tickets: related ones by words, never itself, staff and team only', async () => {
    const a = await createTicket(emp, id(fx.categories.hardware), { title: 'VPN client will not connect', description: 'The VPN client fails to connect from home wifi' })
    const b = await createTicket(emp2, id(fx.categories.hardware), { title: 'VPN connection fails', description: 'Cannot connect to the vpn from my home network' })
    const c = await createTicket(emp, id(fx.categories.hardware), { title: 'Printer paper jam', description: 'Paper stuck in tray two' })

    const r = await tech.get(`/ticket-api/tickets/${a.publicId}/similar`)
    assert.equal(r.status, 200, J(r.body))
    const ids = r.body.payload.map((x) => x.publicId)
    assert.ok(ids.includes(b.publicId))
    assert.ok(!ids.includes(a.publicId) && !ids.includes(c.publicId))
    assert.ok(r.body.payload.every((x) => x.score >= 0.2 && x.score <= 1))
    assert.ok(r.body.payload.every((x) => !('comments' in x) && !('requester' in x)))

    assert.equal((await mgr.get(`/ticket-api/tickets/${a.publicId}/similar`)).status, 200)
    assert.equal((await admin.get(`/ticket-api/tickets/${a.publicId}/similar`)).status, 200)
    assert.equal((await emp.get(`/ticket-api/tickets/${a.publicId}/similar`)).status, 403)
    assert.equal((await assetMgr.get(`/ticket-api/tickets/${a.publicId}/similar`)).status, 403)
    assert.equal((await techInfra.get(`/ticket-api/tickets/${a.publicId}/similar`)).status, 404)
    assert.equal((await techNoDept.get(`/ticket-api/tickets/${a.publicId}/similar`)).status, 404)
  })

  test('timeline: merged in time order, internal notes and work logs only for staff', async () => {
    let t = await createTicket(emp, id(fx.categories.hardware), { title: 'timeline ticket' })
    t = (await act(tech, t, 'claim')).body.payload
    t = (await act(tech, t, 'start')).body.payload
    const pub = await emp.post(`/ticket-api/tickets/${t.publicId}/comments`).send({ text: 'public question' })
    assert.equal(pub.status, 201, J(pub.body))
    const note = await tech.post(`/ticket-api/tickets/${t.publicId}/comments`).send({ text: 'secret staff note', isInternal: true })
    assert.equal(note.status, 201, J(note.body))
    assert.equal((await tech.post(`/worklog-api/${t.publicId}`).send({ description: 'secret work log', minutesSpent: 15 })).status, 201)

    const staff = await tech.get(`/ticket-api/tickets/${t.publicId}/timeline`)
    assert.equal(staff.status, 200, J(staff.body))
    const types = staff.body.payload.map((e) => e.type)
    assert.ok(types.includes('STATUS') && types.includes('COMMENT') && types.includes('INTERNAL_NOTE') && types.includes('WORK_LOG'))
    const times = staff.body.payload.map((e) => new Date(e.at).getTime())
    assert.deepEqual(times, times.slice().sort((x, y) => x - y), 'ascending')
    assert.equal(staff.body.payload[0].type, 'STATUS')
    assert.ok(staff.body.payload[0].by.name.startsWith('Eli'))
    assert.equal(staff.body.payload.find((e) => e.type === 'WORK_LOG').minutesSpent, 15)

    const mine = await emp.get(`/ticket-api/tickets/${t.publicId}/timeline`)
    assert.equal(mine.status, 200)
    assert.ok(!JSON.stringify(mine.body).includes('secret'))
    assert.ok(!mine.body.payload.some((e) => e.type === 'WORK_LOG' || e.type === 'INTERNAL_NOTE'))
    assert.ok(mine.body.payload.some((e) => e.text === 'public question'))

    assert.equal((await mgr.get(`/ticket-api/tickets/${t.publicId}/timeline`)).status, 200)
    assert.equal((await admin.get(`/ticket-api/tickets/${t.publicId}/timeline`)).status, 200)
    assert.equal((await emp2.get(`/ticket-api/tickets/${t.publicId}/timeline`)).status, 404, 'another employee')
    assert.equal((await techInfra.get(`/ticket-api/tickets/${t.publicId}/timeline`)).status, 404, 'another team')
    assert.equal((await assetMgr.get(`/ticket-api/tickets/${t.publicId}/timeline`)).status, 404)
  })
})
