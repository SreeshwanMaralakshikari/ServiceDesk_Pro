import { useFetch } from '../../hooks/useFetch.js'
import { styles } from '../../styles/common.js'

const KIND = {
  STATUS: { label: 'Status', dot: 'bg-indigo-400', box: 'bg-white border border-slate-200' },
  COMMENT: { label: 'Comment', dot: 'bg-slate-400', box: 'bg-slate-50' },
  INTERNAL_NOTE: { label: 'Internal note', dot: 'bg-amber-400', box: 'bg-amber-50 border border-amber-200' },
  WORK_LOG: { label: 'Work log', dot: 'bg-emerald-400', box: 'bg-emerald-50 border border-emerald-200' },
}

const describe = (e) => {
  if (e.type === 'STATUS') {
    const move = e.from && e.from !== e.to ? `${e.from} → ${e.to}` : e.to
    return e.note ? `${move}: ${e.note}` : move
  }
  if (e.type === 'WORK_LOG') return `${e.text} (${e.minutesSpent} min)`
  return e.text
}

// one chronological list of status changes, comments, internal notes and work logs.
// The server merges the three sorted lists with a heap and hides what the caller may not see.
// `reloadKey` changes whenever the ticket page reloads, which refetches the timeline.
export const TimelinePanel = ({ ticket, reloadKey }) => {
  const { data, loading, error } = useFetch(`/ticket-api/tickets/${ticket.publicId}/timeline`, { v: reloadKey })

  return (
    <div className="mb-4">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && !data && <p className="text-sm text-slate-400">Loading timeline…</p>}
      {data?.length === 0 && <p className="text-slate-400 text-sm">Nothing yet.</p>}
      <ol className="space-y-2" aria-label="Ticket timeline">
        {data?.map((e, i) => {
          const kind = KIND[e.type] ?? KIND.COMMENT
          return (
            <li key={i} className={`rounded-lg p-3 text-sm flex gap-3 ${kind.box}`}>
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${kind.dot}`} aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-xs text-slate-500">
                  <span className="font-medium text-slate-700">{e.by?.name ?? 'System'}</span>
                  {' · '}{kind.label}{' · '}{new Date(e.at).toLocaleString()}
                </p>
                <p className="text-slate-700 whitespace-pre-wrap break-words">{describe(e)}</p>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
