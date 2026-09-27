import { config } from 'dotenv'
import bcrypt from 'bcryptjs'
import { UserModel } from '../models/UserModel.js'
import { DepartmentModel } from '../models/DepartmentModel.js'
import { CategoryModel } from '../models/CategoryModel.js'
import { SLAPolicyModel } from '../models/SLAPolicyModel.js'
import { VendorModel } from '../models/VendorModel.js'
import { AssetModel } from '../models/AssetModel.js'
import { generateSequentialId } from './generateSequentialId.js'

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

  const vendors = await VendorModel.insertMany([
    { name: 'Dell Technologies', contactPerson: 'Raj Mehta', email: 'raj@dellsupport.example', phone: '+91-98765-00001', servicesProvided: 'Laptop & desktop hardware' },
    { name: 'Microsoft', contactPerson: 'Priya Nair', email: 'priya@msftlicensing.example', phone: '+91-98765-00002', servicesProvided: 'Software licensing' },
    { name: 'Netgear Solutions', contactPerson: 'Sam Iyer', email: 'sam@netgearsol.example', phone: '+91-98765-00003', servicesProvided: 'Networking equipment' },
  ])
  const [dell, microsoft, netgear] = vendors

  const daysFromNow = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000)
  const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000)

  const laptopPublicId = await generateSequentialId(AssetModel, 'AST')
  await AssetModel.create({
    publicId: laptopPublicId, name: 'Dell Latitude 5440', type: 'HARDWARE', assetClass: 'Laptop',
    serialNumber: 'DL5440-0001', vendor: dell._id, purchaseDate: daysAgo(400), purchaseCost: 78000,
    warrantyExpiry: daysFromNow(20), // deliberately inside the 30-day warranty window, to demo that report
    status: 'ASSIGNED', assignedTo: employee._id, department: eng._id,
    lifecycleHistory: [
      { toStatus: 'PROCURED', by: admin._id, note: 'seed data' },
      { fromStatus: 'PROCURED', toStatus: 'IN_STOCK', by: assetMgr._id },
      { fromStatus: 'IN_STOCK', toStatus: 'ASSIGNED', by: assetMgr._id, note: 'assigned to Eli Employee' },
    ],
  })

  const monitorPublicId = await generateSequentialId(AssetModel, 'AST')
  await AssetModel.create({
    publicId: monitorPublicId, name: 'Dell 24" Monitor', type: 'HARDWARE', assetClass: 'Monitor',
    serialNumber: 'DM24-0007', vendor: dell._id, purchaseDate: daysAgo(200), purchaseCost: 12000,
    warrantyExpiry: daysFromNow(365), status: 'IN_STOCK', department: eng._id,
    lifecycleHistory: [{ toStatus: 'PROCURED', by: admin._id }, { fromStatus: 'PROCURED', toStatus: 'IN_STOCK', by: assetMgr._id }],
  })

  const licensePublicId = await generateSequentialId(AssetModel, 'AST')
  await AssetModel.create({
    publicId: licensePublicId, name: 'Microsoft 365 E3', type: 'SOFTWARE', assetClass: 'License',
    licenseKey: 'M365-XXXX-YYYY-0001', vendor: microsoft._id, purchaseDate: daysAgo(100), purchaseCost: 15000,
    warrantyExpiry: daysFromNow(5), // also inside the warranty window
    status: 'ASSIGNED', assignedTo: tech._id, department: serviceDesk._id,
    lifecycleHistory: [{ toStatus: 'PROCURED', by: admin._id }, { fromStatus: 'PROCURED', toStatus: 'IN_STOCK', by: assetMgr._id }, { fromStatus: 'IN_STOCK', toStatus: 'ASSIGNED', by: assetMgr._id }],
  })

  const routerPublicId = await generateSequentialId(AssetModel, 'AST')
  await AssetModel.create({
    publicId: routerPublicId, name: 'Netgear Rack Switch', type: 'HARDWARE', assetClass: 'Networking',
    serialNumber: 'NG-SW-0003', vendor: netgear._id, purchaseDate: daysAgo(600), purchaseCost: 45000,
    warrantyExpiry: daysAgo(10), // already expired, to demo an overdue entry
    status: 'IN_REPAIR', department: infra._id,
    lifecycleHistory: [{ toStatus: 'PROCURED', by: admin._id }, { fromStatus: 'PROCURED', toStatus: 'IN_STOCK', by: assetMgr._id }, { fromStatus: 'IN_STOCK', toStatus: 'IN_REPAIR', by: tech._id, note: 'intermittent port failure' }],
  })

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
