import { Link } from 'react-router-dom'
import { Layers } from 'lucide-react'
import { useFetch } from '../../hooks/useFetch.js'
import { styles } from '../../styles/common.js'
import { StatusBadge } from '../common/Badges.jsx'

// staff only: other tickets of the same team whose words overlap with this one
// (Jaccard similarity, computed on the server). Resolved ones show how they were fixed.
export const SimilarPanel = ({ ticket }) => {
  const { data, error } = useFetch(`/ticket-api/tickets/${ticket.publicId}/similar`)
  if (error || !data || data.length === 0) return null
  return (
    <section className={styles.card} aria-label="Similar tickets">
      <h2 className={styles.h2 + ' flex items-center gap-2'}><Layers className="h-4 w-4 text-slate-400" aria-hidden="true" />Similar tickets</h2>
      <ul className="space-y-2">
        {data.map((t) => (
          <li key={t.publicId}>
            <Link to={`/tickets/${t.publicId}`} className="block rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-indigo-700"><span className="block font-mono text-xs text-slate-400">{t.publicId}</span>{t.title}</p>
                <div className="flex items-center gap-2">
                  <StatusBadge status={t.status} />
                  <span className="text-xs text-slate-400" title="Jaccard similarity">{Math.round(t.score * 100)}% match</span>
                </div>
              </div>
              {t.resolutionSummary && <p className="text-xs text-slate-500 mt-1">Fix: {t.resolutionSummary}</p>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
