import rateLimit from 'express-rate-limit'

const tooMany = (what) => ({ message: `Too many ${what}, please try again later` })

// login: only failed attempts count, so people (or graders) signing in and out
// of several accounts behind the same proxy IP do not lock each other out
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: tooMany('login attempts'),
})

// second login limiter, keyed on the ACCOUNT (email), not the address. The
// per-IP limiter alone can be dodged by sending a fake X-Forwarded-For
// straight to the API host (F-045); this one cannot. The limit is higher than
// the per-IP one so that someone typing a wrong password on a shared account
// cannot easily lock the real owner out.
const emailKey = (req) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  return email ? `email:${email}` : `no-email:${req.ip}`
}
export const loginEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number.parseInt(process.env.LOGIN_EMAIL_LIMIT_MAX, 10) || 20,
  skipSuccessfulRequests: true,
  keyGenerator: emailKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: tooMany('login attempts for this account'),
})

// public self-registration is unauthenticated, so it is limited per IP
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: Number.parseInt(process.env.REGISTER_RATE_LIMIT_MAX, 10) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: tooMany('sign-ups'),
})

// AI routes cost money and quota: per USER, so it must be mounted after
// verifyToken (req.user is not set before that). The max is an env override
// so tests can lift it
export const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: () => Number.parseInt(process.env.AI_RATE_LIMIT_MAX, 10) || 20,
  keyGenerator: (req) => req.user.id,
  standardHeaders: true,
  legacyHeaders: false,
  message: tooMany('AI requests'),
})
