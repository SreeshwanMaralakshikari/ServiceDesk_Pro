import exp from 'express'
import bcrypt from 'bcryptjs'
import { UserModel } from '../models/UserModel.js'
import { DepartmentModel } from '../models/DepartmentModel.js'
import { CategoryModel } from '../models/CategoryModel.js'
import { SLAPolicyModel } from '../models/SLAPolicyModel.js'
import { TicketModel } from '../models/TicketModel.js'
import { AuditLogModel } from '../models/AuditLogModel.js'
import { getOrgSettings } from '../models/OrgSettingsModel.js'
import { verifyToken } from '../middlewares/verifyToken.js'
import { validateRoleDepartment, REQUIRED_KIND } from '../utils/validateRoleDepartment.js'
import { logAudit } from '../utils/logAudit.js'
import { getPagination, toPage } from '../utils/pagination.js'
import { asText, asBool, escapeRegex, isObjectIdString } from '../utils/queryParams.js'
import { passwordProblem } from '../utils/passwordRule.js'
import { FINISHED_STATUSES, TECH_ACTIVE_STATUSES } from '../utils/ticketStatuses.js'
import {
  normalizeSkills, cleanText, validateBusinessHours, validateSlaHours, validateColor,
  normalizePriorityCode, normalizeDepartmentCode,
} from '../utils/adminRules.js'

export const adminApp = exp.Router()
adminApp.use(verifyToken('ADMIN'))

const ROLES = ['ADMIN', 'MANAGER', 'TECHNICIAN', 'EMPLOYEE', 'ASSET_MANAGER']
const BOOLEAN_FIELDS_ERROR = (name) => `${name} must be true or false`

// plain JSON-friendly copy of some fields, for the audit "before" values
const toPlain = (value) => {
  if (value === undefined || value === null) return null
  if (Array.isArray(value)) return value.map(toPlain)
  if (value._bsontype === 'ObjectId') return String(value)
  return value
}
const snapshot = (doc, keys) => Object.fromEntries(keys.map((key) => [key, toPlain(doc[key])]))

// case-insensitive "same name" lookup for duplicate checks
const sameText = (text) => new RegExp(`^${escapeRegex(text)}$`, 'i')

// tickets a technician is still working on
const countTechnicianLoad = (userId) => TicketModel.countDocuments({ isDeleted: false, assignedTo: userId, status: { $in: TECH_ACTIVE_STATUSES } })
// tickets a requester is still waiting on
const countRequesterOpen = (userId) => TicketModel.countDocuments({ isDeleted: false, requester: userId, status: { $nin: FINISHED_STATUSES } })
// is there any other active admin left?
const hasOtherActiveAdmin = async (userId) => Boolean(await UserModel.exists({ role: 'ADMIN', isActive: true, _id: { $ne: userId } }))

// --- users ---
adminApp.get('/users', async (req, res, next) => {
  try {
    const paging = getPagination(req.query)
    const filter = {}
    const role = asText(req.query.role)
    if (role) {
      if (!ROLES.includes(role)) {
        //send res
        return res.status(400).json({ message: 'unknown role' })
      }
      filter.role = role
    }
    const department = asText(req.query.department)
    if (department) {
      if (!isObjectIdString(department)) {
        //send res
        return res.status(400).json({ message: 'department must be an id' })
      }
      filter.department = department
    }
    const isActive = asBool(req.query.isActive)
    if (isActive !== undefined) filter.isActive = isActive
    const q = asText(req.query.q)
    if (q) {
      const pattern = new RegExp(escapeRegex(q.slice(0, 50)), 'i')
      filter.$or = [{ firstName: pattern }, { lastName: pattern }, { email: pattern }]
    }

    const [users, total] = await Promise.all([
      UserModel.find(filter).populate('department', 'name kind').select('-password').sort({ firstName: 1, _id: 1 }).skip(paging.skip).limit(paging.limit),
      UserModel.countDocuments(filter),
    ])

    // technicians also carry their current load, so an admin sees who is busy
    const technicianIds = users.filter((u) => u.role === 'TECHNICIAN').map((u) => u._id)
    const loads = technicianIds.length
      ? await TicketModel.aggregate([
        { $match: { isDeleted: false, assignedTo: { $in: technicianIds }, status: { $in: TECH_ACTIVE_STATUSES } } },
        { $group: { _id: '$assignedTo', count: { $sum: 1 } } },
      ])
      : []
    const loadOf = new Map(loads.map((l) => [String(l._id), l.count]))
    const items = users.map((u) => {
      const row = u.toObject()
      if (u.role === 'TECHNICIAN') row.openTickets = loadOf.get(String(u._id)) ?? 0
      return row
    })
    //send res
    res.status(200).json({ message: 'users fetched', payload: toPage(items, total, paging) })
  } catch (err) { next(err) }
})

