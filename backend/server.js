import './config/loadEnv.js'
import { connect } from 'mongoose'

import { app } from './app.js'
import { seedIfEmpty } from './utils/seedData.js'
import { startSlaChecker } from './jobs/slaChecker.js'
import { startWarrantyChecker, runWarrantyCheck } from './jobs/warrantyChecker.js'

// fail fast if required env vars are missing
const required = ['MONGO_URI', 'JWT_SECRET', 'CLIENT_URL']
for (const key of required)
{
  if(!process.env[key])
  {
    console.error(`Missing required env var: ${key}. Copy .env.example to .env and fill it in.`)
    process.exit(1)
  }
}

// a URI with nothing after the host list silently uses the default "test"
// database; warn instead of exiting so a deployment that still runs that way
// keeps booting (the move to a named database happens in DEPLOY)
const hasDbName = (uri) => {
  const afterHosts = uri.replace(/^mongodb(\+srv)?:\/\//, '').split('?')[0]
  return /\/[^/]+$/.test(afterHosts)
}

if(!hasDbName(process.env.MONGO_URI))
{
  console.log('WARNING: MONGO_URI has no database name, so MongoDB uses the default "test" database. Use .../servicedeskpro_dev locally and .../servicedeskpro_prod on Render.')
}

let listening = false

const connectDB = async (attempt = 1) => {
  const maxAttempts = 8
  const delayMs = Math.min(30000, 2000 * attempt) // backs off up to 30s between tries
  try {
    await connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 })
    console.log('DB connected')
    console.log(process.env.GROQ_API_KEY ? 'AI classification: enabled (GROQ_API_KEY set)' : 'AI classification: no GROQ_API_KEY set — classify-ticket will use the offline fallback')

    // never auto-seed production: demo accounts there come from `npm run seed`
    if (process.env.SEED_ON_START === 'true') {
      if (process.env.NODE_ENV === 'production') {
        console.log('SEED_ON_START is ignored when NODE_ENV=production — run `npm run seed` once instead')
      } else {
        await seedIfEmpty()
      }
    }

    // listen only once, even if a later step throws and the retry loop runs again
    if (!listening) {
      const port = process.env.PORT || 5000
      app.listen(port, () => console.log(`server listening on ${port}...`))
      listening = true
    }
    await startSlaChecker() // only after the DB connection is confirmed live; awaited so a problem here can't become an unhandled rejection
    await startWarrantyChecker()
    // the warranty cron only fires at 09:00 server time and Render's free tier
    // sleeps, so also run it once per boot (idempotent via warrantyNotified)
    runWarrantyCheck().catch((err) => console.log('warranty check at startup failed (non-fatal):', err.message))
  } catch (err) {
    console.log(`err in db connect (attempt ${attempt}/${maxAttempts}):`, err.message)
    if (attempt >= maxAttempts) {
      console.log('giving up after repeated failures — check MONGO_URI, Atlas Network Access, and your network/firewall (see PLAN.md / README.md troubleshooting notes)')
      process.exit(1)
    }
    console.log(`retrying in ${delayMs / 1000}s...`)
    setTimeout(() => connectDB(attempt + 1), delayMs)
  }
}
connectDB()
