import { styles } from '../../styles/common.js'
import { EmptyState } from './EmptyState.jsx'
import { Spinner } from './Spinner.jsx'

// columns: [{ key, header, render?(row) }]. `page` info comes straight from the
// API's { items, total, page, totalPages } envelope. Row clicks are optional.
export const DataTable = ({ columns, rows, loading, error, onRowClick, page, totalPages, total, onPageChange, emptyTitle, emptyHint }) => {
  if (loading && (!rows || rows.length === 0)) return <Spinner />
  if (error) return <p className="text-red-600 text-sm py-2">{error}</p>
  if (!rows || rows.length === 0) return <EmptyState title={emptyTitle} hint={emptyHint} />
  return (
    <div>
      <table className={styles.table}>
        <thead>
          <tr className={styles.tableHeadRow}>
            {columns.map((c) => <th key={c.key} className="py-2 pr-3">{c.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row._id} className={onRowClick ? styles.tableRow : 'border-b border-slate-100'} onClick={onRowClick ? () => onRowClick(row) : undefined}>
              {columns.map((c) => <td key={c.key} className="py-2 pr-3 align-top">{c.render ? c.render(row) : row[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-3 text-sm text-slate-500">
          <span>{total} total · page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button className={styles.btnSecondary} disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Previous</button>
            <button className={styles.btnSecondary} disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>Next</button>
          </div>
        </div>
      )}
    </div>
  )
}
