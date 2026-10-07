import { History } from 'lucide-react'
import { useFetch } from '../../hooks/useFetch.js'
import { styles } from '../../styles/common.js'
import { statusLabel, priorityLabel, roleLabel } from '../../utils/labels.js'

const describe = (e) => {
  const { before, after } = e
  if (before?.status && after?.status && before.status !== after.status) return `${statusLabel(before.status)} → ${statusLabel(after.status)}`
  if (before?.priority && after?.priority) return `priority ${priorityLabel(before.priority)} → ${priorityLabel(after.priority)}`
  if (after?.rating) return `rated ${after.rating}/5`
  if (after?.minutesSpent) return `${after.minutesSpent} min`
  if (after?.isInternal !== undefined) return after.isInternal ? 'internal note' : 'public comment'
  return ''
}

// Admin only: who did what to this ticket, newest first (read from the audit log)
export const AuditPanel = ({ ticket }) => {
  const { data, loading, error } = useFetch(`/admin-api/audit-logs`, { entityRef: ticket.publicId, limit: 50 })
  if (error) return null
  return (
    <section className={styles.card} aria-label="Audit trail">
      <h2 className={styles.h2 + ' flex items-center gap-2'}><History className="h-4 w-4 text-slate-400" aria-hidden="true" />Audit trail</h2>
      {loading && !data && <p className="text-sm text-slate-400">Loading…</p>}
      {data?.items?.length === 0 && <p className="text-sm text-slate-400">No entries.</p>}
      <ul className="space-y-1">
        {data?.items?.map((e) => (
          <li key={e._id} className="text-xs text-slate-600 flex flex-wrap gap-x-3">
            <span className="text-slate-400 whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</span>
            <span className="font-mono">{e.action}</span>
            <span>{e.actor ? `${e.actor.firstName ?? ''} (${roleLabel(e.actor.role)})` : 'system'}</span>
            <span className="text-slate-500">{describe(e)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
