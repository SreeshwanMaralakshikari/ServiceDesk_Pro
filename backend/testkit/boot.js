// Starts a throwaway real MongoDB (mongodb-memory-server), loads the real
// app.js against it, and seeds the fixtures every integration test shares.
// Each test file runs in its own process, so each gets its own database.
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import request from 'supertest'
import { MongoMemoryServer } from 'mongodb-memory-server'

export const PASSWORD = 'Passw0rd!'

export const bootApp = async (envOverrides = {}) => {
  // set before app.js is imported: dotenv never overrides a variable that already exists
  Object.assign(process.env, {
    NODE_ENV: 'test',
    JWT_SECRET: 'integration-test-secret',
    CLIENT_URL: 'http://localhost:5173',
    MONGO_URI: 'mongodb://unused.invalid/ignored',
    GROQ_API_KEY: '', // never call the real AI from a test
    ...envOverrides,
  })

  const mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri(), { dbName: 'sdp_integration' })

  const { app } = await import('../app.js')
  // build indexes up front so $text searches work in the first test
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()))

  const fx = await seedFixtures()
  const stop = async () => {
    await mongoose.disconnect()
    await mongod.stop()
  }
  return { app, fx, stop }
}

// a logged-in supertest agent (real POST /auth/login, real cookie)
export const loginAs = async (app, email) => {
  const agent = request.agent(app)
  const res = await agent.post('/auth/login').send({ email, password: PASSWORD })
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`)
  return agent
}

const seedFixtures = async () => {
  const { DepartmentModel } = await import('../models/DepartmentModel.js')
  const { SLAPolicyModel } = await import('../models/SLAPolicyModel.js')
  const { CategoryModel } = await import('../models/CategoryModel.js')
  const { UserModel } = await import('../models/UserModel.js')

  const [hr, svc, infra] = await DepartmentModel.insertMany([
    { name: 'Human Resources', code: 'HR', kind: 'BUSINESS' },
    { name: 'Service Desk', code: 'SVD', kind: 'IT_SUPPORT' },
    { name: 'Infrastructure', code: 'INF', kind: 'IT_SUPPORT' },
  ])
  await SLAPolicyModel.insertMany([
    { priority: 'LOW', label: 'Low', level: 1, responseTimeHours: 24, resolutionTimeHours: 72, businessHoursOnly: true },
    { priority: 'MEDIUM', label: 'Medium', level: 2, responseTimeHours: 8, resolutionTimeHours: 24, businessHoursOnly: true },
    { priority: 'HIGH', label: 'High', level: 3, responseTimeHours: 4, resolutionTimeHours: 8, businessHoursOnly: true },
    { priority: 'TEST', label: 'Test', level: 0, responseTimeHours: 0.02, resolutionTimeHours: 0.05, businessHoursOnly: false },
    { priority: 'RETIRED', label: 'Retired', level: 5, responseTimeHours: 1, resolutionTimeHours: 2, businessHoursOnly: true, isActive: false },
  ])
  const [hardware, network, newHardware] = await CategoryModel.insertMany([
    { name: 'Hardware', department: svc._id, ticketType: 'INCIDENT', defaultPriority: 'MEDIUM' },
    { name: 'Network', department: infra._id, ticketType: 'INCIDENT', defaultPriority: 'HIGH' },
    { name: 'New Hardware Request', department: svc._id, ticketType: 'SERVICE_REQUEST', defaultPriority: 'LOW', requiresApproval: true },
  ])

  const password = bcrypt.hashSync(PASSWORD, 4)
  const mk = (firstName, email, role, department) => UserModel.create({ firstName, email, password, role, department })
  const users = {
    admin: await mk('Ava', 'admin@t.test', 'ADMIN'),
    mgrSvc: await mk('Mia', 'mgr.svc@t.test', 'MANAGER', svc._id),
    techSvc: await mk('Theo', 'tech.svc@t.test', 'TECHNICIAN', svc._id),
    techSvc2: await mk('Tina', 'tech.svc2@t.test', 'TECHNICIAN', svc._id),
    techInfra: await mk('Ian', 'tech.infra@t.test', 'TECHNICIAN', infra._id),
    emp: await mk('Eli', 'emp@t.test', 'EMPLOYEE', hr._id),
    emp2: await mk('Eve', 'emp2@t.test', 'EMPLOYEE', hr._id),
    assetMgr: await mk('Amy', 'assets@t.test', 'ASSET_MANAGER'),
    // legacy rows that would be rejected by the API today: staff without a team
    techNoDept: await mk('Nora', 'tech.nodept@t.test', 'TECHNICIAN'),
    mgrNoDept: await mk('Nick', 'mgr.nodept@t.test', 'MANAGER'),
  }
  return { departments: { hr, svc, infra }, categories: { hardware, network, newHardware }, users }
}
