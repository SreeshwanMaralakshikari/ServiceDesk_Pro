// Purely derived from the ticket's own due dates — never from the
// stored breach/warning flags, so the badge is always live even if the
// cron or lazy check hasn't run in the last few minutes (Render's free
// tier sleeps; see backend/jobs/slaChecker.js).
const NO_CLOCK_STATUSES = ['PENDING_APPROVAL', 'RESOLVED', 'CLOSED', 'REJECTED', 'CANCELLED']

export const getSlaStatus = (ticket) => {
  if (!ticket) return null
  if (ticket.status === 'ON_HOLD') return { label: 'On hold', className: 'bg-orange-100 text-orange-700' }
  if (NO_CLOCK_STATUSES.includes(ticket.status)) return null
  if (!ticket.sla?.resolutionDueAt) return null

  const now = Date.now()
  const dueAt = new Date(ticket.sla.resolutionDueAt).getTime()
  if (now > dueAt) return { label: 'Breached', className: 'bg-red-100 text-red-700' }

  const warnAt = ticket.sla.warnAt ? new Date(ticket.sla.warnAt).getTime() : null
  if (warnAt && now > warnAt) return { label: 'At risk', className: 'bg-amber-100 text-amber-700' }

  return { label: 'On track', className: 'bg-green-100 text-green-700' }
}

// short "2h 15m left" / "3h 40m overdue" style countdown for the detail page
export const formatSlaCountdown = (dueAtIso) => {
  if (!dueAtIso) return null
  const diffMs = new Date(dueAtIso).getTime() - Date.now()
  const overdue = diffMs < 0
  const abs = Math.abs(diffMs)
  const hours = Math.floor(abs / 3600000)
  const minutes = Math.floor((abs % 3600000) / 60000)
  const text = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
  return overdue ? `${text} overdue` : `${text} left`
}
