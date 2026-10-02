// one place that parses ?page / ?limit, so a list route can never be asked for
// page 0, a negative skip, NaN or the whole collection (?limit=0)
export const MAX_LIMIT = 50
export const DEFAULT_LIMIT = 20

const toInt = (value) => (typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN)

export const getPagination = (query = {}) => {
  const page = Math.max(toInt(query.page) || 1, 1)
  const limit = Math.min(Math.max(toInt(query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT)
  return { page, limit, skip: (page - 1) * limit }
}

// the list payload shape used by every list route
export const toPage = (items, total, { page, limit }) => ({
  items,
  total,
  page,
  totalPages: Math.ceil(total / limit),
})
