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
import { toTicketView, toTicketListItem, canSeeInternal } from '../utils/ticketView.js'
import { TRANSITIONS, isTransitionAllowed, REQUESTER_ONLY_ACTIONS, TEAM_SCOPED_ACTIONS, REOPEN_WINDOW_DAYS } from '../utils/ticketTransitions.js'
import { createNotification, notifyMany } from '../utils/createNotification.js'
import { logAudit } from '../utils/logAudit.js'
import { WorkLogModel } from '../models/WorkLogModel.js'
import { getTechnicianStats } from '../utils/technicianStats.js'
import { fullName } from '../utils/dashboardStats.js'
import { autoAssignTicket } from '../utils/autoAssign.js'
import { rankTechnicians, matchedSkills } from '../utils/dsa/techHeap.js'
import { findSimilar } from '../utils/dsa/similarity.js'
import { mergeSorted, sortByTime } from '../utils/dsa/timeline.js'
import { Types, isValidObjectId } from 'mongoose'
import { AiLogModel } from '../models/AiLogModel.js'

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
    // an Admin without ?department= sees every active technician (no load numbers)
    if (!department) {
      const all = await UserModel.find({ role: 'TECHNICIAN', isActive: true }).select('firstName lastName email department skills')
      //send res
      return res.status(200).json({ message: 'technicians fetched', payload: all })
    }
    const rows = await getTechnicianStats(department)
    const technicians = rows.map((t) => ({ _id: t.id, firstName: t.firstName, lastName: t.lastName, email: t.email, department, skills: t.skills, openTickets: t.openTickets }))
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
    const { title, description, categoryId, priority, aiLogId } = req.body ?? {}
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

    // if the form used the AI suggestion, note what it said and whether the person kept it.
    // Only the id comes from the client: the log must be this person's own classify call and
    // `acceptedByUser` is worked out here by comparing what was suggested with what was submitted
    let ai
    if (typeof aiLogId === 'string' && isValidObjectId(aiLogId)) {
      const log = await AiLogModel.findOne({ _id: aiLogId, kind: 'CLASSIFY_TICKET', requestedBy: req.user.id })
      if (log?.output) {
        const suggestedCategory = log.output.categoryId ?? undefined
        const suggestedPriority = log.output.priority ?? undefined
        ai = {
          source: log.output.source === 'ai' ? 'ai' : 'fallback',
          aiLogId: log._id,
          suggestedCategory,
          suggestedPriority,
          probableIssue: log.output.probableIssue ?? undefined,
          acceptedByUser: Boolean(suggestedCategory) && String(suggestedCategory) === String(category._id) && suggestedPriority === policy.priority,
        }
      }
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
      ...(ai ? { ai } : {}),
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

    await logAudit({ req, action: 'TICKET_CREATED', entityType: 'TICKET', entity: ticket, after: { status, priority: ticket.priority, category: String(category._id) } })

    // categories with autoAssign hand a new OPEN ticket to the best technician straight away
    const assigned = needsApproval ? null : await autoAssignTicket(ticket)

    //send res
    res.status(201).json({ message: needsApproval ? 'ticket submitted for approval' : 'ticket created', payload: toTicketView(assigned ?? ticket, req.user) })
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
      .populate('relatedAsset', 'publicId name assetClass status')
      .populate('comments.author', 'firstName lastName role')

    if (!ticket) {
      //send res
      return res.status(404).json({ message: 'ticket not found' })
    }

    // lazy SLA check — a single ticket is cheap enough to await before
    // responding, and what it changed is applied to the ticket we are about to
    // serialise, so the flags the caller sees are the up-to-date ones
    const slaChanges = await evaluateTicketSla(ticket).catch((err) => {
      console.log('lazy SLA check (detail) failed:', err.message)
      return {}
    })
    for (const [field, value] of Object.entries(slaChanges ?? {})) ticket.set(`sla.${field}`, value)

    //send res
    res.status(200).json({ message: 'ticket fetched', payload: toTicketView(ticket, req.user) })
  } catch (err) {
    next(err)
  }
})

