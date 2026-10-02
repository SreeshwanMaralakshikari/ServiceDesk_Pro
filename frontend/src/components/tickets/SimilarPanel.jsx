import { Link } from 'react-router-dom'
import { useFetch } from '../../hooks/useFetch.js'
import { styles } from '../../styles/common.js'
import { StatusBadge } from '../common/Badges.jsx'

// staff only: other tickets of the same team whose words overlap with this one
// (Jaccard similarity, computed on the server). Resolved ones show how they were fixed.
export const SimilarPanel = ({ ticket }) => {
  const { data, error } = useFetch(`/ticket-api/tickets/${ticket.publicId}/similar`)
  if (error || !data || data.length === 0) return null
  return (
    <div className="mb-6 border-t border-slate-100 pt-4">
      <h2 className={styles.h2}>Similar tickets</h2>
      <ul className="space-y-2">
        {data.map((t) => (
          <li key={t.publicId}>
            <Link to={`/tickets/${t.publicId}`} className="block rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-indigo-700"><span className="font-mono text-xs text-slate-400 mr-2">{t.publicId}</span>{t.title}</p>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusBadge status={t.status} />
                  <span className="text-xs text-slate-400" title="Jaccard similarity">{Math.round(t.score * 100)}% match</span>
                </div>
              </div>
              {t.resolutionSummary && <p className="text-xs text-slate-500 mt-1">Fix: {t.resolutionSummary}</p>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
