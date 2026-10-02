// Workflow for KnowledgeArticle. Same declarative table + checker pattern as
// ticketTransitions.js / assetTransitions.js.
//
// Rule (D4): technicians write drafts and ask for a review; only a MANAGER or
// ADMIN publishes, archives and restores. `to: null` means the status stays the
// same (request-review only stamps the draft as waiting for a manager).
// `authorOnlyForTechnician` means a technician may use the action on their
// own article only (the route enforces it; managers and admins are not limited).
export const KB_TRANSITIONS = {
  'request-review': { from: ['DRAFT'],              to: null,        roles: ['TECHNICIAN', 'MANAGER', 'ADMIN'], authorOnlyForTechnician: true },
  publish:          { from: ['DRAFT'],              to: 'PUBLISHED', roles: ['MANAGER', 'ADMIN'] },
  archive:          { from: ['DRAFT', 'PUBLISHED'], to: 'ARCHIVED',  roles: ['MANAGER', 'ADMIN'] },
  restore:          { from: ['ARCHIVED'],           to: 'DRAFT',     roles: ['MANAGER', 'ADMIN'] },
}

export const isKbTransitionAllowed = (action, currentStatus, role) => {
  const rule = KB_TRANSITIONS[action]
  if (!rule) return { ok: false, reason: 'unknown action' }
  if (!rule.from.includes(currentStatus)) return { ok: false, reason: `cannot ${action} a ${currentStatus} article` }
  if (!rule.roles.includes(role)) return { ok: false, reason: 'not authorized for this action' }
  return { ok: true, to: rule.to, authorOnlyForTechnician: Boolean(rule.authorOnlyForTechnician) }
}
