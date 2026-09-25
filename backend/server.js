import exp from 'express'
import { config } from 'dotenv'
import { connect } from 'mongoose'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import helmet from 'helmet'

import { commonApp } from './APIs/CommonAPI.js'
import { metaApp } from './APIs/MetaAPI.js'
import { ticketApp } from './APIs/TicketAPI.js'
import { adminApp } from './APIs/AdminAPI.js'
import { notificationApp } from './APIs/NotificationAPI.js'
import { seedIfEmpty } from './utils/seedData.js'
import { sanitizeBody } from './middlewares/sanitize.js'

config()

// fail fast if required env vars are missing
const required = ['MONGO_URI', 'JWT_SECRET', 'CLIENT_URL']
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}. Copy .env.example to .env and fill it in.`)
    process.exit(1)
  }
}

const app = exp()

app.set('trust proxy', 1)
app.use(helmet())
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174', process.env.CLIENT_URL],
  credentials: true,
}))
app.use(exp.json({ limit: '1mb' }))
app.use(cookieParser())
app.use(sanitizeBody)

// health check for deployment platforms
app.get('/health', (req, res) => {
  //send res
  res.status(200).json({ message: 'ok', payload: { uptime: process.uptime() } })
})

app.use('/auth', commonApp)
app.use('/meta-api', metaApp)
app.use('/ticket-api', ticketApp)
app.use('/admin-api', adminApp)
app.use('/notification-api', notificationApp)

const connectDB = async (attempt = 1) => {
  const maxAttempts = 8
  const delayMs = Math.min(30000, 2000 * attempt) // backs off up to 30s between tries
  try {
    await connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 })
    console.log('DB connected')
    if (process.env.SEED_ON_START === 'true') {
      await seedIfEmpty()
    }
    const port = process.env.PORT || 5000
    app.listen(port, () => console.log(`server listening on ${port}...`))
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

// invalid path handler
app.use((req, res) => {
  //send res
  res.status(404).json({ message: `Path ${req.url} is invalid` })
})

// global error handler
app.use((err, req, res, next) => {
  console.log('Error name:', err.name)
  console.log('Full error:', err.message)

  if (err.name === 'ValidationError') {
    //send res
    return res.status(400).json({ message: 'error occurred', error: err.message })
  }
  if (err.name === 'CastError') {
    //send res
    return res.status(400).json({ message: 'error occurred', error: 'invalid id' })
  }

  const errCode = err.code ?? err.cause?.code
  const keyValue = err.keyValue ?? err.cause?.keyValue
  if (errCode === 11000) {
    if (keyValue) {
      const field = Object.keys(keyValue)[0]
      //send res
      return res.status(409).json({ message: 'error occurred', error: `${field} "${keyValue[field]}" already exists` })
    }
    //send res
    return res.status(409).json({ message: 'error occurred', error: 'duplicate key error' })
  }

  //send res
  res.status(500).json({ message: 'error occurred', error: 'server side error' })
})
