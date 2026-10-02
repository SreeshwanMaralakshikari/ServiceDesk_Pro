// query-string values arrive as a string, an array (?q=a&q=b) or, under some
// parser settings, an operator object. Only a plain non-blank string is
// accepted; anything else counts as "no filter" instead of reaching MongoDB
// ($search needs a string, and an object in a field filter is operator injection)
export const asText = (value) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)
