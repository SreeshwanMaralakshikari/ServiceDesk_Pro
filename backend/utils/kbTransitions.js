// Publish/Archive/Restore workflow for KnowledgeArticle. Same declarative
// table + isXTransitionAllowed() checker pattern as ticketTransitions.js /
// assetTransitions.js — kept in its own file for the same reason those are:
// so the rules are one readable place instead of scattered through the route.
//
// `authorOrElevatedOnly` mirrors Ticket's `assigneeOnly`: the route handler
// enforces that only the article's own author *or* a MANAGER/ADMIN may fire
// the action — a plain TECHNICIAN cannot publish/archive/restore someone
// else's article even though TECHNICIAN is in `roles` below.
export const KB_TRANSITIONS = {
  publish: { from: ['DRAFT'],              to: 'PUBLISHED', roles: ['TECHNICIAN', 'MANAGER', 'ADMIN'], authorOrElevatedOnly: true },
  archive: { from: ['DRAFT', 'PUBLISHED'], to: 'ARCHIVED',  roles: ['TECHNICIAN', 'MANAGER', 'ADMIN'], authorOrElevatedOnly: true },
  restore: { from: ['ARCHIVED'],           to: 'DRAFT',     roles: ['TECHNICIAN', 'MANAGER', 'ADMIN'], authorOrElevatedOnly: true },
}

export const isKbTransitionAllowed = (action, currentStatus, role) => {
  const rule = KB_TRANSITIONS[action]
  if (!rule) return { ok: false, reason: 'unknown action' }
  if (!rule.from.includes(currentStatus)) return { ok: false, reason: `cannot ${action} a ${currentStatus} article` }
  if (!rule.roles.includes(role)) return { ok: false, reason: 'not authorized for this action' }
  return { ok: true, to: rule.to, authorOrElevatedOnly: Boolean(rule.authorOrElevatedOnly) }
}