adminApp.post('/users', async (req, res, next) => {
  try {
    const { firstName, lastName, email, password, role, department, skills } = req.body ?? {}
    if (!firstName || !email || !password || !role) {
      //send res
      return res.status(400).json({ message: 'firstName, email, password and role are required' })
    }
    if (![firstName, email, password, role].every((v) => typeof v === 'string') || (lastName !== undefined && typeof lastName !== 'string')) {
      //send res
      return res.status(400).json({ message: 'firstName, lastName, email, password and role must be text' })
    }
    if (!ROLES.includes(role)) {
      //send res
      return res.status(400).json({ message: 'unknown role' })
    }
    const passwordError = passwordProblem(password)
    if (passwordError) {
      //send res
      return res.status(400).json({ message: passwordError })
    }
    // EMPLOYEE -> BUSINESS department, TECHNICIAN/MANAGER -> IT_SUPPORT team
    const deptError = await validateRoleDepartment(role, department)
    if (deptError) {
      //send res
      return res.status(400).json({ message: deptError })
    }
    let cleanSkills = []
    if (skills !== undefined) {
      if (role !== 'TECHNICIAN') {
        //send res
        return res.status(400).json({ message: 'skills only apply to technicians' })
      }
      const parsed = normalizeSkills(skills)
      if (parsed.error) {
        //send res
        return res.status(400).json({ message: parsed.error })
      }
      cleanSkills = parsed.skills
    }
    if (await UserModel.exists({ email: email.trim().toLowerCase() })) {
      //send res
      return res.status(409).json({ message: 'a user with this email already exists' })
    }
    const hashed = await bcrypt.hash(password, 10)
    const user = await UserModel.create({ firstName, lastName, email, password: hashed, role, department, skills: cleanSkills })
    const safe = user.toObject(); delete safe.password
    await logAudit({ req, action: 'USER_CREATED', entityType: 'USER', entity: user, entityRef: user.email, after: { role, department: department ?? null, skills: cleanSkills } })
    //send res
    res.status(201).json({ message: 'user created', payload: safe })
  } catch (err) { next(err) }
})

// edit name, role, department or skills. The role/department pair is
// re-validated, and a person with live work cannot be moved out from under it
adminApp.patch('/users/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params
    if (!isObjectIdString(userId)) {
      //send res
      return res.status(400).json({ message: 'invalid user id' })
    }
    const body = req.body ?? {}
    const user = await UserModel.findById(userId).select('-password')
    if (!user) {
      //send res
      return res.status(404).json({ message: 'user not found' })
    }

    const set = {}
    for (const [key, label, options] of [['firstName', 'firstName', { min: 1, max: 50 }], ['lastName', 'lastName', { min: 0, max: 50, required: false }]]) {
      if (body[key] === undefined) continue
      const parsed = cleanText(body[key], label, { required: true, ...options })
      if (parsed.error) {
        //send res
        return res.status(400).json({ message: parsed.error })
      }
      if (parsed.value !== undefined) set[key] = parsed.value
    }

    const newRole = body.role === undefined ? user.role : body.role
    if (typeof newRole !== 'string' || !ROLES.includes(newRole)) {
      //send res
      return res.status(400).json({ message: 'unknown role' })
    }
    const departmentGiven = Object.prototype.hasOwnProperty.call(body, 'department')
    if (departmentGiven && body.department !== null && typeof body.department !== 'string') {
      //send res
      return res.status(400).json({ message: 'department must be an id or null' })
    }
    const roleChanged = newRole !== user.role
    // a role that has no department (admin, asset manager) drops the old one
    const keepsDepartment = departmentGiven || !roleChanged || Boolean(REQUIRED_KIND[newRole])
    const newDepartment = departmentGiven ? (body.department ?? undefined) : (keepsDepartment ? user.department?.toString() : undefined)
    const departmentChanged = (newDepartment ?? null) !== (user.department?.toString() ?? null)

    if (roleChanged && userId === req.user.id) {
      //send res
      return res.status(400).json({ message: 'you cannot change your own role' })
    }

    if (roleChanged || departmentChanged) {
      // switching role also needs a department that suits the new role
      const deptError = await validateRoleDepartment(newRole, newDepartment)
      if (deptError) {
        //send res
        return res.status(400).json({ message: deptError })
      }
      if (user.role === 'TECHNICIAN') {
        const load = await countTechnicianLoad(user._id)
        if (load > 0) {
          //send res
          return res.status(409).json({ message: `${load} open ticket(s) are assigned to this technician, reassign them before moving or changing them` })
        }
      }
      if (roleChanged && user.role === 'EMPLOYEE' && await countRequesterOpen(user._id) > 0) {
        //send res
        return res.status(409).json({ message: 'this employee still has open tickets, wait until they are closed before changing the role' })
      }
      if (roleChanged && user.role === 'ADMIN' && user.isActive && !(await hasOtherActiveAdmin(user._id))) {
        //send res
        return res.status(409).json({ message: 'this is the last active admin' })
      }
      if (roleChanged) set.role = newRole
      if (departmentChanged) set.department = newDepartment ?? null
    }

    // skills belong to technicians only; leaving the role clears them
    if (body.skills !== undefined) {
      if (newRole !== 'TECHNICIAN') {
        //send res
        return res.status(400).json({ message: 'skills only apply to technicians' })
      }
      const parsed = normalizeSkills(body.skills)
      if (parsed.error) {
        //send res
        return res.status(400).json({ message: parsed.error })
      }
      set.skills = parsed.skills
    } else if (roleChanged && newRole !== 'TECHNICIAN') {
      set.skills = []
    }

    if (!Object.keys(set).length) {
      //send res
      return res.status(400).json({ message: 'nothing to update' })
    }

    const before = snapshot(user, Object.keys(set))
    await UserModel.updateOne({ _id: user._id }, { $set: set }, { runValidators: true })
    const updated = await UserModel.findById(user._id).populate('department', 'name kind').select('-password')

    // a manager who moved on no longer manages the old team
    if (user.role === 'MANAGER' && (roleChanged || departmentChanged)) {
      await DepartmentModel.updateMany({ manager: user._id }, { $unset: { manager: '' } })
    }
    await logAudit({ req, action: roleChanged ? 'USER_ROLE_CHANGED' : 'USER_UPDATED', entityType: 'USER', entity: user, entityRef: user.email, before, after: set })
    //send res
    res.status(200).json({ message: 'user updated', payload: updated })
  } catch (err) { next(err) }
})

