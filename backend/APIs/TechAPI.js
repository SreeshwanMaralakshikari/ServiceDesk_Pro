import exp from 'express'
import { TicketModel } from '../models/TicketModel.js'
import { SLAPolicyModel } from '../models/SLAPolicyModel.js'
import { verifyToken } from '../middlewares/verifyToken.js'
import { buildQueue } from '../utils/dsa/smartQueue.js'
import { TECH_ACTIVE_STATUSES } from '../utils/ticketStatuses.js'
import { toTicketListItem } from '../utils/ticketView.js'
import { WorkLogModel } from '../models/WorkLogModel.js'
import { buildTicketQuery } from '../utils/buildTicketQuery.js'
import { buildTechnicianDashboard, parseDays, windowStart } from '../utils/dashboardStats.js'
import { loadScopedTickets, loadPolicies, loadBusinessHours, ROW_CAP } from '../utils/dashboardData.js'

export const techApp = exp.Router()

// a technician's queue is bounded: nobody works through more than this at once
const QUEUE_CANDIDATES = 300
const QUEUE_LIMIT = 50

// the technician's work list, ordered by a min-heap (smartQueue): SLA urgency first, then
// due date, priority and age.
//   mine        what is assigned to me and still in progress
//   unassigned  OPEN tickets of my team that nobody has picked up (claim candidates)
techApp.get('/queue', verifyToken('TECHNICIAN'), async (req, res, next) => {
  try {
    // a technician without a team has no queue
    if (!req.user.department) {
      //send res
      return res.status(200).json({ message: 'queue fetched', payload: { mine: [], unassigned: [] } })
    }
    const [mineRows, openRows, policies] = await Promise.all([
      TicketModel.find({ isDeleted: false, assignedTo: req.user.id, status: { $in: TECH_ACTIVE_STATUSES } })
        .select('-comments').populate('requester', 'firstName lastName').populate('category', 'name')
        .sort({ createdAt: -1 }).limit(QUEUE_CANDIDATES).lean(),
      TicketModel.find({ isDeleted: false, department: req.user.department, status: 'OPEN', assignedTo: null })
        .select('-comments').populate('requester', 'firstName lastName').populate('category', 'name')
        .sort({ createdAt: -1 }).limit(QUEUE_CANDIDATES).lean(),
      SLAPolicyModel.find().select('priority level'),
    ])
    const levelOf = new Map(policies.map((p) => [p.priority, p.level]))
    const withLevel = (t) => ({ ...toTicketListItem(t), priorityLevel: levelOf.get(t.priority) ?? 0 })
    const now = new Date()

    //send res
    res.status(200).json({
      message: 'queue fetched',
      payload: {
        mine: buildQueue(mineRows.map(withLevel), { now, limit: QUEUE_LIMIT }),
        unassigned: buildQueue(openRows.map(withLevel), { now, limit: QUEUE_LIMIT }),
      },
    })
  } catch (err) {
    next(err)
  }
})

// A technician's own numbers: open work and its SLA state, resolved tickets, CSAT, time logged.
// Only tickets assigned to the caller (inside the caller's team scope). ?days=7|30|90|all (default 30)
techApp.get('/dashboard', verifyToken('TECHNICIAN'), async (req, res, next) => {
  try {
    const days = parseDays(req.query.days)
    if (days === undefined) {
      //send res
      return res.status(400).json({ message: 'days must be 7, 30, 90 or all' })
    }
    const now = new Date()
    const from = windowStart(now, days)
    // the team scope first, then "assigned to me" (a technician without a team matches nothing)
    const query = { ...buildTicketQuery(req.user, {}), assignedTo: req.user.id }
    const [{ tickets, truncated }, policies, settings, workLogs] = await Promise.all([
      loadScopedTickets(query),
      loadPolicies(),
      loadBusinessHours(),
      WorkLogModel.find({ technician: req.user.id, ...(from ? { createdAt: { $gte: from } } : {}) }).select('minutesSpent createdAt').sort({ createdAt: -1 }).limit(ROW_CAP).lean(),
    ])
    //send res
    res.status(200).json({ message: 'dashboard fetched', payload: buildTechnicianDashboard({ tickets, workLogs, policies, settings, now, days, truncated }) })
  } catch (err) {
    next(err)
  }
})
