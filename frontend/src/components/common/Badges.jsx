import { styles, statusColors, priorityColors, assetStatusColors, kbStatusColors, roleColors } from '../../styles/common.js'
import { getSlaStatus } from '../../utils/sla.js'
import { statusLabel, priorityLabel, assetStatusLabel, kbStatusLabel, roleLabel } from '../../utils/labels.js'

const FALLBACK = 'bg-slate-100 text-slate-600'

// one pill: a small dot in the text colour, then the readable label. The raw
// code stays available as `data-code` (handy in tests and the browser inspector)
const Pill = ({ code, colors, toLabel, dot = true }) => (
  <span className={`${styles.badge} gap-1.5 whitespace-nowrap ${colors[code] || FALLBACK}`} data-code={code}>
    {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />}
    {toLabel(code)}
  </span>
)

export const StatusBadge = ({ status }) => <Pill code={status} colors={statusColors} toLabel={statusLabel} />

export const PriorityBadge = ({ priority }) => <Pill code={priority} colors={priorityColors} toLabel={priorityLabel} dot={false} />

export const AssetStatusBadge = ({ status }) => <Pill code={status} colors={assetStatusColors} toLabel={assetStatusLabel} />

export const KbStatusBadge = ({ status }) => <Pill code={status} colors={kbStatusColors} toLabel={kbStatusLabel} />

export const RoleBadge = ({ role }) => <Pill code={role} colors={roleColors} toLabel={roleLabel} dot={false} />

// derived from the ticket's own due dates (see utils/sla.js), so it is always live
export const SLABadge = ({ ticket }) => {
  const sla = getSlaStatus(ticket)
  if (!sla) return <span className="text-slate-300 text-xs">—</span>
  return <span className={`${styles.badge} whitespace-nowrap ${sla.className}`}>{sla.label}</span>
}