adminApp.patch('/users/:userId/status', async (req, res, next) => {
  try {
    const { userId } = req.params
    if (!isObjectIdString(userId)) {
      //send res
      return res.status(400).json({ message: 'invalid user id' })
    }
    if (userId === req.user.id) {
      //send res
      return res.status(400).json({ message: 'an admin cannot deactivate themselves' })
    }
    const { isActive } = req.body ?? {}
    if (typeof isActive !== 'boolean') {
      //send res
      return res.status(400).json({ message: 'isActive must be true or false' })
    }
    const target = await UserModel.findById(userId).select('role department isActive')
    if (!target) {
      //send res
      return res.status(404).json({ message: 'user not found' })
    }
    if (isActive === false) {
      if (target.role === 'ADMIN' && target.isActive && !(await hasOtherActiveAdmin(target._id))) {
        //send res
        return res.status(409).json({ message: 'this is the last active admin' })
      }
      if (target.role === 'TECHNICIAN') {
        const load = await countTechnicianLoad(target._id)
        if (load > 0) {
          //send res
          return res.status(409).json({ message: `${load} open ticket(s) are assigned to this technician, reassign them before deactivating` })
        }
      }
    } else if (target.department) {
      // a person cannot come back into a team that has been switched off
      const department = await DepartmentModel.findById(target.department).select('isActive')
      if (!department?.isActive) {
        //send res
        return res.status(409).json({ message: "this user's department is inactive, reactivate it or move the user first" })
      }
    }
    await UserModel.updateOne({ _id: target._id }, { isActive }, { runValidators: true })
    const user = await UserModel.findById(target._id).select('-password')
    if (isActive === false && target.role === 'MANAGER') {
      await DepartmentModel.updateMany({ manager: target._id }, { $unset: { manager: '' } })
    }
    await logAudit({ req, action: 'USER_STATUS_CHANGED', entityType: 'USER', entity: user, entityRef: user.email, before: { isActive: target.isActive }, after: { isActive } })
    //send res
    res.status(200).json({ message: 'user status updated', payload: user })
  } catch (err) { next(err) }
})

// --- audit trail (read-only; entries are immutable) ---
// filters: entityType, entityRef (e.g. TKT-2026-00004), action, actor
adminApp.get('/audit-logs', async (req, res, next) => {
  try {
    const paging = getPagination(req.query)
    const filter = {}
    for (const key of ['entityType', 'entityRef', 'action', 'actor']) {
      const value = asText(req.query[key])
      if (value) filter[key] = value
    }
    if (filter.actor && !isObjectIdString(filter.actor)) {
      //send res
      return res.status(400).json({ message: 'actor must be a user id' })
    }
    const [items, total] = await Promise.all([
      AuditLogModel.find(filter).populate('actor', 'firstName lastName email role').sort({ createdAt: -1, _id: -1 }).skip(paging.skip).limit(paging.limit),
      AuditLogModel.countDocuments(filter),
    ])
    //send res
    res.status(200).json({ message: 'audit logs fetched', payload: toPage(items, total, paging) })
  } catch (err) { next(err) }
})

