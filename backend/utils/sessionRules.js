// pure helpers for login sessions

const UNIT_MS = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000, w: 7 * 24 * 60 * 60 * 1000 }
const DEFAULT_MS = UNIT_MS.d

// JWT_EXPIRES_IN is what jsonwebtoken accepts: a number of seconds ("3600" or 3600) or "30m", "12h", "7d"
// returns milliseconds; anything unreadable or non-positive falls back to 1 day so the cookie never outlives a bad config
export const durationToMs = (value) => {
  if (value === undefined || value === null || value === '') return DEFAULT_MS
  const text = String(value).trim().toLowerCase()
  const match = /^(\d+)\s*([smhdw])?$/.exec(text)
  if (!match) return DEFAULT_MS
  const amount = Number(match[1])
  const ms = match[2] ? amount * UNIT_MS[match[2]] : amount * 1000 // a bare number is seconds
  return Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_MS
}

// a token is stale when it was issued before the last password change
// iat is in whole seconds, so compare at second precision: a token issued in the
// same second as the change (a login right after it) stays valid
export const tokenIsStale = (iatSeconds, passwordChangedAt) => {
  if (!passwordChangedAt) return false // never changed: old accounts and old tokens keep working
  const changedMs = new Date(passwordChangedAt).getTime()
  if (!Number.isFinite(changedMs)) return false
  if (!Number.isFinite(iatSeconds)) return true // no usable issue time on a user who has changed password: do not trust it
  return iatSeconds < Math.floor(changedMs / 1000)
}
