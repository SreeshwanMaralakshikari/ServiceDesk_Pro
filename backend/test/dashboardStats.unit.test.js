import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { buildDashboard, buildTechnicianDashboard, parseDays, istDayKey, istDayStart, windowStart } from '../utils/dashboardStats.js'
import { responseOutcome, resolutionOutcome } from '../utils/slaOutcome.js'
import { buildAssetStats, toAssetReportRow } from '../utils/assetStats.js'
import { toTicketReportRow, formatIst } from '../utils/ticketReport.js'
import { DEFAULT_BUSINESS_HOURS } from '../utils/businessHours.js'

// "now" is Wednesday 7 Oct 2026, 12:00 IST (IST = UTC + 5:30). Every fixture below is
// written as "n hours before now" and every expected number in this file was worked out by
// hand from that table (see the comment above each test), not by running the code.
const ist = (y, m, d, h, min = 0) => new Date(Date.UTC(y, m - 1, d, h - 5, min - 30))
const NOW = ist(2026, 10, 7, 12, 0)
const h = (n) => new Date(NOW.getTime() - n * 3600000)

const HIGH = { _id: 'p-high', priority: 'HIGH', level: 3, responseTimeHours: 4, resolutionTimeHours: 8, businessHoursOnly: false }
const LOW = { _id: 'p-low', priority: 'LOW', level: 1, responseTimeHours: 24, resolutionTimeHours: 72, businessHoursOnly: true }
const policies = [HIGH, LOW]

// a ticket on the HIGH policy (4h to respond, 8h to resolve, warning at 6h), started `start` hours ago
const ticket = (id, { start, status, dept = 'dA', cat = 'c1', assignedTo, first, resolved, closed, csat, priority = 'HIGH', policy = HIGH, over = {} }) => ({
  _id: id,
  status,
  priority,
  department: dept,
  category: cat,
  assignedTo,
  createdAt: h(start),
  closedAt: closed === undefined ? undefined : h(closed),
  csat: csat ? { rating: csat[0], submittedAt: h(csat[1]) } : undefined,
  reopenCount: 0,
  sla: {
    policy: policy._id,
    startedAt: h(start),
    responseDueAt: h(start - policy.responseTimeHours),
    resolutionDueAt: h(start - policy.resolutionTimeHours),
    warnAt: h(start - policy.resolutionTimeHours * 0.75),
    firstRespondedAt: first === undefined ? undefined : h(first),
    totalPausedMs: 0,
    pastBreaches: 0,
  },
  resolution: resolved === undefined ? {} : { resolvedAt: h(resolved) },
  ...over,
})

const tickets = [
  ticket('T1', { start: 100, status: 'CLOSED', cat: 'c1', assignedTo: 't1', first: 99, resolved: 95, closed: 94, csat: [5, 90] }),
  ticket('T2', { start: 80, status: 'CLOSED', cat: 'c1', assignedTo: 't2', first: 75, resolved: 70, closed: 69, csat: [3, 60] }), // late on both
  ticket('T3', { start: 30, status: 'RESOLVED', cat: 'c2', assignedTo: 't1', first: 29, resolved: 24 }),
  ticket('T4', { start: 7, status: 'IN_PROGRESS', cat: 'c2', assignedTo: 't1', first: 6 }), // past the 6h warning, 1h left
  ticket('T5', { start: 10, status: 'IN_PROGRESS', cat: 'c1', assignedTo: 't2', first: 9 }), // 2h past the resolution deadline
  ticket('T6', { start: 5, status: 'OPEN', cat: 'c1' }), // nobody answered, response deadline passed an hour ago
  ticket('T7', { start: 20, status: 'ON_HOLD', cat: 'c2', assignedTo: 't2', first: 19 }),
  { _id: 'T8', status: 'PENDING_APPROVAL', priority: 'HIGH', department: 'dA', category: 'c1', createdAt: h(2), sla: {}, resolution: {} },
  ticket('T9', { start: 40, status: 'CANCELLED', cat: 'c1' }),
  ticket('T10', { start: 200, status: 'CLOSED', dept: 'dB', cat: 'c2', assignedTo: 't3', first: 199, resolved: 195, closed: 194, csat: [4, 190] }),
  ticket('T11', { start: 1, status: 'OPEN', dept: 'dB', cat: 'c2', priority: 'LOW', policy: LOW }),
  ticket('T12', { start: 5, status: 'REOPENED', cat: 'c1', assignedTo: 't1', first: 149, over: { createdAt: h(150), reopenCount: 1, sla: { policy: 'p-high', startedAt: h(5), responseDueAt: h(146), resolutionDueAt: h(-3), warnAt: h(-1), firstRespondedAt: h(149), totalPausedMs: 0, pastBreaches: 1 } } }),
]