// --- departments ---
adminApp.get('/departments', async (req, res, next) => {
  try {
    const paging = getPagination(req.query)
    const filter = {}
    const kind = asText(req.query.kind)
    if (kind) {
      if (!['BUSINESS', 'IT_SUPPORT'].includes(kind)) {
        //send res
        return res.status(400).json({ message: 'kind must be BUSINESS or IT_SUPPORT' })
      }
      filter.kind = kind
    }
    const isActive = asBool(req.query.isActive)
    if (isActive !== undefined) filter.isActive = isActive
    const q = asText(req.query.q)
    if (q) filter.name = new RegExp(escapeRegex(q.slice(0, 50)), 'i')

    const [departments, total] = await Promise.all([
      DepartmentModel.find(filter).populate('manager', 'firstName lastName email').sort({ name: 1, _id: 1 }).skip(paging.skip).limit(paging.limit),
      DepartmentModel.countDocuments(filter),
    ])
    // active members and categories, so the admin sees what a deactivation would hit
    const ids = departments.map((d) => d._id)
    const [userCounts, categoryCounts] = ids.length
      ? await Promise.all([
        UserModel.aggregate([{ $match: { department: { $in: ids }, isActive: true } }, { $group: { _id: '$department', count: { $sum: 1 } } }]),
        CategoryModel.aggregate([{ $match: { department: { $in: ids }, isActive: true } }, { $group: { _id: '$department', count: { $sum: 1 } } }]),
      ])
      : [[], []]
    const usersOf = new Map(userCounts.map((r) => [String(r._id), r.count]))
    const categoriesOf = new Map(categoryCounts.map((r) => [String(r._id), r.count]))
    const items = departments.map((d) => ({ ...d.toObject(), activeUsers: usersOf.get(String(d._id)) ?? 0, activeCategories: categoriesOf.get(String(d._id)) ?? 0 }))
    //send res
    res.status(200).json({ message: 'departments fetched', payload: toPage(items, total, paging) })
  } catch (err) { next(err) }
})

adminApp.post('/departments', async (req, res, next) => {
  try {
    const { name, code, kind, manager } = req.body ?? {}
    if (manager !== undefined) {
      //send res
      return res.status(400).json({ message: 'set the manager after the team has a manager user (edit the department)' })
    }
    const cleanName = cleanText(name, 'name', { min: 2, max: 60 })
    if (cleanName.error) {
      //send res
      return res.status(400).json({ message: cleanName.error })
    }
    const cleanCode = normalizeDepartmentCode(code)
    if (cleanCode.error) {
      //send res
      return res.status(400).json({ message: cleanCode.error })
    }
    if (!['BUSINESS', 'IT_SUPPORT'].includes(kind)) {
      //send res
      return res.status(400).json({ message: 'kind must be BUSINESS or IT_SUPPORT' })
    }
    if (await DepartmentModel.exists({ name: sameText(cleanName.value) })) {
      //send res
      return res.status(409).json({ message: 'a department with this name already exists' })
    }
    if (await DepartmentModel.exists({ code: cleanCode.value })) {
      //send res
      return res.status(409).json({ message: 'a department with this code already exists' })
    }
    const department = await DepartmentModel.create({ name: cleanName.value, code: cleanCode.value, kind })
    await logAudit({ req, action: 'DEPARTMENT_CREATED', entityType: 'DEPARTMENT', entity: department, entityRef: department.code, after: { name: department.name, kind } })
    //send res
    res.status(201).json({ message: 'department created', payload: department })
  } catch (err) { next(err) }
})