// the ticket as the caller is allowed to see it, or null. The scope and the id
// filter are ANDed, so a staff user without a team (scope { _id: null }) matches nothing.
const findScopedTicket = (user, ticketId, select) => {
  const query = TicketModel.findOne({ $and: [buildTicketQuery(user), idOrPublicIdFilter(ticketId)] })
  return select ? query.select(select) : query
}

// DSA: top technicians for this ticket, ranked with a min-heap (lowest open load,
// then matching skills, then least recently assigned). Manager/Admin, team scoped.
ticketApp.get('/tickets/:ticketId/suggested-technicians', verifyToken('MANAGER', 'ADMIN'), async (req, res, next) => {
  try {
    const ticket = await findScopedTicket(req.user, req.params.ticketId, 'department category publicId')
    if (!ticket) {
      //send res
      return res.status(404).json({ message: 'ticket not found' })
    }
    const category = await CategoryModel.findById(ticket.category).select('skills')
    const wanted = category?.skills ?? []
    const technicians = await getTechnicianStats(ticket.department)
    const ranked = rankTechnicians(technicians, wanted, 5).map((t, index) => ({
      _id: t.id,
      firstName: t.firstName,
      lastName: t.lastName,
      email: t.email,
      skills: t.skills,
      openTickets: t.openTickets,
      matchedSkills: matchedSkills(t, wanted),
      lastAssignedAt: t.lastAssignedAt,
      recommended: index === 0,
    }))
    //send res
    res.status(200).json({ message: 'suggested technicians fetched', payload: ranked })
  } catch (err) {
    next(err)
  }
})

// DSA: similar tickets by Jaccard similarity of their words (titles count double,
// resolved tickets contribute their resolution summary). Staff only, team scoped.
const SIMILAR_CANDIDATES = 300
ticketApp.get('/tickets/:ticketId/similar', verifyToken('TECHNICIAN', 'MANAGER', 'ADMIN'), async (req, res, next) => {
  try {
    const ticket = await findScopedTicket(req.user, req.params.ticketId, 'title description publicId')
    if (!ticket) {
      //send res
      return res.status(404).json({ message: 'ticket not found' })
    }
    const candidates = await TicketModel.find({ $and: [buildTicketQuery(req.user), { _id: { $ne: ticket._id } }] })
      .select('publicId title description status priority resolution.summary createdAt')
      .sort({ createdAt: -1 })
      .limit(SIMILAR_CANDIDATES)
      .lean()
    const matches = findSimilar(ticket, candidates, { threshold: 0.2, limit: 5 }).map(({ ticket: t, score }) => ({
      publicId: t.publicId,
      title: t.title,
      status: t.status,
      priority: t.priority,
      score: Math.round(score * 100) / 100,
      resolutionSummary: t.resolution?.summary ? t.resolution.summary.slice(0, 200) : undefined,
    }))
    //send res
    res.status(200).json({ message: 'similar tickets fetched', payload: matches })
  } catch (err) {
    next(err)
  }
})