const technicians = [
  { _id: 't1', firstName: 'Alice', lastName: 'Tech', department: 'dA' },
  { _id: 't2', firstName: 'Bob', lastName: 'Tech', department: 'dA' },
  { _id: 't3', firstName: 'Cara', lastName: 'Tech', department: 'dB' },
]
const categories = [{ _id: 'c1', name: 'Hardware' }, { _id: 'c2', name: 'Network' }]
const departments = [{ _id: 'dA', name: 'Service Desk' }, { _id: 'dB', name: 'Infrastructure' }]
const run = (over = {}) => buildDashboard({ tickets, policies, settings: DEFAULT_BUSINESS_HOURS, technicians, categories, departments, now: NOW, ...over })

describe('SLA verdicts', () => {
  test('response: met, missed, pending and none', () => {
    const sla = (over) => ({ sla: { responseDueAt: h(2), ...over }, status: 'OPEN' })
    assert.equal(responseOutcome(sla({ firstRespondedAt: h(3) }), NOW), 'MET') // answered before the deadline
    assert.equal(responseOutcome(sla({ firstRespondedAt: h(1) }), NOW), 'MISSED') // answered after it
    assert.equal(responseOutcome(sla({}), NOW), 'MISSED') // deadline passed, nobody answered
    assert.equal(responseOutcome({ sla: { responseDueAt: h(-2) }, status: 'OPEN' }, NOW), 'PENDING')
    assert.equal(responseOutcome({ sla: {}, status: 'PENDING_APPROVAL' }, NOW), 'NONE') // clock never started
    assert.equal(responseOutcome({ sla: { responseDueAt: h(2) }, status: 'CANCELLED' }, NOW), 'NONE') // not held to a reply it never got
  })

  test('resolution: finished and open tickets', () => {
    const open = (status, over) => ({ status, sla: { resolutionDueAt: h(-2), warnAt: h(1), ...over }, resolution: {} })
    assert.equal(resolutionOutcome({ status: 'CLOSED', sla: { resolutionDueAt: h(5) }, resolution: { resolvedAt: h(6) } }, NOW), 'MET')
    assert.equal(resolutionOutcome({ status: 'RESOLVED', sla: { resolutionDueAt: h(5) }, resolution: { resolvedAt: h(4) } }, NOW), 'MISSED')
    assert.equal(resolutionOutcome(open('IN_PROGRESS'), NOW), 'AT_RISK') // past the warning, not past the deadline
    assert.equal(resolutionOutcome(open('IN_PROGRESS', { warnAt: h(-1) }), NOW), 'ON_TRACK')
    assert.equal(resolutionOutcome(open('ASSIGNED', { resolutionDueAt: h(1) }), NOW), 'BREACHED')
    assert.equal(resolutionOutcome(open('ON_HOLD', { resolutionDueAt: h(1) }), NOW), 'ON_HOLD') // paused clock, never breached
    assert.equal(resolutionOutcome(open('CANCELLED'), NOW), 'NONE')
    assert.equal(resolutionOutcome({ status: 'PENDING_APPROVAL', sla: {}, resolution: {} }, NOW), 'NONE')
  })
})

describe('time helpers', () => {
  test('parseDays accepts 7/30/90/all and refuses everything else', () => {
    assert.equal(parseDays(undefined), 30)
    assert.equal(parseDays(''), 30)
    assert.equal(parseDays('7'), 7)
    assert.equal(parseDays('90'), 90)
    assert.equal(parseDays('all'), null)
    for (const bad of ['0', '-1', '31', 'abc', ['7', '30'], { $gt: 1 }, 30]) assert.equal(parseDays(bad), undefined)
  })

  test('day keys are IST days: 23:59 IST and 00:01 IST fall on different days', () => {
    assert.equal(istDayKey(ist(2026, 10, 6, 23, 59)), '2026-10-06')
    assert.equal(istDayKey(ist(2026, 10, 7, 0, 1)), '2026-10-07')
    // 18:31 UTC is already the next day in IST
    assert.equal(istDayKey(new Date('2026-10-06T18:31:00Z')), '2026-10-07')
    assert.equal(istDayStart(NOW).getTime(), ist(2026, 10, 7, 0, 0).getTime())
    assert.equal(windowStart(NOW, 7).getTime(), ist(2026, 10, 1, 0, 0).getTime()) // today plus the 6 days before
    assert.equal(windowStart(NOW, null), null)
  })

  test('formatIst', () => {
    assert.equal(formatIst(ist(2026, 10, 7, 9, 5)), '2026-10-07 09:05')
    assert.equal(formatIst(undefined), '')
  })
})

