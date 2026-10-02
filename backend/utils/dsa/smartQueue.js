import { MinHeap } from './MinHeap.js'

// lower rank = more urgent
export const URGENCY_RANK = { BREACHED: 0, AT_RISK: 1, ON_TRACK: 2, NO_CLOCK: 3, ON_HOLD: 4 }

// ticket: plain object with status, sla { responseDueAt, resolutionDueAt, firstRespondedAt,
// responseBreached, resolutionBreached, warnAt }, priorityLevel (number)
export const urgencyOf = (ticket, now = new Date()) => {
  if (ticket.status === 'ON_HOLD') return 'ON_HOLD'
  const sla = ticket.sla || {}
  const nowMs = now.getTime()
  const resolutionDue = sla.resolutionDueAt ? new Date(sla.resolutionDueAt).getTime() : null
  const responseDue = sla.responseDueAt ? new Date(sla.responseDueAt).getTime() : null
  if (resolutionDue === null && responseDue === null) return 'NO_CLOCK'
  // flags can lag behind the clock (the checker runs every few minutes), so the dates count too
  if (sla.resolutionBreached) return 'BREACHED'
  if (resolutionDue !== null && resolutionDue <= nowMs) return 'BREACHED'
  if (!sla.firstRespondedAt) {
    if (sla.responseBreached) return 'BREACHED'
    if (responseDue !== null && responseDue <= nowMs) return 'BREACHED'
  }
  // warnAt is the 75% point of the resolution window
  if (sla.warnAt && new Date(sla.warnAt).getTime() <= nowMs) return 'AT_RISK'
  return 'ON_TRACK'
}

const ms = (d, fallback) => (d ? new Date(d).getTime() : fallback)

// order: urgency, soonest resolution due, higher priority level, older ticket, id
export const buildComparator = (now) => {
  const cache = new Map()
  const rank = (t) => {
    if (!cache.has(t)) cache.set(t, URGENCY_RANK[urgencyOf(t, now)])
    return cache.get(t)
  }
  return (a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return ra - rb
    const da = ms(a.sla?.resolutionDueAt, Infinity)
    const db = ms(b.sla?.resolutionDueAt, Infinity)
    if (da !== db) return da < db ? -1 : 1
    const pa = a.priorityLevel ?? 0
    const pb = b.priorityLevel ?? 0
    if (pa !== pb) return pb - pa
    const ca = ms(a.createdAt, 0)
    const cb = ms(b.createdAt, 0)
    if (ca !== cb) return ca - cb
    return String(a._id) < String(b._id) ? -1 : String(a._id) > String(b._id) ? 1 : 0
  }
}

// returns tickets in work order, each tagged with its urgency
export const buildQueue = (tickets, { now = new Date(), limit = Infinity } = {}) => {
  const heap = new MinHeap(buildComparator(now), tickets)
  return heap.drain(limit).map((t) => ({ ...t, urgency: urgencyOf(t, now) }))
}
