import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { axiosInstance } from '../../axiosInstance.js'
import { useAuthStore } from '../../store/authStore.js'
import { styles, assetStatusColors } from '../../styles/common.js'

// mirrors ticketTransitions.js's shape, kept in sync with backend/utils/assetTransitions.js
const actionsFor = (asset, user) => {
  if (!asset || !user) return []
  const isManagerOrAdmin = user.role === 'ASSET_MANAGER' || user.role === 'ADMIN'
  const isStaff = isManagerOrAdmin || user.role === 'TECHNICIAN'
  const { status } = asset
  const options = []
  if (status === 'PROCURED' && isManagerOrAdmin) options.push('activate')
  if (status === 'IN_STOCK' && isManagerOrAdmin) options.push('assign')
  if (status === 'ASSIGNED' && isManagerOrAdmin) options.push('return')
  if (['ASSIGNED', 'IN_STOCK'].includes(status) && isStaff) options.push('repair')
  if (status === 'IN_REPAIR' && isStaff) {
    if (asset.assignedTo) options.push('reinstate')
    options.push('restock')
  }
  if (['IN_STOCK', 'REPLACED', 'IN_REPAIR'].includes(status) && isManagerOrAdmin) options.push('retire')
  if (['ASSIGNED', 'IN_REPAIR'].includes(status) && asset.assignedTo && isManagerOrAdmin) options.push('replace')
  return options
}

const ACTION_LABELS = {
  activate: 'Activate (put in stock)', assign: 'Assign', return: 'Mark returned',
  repair: 'Send for repair', reinstate: 'Reinstate to owner', restock: 'Return to stock (unassign)',
  retire: 'Retire', replace: 'Replace',
}

