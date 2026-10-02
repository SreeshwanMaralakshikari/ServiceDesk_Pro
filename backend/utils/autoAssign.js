import { TicketModel } from '../models/TicketModel.js'
import { CategoryModel } from '../models/CategoryModel.js'
import { atomicTransition } from './atomicTransition.js'
import { getTechnicianStats } from './technicianStats.js'
import { pickTechnician } from './dsa/techHeap.js'
import { createNotification } from './createNotification.js'
import { logAudit } from './logAudit.js'

// Assigns a fresh OPEN ticket to the best technician of its team when the
// category has autoAssign switched on. It never throws and never blocks the
// caller: anything unexpected returns null and the ticket just stays OPEN for
// a manager or a technician to pick up.
// Returns the updated ticket document, or null when nothing was assigned.
export const autoAssignTicket = async (ticket) => {
  try {
    if (!ticket || ticket.status !== 'OPEN' || ticket.assignedTo) return null
    const category = await CategoryModel.findById(ticket.category).select('autoAssign skills')
    if (!category?.autoAssign) return null

    const technicians = await getTechnicianStats(ticket.department)
    const chosen = pickTechnician(technicians, category.skills || [])
    if (!chosen) return null

    const now = new Date()
    // OPEN -> ASSIGNED through the same atomic path as a manual assign, so a
    // manager or technician who grabs the ticket at the same moment wins cleanly
    const result = await atomicTransition({
      Model: TicketModel, doc: ticket, action: 'auto-assign', noun: 'ticket', from: ['OPEN'], version: ticket.version,
      set: { status: 'ASSIGNED', assignedTo: chosen.id, assignedAt: now, assignmentMethod: 'AUTO' },
      push: { statusHistory: { from: 'OPEN', to: 'ASSIGNED', note: `auto-assigned to ${chosen.firstName} ${chosen.lastName}`, at: now } },
    })
    if (result.error) return null

    await createNotification({ user: chosen.id, type: 'TICKET_ASSIGNED', message: `Ticket ${ticket.publicId} was assigned to you`, link: `/tickets/${ticket.publicId}` })
    await logAudit({
      action: 'TICKET_AUTO_ASSIGNED', entityType: 'TICKET', entity: result.doc,
      before: { status: 'OPEN', assignedTo: null },
      after: { status: 'ASSIGNED', assignedTo: chosen.id, openTicketsBefore: chosen.openTickets, matchedSkills: chosen.matched },
    })
    return result.doc
  } catch (err) {
    console.log('auto-assign failed:', err.message)
    return null
  }
}
