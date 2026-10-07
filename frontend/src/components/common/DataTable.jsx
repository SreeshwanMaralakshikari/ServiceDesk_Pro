import { ChevronLeft, ChevronRight } from 'lucide-react'
import { styles } from '../../styles/common.js'
import { EmptyState } from './EmptyState.jsx'
import { ErrorState } from './ErrorState.jsx'
import { TableSkeleton } from './Skeleton.jsx'

// columns: [{ key, header, render?(row), className? }]. `className` goes on both the
// header and the cell, e.g. 'hidden md:table-cell' hides a column on phones.
// `page` info comes straight from the API's { items, total, page, totalPages }
// envelope (`total` is optional). Row clicks, retry and the empty-state icon and
// action are optional.
export const DataTable = ({
  columns, rows, loading, error, onRowClick, onRetry,
  page, totalPages, total, onPageChange,
  emptyTitle, emptyHint, emptyIcon, emptyAction,
}) => {
  if (loading && (!rows || rows.length === 0)) return <TableSkeleton columns={Math.min(columns.length, 6)} />
  if (error) return <ErrorState message={error} onRetry={onRetry} compact />
  if (!rows || rows.length === 0) return <EmptyState title={emptyTitle} hint={emptyHint} icon={emptyIcon} action={emptyAction} />
  return (
    <div>
      {/* wide tables scroll sideways inside the card instead of pushing the page on a phone */}
      <div className="overflow-x-auto -mx-2 px-2">
        <table className={styles.table}>
          <thead>
            <tr className={styles.tableHeadRow}>
              {columns.map((c) => <th key={c.key} scope="col" className={`py-2 pr-3 font-medium ${c.className ?? ''}`}>{c.header}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row._id ?? i} className={onRowClick ? styles.tableRow : 'border-b border-slate-100'} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                {columns.map((c) => <td key={c.key} className={`py-2.5 pr-3 align-top ${c.className ?? ''}`}>{c.render ? c.render(row) : row[c.key]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 text-sm text-slate-500">
          <span>{total !== undefined && total !== null ? `${total} total · ` : ''}page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button className={styles.btnSecondary} disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Previous
            </button>
            <button className={styles.btnSecondary} disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
              Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