// Hand-worked expectations for the 12 fixture tickets (30-day window, all of them inside it):
//   created 12 · resolved T1 T2 T3 T10 = 4 · closed T1 T2 T10 = 3 · open (not CLOSED/CANCELLED/REJECTED) = 8
//   response: known 9 (T1 T2 T3 T4 T5 T6 T7 T10 T12), met 7, missed 2 (T2, T6) -> 77.8%
//   resolution: T1 met, T2 missed, T3 met, T10 met -> 3 of 4 = 75%
describe('buildDashboard', () => {
  test('volume, SLA compliance and the live backlog', () => {
    const d = run()
    assert.deepEqual(d.totals, { created: 12, resolved: 4, closed: 3, open: 8, reopened: 1 })
    assert.deepEqual(d.sla.response, { met: 7, missed: 2, compliance: 77.8 })
    assert.deepEqual(d.sla.resolution, { met: 3, missed: 1, compliance: 75 })
    assert.deepEqual(d.sla.current, { breached: 1, atRisk: 1, onTrack: 3, onHold: 1, responseOverdue: 1, unassigned: 2, awaitingConfirmation: 1, pendingApproval: 1 })
    assert.equal(d.sla.pastBreaches, 1)
    assert.equal(d.scope.truncated, false)
    assert.equal(d.scope.ticketsConsidered, 12)
  })

  test('status counts cover every ticket, in the canonical order', () => {
    const d = run()
    assert.deepEqual(d.byStatus, [
      { status: 'PENDING_APPROVAL', count: 1 }, { status: 'OPEN', count: 2 }, { status: 'IN_PROGRESS', count: 2 },
      { status: 'ON_HOLD', count: 1 }, { status: 'RESOLVED', count: 1 }, { status: 'CLOSED', count: 3 },
      { status: 'REOPENED', count: 1 }, { status: 'CANCELLED', count: 1 },
    ])
    assert.equal(d.byStatus.reduce((n, s) => n + s.count, 0), 12)
    // 7 open HIGH tickets (T3 T4 T5 T6 T7 T8 T12) and 1 open LOW (T11), most urgent first
    assert.deepEqual(d.backlogByPriority, [{ priority: 'HIGH', count: 7 }, { priority: 'LOW', count: 1 }])
  })

  test('response and resolution times, CSAT, categories', () => {
    const d = run()
    // first replies: 1,5,1,1,1,1,1 hours (T12 restarted its clock after the reply, so it is left out)
    assert.deepEqual(d.times.firstResponse, { count: 7, avgHours: 1.6 })
    // resolutions: T1 5h, T2 10h, T3 6h, T10 5h -> mean 6.5, median (5+6)/2
    assert.deepEqual(d.times.resolution, { count: 4, avgHours: 6.5, medianHours: 5.5 })
    assert.deepEqual(d.csat, { count: 3, average: 4, distribution: [{ rating: 1, count: 0 }, { rating: 2, count: 0 }, { rating: 3, count: 1 }, { rating: 4, count: 1 }, { rating: 5, count: 1 }] })
    assert.deepEqual(d.categories, [{ categoryId: 'c1', name: 'Hardware', count: 7 }, { categoryId: 'c2', name: 'Network', count: 5 }])
  })

  test('technician workload', () => {
    const d = run()
    assert.deepEqual(d.workload.map((w) => [w.name, w.open, w.breached, w.atRisk, w.resolved, w.resolutionCompliance, w.avgResolutionHours, w.csatAverage, w.csatCount]), [
      ['Alice Tech', 2, 0, 1, 2, 100, 5.5, 5, 1],
      ['Bob Tech', 2, 1, 0, 1, 0, 10, 3, 1],
      ['Cara Tech', 0, 0, 0, 1, 100, 5, 4, 1],
    ])
  })

  test('per-team comparison', () => {
    const d = run()
    assert.deepEqual(d.teams.map((t) => [t.name, t.open, t.created, t.breached, t.atRisk, t.unassigned, t.resolutionCompliance, t.responseCompliance, t.csatAverage, t.csatCount]), [
      ['Infrastructure', 1, 2, 0, 0, 1, 100, 100, 4, 1],
      ['Service Desk', 7, 10, 1, 1, 1, 66.7, 75, 4, 2],
    ])
  })

  test('7-day window: older tickets drop out of the windowed numbers but not the snapshot', () => {
    const d = run({ days: 7 })
    // T10 (created 29 Sep) is outside; T12 (1 Oct 06:00 IST) is inside
    assert.equal(d.totals.created, 11)
    assert.equal(d.totals.resolved, 3)
    assert.equal(d.csat.count, 2) // T10's rating is outside the window
    assert.equal(d.byStatus.reduce((n, s) => n + s.count, 0), 12) // all-time snapshot
    assert.deepEqual(d.trend, [
      { date: '2026-10-01', created: 1, resolved: 0 }, { date: '2026-10-02', created: 0, resolved: 0 },
      { date: '2026-10-03', created: 1, resolved: 1 }, { date: '2026-10-04', created: 1, resolved: 1 },
      { date: '2026-10-05', created: 1, resolved: 0 }, { date: '2026-10-06', created: 2, resolved: 1 },
      { date: '2026-10-07', created: 5, resolved: 0 },
    ])
    // the chart adds up to the number above it
    assert.equal(d.trend.reduce((n, x) => n + x.created, 0), d.totals.created)
    assert.equal(d.trend.reduce((n, x) => n + x.resolved, 0), d.totals.resolved)
  })

  test('"all" has no window and a 90-day chart', () => {
    const d = run({ days: null })
    assert.equal(d.scope.from, null)
    assert.equal(d.totals.created, 12)
    assert.equal(d.trend.length, 90)
    assert.equal(d.trend.at(-1).date, '2026-10-07')
  })

  test('an empty scope gives zeros and nulls, never NaN', () => {
    const d = buildDashboard({ tickets: [], policies, settings: DEFAULT_BUSINESS_HOURS, now: NOW })
    assert.deepEqual(d.totals, { created: 0, resolved: 0, closed: 0, open: 0, reopened: 0 })
    assert.equal(d.sla.response.compliance, null)
    assert.equal(d.sla.resolution.compliance, null)
    assert.equal(d.times.resolution.avgHours, null)
    assert.equal(d.csat.average, null)
    assert.deepEqual(d.byStatus, [])
    assert.deepEqual(d.workload, [])
    assert.ok(!JSON.stringify(d).includes('NaN'))
  })

  test('resolution time uses business hours for a business-hours policy and leaves out time on hold', () => {
    // started Friday 17:00 IST, resolved Monday 10:00 IST: 1h on Friday + 1h on Monday = 2h; 30 min on hold -> 1.5h
    const biz = { _id: 'b', priority: 'LOW', level: 1, responseTimeHours: 24, resolutionTimeHours: 72, businessHoursOnly: true }
    const t = {
      _id: 'x', status: 'RESOLVED', priority: 'LOW', department: 'dA', category: 'c1', createdAt: ist(2026, 10, 2, 17, 0),
      sla: { policy: 'b', startedAt: ist(2026, 10, 2, 17, 0), responseDueAt: ist(2026, 10, 9, 9), resolutionDueAt: ist(2026, 10, 12, 9), totalPausedMs: 30 * 60000 },
      resolution: { resolvedAt: ist(2026, 10, 5, 10, 0) },
    }
    const d = buildDashboard({ tickets: [t], policies: [biz], settings: DEFAULT_BUSINESS_HOURS, now: ist(2026, 10, 6, 12, 0) })
    assert.deepEqual(d.times.resolution, { count: 1, avgHours: 1.5, medianHours: 1.5 })
    // the same ticket on a wall-clock policy is simply the elapsed time minus the hold: 65h - 0.5h
    const wall = { ...biz, businessHoursOnly: false }
    const d2 = buildDashboard({ tickets: [t], policies: [wall], settings: DEFAULT_BUSINESS_HOURS, now: ist(2026, 10, 6, 12, 0) })
    assert.equal(d2.times.resolution.avgHours, 64.5)
  })
})

