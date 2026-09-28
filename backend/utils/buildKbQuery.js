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

// filter values come straight from the query string, where a repeated key
// (?q=a&q=b) is an array and a bracketed key (?status[$ne]=x) can be an
// operator object under some query-parser settings. Only plain non-blank
// strings are accepted; anything else is treated as "no filter" rather than
// forwarded to MongoDB ($search needs a string; an operator object in
// `status`/`category` would be a query-operator injection).
const asText = (value) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)

export const buildKbQuery = (user, filters = {}) => {
  const query = { isDeleted: false, ...buildKbScope(user) }
  const status = asText(filters.status)
  const category = asText(filters.category)
  const q = asText(filters.q)
  if (status) query.status = status
  if (category) query.category = category
  if (q) query.$text = { $search: q }
  return query
}
