// query-string values arrive as a string, an array (?q=a&q=b) or, under some
// parser settings, an operator object. Only a plain non-blank string is
// accepted; anything else counts as "no filter" instead of reaching MongoDB
// ($search needs a string, and an object in a field filter is operator injection)
export const asText = (value) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)

// a 24-character hex string, the only shape an ObjectId arrives in
export const isObjectIdString = (value) => typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value)

// "true" / "false" query strings; anything else means no filter
export const asBool = (value) => (value === 'true' ? true : value === 'false' ? false : undefined)

// user text used inside a regex (name search) must not act as a pattern
export const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