// DSA: one chronological timeline of status changes, comments and work logs,
// built with a k-way heap merge of the three already-sorted lists. Internal notes
// only for people who may see them; work logs only for the ticket's own team and Admin.
ticketApp.get('/tickets/:ticketId/timeline', verifyToken(...ALL_ROLES), async (req, res, next) => {
  try {
    const ticket = await findScopedTicket(req.user, req.params.ticketId)
    if (!ticket) {
      //send res
      return res.status(404).json({ message: 'ticket not found' })
    }
    const staff = canSeeInternal(ticket, req.user)
    const workLogs = staff ? await WorkLogModel.find({ ticket: ticket._id }).lean() : []

    const people = new Set()
    ticket.statusHistory.forEach((h) => h.by && people.add(String(h.by)))
    ticket.comments.forEach((c) => people.add(String(c.author)))
    workLogs.forEach((w) => people.add(String(w.technician)))
    const users = await UserModel.find({ _id: { $in: [...people] } }).select('firstName lastName role').lean()
    const nameOf = new Map(users.map((u) => [String(u._id), { name: fullName(u), role: u.role }]))
    const who = (id) => (id ? nameOf.get(String(id)) ?? null : null)

    const history = ticket.statusHistory.map((h) => ({ type: 'STATUS', at: h.at, by: who(h.by), from: h.from, to: h.to, note: h.note }))
    const comments = ticket.comments
      .filter((c) => staff || !c.isInternal)
      .map((c) => ({ type: c.isInternal ? 'INTERNAL_NOTE' : 'COMMENT', at: c.createdAt, by: who(c.author), text: c.text }))
    const logs = workLogs.map((w) => ({ type: 'WORK_LOG', at: w.createdAt, by: who(w.technician), text: w.description, minutesSpent: w.minutesSpent }))

    const events = mergeSorted([sortByTime(history), sortByTime(comments), sortByTime(logs)])
    //send res
    res.status(200).json({ message: 'timeline fetched', payload: events })
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
// no comment or work log can be added once the ticket is finished (RESOLVED still
// allows a reply, because the requester may answer before confirming or reopening)
const FINISHED_STATUSES = ['CLOSED', 'CANCELLED', 'REJECTED']
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
    await logAudit({ req, action: 'TICKET_PRIORITY_CHANGED', entityType: 'TICKET', entity: result.doc, before: { priority: previousPriority, version }, after: { priority: result.doc.priority, version: result.doc.version } })
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

    // the audit row names assets by their public id, not the raw _id
    const before = ticket.relatedAsset ? ((await AssetModel.findById(ticket.relatedAsset).select('publicId').lean())?.publicId ?? String(ticket.relatedAsset)) : null
    if (!assetId) {
      ticket.relatedAsset = undefined
      await ticket.save()
      if (before) await logAudit({ req, action: 'TICKET_ASSET_UNLINKED', entityType: 'TICKET', entity: ticket, before: { relatedAsset: before } })
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
    await logAudit({ req, action: 'TICKET_ASSET_LINKED', entityType: 'TICKET', entity: ticket, before: { relatedAsset: before }, after: { relatedAsset: asset.publicId } })
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
      const closedAt = ticket.closedAt ?? ticket.resolution?.confirmedAt // confirmedAt covers tickets closed before closedAt existed
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
    // the line the timeline shows next to the status change: the caller's note, or a default that says what happened
    let historyNote = note
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
      historyNote = note || `${action === 'reassign' ? 'reassigned' : 'assigned'} to ${fullName(technician)}`
      set.assignedTo = technician._id
      set.assignedBy = req.user.id
      set.assignedAt = now
      set.assignmentMethod = 'MANUAL'
      notifications.push({ user: technician._id, type: 'TICKET_ASSIGNED', message: `Ticket ${ticket.publicId} was assigned to you` })
      if (action === 'reassign' && previousAssignee && previousAssignee.toString() !== technician._id.toString()) {
        notifications.push({ user: previousAssignee, type: 'STATUS_CHANGED', message: `Ticket ${ticket.publicId} was reassigned to someone else` })
      }
    }
    if (action === 'claim') {
      set.assignedTo = req.user.id
      set.assignedBy = req.user.id
      set.assignedAt = now
      set.assignmentMethod = 'CLAIM'
    }
    if (action === 'start' && !ticket.sla.firstRespondedAt) {
      set['sla.firstRespondedAt'] = now
    }
    if (action === 'hold') {
      set['sla.pausedAt'] = now
      notifications.push({ user: ticket.requester, type: 'TICKET_ON_HOLD', message: `Ticket ${ticket.publicId} was put on hold: ${note}` })
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
      historyNote = note || resolutionSummary
      set['resolution.resolvedBy'] = req.user.id
      set['resolution.resolvedAt'] = now
      notifications.push({ user: ticket.requester, type: 'RESOLUTION_PENDING', message: `Ticket ${ticket.publicId} was marked resolved — please confirm` })
    }
    if (action === 'confirm') {
      set['resolution.confirmedByRequester'] = true
      set['resolution.confirmedAt'] = now
      set.closeReason = 'CONFIRMED'
      set.closedAt = now
      if (ticket.assignedTo) {
        notifications.push({ user: ticket.assignedTo, type: 'TICKET_CLOSED', message: `Ticket ${ticket.publicId} was confirmed and closed by the requester` })
      }
    }
    if (action === 'reopen') {
      // new SLA cycle from now — response SLA isn't re-run (first response
      // already happened), only resolutionDueAt/warnAt restart; a breach
      // from the cycle that just ended is banked into pastBreaches
      // the policy the ticket was already running on, even if an admin switched that priority off since;
      // only a ticket with no stored policy falls back to the active one for its priority
      const policy = (ticket.sla.policy ? await SLAPolicyModel.findById(ticket.sla.policy) : null)
        ?? await SLAPolicyModel.findOne({ priority: ticket.priority, isActive: true })
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
      unset.closeReason = '' // the old csat stays until a new rating overwrites it
      unset.closedAt = ''
      if (ticket.assignedTo) {
        notifications.push({ user: ticket.assignedTo, type: 'TICKET_REOPENED', message: `Ticket ${ticket.publicId} was reopened: ${note}` })
      }
    }

    const result = await atomicTransition({
      Model: TicketModel, doc: ticket, action, noun: 'ticket', from: TRANSITIONS[action].from, version,
      set, unset,
      push: { statusHistory: { from, to: check.to ?? from, by: req.user.id, note: historyNote, at: now } },
    })
    if (result.error) {
      //send res
      return res.status(result.error.status).json({ message: result.error.message })
    }

    await logAudit({
      req, action: `TICKET_${action.toUpperCase()}`, entityType: 'TICKET', entity: result.doc,
      before: { status: from, assignedTo: ticket.assignedTo ? String(ticket.assignedTo) : null, version },
      after: { status: result.doc.status, assignedTo: result.doc.assignedTo ? String(result.doc.assignedTo) : null, version: result.doc.version, ...(note ? { note } : {}) },
    })
    // notifications follow the main write; a failure is logged inside createNotification, never fatal
    await Promise.all(notifications.map((n) => createNotification({ ...n, link: `/tickets/${ticket.publicId}` })))

    // an approved ticket is OPEN now, so an autoAssign category assigns it like a new one
    const assigned = action === 'approve' ? await autoAssignTicket(result.doc) : null

    //send res
    res.status(200).json({ message: `ticket ${action} succeeded`, payload: toTicketView(assigned ?? result.doc, req.user) })
  } catch (err) {
    next(err)
  }
})

