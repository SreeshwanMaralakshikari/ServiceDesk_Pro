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
import { isTransitionAllowed } from '../utils/ticketTransitions.js'
import { createNotification } from '../utils/createNotification.js'

export const ticketApp = exp.Router()

const ALL_ROLES = ['ADMIN', 'MANAGER', 'TECHNICIAN', 'EMPLOYEE', 'ASSET_MANAGER']

// create — EMPLOYEE (or ADMIN, for seed/demo convenience)
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
    const policy = await SLAPolicyModel.findOne({ priority: finalPriority, isActive: true })

    const publicId = await generateSequentialId(TicketModel, 'TKT')
    const startedAt = new Date()
    const sla = computeSlaDueDates(startedAt, policy)

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
      status: 'OPEN',
      sla,
      statusHistory: [{ to: 'OPEN', by: requester._id, note: 'ticket created' }],
    })

    //send res
    res.status(201).json({ message: 'ticket created', payload: ticket })
  } catch (err) {
    next(err)
  }
})

// list — role-scoped, paginated, filterable
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

// status transitions: assign / claim / start / resolve / confirm / reopen / cancel
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

    // requester-only actions must belong to the requester
    if (['confirm', 'reopen', 'cancel'].includes(action) && req.user.role === 'EMPLOYEE' && ticket.requester.toString() !== req.user.id) {
      //send res
      return res.status(403).json({ message: 'this is not your ticket' })
    }
    // team-scoped actions must match the ticket's department
    if (['assign', 'claim', 'start'].includes(action) && req.user.role !== 'ADMIN' && req.user.department !== ticket.department.toString()) {
      //send res
      return res.status(403).json({ message: 'this ticket belongs to a different team' })
    }

    if (typeof version === 'number' && version !== ticket.version) {
      //send res
      return res.status(409).json({ message: 'ticket was updated by someone else, please refresh' })
    }

    const from = ticket.status
    ticket.status = check.to
    ticket.version += 1
    ticket.statusHistory.push({ from, to: check.to, by: req.user.id, note })

    if (action === 'assign') {
      if (!technicianId) { return res.status(400).json({ message: 'technicianId is required' }) }
      ticket.assignedTo = technicianId
      ticket.assignedBy = req.user.id
      ticket.assignedAt = new Date()
      await createNotification({ user: technicianId, type: 'TICKET_ASSIGNED', message: `Ticket ${ticket.publicId} was assigned to you`, link: `/tickets/${ticket.publicId}` })
    }
    if (action === 'claim') {
      ticket.assignedTo = req.user.id
      ticket.assignedBy = req.user.id
      ticket.assignedAt = new Date()
    }
    if (action === 'start' && !ticket.sla.firstRespondedAt) {
      ticket.sla.firstRespondedAt = new Date()
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
      ticket.reopenCount = (ticket.reopenCount || 0) + 1
      if (ticket.assignedTo) {
        await createNotification({ user: ticket.assignedTo, type: 'TICKET_REOPENED', message: `Ticket ${ticket.publicId} was reopened`, link: `/tickets/${ticket.publicId}` })
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
