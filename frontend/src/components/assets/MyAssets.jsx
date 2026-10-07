import { useEffect, useState } from 'react'
import { CalendarClock, Laptop, Package } from 'lucide-react'
import { axiosInstance } from '../../axiosInstance.js'
import toast from 'react-hot-toast'
import { styles } from '../../styles/common.js'
import { getErrorMessage } from '../../utils/errors.js'
import { AssetStatusBadge } from '../common/Badges.jsx'
import { EmptyState } from '../common/EmptyState.jsx'
import { SkeletonLine } from '../common/Skeleton.jsx'

export const MyAssets = () => {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    axiosInstance.get('/asset-api/my-assets')
      .then(({ data }) => setItems(data.payload))
      .catch((err) => toast.error(getErrorMessage(err, 'Failed to load your assets')))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className={styles.container}>
      <h1 className={styles.h1}>My Assets</h1>
      <p className="text-sm text-slate-500 -mt-2 mb-4">Equipment and software assigned to you. Raise a ticket if something stops working.</p>

      {loading && (
        <div className="grid gap-4 sm:grid-cols-2" role="status" aria-label="Loading">
          {[0, 1].map((i) => (
            <div key={i} className={styles.card + ' space-y-3'}>
              <SkeletonLine className="h-4 w-1/2" />
              <SkeletonLine className="h-3 w-2/3" />
              <SkeletonLine className="h-3 w-1/3" />
            </div>
          ))}
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className={styles.card}>
          <EmptyState icon={Package} title="No assets assigned to you yet" hint="When the asset team gives you a laptop, monitor or licence, it will show up here." />
        </div>
      )}

      {!loading && items.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2">
          {items.map((a) => (
            <li key={a._id} className={styles.card + ' flex gap-4'}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600" aria-hidden="true">
                <Laptop className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-slate-800">{a.name}</p>
                  <AssetStatusBadge status={a.status} />
                </div>
                <p className="text-xs text-slate-500 font-mono mt-0.5">{a.publicId}</p>
                <p className="text-sm text-slate-500 mt-1">{a.assetClass}{a.vendor ? ` · ${a.vendor.name}` : ''}</p>
                {a.warrantyExpiry && (
                  <p className="text-xs text-slate-500 mt-2 inline-flex items-center gap-1">
                    <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                    Warranty until {new Date(a.warrantyExpiry).toLocaleDateString()}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
