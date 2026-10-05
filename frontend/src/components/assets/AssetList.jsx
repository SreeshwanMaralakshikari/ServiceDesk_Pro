import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useFetch } from '../../hooks/useFetch.js'
import { DataTable } from '../common/DataTable.jsx'
import { useAuthStore } from '../../store/authStore.js'
import { styles, assetStatusColors } from '../../styles/common.js'

const PAGE_SIZE = 15

export const AssetList = () => {
  const [page, setPage] = useState(1)
  const [showWarrantyOnly, setShowWarrantyOnly] = useState(false)
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const canManage = user?.role === 'ASSET_MANAGER' || user?.role === 'ADMIN'
  // the warranty report is one plain array (no paging); the normal list is the paged { items, total, page, totalPages } payload
  const { data, loading, error } = useFetch(
    showWarrantyOnly ? '/asset-api/assets/warranty-expiring' : '/asset-api/assets',
    showWarrantyOnly ? undefined : { page, limit: PAGE_SIZE },
  )
  const rows = showWarrantyOnly ? (Array.isArray(data) ? data : []) : data?.items

  const columns = [
    { key: 'publicId', header: 'ID', render: (a) => <span className="font-mono text-xs">{a.publicId}</span> },
    { key: 'name', header: 'Name' },
    { key: 'assetClass', header: 'Class' },
    { key: 'assignedTo', header: 'Assigned to', render: (a) => (a.assignedTo ? [a.assignedTo.firstName, a.assignedTo.lastName].filter(Boolean).join(' ') : '—') },
    { key: 'warrantyExpiry', header: 'Warranty', render: (a) => <span className="text-xs">{a.warrantyExpiry ? new Date(a.warrantyExpiry).toLocaleDateString() : '—'}</span> },
    { key: 'status', header: 'Status', render: (a) => <span className={`${styles.badge} ${assetStatusColors[a.status] || ''}`}>{a.status}</span> },
  ]

  return (
    <div className={styles.container}>
      <div className="flex items-center justify-between mb-4">
        <h1 className={styles.h1 + ' mb-0'}>Assets</h1>
        <div className="flex gap-2">
          <button className={showWarrantyOnly ? styles.btnPrimary : styles.btnSecondary} onClick={() => { setPage(1); setShowWarrantyOnly((v) => !v) }}>
            {showWarrantyOnly ? 'Showing: warranty expiring (30d)' : 'Show warranty expiring'}
          </button>
          {canManage && <Link to="/assets/new" className={styles.btnPrimary}>+ New asset</Link>}
        </div>
      </div>
      <div className={styles.card}>
        <DataTable columns={columns} rows={rows} loading={loading} error={error}
          onRowClick={(a) => navigate(`/assets/${a.publicId}`)}
          page={showWarrantyOnly ? undefined : data?.page} totalPages={showWarrantyOnly ? undefined : data?.totalPages}
          total={showWarrantyOnly ? undefined : data?.total} onPageChange={setPage}
          emptyTitle="No assets found" />
      </div>
    </div>
  )
}
