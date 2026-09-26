import { config } from 'dotenv'
import bcrypt from 'bcryptjs'
import { UserModel } from '../models/UserModel.js'
import { DepartmentModel } from '../models/DepartmentModel.js'
import { CategoryModel } from '../models/CategoryModel.js'
import { SLAPolicyModel } from '../models/SLAPolicyModel.js'

config()

// idempotent: only seeds when the User collection is empty
export const seedIfEmpty = async () => {
  const userCount = await UserModel.countDocuments()
  if (userCount > 0) {
    console.log('seed skipped: users already exist')
    return
  }
  console.log('seeding demo data...')

  const departments = await DepartmentModel.insertMany([
    { name: 'Human Resources', code: 'HR', kind: 'BUSINESS' },
    { name: 'Engineering', code: 'ENG', kind: 'BUSINESS' },
    { name: 'Service Desk', code: 'SVD', kind: 'IT_SUPPORT' },
    { name: 'Infrastructure', code: 'INF', kind: 'IT_SUPPORT' },
  ])
  const [hr, eng, serviceDesk, infra] = departments

  const priorities = await SLAPolicyModel.insertMany([
    { priority: 'LOW', label: 'Low', level: 1, color: '#6b7280', responseTimeHours: 24, resolutionTimeHours: 72, businessHoursOnly: true },
    { priority: 'MEDIUM', label: 'Medium', level: 2, color: '#3b82f6', responseTimeHours: 8, resolutionTimeHours: 24, businessHoursOnly: true },
    { priority: 'HIGH', label: 'High', level: 3, color: '#f59e0b', responseTimeHours: 4, resolutionTimeHours: 8, businessHoursOnly: true },
    { priority: 'CRITICAL', label: 'Critical', level: 4, color: '#ef4444', responseTimeHours: 1, resolutionTimeHours: 4, businessHoursOnly: true },
    // demo/test priority: plain wall-clock, minutes not hours, so you can
    // watch a ticket go on-track -> at-risk -> breached in real time
    // without waiting for business hours. Not shown as a normal option —
    // pick it explicitly in a ticket's priority dropdown to demo the SLA checker.
    { priority: 'TEST', label: 'Test (fast demo)', level: 0, color: '#a855f7', responseTimeHours: 0.02, resolutionTimeHours: 0.05, businessHoursOnly: false },
  ])

  const categories = await CategoryModel.insertMany([
    { name: 'Hardware', department: serviceDesk._id, ticketType: 'INCIDENT', defaultPriority: 'MEDIUM' },
    { name: 'Software', department: serviceDesk._id, ticketType: 'INCIDENT', defaultPriority: 'MEDIUM' },
    { name: 'Network', department: infra._id, ticketType: 'INCIDENT', defaultPriority: 'HIGH' },
    { name: 'New Hardware Request', department: serviceDesk._id, ticketType: 'SERVICE_REQUEST', defaultPriority: 'LOW', requiresApproval: true },
  ])

  const hash = (pw) => bcrypt.hashSync(pw, 10)
  const password = hash('Passw0rd!')

  const admin = await UserModel.create({ firstName: 'Ava', lastName: 'Admin', email: 'admin@sdp.test', password, role: 'ADMIN' })
  const manager = await UserModel.create({ firstName: 'Mia', lastName: 'Manager', email: 'manager@sdp.test', password, role: 'MANAGER', department: serviceDesk._id })
  const tech = await UserModel.create({ firstName: 'Theo', lastName: 'Tech', email: 'tech@sdp.test', password, role: 'TECHNICIAN', department: serviceDesk._id })
  const employee = await UserModel.create({ firstName: 'Eli', lastName: 'Employee', email: 'employee@sdp.test', password, role: 'EMPLOYEE', department: eng._id })
  const assetMgr = await UserModel.create({ firstName: 'Amy', lastName: 'Assets', email: 'assets@sdp.test', password, role: 'ASSET_MANAGER' })

  await DepartmentModel.findByIdAndUpdate(serviceDesk._id, { manager: manager._id })

  console.log('seed complete. demo logins (password: Passw0rd!):')
  console.log('  admin@sdp.test / manager@sdp.test / tech@sdp.test / employee@sdp.test / assets@sdp.test')
}

// allow `npm run seed` to run this directly
if (process.argv[1] && process.argv[1].endsWith('seedData.js')) {
  const { connect } = await import('mongoose')
  await connect(process.env.MONGO_URI)
  await seedIfEmpty()
  process.exit(0)
}
