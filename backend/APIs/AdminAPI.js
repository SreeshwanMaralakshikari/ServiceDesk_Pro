import exp from 'express'
import { UserModel } from '../models/UserModel.js'
import { DepartmentModel } from '../models/DepartmentModel.js'
import { CategoryModel } from '../models/CategoryModel.js'
import { SLAPolicyModel } from '../models/SLAPolicyModel.js'
import { TicketModel } from '../models/TicketModel.js'
import { getOrgSettings } from '../models/OrgSettingsModel.js'
import { verifyToken } from '../middlewares/verifyToken.js'

export const adminApp = exp.Router()
adminApp.use(verifyToken('ADMIN'))

// --- users ---
adminApp.get('/users', async (req, res, next) => {
  try {
    const users = await UserModel.find().populate('department', 'name kind').select('-password')
    //send res
    res.status(200).json({ message: 'users fetched', payload: users })
  } catch (err) { next(err) }
})

adminApp.post('/users', async (req, res, next) => {
  try {
    const { firstName, lastName, email, password, role, department } = req.body
    if (!firstName || !email || !password || !role) {
      //send res
      return res.status(400).json({ message: 'firstName, email, password and role are required' })
    }
    const bcrypt = (await import('bcryptjs')).default
    const hashed = await bcrypt.hash(password, 10)
    const user = await UserModel.create({ firstName, lastName, email, password: hashed, role, department })
    const safe = user.toObject(); delete safe.password
    //send res
    res.status(201).json({ message: 'user created', payload: safe })
  } catch (err) { next(err) }
})

adminApp.patch('/users/:userId/status', async (req, res, next) => {
  try {
    if (req.params.userId === req.user.id) {
      //send res
      return res.status(400).json({ message: 'an admin cannot deactivate themselves' })
    }
    const { isActive } = req.body
    const user = await UserModel.findByIdAndUpdate(req.params.userId, { isActive }, { new: true, runValidators: true }).select('-password')
    //send res
    res.status(200).json({ message: 'user status updated', payload: user })
  } catch (err) { next(err) }
})

// --- departments ---
adminApp.get('/departments', async (req, res, next) => {
  try {
    const departments = await DepartmentModel.find().populate('manager', 'firstName lastName email')
    //send res
    res.status(200).json({ message: 'departments fetched', payload: departments })
  } catch (err) { next(err) }
})

adminApp.post('/departments', async (req, res, next) => {
  try {
    const { name, code, kind, manager } = req.body
    const department = await DepartmentModel.create({ name, code, kind, manager })
    //send res
    res.status(201).json({ message: 'department created', payload: department })
  } catch (err) { next(err) }
})

// --- categories ---
adminApp.post('/categories', async (req, res, next) => {
  try {
    const { name, description, department, ticketType, defaultPriority, requiresApproval } = req.body
    const category = await CategoryModel.create({ name, description, department, ticketType, defaultPriority, requiresApproval })
    //send res
    res.status(201).json({ message: 'category created', payload: category })
  } catch (err) { next(err) }
})

adminApp.patch('/categories/:categoryId', async (req, res, next) => {
  try {
    const { name, description, defaultPriority, requiresApproval, isActive } = req.body
    const category = await CategoryModel.findByIdAndUpdate(
      req.params.categoryId,
      { name, description, defaultPriority, requiresApproval, isActive },
      { new: true, runValidators: true }
    )
    //send res
    res.status(200).json({ message: 'category updated', payload: category })
  } catch (err) { next(err) }
})

// --- SLA policies (also the priority master) ---
adminApp.post('/sla-policies', async (req, res, next) => {
  try {
    const { priority, label, level, color, responseTimeHours, resolutionTimeHours, businessHoursOnly } = req.body
    const policy = await SLAPolicyModel.create({ priority, label, level, color, responseTimeHours, resolutionTimeHours, businessHoursOnly })
    //send res
    res.status(201).json({ message: 'SLA policy created', payload: policy })
  } catch (err) { next(err) }
})

adminApp.patch('/sla-policies/:policyId', async (req, res, next) => {
  try {
    const { label, color, responseTimeHours, resolutionTimeHours, businessHoursOnly, isActive } = req.body
    if (isActive === false) {
      const target = await SLAPolicyModel.findById(req.params.policyId)
      const inUse = await TicketModel.exists({
        isDeleted: false,
        priority: target?.priority,
        status: { $nin: ['CLOSED', 'CANCELLED', 'REJECTED'] },
      })
      if (inUse) {
        //send res
        return res.status(409).json({ message: 'cannot deactivate a priority still used by open tickets' })
      }
    }
    const policy = await SLAPolicyModel.findByIdAndUpdate(
      req.params.policyId,
      { label, color, responseTimeHours, resolutionTimeHours, businessHoursOnly, isActive },
      { new: true, runValidators: true }
    )
    //send res
    res.status(200).json({ message: 'SLA policy updated', payload: policy })
  } catch (err) { next(err) }
})

// --- org settings (business hours) ---
adminApp.get('/org-settings', async (req, res, next) => {
  try {
    const settings = await getOrgSettings()
    //send res
    res.status(200).json({ message: 'org settings fetched', payload: settings })
  } catch (err) { next(err) }
})

adminApp.put('/org-settings', async (req, res, next) => {
  try {
    const { orgName, businessHours } = req.body
    const settings = await getOrgSettings()
    if (orgName !== undefined) settings.orgName = orgName
    if (businessHours) {
      if (businessHours.days !== undefined) settings.businessHours.days = businessHours.days
      if (businessHours.start !== undefined) settings.businessHours.start = businessHours.start
      if (businessHours.end !== undefined) settings.businessHours.end = businessHours.end
      // timezone is fixed to Asia/Kolkata (+05:30) — see utils/businessHours.js
    }
    await settings.save()
    //send res
    res.status(200).json({ message: 'org settings updated', payload: settings })
  } catch (err) { next(err) }
})

// --- dashboard ---
adminApp.get('/dashboard', async (req, res, next) => {
  try {
    const [totalTickets, openTickets, byStatus, byPriority, userCount] = await Promise.all([
      TicketModel.countDocuments({ isDeleted: false }),
      TicketModel.countDocuments({ isDeleted: false, status: { $nin: ['CLOSED', 'CANCELLED'] } }),
      TicketModel.aggregate([{ $match: { isDeleted: false } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      TicketModel.aggregate([{ $match: { isDeleted: false } }, { $group: { _id: '$priority', count: { $sum: 1 } } }]),
      UserModel.countDocuments({ isActive: true }),
    ])
    //send res
    res.status(200).json({ message: 'dashboard fetched', payload: { totalTickets, openTickets, byStatus, byPriority, userCount } })
  } catch (err) { next(err) }
})
