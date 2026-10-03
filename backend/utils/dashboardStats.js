import { elapsedMs } from './businessHours.js'
import { APP_UTC_OFFSET_MINUTES } from './timezone.js'
import { FINISHED_STATUSES, TECH_ACTIVE_STATUSES } from './ticketStatuses.js'
import { responseOutcome, resolutionOutcome } from './slaOutcome.js'

// Every dashboard number comes from here. These are pure functions: the routes
// load the ticket rows (through buildTicketQuery, so the same scope as the ticket
// list) and hand them over, which makes each metric testable with hand-computed
// fixtures and keeps the routes free of aggregation pipelines.
//
// What each number counts (the pages say the same thing in words):
//   volume        tickets created in the window
//   response SLA  tickets created in the window whose answer is known (met or missed)
//   resolution    tickets resolved in the window (resolution.resolvedAt)
//   CSAT          ratings submitted in the window
//   backlog       a live snapshot of right now, not windowed
//   byStatus      every ticket in scope, all time (it equals the ticket list totals)

const HOUR = 3600000
const MINUTE = 60000
const DAY = 24 * HOUR
const OFFSET_MS = APP_UTC_OFFSET_MINUTES * MINUTE

export const DEFAULT_DAYS = 30
export const ALLOWED_DAYS = [7, 30, 90]
export const TREND_MAX_DAYS = 90

// "?days=" -> 30 when missing, null for "all", a number for 7/30/90, undefined when invalid
export const parseDays = (value) => {
  if (value === undefined || value === null || value === '') return DEFAULT_DAYS
  if (value === 'all') return null
  const n = typeof value === 'string' ? Number(value) : Number.NaN
  return ALLOWED_DAYS.includes(n) ? n : undefined
}

// day keys and day starts are IST days, not UTC days (APP_TIME_ZONE)
export const istDayKey = (date) => new Date(date.getTime() + OFFSET_MS).toISOString().slice(0, 10)
export const istDayStart = (date) => new Date(Math.floor((date.getTime() + OFFSET_MS) / DAY) * DAY - OFFSET_MS)

// the window is "the last N IST days including today", so a day chart adds up to the volume number
export const windowStart = (now, days) => (days === null ? null : new Date(istDayStart(now).getTime() - (days - 1) * DAY))

const inWindow = (date, from) => Boolean(date) && (from === null || date >= from)

