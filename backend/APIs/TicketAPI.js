import exp from 'express'
import { TicketModel } from '../models/TicketModel.js'
import { CategoryModel } from '../models/CategoryModel.js'
import { SLAPolicyModel } from '../models/SLAPolicyModel.js'
import { UserModel } from '../models/UserModel.js'
import { AssetModel } from '../models/AssetModel.js'
import { verifyToken } from '../middlewares/verifyToken.js'
import { generateSequentialId } from '../utils/generateSequentialId.js'
import { getOrgSettings } from '../models/OrgSettingsModel.js'
import { startSlaClock, recomputeSlaForPriorityChange } from '../utils/slaLifecycle.js'
import { elapsedMs } from '../utils/businessHours.js'
import { evaluateTicketSla, evaluateManyTicketsSla } from '../utils/evaluateSla.js'
import { buildTicketQuery } from '../utils/buildTicketQuery.js'
import { idOrPublicIdFilter } from '../utils/findByIdOrPublicId.js'
import { atomicTransition, isValidVersion, VERSION_REQUIRED_MESSAGE } from '../utils/atomicTransition.js'
import { getPagination, toPage } from '../utils/pagination.js'
import { asText } from '../utils/queryParams.js'
import { toTicketView, toTicketListItem } from '../utils/ticketView.js'
import { TRANSITIONS, isTransitionAllowed, REQUESTER_ONLY_ACTIONS, TEAM_SCOPED_ACTIONS, REOPEN_WINDOW_DAYS } from '../utils/ticketTransitions.js'
import { createNotification, notifyMany } from '../utils/createNotification.js'

export const ticketApp = exp.Router()

const ALL_ROLES = ['ADMIN', 'MANAGER', 'TECHNICIAN', 'EMPLOYEE', 'ASSET_MANAGER']


