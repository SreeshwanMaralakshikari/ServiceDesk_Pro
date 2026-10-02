import { asText } from './queryParams.js'

// role-based scope is always applied first; any client filters are ANDed
// on top of it so a filter can only narrow the results, never widen them.
// A staff user without a department matches nothing: `{ department: undefined }`
// would be dropped by Mongoose and turn into an unscoped query.
export const buildTicketScope = (user) => {
  switch (user.role) {
    case 'ADMIN':
      return {}
    case 'MANAGER':
    case 'TECHNICIAN':
      return user.department ? { department: user.department } : { _id: null }
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
  const status = asText(filters.status)
  const priority = asText(filters.priority)
  const category = asText(filters.category)
  const q = asText(filters.q)
  if (status) query.status = status
  if (priority) query.priority = priority
  if (category) query.category = category
  if (q) query.$text = { $search: q }
  return query
}
