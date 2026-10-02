import { asText } from './queryParams.js'

// role-based scope is always applied first; any client filters are ANDed
// on top of it so a filter can only narrow the results, never widen them —
// same rule as buildTicketQuery.js.
//
// Every branch here returns an `$or` (never a bare `status:` field). That's
// deliberate: buildKbQuery() below applies `filters.status` by *assigning*
// query.status after the scope is spread in. If a restricted scope had
// instead returned a plain `{ status: 'PUBLISHED' }`, that assignment would
// silently overwrite it — letting e.g. an EMPLOYEE pass `?status=DRAFT` and
// see drafts. Keeping every scope as an `$or` means the later `query.status`
// becomes a second, ANDed condition instead of a replacement, so a
// mismatched filter just yields zero results instead of leaking rows.
export const buildKbScope = (user) => {
  switch (user.role) {
    case 'ADMIN':
    case 'MANAGER':
      return {} // full visibility, filters narrow further
    case 'TECHNICIAN':
      return { $or: [{ status: 'PUBLISHED' }, { author: user.id }] }
    default:
      // EMPLOYEE, ASSET_MANAGER — published only
      return { $or: [{ status: 'PUBLISHED' }] }
  }
}

// relevance order for a text search: best match first, then newest, then _id so equal scores page the same way every time
export const TEXT_SCORE = { score: { $meta: 'textScore' } }
export const textRankSort = { score: { $meta: 'textScore' }, publishedAt: -1, _id: -1 }

export const buildKbQuery = (user, filters = {}) => {
  const query = { isDeleted: false, ...buildKbScope(user) }
  const status = asText(filters.status)
  const category = asText(filters.category)
  const q = asText(filters.q)
  if (status) query.status = status
  if (category) query.category = category
  if (q) query.$text = { $search: q }
  // the manager's review inbox: drafts a technician asked to have reviewed
  if (asText(filters.review) === 'pending') {
    query.status = 'DRAFT'
    query.reviewRequestedAt = { $exists: true }
  }
  return query
}