// comments (§6b): public comments from the requester, the assigned technician,
// the team Manager and Admin; any other technician of the team may add internal
// notes only. Nothing can be added to a CLOSED/CANCELLED/REJECTED ticket.
// A comment is one atomic $push and does not bump `version` (it is not a status
// change, so it must not make a concurrent transition fail with 409).
ticketApp.post('/tickets/:ticketId/comments', verifyToken(...ALL_ROLES), async (req, res, next) => {
  try {
    const { text, isInternal } = req.body ?? {}
    if (typeof text !== 'string' || !text.trim()) {
      //send res
      return res.status(400).json({ message: 'comment text is required' })
    }
    if (text.length > 2000) {
      //send res
      return res.status(400).json({ message: 'comment must be 2000 characters or fewer' })
    }
    const ticket = await TicketModel.findOne({ ...idOrPublicIdFilter(req.params.ticketId), isDeleted: false })
    if (!ticket) {
      //send res
      return res.status(404).json({ message: 'ticket not found' })
    }
    const isRequester = req.user.id === ticket.requester.toString()
    const isAssignee = req.user.id === ticket.assignedTo?.toString()
    const isTeamStaff = (req.user.role === 'TECHNICIAN' || req.user.role === 'MANAGER') && req.user.department === ticket.department.toString()
    const isAdmin = req.user.role === 'ADMIN'
    if (!isRequester && !isAssignee && !isTeamStaff && !isAdmin) {
      //send res
      return res.status(403).json({ message: 'not authorized to comment on this ticket' })
    }
    // employees can never post internal notes
    const internal = req.user.role === 'EMPLOYEE' ? false : Boolean(isInternal)
    // a team technician who is not assigned may only leave internal notes
    const mayPostPublic = isRequester || isAssignee || isAdmin || (isTeamStaff && req.user.role === 'MANAGER')
    if (!internal && !mayPostPublic) {
      //send res
      return res.status(403).json({ message: 'only the assigned technician, the team manager or an admin can reply publicly; you can add an internal note' })
    }
    if (FINISHED_STATUSES.includes(ticket.status)) {
      //send res
      return res.status(400).json({ message: `cannot comment on a ${ticket.status} ticket` })
    }

    const comment = { _id: new Types.ObjectId(), author: req.user.id, text: text.trim(), isInternal: internal, createdAt: new Date(), updatedAt: new Date() }
    const written = await TicketModel.updateOne(
      { _id: ticket._id, isDeleted: false, status: { $nin: FINISHED_STATUSES } },
      { $push: { comments: comment } },
    )
    if (written.matchedCount === 0) {
      //send res
      return res.status(409).json({ message: 'ticket changed while you were commenting, please refresh' })
    }

    // the assigned technician's first public reply is the "first response"
    // for the response SLA; the filter keeps the earliest time
    if (isAssignee && !internal && !ticket.sla?.firstRespondedAt) {
      await TicketModel.updateOne({ _id: ticket._id, 'sla.firstRespondedAt': { $exists: false } }, { $set: { 'sla.firstRespondedAt': new Date() } })
    }

    // who hears about it: public -> the other side; internal -> the assignee only
    const recipients = internal
      ? [ticket.assignedTo]
      : [ticket.requester, ticket.assignedTo]
    const link = `/tickets/${ticket.publicId}`
    await Promise.all(recipients
      .filter((id) => id && id.toString() !== req.user.id)
      .map((id) => createNotification({ user: id, type: 'COMMENT_ADDED', message: `New ${internal ? 'internal note' : 'comment'} on ticket ${ticket.publicId}`, link })))
    await logAudit({ req, action: 'TICKET_COMMENT_ADDED', entityType: 'TICKET', entity: ticket, after: { commentId: String(comment._id), isInternal: internal } })

    //send res
    res.status(201).json({ message: 'comment added', payload: comment })
  } catch (err) {
    next(err)
  }
})