// staffing helper for the Manager/Admin assign & reassign UI — active
// technicians in the caller's own team (Admin may pass ?department=)
ticketApp.get('/team-technicians', verifyToken('MANAGER', 'ADMIN'), async (req, res, next) => {
  try {
    // a Manager without a team must see nobody, not every technician
    if (req.user.role !== 'ADMIN' && !req.user.department) {
      //send res
      return res.status(200).json({ message: 'technicians fetched', payload: [] })
    }
    const department = req.user.role === 'ADMIN' ? asText(req.query.department) : req.user.department
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
    const { title, description, categoryId, priority } = req.body ?? {}
    if (!title || !description || !categoryId) {
      //send res
      return res.status(400).json({ message: 'title, description and categoryId are required' })
    }
    if (![title, description, categoryId].every((v) => typeof v === 'string')) {
      //send res
      return res.status(400).json({ message: 'title, description and categoryId must be text' })
    }

    const category = await CategoryModel.findOne({ _id: categoryId, isActive: true })
    if (!category) {
      //send res
      return res.status(400).json({ message: 'invalid category' })
    }

    // the priority must be an active SLA policy; the level-0 TEST policy
    // (1-3 minute SLA, for demos) is staff-only so an employee cannot use it
    // to flood the managers with breach notifications
    const requested = priority === undefined || priority === null || priority === '' ? category.defaultPriority : priority
    if (typeof requested !== 'string') {
      //send res
      return res.status(400).json({ message: 'priority must be text' })
    }
    const policy = await SLAPolicyModel.findOne({ priority: requested.trim().toUpperCase(), isActive: true })
    if (!policy || (policy.level <= 0 && req.user.role !== 'ADMIN')) {
      //send res
      return res.status(400).json({ message: 'invalid or inactive priority' })
    }

    const requester = await UserModel.findById(req.user.id)
    const publicId = await generateSequentialId(TicketModel, 'TKT')
    const needsApproval = Boolean(category.requiresApproval)

    let status = 'OPEN'
    let sla = {}
    if (!needsApproval) {
      const settings = await getOrgSettings()
      sla = { ...startSlaClock(new Date(), policy, settings.businessHours), policy: policy._id }
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
      priority: policy.priority,
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
    res.status(201).json({ message: needsApproval ? 'ticket submitted for approval' : 'ticket created', payload: toTicketView(ticket, req.user) })
  } catch (err) {
    next(err)
  }
})

// list — role-scoped, paginated, filterable (also used for the
// Manager/Admin "Approvals" inbox via ?status=PENDING_APPROVAL)
ticketApp.get('/tickets', verifyToken(...ALL_ROLES), async (req, res, next) => {
  try {
    const { status, priority, category, q } = req.query
    const query = buildTicketQuery(req.user, { status, priority, category, q })
    const paging = getPagination(req.query)

    const [items, total] = await Promise.all([
      TicketModel.find(query)
        .select('-comments') // lists never carry comments, internal or not
        .populate('requester', 'firstName lastName email')
        .populate('assignedTo', 'firstName lastName email')
        .populate('category', 'name ticketType')
        .sort({ createdAt: -1, _id: -1 })
        .skip(paging.skip)
        .limit(paging.limit),
      TicketModel.countDocuments(query),
    ])

    //send res
    res.status(200).json({ message: 'tickets fetched', payload: toPage(items.map(toTicketListItem), total, paging) })

    // lazy SLA check — fire after responding so it never adds latency to
    // the request; Render's free tier sleeps, so this (plus the cron) is
    // what actually catches breaches on a service that was just asleep
    evaluateManyTicketsSla(items).catch((err) => console.log('lazy SLA check (list) failed:', err.message))
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

    // lazy SLA check — a single ticket is cheap enough to await before
    // responding, so the badge the caller sees is already up to date
    await evaluateTicketSla(ticket).catch((err) => console.log('lazy SLA check (detail) failed:', err.message))

    //send res
    res.status(200).json({ message: 'ticket fetched', payload: toTicketView(ticket, req.user) })
  } catch (err) {
    next(err)
  }
})

// priority change — Manager/Admin, team-scoped. On an active ticket this
// recomputes due dates from the same sla.startedAt (plus paused time);
// on a PENDING_APPROVAL ticket it's just a field change (no clock yet).
// Registered BEFORE the wildcard :action route below — otherwise Express
// would match /tickets/:id/priority as :action="priority" and reject it
// as an unknown transition.
const CLOSED_STATUSES = ['RESOLVED', 'CLOSED', 'CANCELLED', 'REJECTED']
const PRIORITY_EDITABLE_STATUSES = ['PENDING_APPROVAL', 'OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'REOPENED']
ticketApp.patch('/tickets/:ticketId/priority', verifyToken('MANAGER', 'ADMIN'), async (req, res, next) => {
  try {
    const { priority, version } = req.body ?? {}
    if (typeof priority !== 'string' || !priority.trim()) {
      //send res
      return res.status(400).json({ message: 'priority is required' })
    }
    const ticket = await TicketModel.findOne({ ...idOrPublicIdFilter(req.params.ticketId), isDeleted: false })
    if (!ticket) {
      //send res
      return res.status(404).json({ message: 'ticket not found' })
    }
    if (req.user.role !== 'ADMIN' && req.user.department !== ticket.department.toString()) {
      //send res
      return res.status(403).json({ message: 'this ticket belongs to a different team' })
    }
    if (!isValidVersion(version)) {
      //send res
      return res.status(400).json({ message: VERSION_REQUIRED_MESSAGE })
    }
    if (version !== ticket.version) {
      //send res
      return res.status(409).json({ message: 'ticket was updated by someone else, please refresh' })
    }
    if (CLOSED_STATUSES.includes(ticket.status)) {
      //send res
      return res.status(400).json({ message: `cannot change priority on a ${ticket.status} ticket` })
    }

    const newPolicy = await SLAPolicyModel.findOne({ priority: priority.trim().toUpperCase(), isActive: true })
    if (!newPolicy) {
      //send res
      return res.status(400).json({ message: 'invalid or inactive priority' })
    }

    const previousPriority = ticket.priority
    const set = { priority: newPolicy.priority }
    if (ticket.status === 'PENDING_APPROVAL') {
      // no SLA clock yet — just the field change, per the handoff plan
      set['sla.policy'] = newPolicy._id
    } else {
      const settings = await getOrgSettings()
      const patch = recomputeSlaForPriorityChange(ticket.sla, newPolicy, settings.businessHours)
      for (const [key, value] of Object.entries(patch)) set[`sla.${key}`] = value
    }

    const result = await atomicTransition({
      Model: TicketModel, doc: ticket, action: 'change priority on', noun: 'ticket', from: PRIORITY_EDITABLE_STATUSES, version,
      set,
      push: { statusHistory: { from: ticket.status, to: ticket.status, by: req.user.id, note: `priority changed ${previousPriority} → ${newPolicy.priority}`, at: new Date() } },
    })
    if (result.error) {
      //send res
      return res.status(result.error.status).json({ message: result.error.message })
    }
    //send res
    res.status(200).json({ message: 'priority updated', payload: toTicketView(result.doc, req.user) })
  } catch (err) {
    next(err)
  }
})

// link/change the asset this ticket is about — Employees may only pick
// one of their own assigned assets; staff (assigned tech, team Manager,
// Admin) can link any asset. No status change, so no version bump (a partial
// $set cannot overwrite anyone else's edit). Registered before the
// wildcard :action route below for the same reason as /priority.
ticketApp.patch('/tickets/:ticketId/related-asset', verifyToken(...ALL_ROLES), async (req, res, next) => {
  try {
    const { assetId } = req.body ?? {} // null/omitted clears the link
    const ticket = await TicketModel.findOne({ ...idOrPublicIdFilter(req.params.ticketId), isDeleted: false })
    if (!ticket) {
      //send res
      return res.status(404).json({ message: 'ticket not found' })
    }

    const isOwner = req.user.id === ticket.requester.toString()
    const isStaff = req.user.role === 'ADMIN'
      || req.user.id === ticket.assignedTo?.toString()
      || ((req.user.role === 'MANAGER') && req.user.department === ticket.department.toString())
    if (!isOwner && !isStaff) {
      //send res
      return res.status(403).json({ message: 'not authorized to link an asset to this ticket' })
    }

    if (!assetId) {
      ticket.relatedAsset = undefined
      await ticket.save()
      //send res
      return res.status(200).json({ message: 'related asset cleared', payload: toTicketView(ticket, req.user) })
    }
    if (typeof assetId !== 'string') {
      //send res
      return res.status(400).json({ message: 'assetId must be text' })
    }

    const asset = await AssetModel.findOne({ ...idOrPublicIdFilter(assetId), isDeleted: false })
    if (!asset) {
      //send res
      return res.status(404).json({ message: 'asset not found' })
    }
    // an Employee (non-staff) may only link an asset assigned to themselves
    if (isOwner && !isStaff && asset.assignedTo?.toString() !== req.user.id) {
      //send res
      return res.status(403).json({ message: 'you can only link an asset assigned to you' })
    }

    ticket.relatedAsset = asset._id
    await ticket.save()
    //send res
    res.status(200).json({ message: 'related asset linked', payload: toTicketView(ticket, req.user) })
  } catch (err) {
    next(err)
  }
})

// status transitions — approve / reject / cancel / assign / claim / reassign
// / start / hold / resume / resolve / confirm / reopen (full Section 6b
// matrix, minus linked-ticket/duplicate closing and watchers — COLLAB-EXTRAS).
// Authorisation and input checks run on a pre-read; the write itself is one
// atomic findOneAndUpdate guarded on status + version (utils/atomicTransition.js).
ticketApp.patch('/tickets/:ticketId/:action', verifyToken(...ALL_ROLES), async (req, res, next) => {
  try {
    const { ticketId, action } = req.params
    const { note, resolutionSummary, technicianId, version } = req.body ?? {}

    const ticket = await TicketModel.findOne({ ...idOrPublicIdFilter(ticketId), isDeleted: false })
    if (!ticket) {
      //send res
      return res.status(404).json({ message: 'ticket not found' })
    }
    if (!isValidVersion(version)) {
      //send res
      return res.status(400).json({ message: VERSION_REQUIRED_MESSAGE })
    }
    if (note !== undefined && typeof note !== 'string') {
      //send res
      return res.status(400).json({ message: 'note must be text' })
    }

    const check = isTransitionAllowed(action, ticket.status, req.user.role)
    if (!check.ok) {
      // a stale version beats "wrong status": the caller is looking at old data
      if (check.reason.startsWith('cannot ') && version !== ticket.version) {
        //send res
        return res.status(409).json({ message: 'ticket was updated by someone else, please refresh' })
      }
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

    if (check.requiresNote && !note?.trim()) {
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

    if (version !== ticket.version) {
      //send res
      return res.status(409).json({ message: 'ticket was updated by someone else, please refresh' })
    }

    // everything below only builds the update; nothing is written until the
    // single atomic call at the end
    const from = ticket.status
    const now = new Date()
    const set = {}
    const unset = {}
    const notifications = []
    if (check.to !== null) set.status = check.to

    if (action === 'approve') {
      const policy = await SLAPolicyModel.findOne({ priority: ticket.priority, isActive: true })
      const settings = await getOrgSettings()
      const clock = startSlaClock(now, policy, settings.businessHours)
      for (const [key, value] of Object.entries(clock)) set[`sla.${key}`] = value
      if (policy) set['sla.policy'] = policy._id
      set['approval.approvedBy'] = req.user.id
      set['approval.approvedAt'] = now
      notifications.push({ user: ticket.requester, type: 'TICKET_APPROVED', message: `Ticket ${ticket.publicId} was approved and is now open` })
    }
    if (action === 'reject') {
      set['approval.rejectedBy'] = req.user.id
      set['approval.rejectedAt'] = now
      set['approval.rejectionReason'] = note
      notifications.push({ user: ticket.requester, type: 'TICKET_REJECTED', message: `Ticket ${ticket.publicId} was rejected: ${note}` })
    }
    if (action === 'cancel') {
      set.cancellation = { cancelledBy: req.user.id, cancelledAt: now, reason: note }
      if (ticket.assignedTo) {
        notifications.push({ user: ticket.assignedTo, type: 'STATUS_CHANGED', message: `Ticket ${ticket.publicId} was cancelled` })
      }
    }
    if (action === 'assign' || action === 'reassign') {
      if (!technicianId || typeof technicianId !== 'string') {
        //send res
        return res.status(400).json({ message: 'technicianId is required' })
      }
      const technician = await UserModel.findOne({ _id: technicianId, role: 'TECHNICIAN', isActive: true })
      if (!technician) {
        //send res
        return res.status(400).json({ message: 'technicianId must be an active technician' })
      }
      // no Admin bypass: the assignee must be in the ticket's own team
      if (technician.department?.toString() !== ticket.department.toString()) {
        //send res
        return res.status(400).json({ message: "technician must belong to the ticket's department" })
      }
      const previousAssignee = ticket.assignedTo
      set.assignedTo = technician._id
      set.assignedBy = req.user.id
      set.assignedAt = now
      notifications.push({ user: technician._id, type: 'TICKET_ASSIGNED', message: `Ticket ${ticket.publicId} was assigned to you` })
      if (action === 'reassign' && previousAssignee && previousAssignee.toString() !== technician._id.toString()) {
        notifications.push({ user: previousAssignee, type: 'STATUS_CHANGED', message: `Ticket ${ticket.publicId} was reassigned to someone else` })
      }
    }
    if (action === 'claim') {
      set.assignedTo = req.user.id
      set.assignedBy = req.user.id
      set.assignedAt = now
    }
    if (action === 'start' && !ticket.sla.firstRespondedAt) {
      set['sla.firstRespondedAt'] = now
    }
    if (action === 'hold') {
      set['sla.pausedAt'] = now
    }
    if (action === 'resume' && ticket.sla.pausedAt) {
      const policy = ticket.sla.policy ? await SLAPolicyModel.findById(ticket.sla.policy) : null
      const settings = await getOrgSettings()
      const pausedMs = elapsedMs(ticket.sla.pausedAt, now, policy, settings.businessHours)
      if (ticket.sla.responseDueAt) set['sla.responseDueAt'] = new Date(ticket.sla.responseDueAt.getTime() + pausedMs)
      if (ticket.sla.resolutionDueAt) set['sla.resolutionDueAt'] = new Date(ticket.sla.resolutionDueAt.getTime() + pausedMs)
      if (ticket.sla.warnAt) set['sla.warnAt'] = new Date(ticket.sla.warnAt.getTime() + pausedMs)
      set['sla.totalPausedMs'] = (ticket.sla.totalPausedMs || 0) + pausedMs
      unset['sla.pausedAt'] = ''
    }
    if (action === 'resolve') {
      if (typeof resolutionSummary !== 'string' || !resolutionSummary.trim()) {
        //send res
        return res.status(400).json({ message: 'resolutionSummary is required' })
      }
      set['resolution.summary'] = resolutionSummary
      set['resolution.resolvedBy'] = req.user.id
      set['resolution.resolvedAt'] = now
      notifications.push({ user: ticket.requester, type: 'STATUS_CHANGED', message: `Ticket ${ticket.publicId} was marked resolved — please confirm` })
    }
    if (action === 'confirm') {
      set['resolution.confirmedByRequester'] = true
      set['resolution.confirmedAt'] = now
    }
    if (action === 'reopen') {
      // new SLA cycle from now — response SLA isn't re-run (first response
      // already happened), only resolutionDueAt/warnAt restart; a breach
      // from the cycle that just ended is banked into pastBreaches
      const policy = await SLAPolicyModel.findOne({ priority: ticket.priority, isActive: true })
      const settings = await getOrgSettings()
      const clock = startSlaClock(now, policy, settings.businessHours)
      set.reopenCount = (ticket.reopenCount || 0) + 1
      set['sla.pastBreaches'] = (ticket.sla.pastBreaches || 0) + (ticket.sla.resolutionBreached ? 1 : 0)
      set['sla.startedAt'] = now
      set['sla.resolutionDueAt'] = clock.resolutionDueAt
      set['sla.warnAt'] = clock.warnAt
      set['sla.resolutionBreached'] = false
      set['sla.warningSent'] = false
      set['sla.escalationLevel'] = ticket.sla.responseBreached ? 1 : 0 // responseBreached isn't touched by reopen, so don't clobber it
      set['sla.totalPausedMs'] = 0
      set['resolution.confirmedByRequester'] = false
      unset['resolution.summary'] = ''
      unset['resolution.resolvedBy'] = ''
      unset['resolution.resolvedAt'] = ''
      unset['resolution.confirmedAt'] = ''
      if (ticket.assignedTo) {
        notifications.push({ user: ticket.assignedTo, type: 'TICKET_REOPENED', message: `Ticket ${ticket.publicId} was reopened: ${note}` })
      }
    }

    const result = await atomicTransition({
      Model: TicketModel, doc: ticket, action, noun: 'ticket', from: TRANSITIONS[action].from, version,
      set, unset,
      push: { statusHistory: { from, to: check.to ?? from, by: req.user.id, note, at: now } },
    })
    if (result.error) {
      //send res
      return res.status(result.error.status).json({ message: result.error.message })
    }

    // notifications follow the main write; a failure is logged inside createNotification, never fatal
    await Promise.all(notifications.map((n) => createNotification({ ...n, link: `/tickets/${ticket.publicId}` })))

    //send res
    res.status(200).json({ message: `ticket ${action} succeeded`, payload: toTicketView(result.doc, req.user) })
  } catch (err) {
    next(err)
  }
})

// comments
ticketApp.post('/tickets/:ticketId/comments', verifyToken(...ALL_ROLES), async (req, res, next) => {
  try {
    const { text, isInternal } = req.body ?? {}
    if (typeof text !== 'string' || !text.trim()) {
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
