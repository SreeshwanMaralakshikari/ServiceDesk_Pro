// The dashboards against the REAL seed (utils/seedData.js, 40 demo tickets) on a real database.
// The expected numbers below were worked out by hand from the table in utils/demoTickets.js
// (comments say how); they are not read back from the code under test.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { bootApp, loginAs } from '../../testkit/boot.js'

describe('dashboards on the seeded demo data (real database)', () => {
  let ctx, admin, mia, ian, theo, emp, assets
  let infId

  before(async () => {
    ctx = await bootApp({}, { fixtures: false })
    const { seedIfEmpty } = await import('../../utils/seedData.js')
    await seedIfEmpty({ extraDemoTickets: false })
    const { DepartmentModel } = await import('../../models/DepartmentModel.js')
    infId = String((await DepartmentModel.findOne({ code: 'INF' }))._id)
    ;[admin, mia, ian, theo, emp, assets] = await Promise.all(
      ['admin@sdp.test', 'manager@sdp.test', 'ian@sdp.test', 'tech@sdp.test', 'employee@sdp.test', 'assets@sdp.test'].map((e) => loginAs(ctx.app, e)),
    )
  })
  after(() => ctx.stop())

  const statusOf = (d) => Object.fromEntries(d.byStatus.map((s) => [s.status, s.count]))

  test('the seed made what the table says: 40 tickets in the planned status mix', async () => {
    const d = (await admin.get('/manager-api/dashboard?days=all')).body.payload
    assert.equal(d.byStatus.reduce((n, s) => n + s.count, 0), 40)
    assert.deepEqual(statusOf(d), { PENDING_APPROVAL: 2, OPEN: 4, ASSIGNED: 3, IN_PROGRESS: 5, ON_HOLD: 2, RESOLVED: 3, CLOSED: 17, REOPENED: 2, REJECTED: 1, CANCELLED: 1 })
  })

  test('Manager (Service Desk): volume, SLA, backlog, workload', async () => {
    const res = await mia.get('/manager-api/dashboard')
    assert.equal(res.status, 200)
    const d = res.body.payload
    assert.equal(d.scope.department.name, 'Service Desk')
    assert.equal(d.scope.truncated, false)
    // Service Desk handles Hardware, Software and New Hardware Request: 28 of the 40
    assert.equal(d.byStatus.reduce((n, s) => n + s.count, 0), 28)
    // the other team's tickets are not in any number
    assert.equal(d.teams.length, 1)
    assert.equal(d.teams[0].name, 'Service Desk')
    // live state: breached = the reopened projector ticket; at risk = slow boot + Teams sign-in; on hold = laptop fan
    assert.equal(d.sla.current.breached, 1)
    assert.equal(d.sla.current.atRisk, 2)
    assert.equal(d.sla.current.onHold, 1)
    assert.equal(d.sla.current.unassigned, 2) // OPEN and nobody assigned: the toner request and the Teams sign-in (the other two open tickets are Network)
    // workload: Tara 3 (in progress, assigned, reopened), Theo 3 (in progress, assigned, on hold), Ravi 2 (in progress, reopened)
    assert.deepEqual(d.workload.map((w) => [w.name, w.open]), [['Tara Tech', 3], ['Theo Tech', 3], ['Ravi Tech', 2]])
    // a manager never sees the Infrastructure technicians
    assert.ok(!d.workload.some((w) => ['Noor Network', 'Nia Network'].includes(w.name)))
  })

  test('Manager (Infrastructure) sees only Infrastructure', async () => {
    const d = (await ian.get('/manager-api/dashboard')).body.payload
    assert.equal(d.scope.department.name, 'Infrastructure')
    assert.equal(d.byStatus.reduce((n, s) => n + s.count, 0), 12) // every Network ticket
    // breached: core switch, VPN file server, server room temperature
    assert.equal(d.sla.current.breached, 3)
    assert.equal(d.sla.current.atRisk, 0)
    assert.deepEqual(d.workload.map((w) => [w.name, w.open]), [['Noor Network', 3], ['Nia Network', 1]])
  })

  test('Admin: all teams, SLA compliance and CSAT match the table (30 days)', async () => {
    const d = (await admin.get('/manager-api/dashboard')).body.payload
    assert.equal(d.scope.department, null)
    // 40 tickets, 2 of them (45 and 50 days old) outside the 30-day window
    assert.deepEqual(d.totals, { created: 38, resolved: 18, closed: 15, open: 21, reopened: 2 })
    // reply: 31 answered or overdue (met 25, missed 6) -> 80.6%
    assert.deepEqual(d.sla.response, { met: 25, missed: 6, compliance: 80.6 })
    // resolution: 18 resolved (met 14; late: docking station, Excel crash, slow Wi-Fi, Excel print) -> 77.8%
    assert.deepEqual(d.sla.resolution, { met: 14, missed: 4, compliance: 77.8 })
    assert.deepEqual(d.sla.current, { breached: 4, atRisk: 2, onTrack: 8, onHold: 2, responseOverdue: 4, unassigned: 4, awaitingConfirmation: 3, pendingApproval: 2 })
    assert.equal(d.sla.pastBreaches, 1)
    // CSAT: 14 ratings (6 fives, 5 fours, one each of 3, 2, 1) -> 4.0
    assert.deepEqual(d.csat, { count: 14, average: 4, distribution: [{ rating: 1, count: 1 }, { rating: 2, count: 1 }, { rating: 3, count: 1 }, { rating: 4, count: 5 }, { rating: 5, count: 6 }] })
    assert.equal(d.teams.length, 2)
    assert.equal(d.trend.length, 30)
    assert.equal(d.trend.reduce((n, x) => n + x.created, 0), d.totals.created)
    assert.equal(d.trend.reduce((n, x) => n + x.resolved, 0), d.totals.resolved)
    // times exist and are sane (business hours: exact values depend on the weekday the seed ran)
    assert.ok(d.times.resolution.avgHours > 0 && d.times.resolution.avgHours < 100)
  })

  test('"all" adds the two old closed tickets', async () => {
    const d = (await admin.get('/manager-api/dashboard?days=all')).body.payload
    assert.equal(d.totals.created, 40)
    assert.equal(d.totals.resolved, 20)
    // + battery (met) and firewall (late): reply 27 of 33, resolution 15 of 20
    assert.deepEqual(d.sla.response, { met: 27, missed: 6, compliance: 81.8 })
    assert.deepEqual(d.sla.resolution, { met: 15, missed: 5, compliance: 75 })
    assert.equal(d.csat.count, 16)
    assert.equal(d.csat.average, 3.88)
  })

  test('7 days: the chart adds up to the numbers above it', async () => {
    const d = (await admin.get('/manager-api/dashboard?days=7')).body.payload
    assert.equal(d.trend.length, 7)
    assert.equal(d.trend.reduce((n, x) => n + x.created, 0), d.totals.created)
    assert.equal(d.trend.reduce((n, x) => n + x.resolved, 0), d.totals.resolved)
    assert.ok(d.totals.created < 38)
  })

  test('every status count equals the ticket list total for the same person', async () => {
    for (const [agent, who] of [[mia, 'Mia'], [ian, 'Ian'], [admin, 'Admin']]) {
      const d = (await agent.get('/manager-api/dashboard?days=all')).body.payload
      let sum = 0
      for (const { status, count } of d.byStatus) {
        const list = (await agent.get(`/ticket-api/tickets?status=${status}&limit=1`)).body.payload
        assert.equal(list.total, count, `${who}: ${status}`)
        sum += count
      }
      assert.equal(sum, d.scope.ticketsConsidered)
    }
  })

  test('Admin can narrow to one team; a Manager cannot choose another team', async () => {
    const d = (await admin.get(`/manager-api/dashboard?department=${infId}`)).body.payload
    assert.equal(d.scope.department.name, 'Infrastructure')
    assert.equal(d.byStatus.reduce((n, s) => n + s.count, 0), 12)
    const mine = (await mia.get(`/manager-api/dashboard?department=${infId}`)).body.payload
    assert.equal(mine.scope.department.name, 'Service Desk') // the parameter is ignored for a manager
    assert.equal(mine.byStatus.reduce((n, s) => n + s.count, 0), 28)
  })

  test('bad input is a 400, wrong roles are refused', async () => {
    assert.equal((await mia.get('/manager-api/dashboard?days=abc')).status, 400)
    assert.equal((await mia.get('/manager-api/dashboard?days=7&days=30')).status, 400)
    assert.equal((await mia.get('/manager-api/dashboard?days=0')).status, 400)
    assert.equal((await admin.get('/manager-api/dashboard?department=notanid')).status, 400)
    // a well-formed id that belongs to no department (the last character is always changed)
    assert.equal((await admin.get(`/manager-api/dashboard?department=${infId.slice(0, -1) + (infId.endsWith('a') ? 'b' : 'a')}`)).status, 400)
    assert.equal((await emp.get('/manager-api/dashboard')).status, 403)
    assert.equal((await theo.get('/manager-api/dashboard')).status, 403)
    assert.equal((await assets.get('/manager-api/dashboard')).status, 403)
  })

  test('Technician dashboard: only my tickets', async () => {
    const res = await theo.get('/tech-api/dashboard')
    assert.equal(res.status, 200)
    const d = res.body.payload
    // Theo: in progress (dock flicker), assigned (scroll wheel), on hold (fan); the keyboard ticket waits for the requester
    assert.equal(d.open.total, 3)
    assert.deepEqual(d.open.byStatus, [{ status: 'ASSIGNED', count: 1 }, { status: 'IN_PROGRESS', count: 1 }, { status: 'ON_HOLD', count: 1 }])
    assert.equal(d.open.awaitingConfirmation, 1)
    // resolved in 30 days: laptop, printer, Teams audio, keyboard+mouse, shared drive (closed) + keyboard keys (resolved) = 6
    assert.equal(d.resolved, 6)
    // ratings 5, 5, 4, 5 (the keyboard+mouse request was never rated)
    assert.deepEqual([d.csat.count, d.csat.average], [4, 4.75])
    // logged time equals what is in the work log collection for Theo
    const { WorkLogModel } = await import('../../models/WorkLogModel.js')
    const { UserModel } = await import('../../models/UserModel.js')
    const theoDoc = await UserModel.findOne({ email: 'tech@sdp.test' })
    const logs = await WorkLogModel.find({ technician: theoDoc._id }).lean()
    const cutoff = new Date(d.scope.from)
    const expected = logs.filter((l) => l.createdAt >= cutoff).reduce((n, l) => n + l.minutesSpent, 0)
    assert.ok(expected > 0)
    assert.equal(d.work.minutes, expected)
    // a different technician's numbers are different (not a shared total)
    const other = (await (await loginAs(ctx.app, 'noor@sdp.test')).get('/tech-api/dashboard')).body.payload
    assert.equal(other.open.total, 3) // switch dropping packets, meeting-room display, remote desktop gateway
    assert.equal(other.open.breached, 1)
  })

  test('Technician dashboard refuses other roles and bad input', async () => {
    assert.equal((await mia.get('/tech-api/dashboard')).status, 403)
    assert.equal((await emp.get('/tech-api/dashboard')).status, 403)
    assert.equal((await theo.get('/tech-api/dashboard?days=x')).status, 400)
  })

  test('Admin dashboard keeps its original keys and adds the overview', async () => {
    const res = await admin.get('/admin-api/dashboard')
    assert.equal(res.status, 200)
    const p = res.body.payload
    assert.equal(p.totalTickets, 40)
    assert.equal(p.openTickets, 21) // not CLOSED, CANCELLED or REJECTED
    assert.ok(Array.isArray(p.byStatus) && p.byStatus.every((s) => '_id' in s && 'count' in s))
    assert.ok(Array.isArray(p.byPriority))
    assert.equal(typeof p.userCount, 'number')
    assert.equal(p.overview.totals.created, 38)
    assert.equal(p.overview.byStatus.reduce((n, s) => n + s.count, 0), p.totalTickets)
    assert.equal((await admin.get('/admin-api/dashboard?days=bad')).status, 400)
  })

  test('Asset stats match the four seeded assets and the warranty report', async () => {
    const res = await assets.get('/asset-api/stats')
    assert.equal(res.status, 200)
    const s = res.body.payload
    assert.equal(s.total, 4)
    assert.deepEqual(s.byStatus, [{ status: 'IN_STOCK', count: 1 }, { status: 'ASSIGNED', count: 2 }, { status: 'IN_REPAIR', count: 1 }])
    // laptop (20 days) and Microsoft 365 (5 days) end soon; the switch's warranty ended 10 days ago
    assert.deepEqual(s.warranty, { windowDays: 30, expiringSoon: 2, expired: 1 })
    assert.equal(s.cost.purchaseTotal, 150000) // 78000 + 12000 + 15000 + 45000
    assert.deepEqual(s.byVendor.map((v) => [v.name, v.count, v.purchaseTotal]), [['Dell Technologies', 2, 90000], ['Microsoft', 1, 15000], ['Netgear Solutions', 1, 45000]])
    // the same three assets the existing warranty report lists
    const report = (await assets.get('/asset-api/assets/warranty-expiring')).body.payload
    assert.equal(report.total, s.warranty.expiringSoon + s.warranty.expired)
    assert.equal(report.items.length, report.total)
    assert.equal((await admin.get('/asset-api/stats')).status, 200)
    assert.equal((await emp.get('/asset-api/stats')).status, 403)
    assert.equal((await theo.get('/asset-api/stats')).status, 403)
    assert.equal((await mia.get('/asset-api/stats')).status, 403)
  })
})
