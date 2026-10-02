import exp from 'express'
import { TicketModel } from '../models/TicketModel.js'
import { WorkLogModel } from '../models/WorkLogModel.js'
import { verifyToken } from '../middlewares/verifyToken.js'
import { idOrPublicIdFilter } from '../utils/findByIdOrPublicId.js'
import { getPagination, toPage } from '../utils/pagination.js'
import { logAudit } from '../utils/logAudit.js'

export const workLogApp = exp.Router()

// nothing can be logged once the ticket is finished
const FINISHED_STATUSES = ['CLOSED', 'CANCELLED', 'REJECTED']

// add: the assigned TECHNICIAN only
workLogApp.post('/:ticketId', verifyToken('TECHNICIAN'), async (req, res, next) => {
  try {
    const { description, minutesSpent } = req.body ?? {}
    if (typeof description !== 'string' || !description.trim() || description.length > 1000) {
      //send res
      return res.status(400).json({ message: 'description is required (1000 characters at most)' })
    }
    if (!Number.isInteger(minutesSpent) || minutesSpent < 1 || minutesSpent > 1440) {
      //send res
      return res.status(400).json({ message: 'minutesSpent must be a whole number from 1 to 1440' })
    }
    const ticket = await TicketModel.findOne({ ...idOrPublicIdFilter(req.params.ticketId), isDeleted: false })
    // a technician who is not on this ticket gets the same answer as for a missing one
    if (!ticket || ticket.assignedTo?.toString() !== req.user.id) {
      //send res
      return res.status(404).json({ message: 'ticket not found or not assigned to you' })
    }
    if (FINISHED_STATUSES.includes(ticket.status)) {
      //send res
      return res.status(400).json({ message: `cannot log work on a ${ticket.status} ticket` })
    }
    const log = await WorkLogModel.create({ ticket: ticket._id, technician: req.user.id, description, minutesSpent })
    await logAudit({ req, action: 'WORKLOG_ADDED', entityType: 'TICKET', entity: ticket, after: { workLogId: String(log._id), minutesSpent } })
    //send res
    res.status(201).json({ message: 'work log added', payload: log })
  } catch (err) {
    next(err)
  }
})

// view: TECHNICIAN or MANAGER of the ticket's team, and ADMIN
workLogApp.get('/:ticketId', verifyToken('TECHNICIAN', 'MANAGER', 'ADMIN'), async (req, res, next) => {
  try {
    const ticket = await TicketModel.findOne({ ...idOrPublicIdFilter(req.params.ticketId), isDeleted: false }).select('department publicId')
    const sameTeam = ticket && req.user.department && ticket.department.toString() === req.user.department
    if (!ticket || (req.user.role !== 'ADMIN' && !sameTeam)) {
      //send res
      return res.status(404).json({ message: 'ticket not found' })
    }
    const paging = getPagination(req.query)
    const [items, total, sums] = await Promise.all([
      WorkLogModel.find({ ticket: ticket._id }).populate('technician', 'firstName lastName').sort({ createdAt: -1, _id: -1 }).skip(paging.skip).limit(paging.limit),
      WorkLogModel.countDocuments({ ticket: ticket._id }),
      WorkLogModel.aggregate([{ $match: { ticket: ticket._id } }, { $group: { _id: null, minutes: { $sum: '$minutesSpent' } } }]),
    ])
    //send res
    res.status(200).json({ message: 'work logs fetched', payload: { ...toPage(items, total, paging), totalMinutes: sums[0]?.minutes ?? 0 } })
  } catch (err) {
    next(err)
  }
})
