// MVP transition table (subset of the full plan's Section 6b matrix).
// Each row: which "from" statuses are allowed, the resulting "to" status,
// and which roles may perform it. Anything not listed is rejected as 400.
export const TRANSITIONS = {
  assign:   { from: ['OPEN', 'REOPENED'], to: 'ASSIGNED', roles: ['MANAGER', 'ADMIN'] },
  claim:    { from: ['OPEN'], to: 'ASSIGNED', roles: ['TECHNICIAN'] },
  start:    { from: ['ASSIGNED', 'REOPENED'], to: 'IN_PROGRESS', roles: ['TECHNICIAN'] },
  resolve:  { from: ['IN_PROGRESS'], to: 'RESOLVED', roles: ['TECHNICIAN'] },
  confirm:  { from: ['RESOLVED'], to: 'CLOSED', roles: ['EMPLOYEE'] },
  reopen:   { from: ['RESOLVED', 'CLOSED'], to: 'REOPENED', roles: ['EMPLOYEE'] },
  cancel:   { from: ['OPEN', 'ASSIGNED'], to: 'CANCELLED', roles: ['EMPLOYEE', 'ADMIN'] },
}

export const isTransitionAllowed = (action, currentStatus, role) => {
  const rule = TRANSITIONS[action]
  if (!rule) return { ok: false, reason: 'unknown action' }
  if (!rule.from.includes(currentStatus)) return { ok: false, reason: `cannot ${action} a ${currentStatus} ticket` }
  if (!rule.roles.includes(role)) return { ok: false, reason: 'not authorized for this action' }
  return { ok: true, to: rule.to }
}
