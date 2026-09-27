// Section 6b asset table. Every entry appends to lifecycleHistory.
// `assigneeRequired`/`clearsAssignee` flag the special-case field effects
// the route handler needs to apply alongside the plain status change.
export const ASSET_TRANSITIONS = {
  activate:  { from: ['PROCURED'], to: 'IN_STOCK', roles: ['ASSET_MANAGER', 'ADMIN'] },
  assign:    { from: ['IN_STOCK'], to: 'ASSIGNED', roles: ['ASSET_MANAGER', 'ADMIN'], assigneeRequired: true },
  return:    { from: ['ASSIGNED'], to: 'IN_STOCK', roles: ['ASSET_MANAGER', 'ADMIN'], clearsAssignee: true },
  repair:    { from: ['ASSIGNED', 'IN_STOCK'], to: 'IN_REPAIR', roles: ['ASSET_MANAGER', 'ADMIN', 'TECHNICIAN'] },
  // from IN_REPAIR there are two possible destinations depending on whether
  // an assignee is still on record — the route handler picks the branch
  reinstate: { from: ['IN_REPAIR'], to: 'ASSIGNED', roles: ['ASSET_MANAGER', 'ADMIN', 'TECHNICIAN'], requiresExistingAssignee: true },
  restock:   { from: ['IN_REPAIR'], to: 'IN_STOCK', roles: ['ASSET_MANAGER', 'ADMIN', 'TECHNICIAN'], clearsAssignee: true },
  retire:    { from: ['IN_STOCK', 'REPLACED', 'IN_REPAIR'], to: 'RETIRED', roles: ['ASSET_MANAGER', 'ADMIN'], clearsAssignee: true },
  // `replace` is handled as its own two-asset operation in AssetAPI.js,
  // not through this generic single-asset check, but is listed for reference:
  // { from: ['ASSIGNED', 'IN_REPAIR'] (assignedTo required), to: 'REPLACED', roles: ['ASSET_MANAGER', 'ADMIN'] }
}

export const isAssetTransitionAllowed = (action, currentStatus, role, asset) => {
  const rule = ASSET_TRANSITIONS[action]
  if (!rule) return { ok: false, reason: 'unknown action' }
  if (!rule.from.includes(currentStatus)) return { ok: false, reason: `cannot ${action} a ${currentStatus} asset` }
  if (!rule.roles.includes(role)) return { ok: false, reason: 'not authorized for this action' }
  if (rule.requiresExistingAssignee && !asset.assignedTo) {
    return { ok: false, reason: 'this asset has no assignee on record — use restock instead' }
  }
  return { ok: true, to: rule.to, assigneeRequired: Boolean(rule.assigneeRequired), clearsAssignee: Boolean(rule.clearsAssignee) }
}