// CSAT: only the requester, only while the ticket is CLOSED with
// closeReason CONFIRMED, once per closure. After a reopen and a new closure the
// requester can rate again and the new rating overwrites the old one.
ticketApp.post('/tickets/:ticketId/csat', verifyToken(...ALL_ROLES), async (req, res, next) => {
  try {
    const { rating, comment } = req.body ?? {}
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      //send res
      return res.status(400).json({ message: 'rating must be a whole number from 1 to 5' })
    }
    if (comment !== undefined && comment !== null && (typeof comment !== 'string' || comment.length > 500)) {
      //send res
      return res.status(400).json({ message: 'comment must be text of 500 characters or fewer' })
    }
    const ticket = await TicketModel.findOne({ ...idOrPublicIdFilter(req.params.ticketId), isDeleted: false })
    if (!ticket || ticket.requester.toString() !== req.user.id) {
      // another user's ticket looks exactly like a missing one
      //send res
      return res.status(404).json({ message: 'ticket not found' })
    }
    if (ticket.status !== 'CLOSED' || ticket.closeReason !== 'CONFIRMED' || !ticket.closedAt) {
      //send res
      return res.status(400).json({ message: 'you can rate a ticket once it is closed' })
    }
    if (ticket.csat?.submittedAt && ticket.csat.submittedAt >= ticket.closedAt) {
      //send res
      return res.status(409).json({ message: 'you already rated this ticket' })
    }

    const csat = { rating, submittedAt: new Date() }
    if (typeof comment === 'string' && comment.trim()) csat.comment = comment.trim()
    // the filter pins the closure we just read, so a reopen or a second
    // rating arriving at the same moment cannot be overwritten silently
    const written = await TicketModel.findOneAndUpdate(
      {
        _id: ticket._id, isDeleted: false, status: 'CLOSED', closeReason: 'CONFIRMED', closedAt: ticket.closedAt,
        $or: [{ 'csat.submittedAt': { $exists: false } }, { 'csat.submittedAt': { $lt: ticket.closedAt } }],
      },
      { $set: { csat } },
      { returnDocument: 'after', runValidators: true },
    )
    if (!written) {
      //send res
      return res.status(409).json({ message: 'ticket changed, please refresh' })
    }
    await logAudit({ req, action: 'TICKET_CSAT', entityType: 'TICKET', entity: written, after: { rating } })
    //send res
    res.status(201).json({ message: 'thank you for your feedback', payload: toTicketView(written, req.user) })
  } catch (err) {
    next(err)
  }
})
