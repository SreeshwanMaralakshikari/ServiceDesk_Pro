import { DepartmentModel } from '../models/DepartmentModel.js'

// EMPLOYEE -> an active BUSINESS department; TECHNICIAN/MANAGER -> an active
// IT_SUPPORT team; ADMIN/ASSET_MANAGER -> department optional. Returns an
// error message, or null when the pair is valid.
const REQUIRED_KIND = { EMPLOYEE: 'BUSINESS', TECHNICIAN: 'IT_SUPPORT', MANAGER: 'IT_SUPPORT' }

export const validateRoleDepartment = async (role, department) => {
  const kind = REQUIRED_KIND[role]
  if (!kind) return null
  if (!department) return `${role} requires a ${kind} department`
  if (typeof department !== 'string') return 'department must be an id'
  const dept = await DepartmentModel.findOne({ _id: department, isActive: true }).select('kind')
  if (!dept) return 'department not found or inactive'
  if (dept.kind !== kind) return `${role} must belong to a ${kind} department`
  return null
}