adminApp.patch('/departments/:departmentId', async (req, res, next) => {
  try {
    const { departmentId } = req.params
    if (!isObjectIdString(departmentId)) {
      //send res
      return res.status(400).json({ message: 'invalid department id' })
    }
    const body = req.body ?? {}
    const department = await DepartmentModel.findById(departmentId)
    if (!department) {
      //send res
      return res.status(404).json({ message: 'department not found' })
    }
    // the kind decides which roles may belong here, so it never changes
    if (body.kind !== undefined && body.kind !== department.kind) {
      //send res
      return res.status(400).json({ message: 'the kind of a department cannot be changed' })
    }

    const set = {}
    const unset = {}
    if (body.name !== undefined) {
      const parsed = cleanText(body.name, 'name', { min: 2, max: 60 })
      if (parsed.error) {
        //send res
        return res.status(400).json({ message: parsed.error })
      }
      if (parsed.value.toLowerCase() !== department.name.toLowerCase() && await DepartmentModel.exists({ name: sameText(parsed.value), _id: { $ne: department._id } })) {
        //send res
        return res.status(409).json({ message: 'a department with this name already exists' })
      }
      set.name = parsed.value
    }
    if (body.code !== undefined) {
      const parsed = normalizeDepartmentCode(body.code)
      if (parsed.error) {
        //send res
        return res.status(400).json({ message: parsed.error })
      }
      if (parsed.value !== department.code && await DepartmentModel.exists({ code: parsed.value, _id: { $ne: department._id } })) {
        //send res
        return res.status(409).json({ message: 'a department with this code already exists' })
      }
      set.code = parsed.value
    }
    if (Object.prototype.hasOwnProperty.call(body, 'manager')) {
      if (body.manager === null) {
        unset.manager = ''
      } else {
        if (department.kind !== 'IT_SUPPORT') {
          //send res
          return res.status(400).json({ message: 'only IT support teams have a manager' })
        }
        if (!isObjectIdString(body.manager)) {
          //send res
          return res.status(400).json({ message: 'manager must be a user id or null' })
        }
        const manager = await UserModel.findOne({ _id: body.manager, role: 'MANAGER', isActive: true, department: department._id }).select('_id')
        if (!manager) {
          //send res
          return res.status(400).json({ message: 'the manager must be an active MANAGER user of this team' })
        }
        set.manager = manager._id
      }
    }
    if (body.isActive !== undefined) {
      if (typeof body.isActive !== 'boolean') {
        //send res
        return res.status(400).json({ message: BOOLEAN_FIELDS_ERROR('isActive') })
      }
      if (body.isActive === false && department.isActive) {
        const [members, categories, tickets] = await Promise.all([
          UserModel.countDocuments({ department: department._id, isActive: true }),
          CategoryModel.countDocuments({ department: department._id, isActive: true }),
          TicketModel.countDocuments({ isDeleted: false, status: { $nin: FINISHED_STATUSES }, $or: [{ department: department._id }, { requesterDepartment: department._id }] }),
        ])
        if (members || categories || tickets) {
          //send res
          return res.status(409).json({ message: `cannot deactivate: ${members} active user(s), ${categories} active categor${categories === 1 ? 'y' : 'ies'} and ${tickets} open ticket(s) still use this department` })
        }
      }
      set.isActive = body.isActive
    }

    const update = {}
    if (Object.keys(set).length) update.$set = set
    if (Object.keys(unset).length) update.$unset = unset
    if (!Object.keys(update).length) {
      //send res
      return res.status(400).json({ message: 'nothing to update' })
    }
    const before = snapshot(department, [...Object.keys(set), ...Object.keys(unset)])
    const updated = await DepartmentModel.findOneAndUpdate({ _id: department._id }, update, { returnDocument: 'after', runValidators: true }).populate('manager', 'firstName lastName email')
    await logAudit({ req, action: 'DEPARTMENT_UPDATED', entityType: 'DEPARTMENT', entity: department, entityRef: department.code, before, after: { ...set, ...(unset.manager !== undefined ? { manager: null } : {}) } })
    //send res
    res.status(200).json({ message: 'department updated', payload: updated })
  } catch (err) { next(err) }
})

// --- categories ---
// a category's default priority must be a real, active, employee-selectable one
const findSelectablePolicy = (code) => SLAPolicyModel.findOne({ priority: code, isActive: true, level: { $gt: 0 } })

const readCategoryFlags = (body, set) => {
  for (const key of ['requiresApproval', 'autoAssign']) {
    if (body[key] === undefined) continue
    if (typeof body[key] !== 'boolean') return BOOLEAN_FIELDS_ERROR(key)
    set[key] = body[key]
  }
  return null
}

adminApp.get('/categories', async (req, res, next) => {
  try {
    const paging = getPagination(req.query)
    const filter = {}
    const department = asText(req.query.department)
    if (department) {
      if (!isObjectIdString(department)) {
        //send res
        return res.status(400).json({ message: 'department must be an id' })
      }
      filter.department = department
    }
    const isActive = asBool(req.query.isActive)
    if (isActive !== undefined) filter.isActive = isActive
    const q = asText(req.query.q)
    if (q) filter.name = new RegExp(escapeRegex(q.slice(0, 50)), 'i')
    const [items, total] = await Promise.all([
      CategoryModel.find(filter).populate('department', 'name kind').sort({ name: 1, _id: 1 }).skip(paging.skip).limit(paging.limit),
      CategoryModel.countDocuments(filter),
    ])
    //send res
    res.status(200).json({ message: 'categories fetched', payload: toPage(items, total, paging) })
  } catch (err) { next(err) }
})

