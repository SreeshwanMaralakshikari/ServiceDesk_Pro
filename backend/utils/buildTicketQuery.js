// role-based scope is always applied first; any client filters are ANDed
// on top of it so a filter can only narrow the results, never widen them.
export const buildTicketScope = (user) => {
  switch (user.role) {
    case 'ADMIN':
      return {}
    case 'MANAGER':
    case 'TECHNICIAN':
      return { department: user.department }
    case 'EMPLOYEE':
      return { requester: user.id }
    case 'ASSET_MANAGER':
      return { _id: null } // no ticket access for asset managers in the MVP
    default:
      return { _id: null }
  }
}

export const buildTicketQuery = (user, filters = {}) => {
  const query = { isDeleted: false, ...buildTicketScope(user) }
  if (filters.status) query.status = filters.status
  if (filters.priority) query.priority = filters.priority
  if (filters.category) query.category = filters.category
  if (filters.q) query.$text = { $search: filters.q }
  return query
}
