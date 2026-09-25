// Full Section 6b status matrix (linked-ticket/duplicate closing and
// watchers stay out per PLAN.md Phase 6; ON_HOLD pause math here is
// simple wall-clock — the business-hours version is Phase 3).
//
// `to: null` means "no status change" (used by reassign, which only
// moves assignedTo).
export const TRANSITIONS = {
  approve:  { from: ['PENDING_APPROVAL'], to: 'OPEN',       roles: ['MANAGER', 'ADMIN'] },
  reject:   { from: ['PENDING_APPROVAL'], to: 'REJECTED',   roles: ['MANAGER', 'ADMIN'], requiresNote: true },
  cancel:   { from: ['PENDING_APPROVAL', 'OPEN', 'ASSIGNED'], to: 'CANCELLED', roles: ['EMPLOYEE', 'ADMIN'], requiresNote: true },

  assign:   { from: ['OPEN'], to: 'ASSIGNED', roles: ['MANAGER', 'ADMIN'] },
  claim:    { from: ['OPEN'], to: 'ASSIGNED', roles: ['TECHNICIAN'] },
  reassign: { from: ['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'REOPENED'], to: null, roles: ['MANAGER', 'ADMIN'] },

  start:    { from: ['ASSIGNED', 'REOPENED'], to: 'IN_PROGRESS', roles: ['TECHNICIAN'], assigneeOnly: true },
  hold:     { from: ['IN_PROGRESS'], to: 'ON_HOLD', roles: ['TECHNICIAN'], assigneeOnly: true, requiresNote: true },
  resume:   { from: ['ON_HOLD'], to: 'IN_PROGRESS', roles: ['TECHNICIAN'], assigneeOnly: true },
  resolve:  { from: ['IN_PROGRESS'], to: 'RESOLVED', roles: ['TECHNICIAN'], assigneeOnly: true },

  confirm:  { from: ['RESOLVED'], to: 'CLOSED', roles: ['EMPLOYEE'] },
  reopen:   { from: ['RESOLVED', 'CLOSED'], to: 'REOPENED', roles: ['EMPLOYEE'], requiresNote: true },
}

// actions that only the requester (not "any employee") may perform
export const REQUESTER_ONLY_ACTIONS = ['confirm', 'reopen', 'cancel']
// actions restricted to staff on the ticket's own department (unless ADMIN)
export const TEAM_SCOPED_ACTIONS = ['assign', 'claim', 'reassign', 'approve', 'reject', 'start', 'hold', 'resume', 'resolve']
// a CLOSED ticket can only be reopened within this many days of confirmation
export const REOPEN_WINDOW_DAYS = 7

export const isTransitionAllowed = (action, currentStatus, role) => {
  const rule = TRANSITIONS[action]
  if (!rule) return { ok: false, reason: 'unknown action' }
  if (!rule.from.includes(currentStatus)) return { ok: false, reason: `cannot ${action} a ${currentStatus} ticket` }
  if (!rule.roles.includes(role)) return { ok: false, reason: 'not authorized for this action' }
  return { ok: true, to: rule.to, requiresNote: Boolean(rule.requiresNote), assigneeOnly: Boolean(rule.assigneeOnly) }
}
