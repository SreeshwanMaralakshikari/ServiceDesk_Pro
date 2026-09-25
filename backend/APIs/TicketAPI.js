import exp from 'express'
import { TicketModel } from '../models/TicketModel.js'
import { CategoryModel } from '../models/CategoryModel.js'
import { SLAPolicyModel } from '../models/SLAPolicyModel.js'
import { UserModel } from '../models/UserModel.js'
import { verifyToken } from '../middlewares/verifyToken.js'
import { generateSequentialId } from '../utils/generateSequentialId.js'
import { computeSlaDueDates } from '../utils/slaHelper.js'
import { buildTicketQuery } from '../utils/buildTicketQuery.js'
import { idOrPublicIdFilter } from '../utils/findByIdOrPublicId.js'
import { isTransitionAllowed, REQUESTER_ONLY_ACTIONS, TEAM_SCOPED_ACTIONS, REOPEN_WINDOW_DAYS } from '../utils/ticketTransitions.js'
import { createNotification, notifyMany } from '../utils/createNotification.js'

export const ticketApp = exp.Router()

const ALL_ROLES = ['ADMIN', 'MANAGER', 'TECHNICIAN', 'EMPLOYEE', 'ASSET_MANAGER']

// staffing helper for the Manager/Admin assign & reassign UI — active
// technicians in the caller's own team (Admin may pass ?department=)
ticketApp.get('/team-technicians', verifyToken('MANAGER', 'ADMIN'), async (req, res, next) => {
  try {
    const department = req.user.role === 'ADMIN' ? req.query.department : req.user.department
    const filter = { role: 'TECHNICIAN', isActive: true }
    if (department) filter.department = department
    const technicians = await UserModel.find(filter).select('firstName lastName email department')
    //send res
    res.status(200).json({ message: 'technicians fetched', payload: technicians })
  } catch (err) {
    next(err)
  }
})

// create — EMPLOYEE (or ADMIN, for seed/demo convenience)
// categories with requiresApproval land in PENDING_APPROVAL with no SLA
// clock yet; everything else opens straight into OPEN with SLA running.
ticketApp.post('/tickets', verifyToken('EMPLOYEE', 'ADMIN'), async (req, res, next) => {
  try {
    // destructure known fields only — never new Model(req.body)
    const { title, description, categoryId, priority } = req.body
    if (!title || !description || !categoryId) {
      //send res
      return res.status(400).json({ message: 'title, description and categoryId are required' })
    }

    const category = await CategoryModel.findOne({ _id: categoryId, isActive: true })
    if (!category) {
      //send res
      return res.status(400).json({ message: 'invalid category' })
    }

    const requester = await UserModel.findById(req.user.id)
    const finalPriority = priority || category.defaultPriority
    const publicId = await generateSequentialId(TicketModel, 'TKT')
    const needsApproval = Boolean(category.requiresApproval)

    let status = 'OPEN'
    let sla = {}
    if (!needsApproval) {
      const policy = await SLAPolicyModel.findOne({ priority: finalPriority, isActive: true })
      sla = computeSlaDueDates(new Date(), policy)
    } else {
      status = 'PENDING_APPROVAL'
    }

    const ticket = await TicketModel.create({
      publicId,
      title,
      description,
      type: category.ticketType,
      requester: requester._id,
      requesterDepartment: requester.department,
      department: category.department,
      category: category._id,
      priority: finalPriority,
      status,
      sla,
      statusHistory: [{ to: status, by: requester._id, note: needsApproval ? 'ticket created — awaiting approval' : 'ticket created' }],
    })

    if (needsApproval) {
      const managers = await UserModel.find({ role: 'MANAGER', department: category.department, isActive: true }).select('_id')
      await notifyMany(managers.map((m) => m._id), {
        type: 'APPROVAL_REQUESTED',
        message: `Ticket ${ticket.publicId} needs your approval`,
        link: `/tickets/${ticket.publicId}`,
      })
    }

    //send res
    res.status(201).json({ message: needsApproval ? 'ticket submitted for approval' : 'ticket created', payload: ticket })
  } catch (err) {
    next(err)
  }
})