adminApp.post('/categories', async (req, res, next) => {
  try {
    const { name, description, department, ticketType, defaultPriority, skills } = req.body ?? {}
    const cleanName = cleanText(name, 'name', { min: 2, max: 80 })
    if (cleanName.error) {
      //send res
      return res.status(400).json({ message: cleanName.error })
    }
    const cleanDescription = cleanText(description, 'description', { min: 0, max: 300, required: false })
    if (cleanDescription.error) {
      //send res
      return res.status(400).json({ message: cleanDescription.error })
    }
    if (!isObjectIdString(department)) {
      //send res
      return res.status(400).json({ message: 'department is required (the handling team id)' })
    }
    const team = await DepartmentModel.findOne({ _id: department, isActive: true, kind: 'IT_SUPPORT' }).select('_id')
    if (!team) {
      //send res
      return res.status(400).json({ message: 'the handling team must be an active IT support department' })
    }
    if (ticketType !== undefined && !['INCIDENT', 'SERVICE_REQUEST'].includes(ticketType)) {
      //send res
      return res.status(400).json({ message: 'ticketType must be INCIDENT or SERVICE_REQUEST' })
    }
    let priority
    if (defaultPriority !== undefined) {
      const code = normalizePriorityCode(defaultPriority)
      if (code.error || !(await findSelectablePolicy(code.value))) {
        //send res
        return res.status(400).json({ message: 'defaultPriority must be an active priority that employees can choose' })
      }
      priority = code.value
    }
    const set = {}
    const flagError = readCategoryFlags(req.body ?? {}, set)
    if (flagError) {
      //send res
      return res.status(400).json({ message: flagError })
    }
    let cleanSkills
    if (skills !== undefined) {
      const parsed = normalizeSkills(skills)
      if (parsed.error) {
        //send res
        return res.status(400).json({ message: parsed.error })
      }
      cleanSkills = parsed.skills
    }
    if (await CategoryModel.exists({ name: sameText(cleanName.value) })) {
      //send res
      return res.status(409).json({ message: 'a category with this name already exists' })
    }
    const category = await CategoryModel.create({
      name: cleanName.value, description: cleanDescription.value, department: team._id, ticketType, defaultPriority: priority, skills: cleanSkills, ...set,
    })
    await logAudit({ req, action: 'CATEGORY_CREATED', entityType: 'CATEGORY', entity: category, entityRef: category.name, after: { department: String(team._id), defaultPriority: category.defaultPriority, autoAssign: category.autoAssign, requiresApproval: category.requiresApproval } })
    //send res
    res.status(201).json({ message: 'category created', payload: category })
  } catch (err) { next(err) }
})

adminApp.patch('/categories/:categoryId', async (req, res, next) => {
  try {
    const { categoryId } = req.params
    if (!isObjectIdString(categoryId)) {
      //send res
      return res.status(400).json({ message: 'invalid category id' })
    }
    const body = req.body ?? {}
    const category = await CategoryModel.findById(categoryId)
    if (!category) {
      //send res
      return res.status(404).json({ message: 'category not found' })
    }

    const set = {}
    if (body.name !== undefined) {
      const parsed = cleanText(body.name, 'name', { min: 2, max: 80 })
      if (parsed.error) {
        //send res
        return res.status(400).json({ message: parsed.error })
      }
      if (parsed.value.toLowerCase() !== category.name.toLowerCase() && await CategoryModel.exists({ name: sameText(parsed.value), _id: { $ne: category._id } })) {
        //send res
        return res.status(409).json({ message: 'a category with this name already exists' })
      }
      set.name = parsed.value
    }
    if (body.description !== undefined) {
      const parsed = cleanText(body.description, 'description', { min: 0, max: 300 })
      if (parsed.error) {
        //send res
        return res.status(400).json({ message: parsed.error })
      }
      set.description = parsed.value
    }
    if (body.ticketType !== undefined) {
      if (!['INCIDENT', 'SERVICE_REQUEST'].includes(body.ticketType)) {
        //send res
        return res.status(400).json({ message: 'ticketType must be INCIDENT or SERVICE_REQUEST' })
      }
      set.ticketType = body.ticketType
    }
    if (body.defaultPriority !== undefined) {
      const code = normalizePriorityCode(body.defaultPriority)
      if (code.error || !(await findSelectablePolicy(code.value))) {
        //send res
        return res.status(400).json({ message: 'defaultPriority must be an active priority that employees can choose' })
      }
      set.defaultPriority = code.value
    }
    const flagError = readCategoryFlags(body, set)
    if (flagError) {
      //send res
      return res.status(400).json({ message: flagError })
    }
    if (body.skills !== undefined) {
      const parsed = normalizeSkills(body.skills)
      if (parsed.error) {
        //send res
        return res.status(400).json({ message: parsed.error })
      }
      set.skills = parsed.skills
    }

    let teamChanged = false
    if (body.department !== undefined) {
      if (!isObjectIdString(body.department)) {
        //send res
        return res.status(400).json({ message: 'department must be an id' })
      }
      if (body.department !== String(category.department)) {
        const team = await DepartmentModel.findOne({ _id: body.department, isActive: true, kind: 'IT_SUPPORT' }).select('_id')
        if (!team) {
          //send res
          return res.status(400).json({ message: 'the handling team must be an active IT support department' })
        }
        set.department = team._id
        teamChanged = true
      }
    }
    let deactivating = false
    if (body.isActive !== undefined) {
      if (typeof body.isActive !== 'boolean') {
        //send res
        return res.status(400).json({ message: BOOLEAN_FIELDS_ERROR('isActive') })
      }
      deactivating = body.isActive === false && category.isActive
      set.isActive = body.isActive
    }
    // tickets already filed under it must keep a consistent team and category
    if (teamChanged || deactivating) {
      const open = await TicketModel.countDocuments({ isDeleted: false, category: category._id, status: { $nin: FINISHED_STATUSES } })
      if (open > 0) {
        //send res
        return res.status(409).json({ message: `${open} open ticket(s) use this category, wait until they are finished before ${teamChanged ? 'changing its team' : 'deactivating it'}` })
      }
    }
    if (!Object.keys(set).length) {
      //send res
      return res.status(400).json({ message: 'nothing to update' })
    }

    const before = snapshot(category, Object.keys(set))
    const updated = await CategoryModel.findOneAndUpdate({ _id: category._id }, { $set: set }, { returnDocument: 'after', runValidators: true }).populate('department', 'name kind')
    await logAudit({ req, action: 'CATEGORY_UPDATED', entityType: 'CATEGORY', entity: category, entityRef: category.name, before, after: set })
    //send res
    res.status(200).json({ message: 'category updated', payload: updated })
  } catch (err) { next(err) }
})

