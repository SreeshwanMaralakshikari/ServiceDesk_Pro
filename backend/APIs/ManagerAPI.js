import exp from 'express'
import { DepartmentModel } from '../models/DepartmentModel.js'
import { verifyToken } from '../middlewares/verifyToken.js'
import { asText, isObjectIdString } from '../utils/queryParams.js'
import { parseDays } from '../utils/dashboardStats.js'
import { loadDashboard } from '../utils/dashboardData.js'

export const managerApp = exp.Router()

// Manager (own team) and Admin (all teams, or one with ?department=): SLA compliance, backlog,
// workload per technician, CSAT, volume trend. ?days=7|30|90|all (default 30).
// What each number counts is written at the top of utils/dashboardStats.js.
managerApp.get('/dashboard', verifyToken('MANAGER', 'ADMIN'), async (req, res, next) => {
  try {
    const days = parseDays(req.query.days)
    if (days === undefined) {
      //send res
      return res.status(400).json({ message: 'days must be 7, 30, 90 or all' })
    }

    // a manager's team is fixed by their account; only an admin can pick a team
    let department
    if (req.user.role === 'ADMIN') {
      department = asText(req.query.department)
      if (department) {
        const team = isObjectIdString(department) ? await DepartmentModel.findOne({ _id: department, kind: 'IT_SUPPORT' }).select('_id') : null
        if (!team) {
          //send res
          return res.status(400).json({ message: 'department must be an IT support team' })
        }
      }
    }

    const payload = await loadDashboard({ user: req.user, days, department })
    //send res
    res.status(200).json({ message: 'dashboard fetched', payload })
  } catch (err) {
    next(err)
  }
})