// list — role-scoped, paginated, filterable (also used for the
// Manager/Admin "Approvals" inbox via ?status=PENDING_APPROVAL)
ticketApp.get('/tickets', verifyToken(...ALL_ROLES), async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, priority, category, q } = req.query
    const query = buildTicketQuery(req.user, { status, priority, category, q })

    const skip = (Number(page) - 1) * Number(limit)
    const [items, total] = await Promise.all([
      TicketModel.find(query)
        .populate('requester', 'firstName lastName email')
        .populate('assignedTo', 'firstName lastName email')
        .populate('category', 'name ticketType')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      TicketModel.countDocuments(query),
    ])

    //send res
    res.status(200).json({
      message: 'tickets fetched',
      payload: { items, total, page: Number(page), totalPages: Math.ceil(total / limit) },
    })
  } catch (err) {
    next(err)
  }
})

// detail
ticketApp.get('/tickets/:ticketId', verifyToken(...ALL_ROLES), async (req, res, next) => {
  try {
    const query = { ...buildTicketQuery(req.user), ...idOrPublicIdFilter(req.params.ticketId) }
    const ticket = await TicketModel.findOne(query)
      .populate('requester', 'firstName lastName email')
      .populate('assignedTo', 'firstName lastName email')
      .populate('category', 'name ticketType')
      .populate('comments.author', 'firstName lastName role')

    if (!ticket) {
      //send res
      return res.status(404).json({ message: 'ticket not found' })
    }

    // hide internal comments from anyone who isn't staff on the owning team or Admin
    const isStaff = req.user.role === 'ADMIN' || ((req.user.role === 'TECHNICIAN' || req.user.role === 'MANAGER') && req.user.department === ticket.department.toString())
    const visible = ticket.toObject()
    if (!isStaff) visible.comments = visible.comments.filter((c) => !c.isInternal)

    //send res
    res.status(200).json({ message: 'ticket fetched', payload: visible })
  } catch (err) {
    next(err)
  }
})