// --- SLA policies (also the priority master) ---
adminApp.get('/sla-policies', async (req, res, next) => {
  try {
    const paging = getPagination(req.query)
    const [items, total] = await Promise.all([
      SLAPolicyModel.find().sort({ level: 1, _id: 1 }).skip(paging.skip).limit(paging.limit),
      SLAPolicyModel.countDocuments(),
    ])
    //send res
    res.status(200).json({ message: 'SLA policies fetched', payload: toPage(items, total, paging) })
  } catch (err) { next(err) }
})

adminApp.post('/sla-policies', async (req, res, next) => {
  try {
    const { priority, label, level, color, responseTimeHours, resolutionTimeHours, businessHoursOnly } = req.body ?? {}
    const code = normalizePriorityCode(priority)
    if (code.error) {
      //send res
      return res.status(400).json({ message: code.error })
    }
    const cleanLabel = cleanText(label, 'label', { min: 1, max: 30 })
    if (cleanLabel.error) {
      //send res
      return res.status(400).json({ message: cleanLabel.error })
    }
    if (!Number.isInteger(level) || level < 0 || level > 10) {
      //send res
      return res.status(400).json({ message: 'level must be a whole number from 0 to 10 (higher = more urgent, 0 is staff-only)' })
    }
    const hours = validateSlaHours(responseTimeHours, resolutionTimeHours)
    if (hours.error) {
      //send res
      return res.status(400).json({ message: hours.error })
    }
    if (color !== undefined) {
      const parsed = validateColor(color)
      if (parsed.error) {
        //send res
        return res.status(400).json({ message: parsed.error })
      }
    }
    if (businessHoursOnly !== undefined && typeof businessHoursOnly !== 'boolean') {
      //send res
      return res.status(400).json({ message: BOOLEAN_FIELDS_ERROR('businessHoursOnly') })
    }
    if (await SLAPolicyModel.exists({ priority: code.value })) {
      //send res
      return res.status(409).json({ message: 'a priority with this code already exists' })
    }
    if (await SLAPolicyModel.exists({ level })) {
      //send res
      return res.status(409).json({ message: 'another priority already uses this level' })
    }
    const policy = await SLAPolicyModel.create({ priority: code.value, label: cleanLabel.value, level, color, responseTimeHours, resolutionTimeHours, businessHoursOnly })
    await logAudit({ req, action: 'SLA_POLICY_CREATED', entityType: 'SLA_POLICY', entity: policy, entityRef: policy.priority, after: { level, responseTimeHours, resolutionTimeHours } })
    //send res
    res.status(201).json({ message: 'SLA policy created', payload: policy })
  } catch (err) { next(err) }
})