export const AssetDetail = () => {
  const { assetId } = useParams()
  const user = useAuthStore((s) => s.user)
  const [asset, setAsset] = useState(null)
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState([])
  const [inStockAssets, setInStockAssets] = useState([])
  const [userPick, setUserPick] = useState('')
  const [replacementPick, setReplacementPick] = useState('')
  const [note, setNote] = useState('')
  const [maintForm, setMaintForm] = useState({ type: '', cost: '', note: '' })

  const load = useCallback(() => {
    axiosInstance.get(`/asset-api/assets/${assetId}`)
      .then(({ data }) => setAsset(data.payload))
      .catch((err) => toast.error(err.response?.data?.message || 'Failed to load asset'))
      .finally(() => setLoading(false))
  }, [assetId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (user?.role === 'ASSET_MANAGER' || user?.role === 'ADMIN') {
      axiosInstance.get('/asset-api/assignable-users').then(({ data }) => setUsers(data.payload)).catch(() => {})
      axiosInstance.get('/asset-api/assets?status=IN_STOCK').then(({ data }) => setInStockAssets(data.payload.items)).catch(() => {})
    }
  }, [user])

  const runAction = async (action, body = {}) => {
    try {
      await axiosInstance.patch(`/asset-api/assets/${assetId}/${action}`, { ...body, version: asset.version })
      toast.success(`Asset ${action} succeeded`)
      setUserPick(''); setNote('')
      load()
    } catch (err) {
      if (err.response?.status === 409) {
        toast.error('This asset changed. Reloading…')
        load()
      } else {
        toast.error(err.response?.data?.message || `Failed to ${action}`)
      }
    }
  }

  const runReplace = async () => {
    if (!replacementPick) return toast.error('Pick a replacement asset first')
    try {
      await axiosInstance.patch(`/asset-api/assets/${assetId}/replace`, { newAssetId: replacementPick, note, version: asset.version })
      toast.success('Asset replaced')
      setReplacementPick(''); setNote('')
      load()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to replace asset')
    }
  }

  const addMaintenance = async (e) => {
    e.preventDefault()
    if (!maintForm.type.trim()) return toast.error('Maintenance type is required')
    try {
      await axiosInstance.post(`/asset-api/assets/${assetId}/maintenance`, maintForm)
      toast.success('Maintenance entry added')
      setMaintForm({ type: '', cost: '', note: '' })
      load()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to add maintenance entry')
    }
  }

  if (loading) return <div className={styles.container}>Loading…</div>
  if (!asset) return <div className={styles.container}>Asset not found.</div>

  const actions = actionsFor(asset, user)
  const isStaff = user.role === 'ASSET_MANAGER' || user.role === 'ADMIN' || user.role === 'TECHNICIAN'

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className="flex items-start justify-between mb-2">
          <div>
            <p className="font-mono text-xs text-slate-400">{asset.publicId}</p>
            <h1 className={styles.h1 + ' mb-1'}>{asset.name}</h1>
          </div>
          <span className={`${styles.badge} ${assetStatusColors[asset.status] || ''}`}>{asset.status}</span>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          {asset.type} · {asset.assetClass}
          {asset.serialNumber && ` · S/N ${asset.serialNumber}`}
          {asset.licenseKey && ` · Key ${asset.licenseKey}`}
          {asset.vendor && ` · ${asset.vendor.name}`}
        </p>
        <p className="text-sm text-slate-500 mb-2">
          Assigned to: {asset.assignedTo ? `${asset.assignedTo.firstName} ${asset.assignedTo.lastName}` : 'unassigned'}
          {asset.warrantyExpiry && <> · Warranty until {new Date(asset.warrantyExpiry).toLocaleDateString()}</>}
        </p>
        {asset.replaces && <p className="text-xs text-slate-400 mb-1">Replaces: {asset.replaces.publicId} ({asset.replaces.name})</p>}
        {asset.replacedBy && <p className="text-xs text-slate-400 mb-4">Replaced by: {asset.replacedBy.publicId} ({asset.replacedBy.name})</p>}

        {actions.length > 0 && (
          <div className="flex flex-col gap-3 mb-6 border-t border-slate-100 pt-4">
            {actions.includes('assign') && (
              <div className="flex gap-2">
                <select className={styles.select} value={userPick} onChange={(e) => setUserPick(e.target.value)}>
                  <option value="">Select user…</option>
                  {users.map((u) => <option key={u._id} value={u._id}>{u.firstName} {u.lastName} ({u.role})</option>)}
                </select>
                <button className={styles.btnPrimary} onClick={() => { if (!userPick) return toast.error('Pick a user first'); runAction('assign', { assignedTo: userPick }) }}>Assign</button>
              </div>
            )}
            {actions.includes('replace') && (
              <div className="flex gap-2">
                <select className={styles.select} value={replacementPick} onChange={(e) => setReplacementPick(e.target.value)}>
                  <option value="">Select replacement (IN_STOCK)…</option>
                  {inStockAssets.map((a) => <option key={a._id} value={a._id}>{a.publicId} — {a.name}</option>)}
                </select>
                <button className={styles.btnSecondary} onClick={runReplace}>Replace</button>
              </div>
            )}
            {actions.filter((a) => !['assign', 'replace'].includes(a)).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {actions.filter((a) => !['assign', 'replace'].includes(a)).map((action) => (
                  <button key={action} className={action === 'retire' ? styles.btnDanger : styles.btnSecondary} onClick={() => runAction(action, { note })}>
                    {ACTION_LABELS[action]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {isStaff && (
          <>
            <h2 className={styles.h2}>Maintenance log</h2>
            <ul className="space-y-2 mb-3">
              {asset.maintenance?.map((m, i) => (
                <li key={i} className="rounded-lg bg-slate-50 p-3 text-sm">
                  <p className="font-medium text-slate-700">{m.type}{m.cost ? ` — ₹${m.cost}` : ''}</p>
                  <p className="text-slate-500 text-xs">{new Date(m.date).toLocaleDateString()}{m.note ? ` — ${m.note}` : ''}</p>
                </li>
              ))}
              {(!asset.maintenance || asset.maintenance.length === 0) && <p className="text-slate-400 text-sm">No maintenance entries yet.</p>}
            </ul>
            <form onSubmit={addMaintenance} className="flex gap-2 mb-6">
              <input className={styles.input} placeholder="Type (e.g. Repair)" value={maintForm.type} onChange={(e) => setMaintForm({ ...maintForm, type: e.target.value })} />
              <input className={styles.input + ' max-w-[7rem]'} placeholder="Cost" type="number" value={maintForm.cost} onChange={(e) => setMaintForm({ ...maintForm, cost: e.target.value })} />
              <input className={styles.input} placeholder="Note" value={maintForm.note} onChange={(e) => setMaintForm({ ...maintForm, note: e.target.value })} />
              <button className={styles.btnSecondary} type="submit">Add</button>
            </form>
          </>
        )}

        <h2 className={styles.h2}>Lifecycle history</h2>
        <ul className="space-y-1">
          {asset.lifecycleHistory?.slice().reverse().map((h, i) => (
            <li key={i} className="text-sm text-slate-600">
              {h.fromStatus ? `${h.fromStatus} → ${h.toStatus}` : h.toStatus}
              {h.note ? ` — ${h.note}` : ''}
              <span className="text-slate-400 text-xs"> ({new Date(h.at).toLocaleString()})</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
