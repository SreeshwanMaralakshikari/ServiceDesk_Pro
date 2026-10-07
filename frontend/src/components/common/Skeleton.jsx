import { styles } from '../../styles/common.js'

// grey placeholders shown while data loads, shaped like what is coming,
// so the page does not jump when it arrives
export const SkeletonLine = ({ className = '' }) => <div className={`animate-pulse rounded bg-slate-200 ${className}`} />

export const TableSkeleton = ({ rows = 5, columns = 4 }) => (
  <div role="status" aria-label="Loading" className="py-1">
    <div className="flex gap-4 border-b border-slate-200 pb-3 mb-1">
      {Array.from({ length: columns }, (_, c) => <SkeletonLine key={c} className="h-3 flex-1" />)}
    </div>
    {Array.from({ length: rows }, (_, r) => (
      <div key={r} className="flex gap-4 border-b border-slate-100 py-3">
        {Array.from({ length: columns }, (_, c) => <SkeletonLine key={c} className={`h-4 flex-1 ${c === 1 ? 'basis-1/3' : ''}`} />)}
      </div>
    ))}
    <span className="sr-only">Loading…</span>
  </div>
)

// a whole page (detail pages, forms) while its first request is in flight
export const PageSkeleton = ({ wide = false }) => (
  <div className={wide ? styles.containerWide : styles.container} role="status" aria-label="Loading">
    <SkeletonLine className="h-3 w-24 mb-3" />
    <SkeletonLine className="h-7 w-2/3 mb-6" />
    <div className={styles.card + ' space-y-3'}>
      <SkeletonLine className="h-4 w-full" />
      <SkeletonLine className="h-4 w-11/12" />
      <SkeletonLine className="h-4 w-4/5" />
      <SkeletonLine className="h-4 w-3/5" />
    </div>
    <span className="sr-only">Loading…</span>
  </div>
)

// a row of stat cards (dashboards)
export const StatSkeleton = ({ count = 4 }) => (
  <div className="grid grid-cols-2 md:grid-cols-4 gap-4" role="status" aria-label="Loading">
    {Array.from({ length: count }, (_, i) => (
      <div key={i} className={styles.card + ' !p-4 space-y-2'}>
        <SkeletonLine className="h-3 w-1/2" />
        <SkeletonLine className="h-7 w-1/3" />
      </div>
    ))}
  </div>
)