// code and level never change (tickets and ordering depend on them); new
// hours only apply to tickets whose clock starts afterwards
adminApp.patch('/sla-policies/:policyId', async (req, res, next) => {
  try {
    const { policyId } = req.params
    if (!isObjectIdString(policyId)) {
      //send res
      return res.status(400).json({ message: 'invalid policy id' })
    }
    const body = req.body ?? {}
    const policy = await SLAPolicyModel.findById(policyId)
    if (!policy) {
      //send res
      return res.status(404).json({ message: 'SLA policy not found' })
    }

    const set = {}
    if (body.label !== undefined) {
      const parsed = cleanText(body.label, 'label', { min: 1, max: 30 })
      if (parsed.error) {
        //send res
        return res.status(400).json({ message: parsed.error })
      }
      set.label = parsed.value
    }
    if (body.color !== undefined) {
      const parsed = validateColor(body.color)
      if (parsed.error) {
        //send res
        return res.status(400).json({ message: parsed.error })
      }
      set.color = parsed.value
    }
    if (body.responseTimeHours !== undefined || body.resolutionTimeHours !== undefined) {
      const hours = validateSlaHours(body.responseTimeHours ?? policy.responseTimeHours, body.resolutionTimeHours ?? policy.resolutionTimeHours)
      if (hours.error) {
        //send res
        return res.status(400).json({ message: hours.error })
      }
      Object.assign(set, hours.value)
    }
    if (body.businessHoursOnly !== undefined) {
      if (typeof body.businessHoursOnly !== 'boolean') {
        //send res
        return res.status(400).json({ message: BOOLEAN_FIELDS_ERROR('businessHoursOnly') })
      }
      set.businessHoursOnly = body.businessHoursOnly
    }
    if (body.isActive !== undefined) {
      if (typeof body.isActive !== 'boolean') {
        //send res
        return res.status(400).json({ message: BOOLEAN_FIELDS_ERROR('isActive') })
      }
      if (body.isActive === false && policy.isActive) {
        const [openTickets, categories, otherSelectable] = await Promise.all([
          TicketModel.countDocuments({ isDeleted: false, priority: policy.priority, status: { $nin: FINISHED_STATUSES } }),
          CategoryModel.countDocuments({ defaultPriority: policy.priority, isActive: true }),
          SLAPolicyModel.countDocuments({ _id: { $ne: policy._id }, isActive: true, level: { $gt: 0 } }),
        ])
        if (openTickets) {
          //send res
          return res.status(409).json({ message: `cannot deactivate a priority still used by ${openTickets} open ticket(s)` })
        }
        if (categories) {
          //send res
          return res.status(409).json({ message: `cannot deactivate a priority that is the default of ${categories} active categor${categories === 1 ? 'y' : 'ies'}` })
        }
        if (policy.level > 0 && !otherSelectable) {
          //send res
          return res.status(409).json({ message: 'at least one priority that employees can choose must stay active' })
        }
      }
      set.isActive = body.isActive
    }
    if (!Object.keys(set).length) {
      //send res
      return res.status(400).json({ message: 'nothing to update' })
    }

    const before = snapshot(policy, Object.keys(set))
    const updated = await SLAPolicyModel.findOneAndUpdate({ _id: policy._id }, { $set: set }, { returnDocument: 'after', runValidators: true })
    await logAudit({ req, action: 'SLA_POLICY_UPDATED', entityType: 'SLA_POLICY', entity: policy, entityRef: policy.priority, before, after: set })
    //send res
    res.status(200).json({ message: 'SLA policy updated', payload: updated })
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
    const { orgName, businessHours } = req.body ?? {}
    const settings = await getOrgSettings()
    const before = { orgName: settings.orgName, businessHours: { days: [...settings.businessHours.days], start: settings.businessHours.start, end: settings.businessHours.end } }
    if (orgName !== undefined) {
      const parsed = cleanText(orgName, 'orgName', { min: 1, max: 80 })
      if (parsed.error) {
        //send res
        return res.status(400).json({ message: parsed.error })
      }
      settings.orgName = parsed.value
    }
    if (businessHours !== undefined) {
      const parsed = validateBusinessHours(businessHours, settings.businessHours)
      if (parsed.error) {
        //send res
        return res.status(400).json({ message: parsed.error })
      }
      // timezone is fixed to Asia/Kolkata (+05:30), see utils/businessHours.js
      settings.businessHours.days = parsed.value.days
      settings.businessHours.start = parsed.value.start
      settings.businessHours.end = parsed.value.end
    }
    await settings.save()
    const after = { orgName: settings.orgName, businessHours: { days: [...settings.businessHours.days], start: settings.businessHours.start, end: settings.businessHours.end } }
    // a save that changed nothing is not worth an audit entry
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      await logAudit({ req, action: 'ORG_SETTINGS_UPDATED', entityType: 'ORG_SETTINGS', entity: settings, entityRef: 'org', before, after })
    }
    //send res
    res.status(200).json({ message: 'org settings updated', payload: settings })
  } catch (err) { next(err) }
})

// --- dashboard ---
adminApp.get('/dashboard', async (req, res, next) => {
  try {
    const [totalTickets, openTickets, byStatus, byPriority, userCount] = await Promise.all([
      TicketModel.countDocuments({ isDeleted: false }),
      TicketModel.countDocuments({ isDeleted: false, status: { $nin: FINISHED_STATUSES } }),
      TicketModel.aggregate([{ $match: { isDeleted: false } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      TicketModel.aggregate([{ $match: { isDeleted: false } }, { $group: { _id: '$priority', count: { $sum: 1 } } }]),
      UserModel.countDocuments({ isActive: true }),
    ])
    //send res
    res.status(200).json({ message: 'dashboard fetched', payload: { totalTickets, openTickets, byStatus, byPriority, userCount } })
  } catch (err) { next(err) }
})