const round = (value, places) => {
  const f = 10 ** places
  return Math.round(value * f) / f
}
const average = (values, places = 1) => (values.length ? round(values.reduce((a, b) => a + b, 0) / values.length, places) : null)
const median = (values) => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2, 1)
}
const percent = (met, total) => (total ? round((met / total) * 100, 1) : null)
export const fullName = (user) => `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim()

// canonical status order, shared with the pages
export const STATUS_ORDER = ['PENDING_APPROVAL', 'OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CLOSED', 'REOPENED', 'REJECTED', 'CANCELLED']

// working time from the start of the current SLA cycle to the resolution, in hours. It uses
// the policy's own clock (business hours or wall clock) and leaves out the time on hold
const resolutionHours = (ticket, policy, settings) => {
  const start = ticket.sla?.startedAt
  const end = ticket.resolution?.resolvedAt
  if (!start || !end || end < start) return null
  const ms = elapsedMs(start, end, policy, settings) - (ticket.sla?.totalPausedMs || 0)
  return Math.max(0, ms) / HOUR
}

// start of the cycle to the first reply. A reopened ticket restarted its clock after the reply
// had already happened, so it is left out instead of going negative
const firstResponseHours = (ticket, policy, settings) => {
  const start = ticket.sla?.startedAt
  const first = ticket.sla?.firstRespondedAt
  if (!start || !first || first < start) return null
  return elapsedMs(start, first, policy, settings) / HOUR
}

// one pass over the tickets: attach the policy and the SLA verdicts so every metric below reads them
const annotate = (tickets, policies, settings, now) => {
  const byId = new Map(policies.map((p) => [String(p._id), p]))
  const byCode = new Map(policies.map((p) => [p.priority, p]))
  return tickets.map((ticket) => {
    const policy = byId.get(String(ticket.sla?.policy)) ?? byCode.get(ticket.priority)
    return {
      ticket,
      policy,
      response: responseOutcome(ticket, now),
      resolution: resolutionOutcome(ticket, now),
      resolveHours: resolutionHours(ticket, policy, settings),
      firstHours: firstResponseHours(ticket, policy, settings),
    }
  })
}

const countBy = (rows, keyOf) => {
  const map = new Map()
  for (const row of rows) {
    const key = keyOf(row)
    if (key !== undefined && key !== null) map.set(key, (map.get(key) ?? 0) + 1)
  }
  return map
}

// the numbers every audience shares (manager, team, technician, admin)
const summarize = (rows, { from, now }) => {
  const created = rows.filter((r) => inWindow(r.ticket.createdAt, from))
  const resolved = rows.filter((r) => inWindow(r.ticket.resolution?.resolvedAt, from))
  const closed = rows.filter((r) => inWindow(r.ticket.closedAt, from))
  const open = rows.filter((r) => !FINISHED_STATUSES.includes(r.ticket.status))

  const responseKnown = created.filter((r) => r.response === 'MET' || r.response === 'MISSED')
  const responseMet = responseKnown.filter((r) => r.response === 'MET').length
  const resolutionKnown = resolved.filter((r) => r.resolution === 'MET' || r.resolution === 'MISSED')
  const resolutionMet = resolutionKnown.filter((r) => r.resolution === 'MET').length

  const resolveHours = resolved.map((r) => r.resolveHours).filter((h) => h !== null)
  const firstHours = created.map((r) => r.firstHours).filter((h) => h !== null)

  const rated = rows.filter((r) => r.ticket.csat?.rating && inWindow(r.ticket.csat.submittedAt, from))
  const ratings = rated.map((r) => r.ticket.csat.rating)
  const distribution = [1, 2, 3, 4, 5].map((rating) => ({ rating, count: ratings.filter((x) => x === rating).length }))

  const outcomeCount = (name) => rows.filter((r) => r.resolution === name).length
  return {
    totals: {
      created: created.length,
      resolved: resolved.length,
      closed: closed.length,
      open: open.length,
      reopened: created.filter((r) => (r.ticket.reopenCount || 0) > 0).length,
    },
    sla: {
      response: { met: responseMet, missed: responseKnown.length - responseMet, compliance: percent(responseMet, responseKnown.length) },
      resolution: { met: resolutionMet, missed: resolutionKnown.length - resolutionMet, compliance: percent(resolutionMet, resolutionKnown.length) },
      current: {
        breached: outcomeCount('BREACHED'),
        atRisk: outcomeCount('AT_RISK'),
        onTrack: outcomeCount('ON_TRACK'),
        onHold: outcomeCount('ON_HOLD'),
        // nobody has answered and the response deadline has passed
        responseOverdue: rows.filter((r) => r.response === 'MISSED' && !r.ticket.sla?.firstRespondedAt).length,
        // OPEN and not picked up yet: what a technician can still claim
        unassigned: rows.filter((r) => r.ticket.status === 'OPEN' && !r.ticket.assignedTo).length,
        awaitingConfirmation: rows.filter((r) => r.ticket.status === 'RESOLVED').length,
        pendingApproval: rows.filter((r) => r.ticket.status === 'PENDING_APPROVAL').length,
      },
      // resolution breaches from earlier cycles of reopened tickets
      pastBreaches: rows.reduce((sum, r) => sum + (r.ticket.sla?.pastBreaches || 0), 0),
    },
    times: {
      firstResponse: { count: firstHours.length, avgHours: average(firstHours) },
      resolution: { count: resolveHours.length, avgHours: average(resolveHours), medianHours: median(resolveHours) },
    },
    csat: { count: ratings.length, average: average(ratings, 2), distribution },
  }
}

const statusCounts = (rows) => {
  const counts = countBy(rows, (r) => r.ticket.status)
  return STATUS_ORDER.filter((s) => counts.has(s)).map((status) => ({ status, count: counts.get(status) }))
}

const dayTrend = (rows, now, days) => {
  const length = Math.min(days ?? TREND_MAX_DAYS, TREND_MAX_DAYS)
  const created = countBy(rows, (r) => (r.ticket.createdAt ? istDayKey(r.ticket.createdAt) : undefined))
  const resolved = countBy(rows, (r) => (r.ticket.resolution?.resolvedAt ? istDayKey(r.ticket.resolution.resolvedAt) : undefined))
  const trend = []
  for (let i = length - 1; i >= 0; i--) {
    const date = istDayKey(new Date(now.getTime() - i * DAY))
    trend.push({ date, created: created.get(date) ?? 0, resolved: resolved.get(date) ?? 0 })
  }
  return trend
}

// ---- manager / admin dashboard -------------------------------------------------------------

// tickets        lean tickets already scoped to the viewer
// policies       every SLA policy; settings = org business hours
// technicians    the active technicians to show in the workload table
// categories / departments   id -> name lookups
export const buildDashboard = ({ tickets, policies = [], settings, technicians = [], categories = [], departments = [], now = new Date(), days = DEFAULT_DAYS, truncated = false, department = null }) => {
  const from = windowStart(now, days)
  const rows = annotate(tickets, policies, settings, now)
  const overall = summarize(rows, { from, now })
  const levelOf = new Map(policies.map((p) => [p.priority, p.level]))

  // open tickets by priority, most urgent first
  const priorityCounts = countBy(rows.filter((r) => !FINISHED_STATUSES.includes(r.ticket.status)), (r) => r.ticket.priority)
  const backlogByPriority = [...priorityCounts.entries()]
    .map(([priority, count]) => ({ priority, count }))
    .sort((a, b) => (levelOf.get(b.priority) ?? 0) - (levelOf.get(a.priority) ?? 0) || a.priority.localeCompare(b.priority))

  const categoryName = new Map(categories.map((c) => [String(c._id), c.name]))
  const categoryCounts = countBy(rows.filter((r) => inWindow(r.ticket.createdAt, from)), (r) => (r.ticket.category ? String(r.ticket.category) : undefined))
  const topCategories = [...categoryCounts.entries()]
    .map(([id, count]) => ({ categoryId: id, name: categoryName.get(id) ?? 'Unknown', count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 5)

  const byAssignee = new Map()
  for (const row of rows) {
    if (!row.ticket.assignedTo) continue
    const id = String(row.ticket.assignedTo)
    if (!byAssignee.has(id)) byAssignee.set(id, [])
    byAssignee.get(id).push(row)
  }
  const workload = technicians.map((tech) => {
    const mine = byAssignee.get(String(tech._id)) ?? []
    const part = summarize(mine, { from, now })
    return {
      technicianId: String(tech._id),
      name: fullName(tech),
      department: tech.department ? String(tech.department) : null,
      open: mine.filter((r) => TECH_ACTIVE_STATUSES.includes(r.ticket.status)).length,
      breached: part.sla.current.breached,
      atRisk: part.sla.current.atRisk,
      resolved: part.totals.resolved,
      resolutionCompliance: part.sla.resolution.compliance,
      avgResolutionHours: part.times.resolution.avgHours,
      csatAverage: part.csat.average,
      csatCount: part.csat.count,
    }
  }).sort((a, b) => b.open - a.open || a.name.localeCompare(b.name))

  // a per-team comparison, only useful when the viewer can see more than one team
  const byDepartment = new Map()
  for (const row of rows) {
    const id = String(row.ticket.department)
    if (!byDepartment.has(id)) byDepartment.set(id, [])
    byDepartment.get(id).push(row)
  }
  const departmentName = new Map(departments.map((d) => [String(d._id), d.name]))
  const teams = [...byDepartment.entries()].map(([id, part]) => {
    const s = summarize(part, { from, now })
    return {
      departmentId: id,
      name: departmentName.get(id) ?? 'Unknown',
      open: s.totals.open,
      created: s.totals.created,
      breached: s.sla.current.breached,
      atRisk: s.sla.current.atRisk,
      unassigned: s.sla.current.unassigned,
      resolutionCompliance: s.sla.resolution.compliance,
      responseCompliance: s.sla.response.compliance,
      csatAverage: s.csat.average,
      csatCount: s.csat.count,
    }
  }).sort((a, b) => a.name.localeCompare(b.name))

  return {
    scope: { days, from, department, generatedAt: now, truncated, ticketsConsidered: tickets.length },
    ...overall,
    byStatus: statusCounts(rows),
    backlogByPriority,
    trend: dayTrend(rows, now, days),
    categories: topCategories,
    workload,
    teams,
  }
}

// ---- technician dashboard -------------------------------------------------------------------

// tickets: the tickets assigned to this technician; workLogs: their work log rows { minutesSpent, createdAt }
export const buildTechnicianDashboard = ({ tickets, workLogs = [], policies = [], settings, now = new Date(), days = DEFAULT_DAYS, truncated = false }) => {
  const from = windowStart(now, days)
  const rows = annotate(tickets, policies, settings, now)
  const s = summarize(rows, { from, now })
  const active = rows.filter((r) => TECH_ACTIVE_STATUSES.includes(r.ticket.status))
  const minutes = workLogs.filter((w) => inWindow(w.createdAt, from)).reduce((sum, w) => sum + (w.minutesSpent || 0), 0)
  return {
    scope: { days, from, generatedAt: now, truncated, ticketsConsidered: tickets.length },
    open: {
      total: active.length,
      byStatus: statusCounts(active),
      breached: s.sla.current.breached,
      atRisk: s.sla.current.atRisk,
      onHold: s.sla.current.onHold,
      awaitingConfirmation: s.sla.current.awaitingConfirmation,
    },
    resolved: s.totals.resolved,
    sla: { resolution: s.sla.resolution, response: s.sla.response },
    times: s.times,
    csat: s.csat,
    work: { minutes, hours: round(minutes / 60, 1), entries: workLogs.filter((w) => inWindow(w.createdAt, from)).length },
    trend: dayTrend(rows, now, days),
  }
}