describe('buildTechnicianDashboard', () => {
  test('one technician: open work, SLA state, resolved, CSAT and logged time', () => {
    const mine = tickets.filter((t) => t.assignedTo === 't1') // T1 T3 T4 T12
    const workLogs = [
      { minutesSpent: 30, createdAt: h(10) },
      { minutesSpent: 45, createdAt: h(100) },
      { minutesSpent: 60, createdAt: h(2000) }, // 83 days ago: outside the window
    ]
    const d = buildTechnicianDashboard({ tickets: mine, workLogs, policies, settings: DEFAULT_BUSINESS_HOURS, now: NOW })
    assert.equal(d.open.total, 2) // T4 in progress, T12 reopened (T3 is waiting for the requester)
    assert.deepEqual(d.open.byStatus, [{ status: 'IN_PROGRESS', count: 1 }, { status: 'REOPENED', count: 1 }])
    assert.equal(d.open.atRisk, 1)
    assert.equal(d.open.breached, 0)
    assert.equal(d.open.awaitingConfirmation, 1)
    assert.equal(d.resolved, 2)
    assert.equal(d.sla.resolution.compliance, 100)
    assert.deepEqual(d.csat.count, 1)
    assert.deepEqual(d.work, { minutes: 75, hours: 1.3, entries: 2 })
  })
})

