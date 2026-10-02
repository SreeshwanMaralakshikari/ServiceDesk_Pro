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
