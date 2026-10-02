import { UserModel } from '../models/UserModel.js'
import { TicketModel } from '../models/TicketModel.js'
import { TECH_ACTIVE_STATUSES } from './ticketStatuses.js'

const LAST_ASSIGNED_SCAN = 500

// Active technicians of one department with their current load, in three queries
// (one find, one aggregate, one bounded find) no matter how many technicians there are.
// Returns plain rows: { id, firstName, lastName, email, skills, openTickets, lastAssignedAt }
export const getTechnicianStats = async (department) => {
  if (!department) return []
  const technicians = await UserModel.find({ role: 'TECHNICIAN', isActive: true, department }).select('firstName lastName email skills')
  if (technicians.length === 0) return []

  const ids = technicians.map((t) => t._id)
  // one $group for the load and one bounded find for the last assignment (plain operators only, so it runs on any MongoDB-compatible server)
  const [loadRows, lastRows] = await Promise.all([
    TicketModel.aggregate([
      { $match: { assignedTo: { $in: ids }, isDeleted: false, status: { $in: TECH_ACTIVE_STATUSES } } },
      { $group: { _id: '$assignedTo', openTickets: { $sum: 1 } } },
    ]),
    // newest assignments first; the first row seen per technician is their latest (bounded read)
    TicketModel.find({ assignedTo: { $in: ids }, assignedAt: { $exists: true } })
      .select('assignedTo assignedAt').sort({ assignedAt: -1 }).limit(LAST_ASSIGNED_SCAN).lean(),
  ])
  const load = new Map(loadRows.map((r) => [String(r._id), r.openTickets]))
  const last = new Map()
  for (const row of lastRows) if (!last.has(String(row.assignedTo))) last.set(String(row.assignedTo), row.assignedAt)

  return technicians.map((t) => ({
    id: String(t._id),
    firstName: t.firstName,
    lastName: t.lastName,
    email: t.email,
    skills: t.skills || [],
    openTickets: load.get(String(t._id)) ?? 0,
    lastAssignedAt: last.get(String(t._id)) ?? null,
  }))
}
