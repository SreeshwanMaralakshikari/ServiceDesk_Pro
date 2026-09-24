// strip keys starting with "$" or containing "." from req.body to block
// basic NoSQL-injection / operator-injection attempts
const clean = (obj) => {
  if (Array.isArray(obj)) return obj.map(clean)
  if (obj && typeof obj === 'object') {
    const out = {}
    for (const key of Object.keys(obj)) {
      if (key.startsWith('$') || key.includes('.')) continue
      out[key] = clean(obj[key])
    }
    return out
  }
  return obj
}

export const sanitizeBody = (req, res, next) => {
  if (req.body) req.body = clean(req.body)
  next()
}
