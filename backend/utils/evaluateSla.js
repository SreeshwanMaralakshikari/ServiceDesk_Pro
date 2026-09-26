import { TicketModel } from '../models/TicketModel.js'
import { UserModel } from '../models/UserModel.js'
import { createNotification, notifyMany } from './createNotification.js'

// SLA clock only actually runs in these statuses (Section 6b): not while
// PENDING_APPROVAL (no clock yet), not while ON_HOLD (paused), and not in
// any terminal state.
export const SLA_RUNNING_STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'REOPENED']

// a populated ticket may have assignedTo as a populated doc — normalize
// back to a plain id before using it as a notification recipient
const idOf = (value) => value?._id ?? value

/**
 * Single source of SLA-breach/warning logic, called by both the cron job
 * and the lazy check on ticket fetch. Every write is a conditional
 * updateOne guarded on the flag still being false, so running this twice
 * (cron + lazy check racing, or the cron catching up after Render's free
 * tier wakes from sleep) never sends a duplicate notification.
 */
export const evaluateTicketSla = async (ticket) => {
  if (!SLA_RUNNING_STATUSES.includes(ticket.status)) return
  const sla = ticket.sla || {}
  const now = new Date()
  let resolutionJustBreached = false // tracks a breach found in step 2, since `sla` is a stale snapshot within this same call

  // 1. response breach — only while nobody has responded yet
  if (sla.responseDueAt && !sla.firstRespondedAt && !sla.responseBreached && now > sla.responseDueAt) {
    const result = await TicketModel.updateOne(
      { _id: ticket._id, 'sla.responseBreached': false },
      { $set: { 'sla.responseBreached': true, 'sla.escalationLevel': Math.max(sla.escalationLevel || 0, 1) } }
    )
    if (result.modifiedCount) {
      const managers = await UserModel.find({ role: 'MANAGER', department: ticket.department, isActive: true }).select('_id')
      const recipients = managers.map((m) => m._id)
      await notifyMany(recipients, { type: 'SLA_BREACHED', message: `Response SLA breached for ${ticket.publicId}`, link: `/tickets/${ticket.publicId}` })
      await notifyMany(recipients, { type: 'ESCALATED', message: `Ticket ${ticket.publicId} escalated after a response-SLA breach`, link: `/tickets/${ticket.publicId}` })
    }
  }

  // 2. resolution breach — the bigger escalation, reaches Admins too
  if (sla.resolutionDueAt && !sla.resolutionBreached && now > sla.resolutionDueAt) {
    const result = await TicketModel.updateOne(
      { _id: ticket._id, 'sla.resolutionBreached': false },
      { $set: { 'sla.resolutionBreached': true, 'sla.escalationLevel': 2 } }
    )
    if (result.modifiedCount) {
      resolutionJustBreached = true
      const [managers, admins] = await Promise.all([
        UserModel.find({ role: 'MANAGER', department: ticket.department, isActive: true }).select('_id'),
        UserModel.find({ role: 'ADMIN', isActive: true }).select('_id'),
      ])
      const recipients = [...managers.map((m) => m._id), ...admins.map((a) => a._id)]
      await notifyMany(recipients, { type: 'SLA_BREACHED', message: `Resolution SLA breached for ${ticket.publicId}`, link: `/tickets/${ticket.publicId}` })
      await notifyMany(recipients, { type: 'ESCALATED', message: `Ticket ${ticket.publicId} escalated after a resolution-SLA breach`, link: `/tickets/${ticket.publicId}` })
    }
  }

  // 3. 75%-of-window warning — moot once resolution-breached, including a
  // breach that was just recorded in step 2 above within this same call
  if (sla.warnAt && !sla.warningSent && !sla.resolutionBreached && !resolutionJustBreached && now > sla.warnAt) {
    const result = await TicketModel.updateOne(
      { _id: ticket._id, 'sla.warningSent': false },
      { $set: { 'sla.warningSent': true } }
    )
    if (result.modifiedCount) {
      const assignedTo = idOf(ticket.assignedTo)
      if (assignedTo) {
        await createNotification({ user: assignedTo, type: 'SLA_WARNING', message: `Ticket ${ticket.publicId} is approaching its SLA deadline`, link: `/tickets/${ticket.publicId}` })
      } else {
        const managers = await UserModel.find({ role: 'MANAGER', department: ticket.department, isActive: true }).select('_id')
        await notifyMany(managers.map((m) => m._id), { type: 'SLA_WARNING', message: `Unassigned ticket ${ticket.publicId} is approaching its SLA deadline`, link: `/tickets/${ticket.publicId}` })
      }
    }
  }
}

export const evaluateManyTicketsSla = async (tickets) => {
  await Promise.all(tickets.filter((t) => SLA_RUNNING_STATUSES.includes(t.status)).map(evaluateTicketSla))
}
