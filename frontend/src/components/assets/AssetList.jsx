import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { axiosInstance } from '../../axiosInstance.js'
import { useAuthStore } from '../../store/authStore.js'
import { styles, assetStatusColors } from '../../styles/common.js'

export const AssetList = () => {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showWarrantyOnly, setShowWarrantyOnly] = useState(false)
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const canManage = user?.role === 'ASSET_MANAGER' || user?.role === 'ADMIN'

  useEffect(() => {
    setLoading(true)
    const url = showWarrantyOnly ? '/asset-api/assets/warranty-expiring' : '/asset-api/assets'
    axiosInstance.get(url)
      .then(({ data }) => setItems(showWarrantyOnly ? data.payload : data.payload.items))
      .finally(() => setLoading(false))
  }, [showWarrantyOnly])

  return (
    <div className={styles.container}>
      <div className="flex items-center justify-between mb-4">
        <h1 className={styles.h1 + ' mb-0'}>Assets</h1>
        <div className="flex gap-2">
          <button className={showWarrantyOnly ? styles.btnPrimary : styles.btnSecondary} onClick={() => setShowWarrantyOnly((v) => !v)}>
            {showWarrantyOnly ? 'Showing: warranty expiring (30d)' : 'Show warranty expiring'}
          </button>
          {canManage && <Link to="/assets/new" className={styles.btnPrimary}>+ New asset</Link>}
        </div>
      </div>
      <div className={styles.card}>
        {loading && <p className="text-slate-500">Loading…</p>}
        {!loading && items.length === 0 && <p className="text-slate-500">No assets found.</p>}
        {!loading && items.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr className={styles.tableHeadRow}>
                <th className="py-2">ID</th>
                <th className="py-2">Name</th>
                <th className="py-2">Class</th>
                <th className="py-2">Assigned to</th>
                <th className="py-2">Warranty</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a._id} className={styles.tableRow} onClick={() => navigate(`/assets/${a.publicId}`)}>
                  <td className="py-2 font-mono text-xs">{a.publicId}</td>
                  <td className="py-2">{a.name}</td>
                  <td className="py-2">{a.assetClass}</td>
                  <td className="py-2">{a.assignedTo ? `${a.assignedTo.firstName} ${a.assignedTo.lastName}` : '—'}</td>
                  <td className="py-2 text-xs">{a.warrantyExpiry ? new Date(a.warrantyExpiry).toLocaleDateString() : '—'}</td>
                  <td className="py-2"><span className={`${styles.badge} ${assetStatusColors[a.status] || ''}`}>{a.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
