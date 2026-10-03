import { FINISHED_STATUSES, SLA_RUNNING_STATUSES } from './ticketStatuses.js'

// The one place that decides "did this ticket meet its SLA". The dashboards and
// the CSV export both use it, so they can never disagree. Everything is derived
// from the due dates and the real timestamps, never from the stored breach flags:
// those are only set when the cron or a lazy check has run, and the free Render
// tier sleeps (the same reason the frontend badge in utils/sla.js is date based).
// Works on plain (lean) tickets; dates may be Date objects.

// MET / MISSED once the answer is known, PENDING while the deadline is still ahead,
// NONE when there is no clock or the ticket ended without ever needing a response
export const responseOutcome = (ticket, now = new Date()) => {
  const due = ticket.sla?.responseDueAt
  if (!due) return 'NONE'
  const first = ticket.sla.firstRespondedAt
  if (first) return first <= due ? 'MET' : 'MISSED'
  // a cancelled or rejected ticket is not held to a response it never got
  if (FINISHED_STATUSES.includes(ticket.status)) return 'NONE'
  return now > due ? 'MISSED' : 'PENDING'
}

// MET / MISSED for a ticket that was resolved (compared with its due date, which already
// includes any time on hold). While it is still open: BREACHED, AT_RISK, ON_TRACK or ON_HOLD.
// NONE when there is no clock or the ticket ended without a resolution.
// A reopen clears the resolution time and restarts the clock, so a reopened ticket is
// judged on its current cycle (the earlier breach is counted in sla.pastBreaches).
export const resolutionOutcome = (ticket, now = new Date()) => {
  const due = ticket.sla?.resolutionDueAt
  if (!due) return 'NONE'
  const resolvedAt = ticket.resolution?.resolvedAt
  if (resolvedAt) return resolvedAt <= due ? 'MET' : 'MISSED'
  if (FINISHED_STATUSES.includes(ticket.status)) return 'NONE'
  if (ticket.status === 'ON_HOLD') return 'ON_HOLD'
  if (!SLA_RUNNING_STATUSES.includes(ticket.status)) return 'NONE'
  if (now > due) return 'BREACHED'
  const warnAt = ticket.sla.warnAt
  if (warnAt && now > warnAt) return 'AT_RISK'
  return 'ON_TRACK'
}
