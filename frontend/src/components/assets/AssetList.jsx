import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CalendarClock, Laptop, Plus } from 'lucide-react'
import { useFetch } from '../../hooks/useFetch.js'
import { DataTable } from '../common/DataTable.jsx'
import { useAuthStore } from '../../store/authStore.js'
import { styles } from '../../styles/common.js'
import { AssetStatusBadge } from '../common/Badges.jsx'

const PAGE_SIZE = 15

export const AssetList = () => {
  const [page, setPage] = useState(1)
  const [showWarrantyOnly, setShowWarrantyOnly] = useState(false)
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const canManage = user?.role === 'ASSET_MANAGER' || user?.role === 'ADMIN'
  // both views are paged { items, total, page, totalPages } lists
  const { data, loading, error, reload } = useFetch(
    showWarrantyOnly ? '/asset-api/assets/warranty-expiring' : '/asset-api/assets',
    { page, limit: PAGE_SIZE },
  )

  const columns = [
    { key: 'publicId', header: 'ID', render: (a) => <span className="font-mono text-xs whitespace-nowrap">{a.publicId}</span> },
    { key: 'name', header: 'Name', render: (a) => <span className="font-medium text-slate-800">{a.name}</span> },
    { key: 'assetClass', header: 'Class', className: 'hidden sm:table-cell' },
    { key: 'assignedTo', header: 'Assigned to', className: 'hidden md:table-cell', render: (a) => (a.assignedTo ? [a.assignedTo.firstName, a.assignedTo.lastName].filter(Boolean).join(' ') : '—') },
    { key: 'warrantyExpiry', header: 'Warranty', className: 'hidden md:table-cell', render: (a) => <span className="text-xs whitespace-nowrap">{a.warrantyExpiry ? new Date(a.warrantyExpiry).toLocaleDateString() : '—'}</span> },
    { key: 'status', header: 'Status', render: (a) => <AssetStatusBadge status={a.status} /> },
  ]

  return (
    <div className={styles.container}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 className={styles.h1 + ' mb-0'}>Assets</h1>
        <div className="flex flex-wrap gap-2">
          <button className={showWarrantyOnly ? styles.btnPrimary : styles.btnSecondary} onClick={() => { setPage(1); setShowWarrantyOnly((v) => !v) }}>
            <CalendarClock className="h-4 w-4" aria-hidden="true" />
            {showWarrantyOnly ? 'Showing: warranty expiring (30d)' : 'Show warranty expiring'}
          </button>
          {canManage && <Link to="/assets/new" className={styles.btnPrimary}><Plus className="h-4 w-4" aria-hidden="true" />New asset</Link>}
        </div>
      </div>
      <div className={styles.card}>
        <DataTable columns={columns} rows={data?.items} loading={loading} error={error}
          onRowClick={(a) => navigate(`/assets/${a.publicId}`)} onRetry={reload} emptyIcon={showWarrantyOnly ? CalendarClock : Laptop}
          page={data?.page} totalPages={data?.totalPages} total={data?.total} onPageChange={setPage}
          emptyTitle={showWarrantyOnly ? 'No warranties end in the next 30 days' : 'No assets found'} />
      </div>
    </div>
  )
}