// status transitions — approve / reject / cancel / assign / claim / reassign
// / start / hold / resume / resolve / confirm / reopen (full Section 6b
// matrix, minus linked-ticket/duplicate closing and watchers — Phase 6)
ticketApp.patch('/tickets/:ticketId/:action', verifyToken(...ALL_ROLES), async (req, res, next) => {
  try {
    const { ticketId, action } = req.params
    const { note, resolutionSummary, technicianId, version } = req.body

    const ticket = await TicketModel.findOne({ ...idOrPublicIdFilter(ticketId), isDeleted: false })
    if (!ticket) {
      //send res
      return res.status(404).json({ message: 'ticket not found' })
    }

    const check = isTransitionAllowed(action, ticket.status, req.user.role)
    if (!check.ok) {
      //send res
      return res.status(check.reason.includes('authorized') ? 403 : 400).json({ message: check.reason })
    }

    // extra reopen guard: a CLOSED ticket can only be reopened within
    // REOPEN_WINDOW_DAYS of confirmation (RESOLVED has no such window)
    if (action === 'reopen' && ticket.status === 'CLOSED') {
      const closedAt = ticket.resolution?.confirmedAt
      const withinWindow = closedAt && (Date.now() - closedAt.getTime()) <= REOPEN_WINDOW_DAYS * 24 * 60 * 60 * 1000
      if (!withinWindow) {
        //send res
        return res.status(400).json({ message: `this ticket was closed more than ${REOPEN_WINDOW_DAYS} days ago and can no longer be reopened — please raise a new ticket` })
      }
    }

    if (check.requiresNote && !note) {
      //send res
      return res.status(400).json({ message: `a note is required for ${action}` })
    }

    // requester-only actions must belong to the requester
    if (REQUESTER_ONLY_ACTIONS.includes(action) && req.user.role === 'EMPLOYEE' && ticket.requester.toString() !== req.user.id) {
      //send res
      return res.status(403).json({ message: 'this is not your ticket' })
    }
    // team-scoped actions must match the ticket's department
    if (TEAM_SCOPED_ACTIONS.includes(action) && req.user.role !== 'ADMIN' && req.user.department !== ticket.department.toString()) {
      //send res
      return res.status(403).json({ message: 'this ticket belongs to a different team' })
    }
    // actions that only the assigned technician may perform
    if (check.assigneeOnly && req.user.role === 'TECHNICIAN' && ticket.assignedTo?.toString() !== req.user.id) {
      //send res
      return res.status(403).json({ message: 'only the assigned technician can do this' })
    }

    if (typeof version === 'number' && version !== ticket.version) {
      //send res
      return res.status(409).json({ message: 'ticket was updated by someone else, please refresh' })
    }

    const from = ticket.status
    if (check.to !== null) ticket.status = check.to
    ticket.version += 1
    ticket.statusHistory.push({ from, to: check.to ?? from, by: req.user.id, note })

    if (action === 'approve') {
      const policy = await SLAPolicyModel.findOne({ priority: ticket.priority, isActive: true })
      ticket.sla = { ...ticket.sla, ...computeSlaDueDates(new Date(), policy) }
      ticket.approval.approvedBy = req.user.id
      ticket.approval.approvedAt = new Date()
      await createNotification({ user: ticket.requester, type: 'TICKET_APPROVED', message: `Ticket ${ticket.publicId} was approved and is now open`, link: `/tickets/${ticket.publicId}` })
    }
    if (action === 'reject') {
      ticket.approval.rejectedBy = req.user.id
      ticket.approval.rejectedAt = new Date()
      ticket.approval.rejectionReason = note
      await createNotification({ user: ticket.requester, type: 'TICKET_REJECTED', message: `Ticket ${ticket.publicId} was rejected: ${note}`, link: `/tickets/${ticket.publicId}` })
    }
    if (action === 'cancel') {
      ticket.cancellation = { cancelledBy: req.user.id, cancelledAt: new Date(), reason: note }
      if (ticket.assignedTo) {
        await createNotification({ user: ticket.assignedTo, type: 'STATUS_CHANGED', message: `Ticket ${ticket.publicId} was cancelled`, link: `/tickets/${ticket.publicId}` })
      }
    }
    if (action === 'assign' || action === 'reassign') {
      if (!technicianId) {
        //send res
        return res.status(400).json({ message: 'technicianId is required' })
      }
      const technician = await UserModel.findOne({ _id: technicianId, role: 'TECHNICIAN', isActive: true })
      if (!technician) {
        //send res
        return res.status(400).json({ message: 'technicianId must be an active technician' })
      }
      if (req.user.role !== 'ADMIN' && technician.department?.toString() !== ticket.department.toString()) {
        //send res
        return res.status(400).json({ message: "technician must belong to the ticket's department" })
      }
      const previousAssignee = ticket.assignedTo
      ticket.assignedTo = technician._id
      ticket.assignedBy = req.user.id
      ticket.assignedAt = new Date()
      await createNotification({ user: technician._id, type: 'TICKET_ASSIGNED', message: `Ticket ${ticket.publicId} was assigned to you`, link: `/tickets/${ticket.publicId}` })
      if (action === 'reassign' && previousAssignee && previousAssignee.toString() !== technicianId) {
        await createNotification({ user: previousAssignee, type: 'STATUS_CHANGED', message: `Ticket ${ticket.publicId} was reassigned to someone else`, link: `/tickets/${ticket.publicId}` })
      }
    }
    if (action === 'claim') {
      ticket.assignedTo = req.user.id
      ticket.assignedBy = req.user.id
      ticket.assignedAt = new Date()
    }
    if (action === 'start' && !ticket.sla.firstRespondedAt) {
      ticket.sla.firstRespondedAt = new Date()
    }
    if (action === 'hold') {
      ticket.sla.pausedAt = new Date()
    }
    if (action === 'resume' && ticket.sla.pausedAt) {
      const pausedMs = Date.now() - ticket.sla.pausedAt.getTime()
      if (ticket.sla.responseDueAt) ticket.sla.responseDueAt = new Date(ticket.sla.responseDueAt.getTime() + pausedMs)
      if (ticket.sla.resolutionDueAt) ticket.sla.resolutionDueAt = new Date(ticket.sla.resolutionDueAt.getTime() + pausedMs)
      ticket.sla.totalPausedMs = (ticket.sla.totalPausedMs || 0) + pausedMs
      ticket.sla.pausedAt = undefined
    }
    if (action === 'resolve') {
      if (!resolutionSummary) { return res.status(400).json({ message: 'resolutionSummary is required' }) }
      ticket.resolution.summary = resolutionSummary
      ticket.resolution.resolvedBy = req.user.id
      ticket.resolution.resolvedAt = new Date()
      await createNotification({ user: ticket.requester, type: 'STATUS_CHANGED', message: `Ticket ${ticket.publicId} was marked resolved — please confirm`, link: `/tickets/${ticket.publicId}` })
    }
    if (action === 'confirm') {
      ticket.resolution.confirmedByRequester = true
      ticket.resolution.confirmedAt = new Date()
    }
    if (action === 'reopen') {
      // new SLA cycle — same-priority policy, wall-clock due dates from now
      const policy = await SLAPolicyModel.findOne({ priority: ticket.priority, isActive: true })
      const { resolutionDueAt } = computeSlaDueDates(new Date(), policy)
      ticket.reopenCount = (ticket.reopenCount || 0) + 1
      ticket.sla.resolutionDueAt = resolutionDueAt
      ticket.sla.resolutionBreached = false
      ticket.sla.totalPausedMs = 0
      ticket.resolution = { summary: undefined, resolvedBy: undefined, resolvedAt: undefined, confirmedByRequester: false, confirmedAt: undefined }
      if (ticket.assignedTo) {
        await createNotification({ user: ticket.assignedTo, type: 'TICKET_REOPENED', message: `Ticket ${ticket.publicId} was reopened: ${note}`, link: `/tickets/${ticket.publicId}` })
      }
    }

    await ticket.save()
    //send res
    res.status(200).json({ message: `ticket ${action} succeeded`, payload: ticket })
  } catch (err) {
    next(err)
  }
})

