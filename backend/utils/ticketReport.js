import { APP_UTC_OFFSET_MINUTES } from './timezone.js'
import { responseOutcome, resolutionOutcome } from './slaOutcome.js'
import { fullName } from './dashboardStats.js'

// the flat ticket row used by the report preview and the CSV export, so both show the same
// columns. Deliberately has no comments, internal notes or AI notes: an export must never
// carry more than the ticket list does.

const IST_MS = APP_UTC_OFFSET_MINUTES * 60000
// "2026-10-03 14:05" in IST, the zone the SLA clocks run in
export const formatIst = (date) => (date ? new Date(date.getTime() + IST_MS).toISOString().slice(0, 16).replace('T', ' ') : '')

const LABELS = { MET: 'Met', MISSED: 'Missed', PENDING: 'Pending', BREACHED: 'Breached', AT_RISK: 'At risk', ON_TRACK: 'On track', ON_HOLD: 'On hold', NONE: '' }

// `requester`, `assignedTo`, `category` and `department` come populated
export const toTicketReportRow = (ticket, now = new Date()) => ({
  _id: String(ticket._id),
  publicId: ticket.publicId,
  title: ticket.title,
  type: ticket.type,
  category: ticket.category?.name ?? '',
  team: ticket.department?.name ?? '',
  priority: ticket.priority,
  status: ticket.status,
  requester: fullName(ticket.requester),
  assignedTo: ticket.assignedTo ? fullName(ticket.assignedTo) : '',
  createdAt: formatIst(ticket.createdAt),
  firstResponseAt: formatIst(ticket.sla?.firstRespondedAt),
  resolvedAt: formatIst(ticket.resolution?.resolvedAt),
  closedAt: formatIst(ticket.closedAt),
  responseDueAt: formatIst(ticket.sla?.responseDueAt),
  resolutionDueAt: formatIst(ticket.sla?.resolutionDueAt),
  responseSla: LABELS[responseOutcome(ticket, now)],
  resolutionSla: LABELS[resolutionOutcome(ticket, now)],
  reopenCount: ticket.reopenCount || 0,
  csatRating: ticket.csat?.rating ?? '',
  closeReason: ticket.closeReason ?? '',
})

export const TICKET_REPORT_COLUMNS = [
  { key: 'publicId', header: 'Ticket ID' },
  { key: 'title', header: 'Title' },
  { key: 'type', header: 'Type' },
  { key: 'category', header: 'Category' },
  { key: 'team', header: 'Team' },
  { key: 'priority', header: 'Priority' },
  { key: 'status', header: 'Status' },
  { key: 'requester', header: 'Requester' },
  { key: 'assignedTo', header: 'Assigned to' },
  { key: 'createdAt', header: 'Created (IST)' },
  { key: 'firstResponseAt', header: 'First response (IST)' },
  { key: 'resolvedAt', header: 'Resolved (IST)' },
  { key: 'closedAt', header: 'Closed (IST)' },
  { key: 'responseDueAt', header: 'Response due (IST)' },
  { key: 'resolutionDueAt', header: 'Resolution due (IST)' },
  { key: 'responseSla', header: 'Response SLA' },
  { key: 'resolutionSla', header: 'Resolution SLA' },
  { key: 'reopenCount', header: 'Reopened' },
  { key: 'csatRating', header: 'CSAT' },
  { key: 'closeReason', header: 'Close reason' },
]
