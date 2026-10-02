import { styles, statusColors, priorityColors } from '../../styles/common.js'
import { getSlaStatus } from '../../utils/sla.js'

export const StatusBadge = ({ status }) => (
  <span className={`${styles.badge} ${statusColors[status] || 'bg-slate-100 text-slate-600'}`}>{status}</span>
)

export const PriorityBadge = ({ priority }) => (
  <span className={`${styles.badge} ${priorityColors[priority] || 'bg-slate-100 text-slate-600'}`}>{priority}</span>
)

// derived from the ticket's own due dates (see utils/sla.js), so it is always live
export const SLABadge = ({ ticket }) => {
  const sla = getSlaStatus(ticket)
  if (!sla) return <span className="text-slate-300 text-xs">—</span>
  return <span className={`${styles.badge} ${sla.className}`}>{sla.label}</span>
}