// comments
ticketApp.post('/tickets/:ticketId/comments', verifyToken(...ALL_ROLES), async (req, res, next) => {
  try {
    const { text, isInternal } = req.body
    if (!text) {
      //send res
      return res.status(400).json({ message: 'comment text is required' })
    }
    const ticket = await TicketModel.findOne({ ...idOrPublicIdFilter(req.params.ticketId), isDeleted: false })
    if (!ticket) {
      //send res
      return res.status(404).json({ message: 'ticket not found' })
    }
    const canComment = req.user.role === 'ADMIN'
      || req.user.id === ticket.requester.toString()
      || req.user.id === ticket.assignedTo?.toString()
      || ((req.user.role === 'TECHNICIAN' || req.user.role === 'MANAGER') && req.user.department === ticket.department.toString())
    if (!canComment) {
      //send res
      return res.status(403).json({ message: 'not authorized to comment on this ticket' })
    }
    // employees can never post internal notes
    const internal = req.user.role === 'EMPLOYEE' ? false : Boolean(isInternal)
    ticket.comments.push({ author: req.user.id, text, isInternal: internal })
    await ticket.save()
    //send res
    res.status(201).json({ message: 'comment added', payload: ticket.comments[ticket.comments.length - 1] })
  } catch (err) {
    next(err)
  }
})
