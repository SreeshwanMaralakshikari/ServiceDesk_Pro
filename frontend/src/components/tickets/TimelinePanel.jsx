import { ArrowRightLeft, Lock, MessageSquare, Timer } from 'lucide-react'
import { useFetch } from '../../hooks/useFetch.js'
import { statusLabel, transitionText } from '../../utils/labels.js'
import { SkeletonLine } from '../common/Skeleton.jsx'

const KIND = {
  STATUS: { label: 'Status', icon: ArrowRightLeft, dot: 'bg-indigo-100 text-indigo-600', box: '' },
  COMMENT: { label: 'Comment', icon: MessageSquare, dot: 'bg-slate-100 text-slate-600', box: 'rounded-lg border border-slate-200 bg-white px-3 py-2' },
  INTERNAL_NOTE: { label: 'Internal note', icon: Lock, dot: 'bg-amber-100 text-amber-700', box: 'rounded-lg border border-amber-200 bg-amber-50 px-3 py-2' },
  WORK_LOG: { label: 'Work log', icon: Timer, dot: 'bg-emerald-100 text-emerald-700', box: 'rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2' },
}

const describe = (e) => {
  if (e.type === 'STATUS') {
    const move = transitionText(e.from, e.to, statusLabel)
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
      {loading && !data && (
        <div className="space-y-3" role="status" aria-label="Loading timeline">
          <SkeletonLine className="h-4 w-2/3" />
          <SkeletonLine className="h-12 w-full" />
          <SkeletonLine className="h-4 w-1/2" />
        </div>
      )}
      {data?.length === 0 && <p className="text-slate-400 text-sm">Nothing yet.</p>}
      <ol className="relative space-y-4" aria-label="Ticket timeline">
        {data?.length > 1 && <span className="absolute left-4 top-4 bottom-4 w-px bg-slate-200" aria-hidden="true" />}
        {data?.map((e, i) => {
          const kind = KIND[e.type] ?? KIND.COMMENT
          const Icon = kind.icon
          const isStatus = e.type === 'STATUS'
          return (
            <li key={i} className="relative flex gap-3 text-sm">
              <span className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-white ${kind.dot}`} aria-hidden="true">
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1 pt-1">
                <p className="text-xs text-slate-500">
                  <span className="font-medium text-slate-700">{e.by?.name ?? 'System'}</span>
                  {' · '}{kind.label}{' · '}{new Date(e.at).toLocaleString()}
                </p>
                <div className={`mt-1 ${kind.box}`}>
                  <p className={`whitespace-pre-wrap break-words ${isStatus ? 'text-slate-600' : 'text-slate-800'}`}>{describe(e)}</p>
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
