import { useEffect, useState } from 'react'
import { axiosInstance } from '../../axiosInstance.js'
import { styles, assetStatusColors } from '../../styles/common.js'

export const MyAssets = () => {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    axiosInstance.get('/asset-api/my-assets').then(({ data }) => setItems(data.payload)).finally(() => setLoading(false))
  }, [])

  return (
    <div className={styles.container}>
      <h1 className={styles.h1}>My Assets</h1>
      <div className={styles.card}>
        {loading && <p className="text-slate-500">Loading…</p>}
        {!loading && items.length === 0 && <p className="text-slate-500">No assets assigned to you yet.</p>}
        {!loading && items.length > 0 && (
          <ul className="space-y-3">
            {items.map((a) => (
              <li key={a._id} className="flex items-center justify-between border-b border-slate-100 pb-3 last:border-0">
                <div>
                  <p className="font-medium text-slate-800">{a.name}</p>
                  <p className="text-xs text-slate-400 font-mono">{a.publicId} · {a.assetClass}{a.vendor ? ` · ${a.vendor.name}` : ''}</p>
                  {a.warrantyExpiry && <p className="text-xs text-slate-400">Warranty until {new Date(a.warrantyExpiry).toLocaleDateString()}</p>}
                </div>
                <span className={`${styles.badge} ${assetStatusColors[a.status] || ''}`}>{a.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
