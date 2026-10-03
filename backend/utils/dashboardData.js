import { TicketModel } from '../models/TicketModel.js'
import { UserModel } from '../models/UserModel.js'
import { CategoryModel } from '../models/CategoryModel.js'
import { DepartmentModel } from '../models/DepartmentModel.js'
import { SLAPolicyModel } from '../models/SLAPolicyModel.js'
import { getOrgSettings } from '../models/OrgSettingsModel.js'
import { buildTicketQuery } from './buildTicketQuery.js'
import { buildDashboard } from './dashboardStats.js'

// loads what buildDashboard needs. The ticket query is buildTicketQuery, the same scope-then-filter
// builder as the ticket list, so a manager's dashboard can never include a ticket the list would hide.

// a dashboard looks at no more than this many tickets (newest first); `truncated` says when it was cut
// (REPORT_ROW_CAP lets a test lower it)
export const ROW_CAP = Number.parseInt(process.env.REPORT_ROW_CAP, 10) || 5000

// only what the numbers need: no comments, no AI notes, no descriptions
const TICKET_FIELDS = 'status priority department category assignedTo createdAt closedAt closeReason csat reopenCount sla resolution'

export const loadScopedTickets = async (query, { fields = TICKET_FIELDS } = {}) => {
  const rows = await TicketModel.find(query).select(fields).sort({ createdAt: -1, _id: -1 }).limit(ROW_CAP + 1).lean()
  const truncated = rows.length > ROW_CAP
  return { tickets: truncated ? rows.slice(0, ROW_CAP) : rows, truncated }
}

export const loadPolicies = () => SLAPolicyModel.find().lean()
export const loadBusinessHours = async () => (await getOrgSettings()).toObject().businessHours

// the dashboard for a MANAGER (their team only) or an ADMIN (every team, or one team via `department`)
export const loadDashboard = async ({ user, days, department }) => {
  const query = buildTicketQuery(user, {})
  const technicianFilter = { role: 'TECHNICIAN', isActive: true }
  if (user.role === 'ADMIN') {
    if (department) {
      query.department = department
      technicianFilter.department = department
    }
  } else if (user.department) {
    technicianFilter.department = user.department
  } else {
    technicianFilter._id = null // a manager without a team has no technicians to show
  }

  const [{ tickets, truncated }, policies, settings, technicians, categories, departments] = await Promise.all([
    loadScopedTickets(query),
    loadPolicies(),
    loadBusinessHours(),
    UserModel.find(technicianFilter).select('firstName lastName department').lean(),
    CategoryModel.find().select('name').lean(),
    DepartmentModel.find().select('name').lean(),
  ])

  const teamId = user.role === 'ADMIN' ? department : user.department
  const team = teamId ? departments.find((d) => String(d._id) === String(teamId)) : null
  return buildDashboard({
    tickets, policies, settings, technicians, categories, departments, days, truncated,
    department: team ? { _id: String(team._id), name: team.name } : null,
  })
}
