import './config/loadEnv.js'
import exp from 'express'
import mongoose from 'mongoose'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import helmet from 'helmet'

import { commonApp } from './APIs/CommonAPI.js'
import { metaApp } from './APIs/MetaAPI.js'
import { ticketApp } from './APIs/TicketAPI.js'
import { adminApp } from './APIs/AdminAPI.js'
import { notificationApp } from './APIs/NotificationAPI.js'
import { assetApp } from './APIs/AssetAPI.js'
import { vendorApp } from './APIs/VendorAPI.js'
import { kbApp } from './APIs/KnowledgeBaseAPI.js'
import { aiApp } from './APIs/AiAPI.js'
import { workLogApp } from './APIs/WorkLogAPI.js'
import { techApp } from './APIs/TechAPI.js'
import { managerApp } from './APIs/ManagerAPI.js'
import { reportApp } from './APIs/ReportAPI.js'
import { sanitizeBody } from './middlewares/sanitize.js'
import { errorHandler } from './middlewares/errorHandler.js'
import { cronStatus } from './jobs/status.js'

// the express app without any connection or listener, so tests can mount it
// with supertest; server.js owns the database, jobs and listen()
export const app = exp()

// Vercel edge -> Render is two proxies, so the hop count is configurable.
// 1 keeps the previous behaviour; see TRUST_PROXY_HOPS in .env.example
const trustProxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS, 10)
app.set('trust proxy', Number.isInteger(trustProxyHops) && trustProxyHops >= 0 ? trustProxyHops : 1)
app.use(helmet())
// the Vite dev servers are only allowed outside production
const allowedOrigins = [process.env.CLIENT_URL]
if (process.env.NODE_ENV !== 'production') allowedOrigins.push('http://localhost:5173', 'http://localhost:5174')
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}))
app.use(exp.json({ limit: '1mb' }))
app.use(cookieParser())
app.use(sanitizeBody)

// health check for deployment platforms; also says whether the background
// jobs started and which build is running
app.get('/health', (req, res) => {
  //send res
  res.status(200).json({
    message: 'ok',
    payload: {
      uptime: process.uptime(),
      db: mongoose.connection.readyState === 1 ? 'up' : 'down',
      cron: { ...cronStatus },
      version: process.env.RENDER_GIT_COMMIT?.slice(0, 7) || process.env.APP_VERSION || 'dev',
    },
  })
})

app.use('/auth', commonApp)
app.use('/meta-api', metaApp)
app.use('/ticket-api', ticketApp)
app.use('/admin-api', adminApp)
app.use('/notification-api', notificationApp)
app.use('/asset-api', assetApp)
app.use('/vendor-api', vendorApp)
app.use('/kb-api', kbApp)
app.use('/ai-api', aiApp)
app.use('/worklog-api', workLogApp)
app.use('/tech-api', techApp)
app.use('/manager-api', managerApp)
app.use('/report-api', reportApp)

// invalid path handler
app.use((req, res) => {
  //send res
  res.status(404).json({ message: `Path ${req.url} is invalid` })
})

// global error handler
app.use(errorHandler)