describe('buildAssetStats', () => {
  const assets = [
    { status: 'IN_STOCK', type: 'HARDWARE', assetClass: 'Laptop', vendor: 'v1', purchaseCost: 1000, warrantyExpiry: new Date(NOW.getTime() + 10 * 86400000), maintenance: [{ cost: 100 }, {}] },
    { status: 'ASSIGNED', type: 'HARDWARE', assetClass: 'Laptop', vendor: 'v1', purchaseCost: 2000, warrantyExpiry: new Date(NOW.getTime() - 5 * 86400000) },
    { status: 'RETIRED', type: 'HARDWARE', assetClass: 'Monitor', vendor: 'v2', purchaseCost: 500, warrantyExpiry: new Date(NOW.getTime() - 100 * 86400000) },
    { status: 'ASSIGNED', type: 'SOFTWARE', assetClass: 'License', vendor: 'v2', purchaseCost: 300, warrantyExpiry: new Date(NOW.getTime() + 60 * 86400000) },
    { status: 'IN_REPAIR', type: 'HARDWARE', assetClass: 'Monitor' },
  ]
  test('counts, warranty window and costs', () => {
    const s = buildAssetStats({ assets, vendors: [{ _id: 'v1', name: 'Dell' }, { _id: 'v2', name: 'Microsoft' }], now: NOW })
    assert.equal(s.total, 5)
    assert.deepEqual(s.byStatus, [{ status: 'IN_STOCK', count: 1 }, { status: 'ASSIGNED', count: 2 }, { status: 'IN_REPAIR', count: 1 }, { status: 'RETIRED', count: 1 }])
    assert.deepEqual(s.byType, [{ type: 'HARDWARE', count: 4 }, { type: 'SOFTWARE', count: 1 }])
    assert.deepEqual(s.byClass, [{ assetClass: 'Laptop', count: 2 }, { assetClass: 'Monitor', count: 2 }, { assetClass: 'License', count: 1 }])
    // the retired monitor is ignored; the laptop ending in 10 days is "soon", the one that ended 5 days ago is "expired"
    assert.deepEqual(s.warranty, { windowDays: 30, expiringSoon: 1, expired: 1 })
    assert.deepEqual(s.cost, { purchaseTotal: 3800, maintenanceTotal: 100, maintenanceEntries: 2 })
    assert.deepEqual(s.byVendor, [
      { vendorId: 'v1', name: 'Dell', count: 2, purchaseTotal: 3000, maintenanceTotal: 100 },
      { vendorId: 'v2', name: 'Microsoft', count: 2, purchaseTotal: 800, maintenanceTotal: 0 },
    ])
  })

  test('the CSV row writes empty cells for missing values', () => {
    const row = toAssetReportRow({ publicId: 'AST-1', name: 'X', type: 'HARDWARE', assetClass: 'Laptop', status: 'IN_STOCK', maintenance: [{ cost: 5 }, { cost: 7 }] })
    assert.equal(row.serialOrLicense, '')
    assert.equal(row.vendor, '')
    assert.equal(row.purchaseCost, '')
    assert.equal(row.maintenanceCost, 12)
  })
})

describe('toTicketReportRow', () => {
  test('flat, readable and without comments or AI notes', () => {
    const t = {
      ...tickets[1], publicId: 'TKT-2026-00002', title: 'Screen flickers', type: 'INCIDENT', comments: [{ text: 'INTERNAL secret', isInternal: true }], ai: { probableIssue: 'secret' },
      requester: { firstName: 'Eli', lastName: 'Employee' }, assignedTo: { firstName: 'Bob', lastName: 'Tech' }, category: { name: 'Hardware' }, department: { name: 'Service Desk' },
    }
    const row = toTicketReportRow(t, NOW)
    assert.equal(row.requester, 'Eli Employee')
    assert.equal(row.team, 'Service Desk')
    assert.equal(row.responseSla, 'Missed')
    assert.equal(row.resolutionSla, 'Missed')
    assert.equal(row.csatRating, 3)
    assert.equal(row.createdAt, '2026-10-04 04:00') // 80h before Wed 12:00 IST = Sat 4 Oct 04:00 IST
  })
})
