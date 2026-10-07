import { useEffect, useState, useCallback } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil } from 'lucide-react'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import { axiosInstance } from '../../axiosInstance.js'
import { useAuthStore } from '../../store/authStore.js'
import { styles } from '../../styles/common.js'
import { AssetStatusBadge } from '../common/Badges.jsx'
import { PageSkeleton } from '../common/Skeleton.jsx'
import { NotFoundState } from '../common/NotFoundState.jsx'
import { assetStatusLabel, assetTypeLabel, roleLabel, transitionText } from '../../utils/labels.js'
import { getErrorMessage } from '../../utils/errors.js'
import { Modal, ModalFooter } from '../common/Modal.jsx'
import { Field } from '../common/Field.jsx'

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

// the editable details (status, type and assignee change only through the lifecycle actions)
const EDIT_FIELDS = ['name', 'assetClass', 'serialNumber', 'licenseKey', 'vendor', 'purchaseDate', 'purchaseCost', 'warrantyExpiry', 'location']
const dateValue = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '')
const formValuesOf = (asset) => ({
  name: asset.name ?? '', assetClass: asset.assetClass ?? '', serialNumber: asset.serialNumber ?? '', licenseKey: asset.licenseKey ?? '',
  vendor: asset.vendor?._id ?? asset.vendor ?? '', purchaseDate: dateValue(asset.purchaseDate),
  purchaseCost: asset.purchaseCost ?? '', warrantyExpiry: dateValue(asset.warrantyExpiry), location: asset.location ?? '',
})

const EditAssetModal = ({ asset, onClose, onSaved }) => {
  const initial = formValuesOf(asset)
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm({ defaultValues: initial })
  const [vendors, setVendors] = useState([])
  const [serverError, setServerError] = useState('')

  useEffect(() => {
    axiosInstance.get('/vendor-api/vendors').then(({ data }) => setVendors(data.payload)).catch((err) => setServerError(getErrorMessage(err, 'Could not load vendors')))
  }, [])
  // the vendor options arrive after the first render, so select the current vendor once they exist
  useEffect(() => {
    if (vendors.length) setValue('vendor', initial.vendor)
  }, [vendors, setValue, initial.vendor])

  const submit = async (values) => {
    setServerError('')
    // only what changed; '' clears an optional field on the server
    const changes = {}
    for (const key of EDIT_FIELDS) {
      const value = typeof values[key] === 'string' ? values[key].trim() : values[key]
      if (String(value) !== String(initial[key])) changes[key] = value
    }
    if (Object.keys(changes).length === 0) return onClose()
    try {
      await axiosInstance.patch(`/asset-api/assets/${asset.publicId}`, changes)
      onSaved()
    } catch (err) {
      setServerError(getErrorMessage(err, 'Failed to save the asset'))
    }
  }

  const isSoftware = asset.type === 'SOFTWARE'
  return (
    <Modal title={`Edit ${asset.publicId}`} onClose={onClose}>
      <form onSubmit={handleSubmit(submit)} noValidate>
        <Field label="Name" error={errors.name}><input className={styles.input} {...register('name', { validate: (v) => v.trim() !== '' || 'Name is required' })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Class" error={errors.assetClass}><input className={styles.input} {...register('assetClass', { validate: (v) => v.trim() !== '' || 'Class is required' })} /></Field>
          {isSoftware
            ? <Field label="License key"><input className={styles.input} {...register('licenseKey')} /></Field>
            : <Field label="Serial number"><input className={styles.input} {...register('serialNumber')} /></Field>}
        </div>
        <Field label="Vendor">
          <select className={styles.select} {...register('vendor')}>
            <option value="">None</option>
            {vendors.map((v) => <option key={v._id} value={v._id}>{v.name}{v.isActive ? '' : ' (inactive)'}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Purchase date"><input className={styles.input} type="date" {...register('purchaseDate')} /></Field>
          <Field label="Cost" error={errors.purchaseCost}><input className={styles.input} type="number" min="0" step="any" {...register('purchaseCost', { validate: (v) => v === '' || Number(v) >= 0 || 'Cannot be negative' })} /></Field>
        </div>
        <Field label="Warranty expiry" hint="Changing it re-arms the 30-day warranty reminder."><input className={styles.input} type="date" {...register('warrantyExpiry')} /></Field>
        <Field label="Location"><input className={styles.input} {...register('location')} /></Field>
        <p className="text-xs text-slate-400">Status, type and the assignee change only through the actions on the asset page.</p>
        <ModalFooter error={serverError} submitting={isSubmitting} submitLabel="Save changes" onCancel={onClose} />
      </form>
    </Modal>
  )
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
  const [editing, setEditing] = useState(false)

  const load = useCallback(() => {
    axiosInstance.get(`/asset-api/assets/${assetId}`)
      .then(({ data }) => setAsset(data.payload))
      .catch((err) => toast.error(getErrorMessage(err, 'Failed to load asset')))
      .finally(() => setLoading(false))
  }, [assetId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (user?.role === 'ASSET_MANAGER' || user?.role === 'ADMIN') {
      axiosInstance.get('/asset-api/assignable-users').then(({ data }) => setUsers(data.payload)).catch((err) => toast.error(getErrorMessage(err, 'Could not load users')))
      // 50 is the largest page the API serves
      axiosInstance.get('/asset-api/assets', { params: { status: 'IN_STOCK', limit: 50 } }).then(({ data }) => setInStockAssets(data.payload.items)).catch((err) => toast.error(getErrorMessage(err, 'Could not load in-stock assets')))
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
        toast.error(getErrorMessage(err, `Failed to ${action}`))
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
      toast.error(getErrorMessage(err, 'Failed to replace asset'))
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
      toast.error(getErrorMessage(err, 'Failed to add maintenance entry'))
    }
  }

  if (loading) return <PageSkeleton />
  if (!asset) return <NotFoundState title="Asset not found" hint="It may not exist, or you may not have access to it." backTo="/assets" backLabel="Back to assets" />

  const actions = actionsFor(asset, user)
  const isStaff = user.role === 'ASSET_MANAGER' || user.role === 'ADMIN' || user.role === 'TECHNICIAN'
  const canEdit = user.role === 'ASSET_MANAGER' || user.role === 'ADMIN'

  return (
    <div className={styles.container}>
      <Link to="/assets" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-indigo-600 mb-3"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Assets</Link>
      <div className={styles.card}>
        <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
          <div>
            <p className="font-mono text-xs text-slate-400">{asset.publicId}</p>
            <h1 className={styles.h1 + ' mb-1'}>{asset.name}</h1>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && <button type="button" className={styles.btnSecondary} onClick={() => setEditing(true)}><Pencil className="h-4 w-4" aria-hidden="true" />Edit details</button>}
            <AssetStatusBadge status={asset.status} />
          </div>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          {assetTypeLabel(asset.type)} · {asset.assetClass}
          {asset.serialNumber && ` · S/N ${asset.serialNumber}`}
          {asset.licenseKey && ` · Key ${asset.licenseKey}`}
          {asset.vendor && ` · ${asset.vendor.name}`}
        </p>
        <p className="text-sm text-slate-500 mb-2">
          Assigned to: {asset.assignedTo ? `${asset.assignedTo.firstName} ${asset.assignedTo.lastName}` : 'unassigned'}
          {asset.warrantyExpiry && <> · Warranty until {new Date(asset.warrantyExpiry).toLocaleDateString()}</>}
        </p>
        {(asset.location || asset.purchaseDate || asset.purchaseCost != null) && (
          <p className="text-sm text-slate-500 mb-2" data-testid="asset-extra">
            {[asset.location && `Location: ${asset.location}`, asset.purchaseDate && `Bought ${new Date(asset.purchaseDate).toLocaleDateString()}`, asset.purchaseCost != null && `Cost ₹${asset.purchaseCost}`].filter(Boolean).join(' · ')}
          </p>
        )}
        {asset.replaces && <p className="text-xs text-slate-400 mb-1">Replaces: {asset.replaces.publicId} ({asset.replaces.name})</p>}
        {asset.replacedBy && <p className="text-xs text-slate-400 mb-4">Replaced by: {asset.replacedBy.publicId} ({asset.replacedBy.name})</p>}

        {actions.length > 0 && (
          <div className="flex flex-col gap-3 mb-6 border-t border-slate-100 pt-4">
            {actions.includes('assign') && (
              <div className="flex flex-wrap sm:flex-nowrap gap-2">
                <select className={styles.select} value={userPick} onChange={(e) => setUserPick(e.target.value)}>
                  <option value="">Select user…</option>
                  {users.map((u) => <option key={u._id} value={u._id}>{u.firstName} {u.lastName} ({roleLabel(u.role)})</option>)}
                </select>
                <button className={styles.btnPrimary} onClick={() => { if (!userPick) return toast.error('Pick a user first'); runAction('assign', { assignedTo: userPick }) }}>Assign</button>
              </div>
            )}
            {actions.includes('replace') && (
              <div className="flex flex-wrap sm:flex-nowrap gap-2">
                <select className={styles.select} value={replacementPick} onChange={(e) => setReplacementPick(e.target.value)}>
                  <option value="">Select a replacement (in stock)…</option>
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
            <form onSubmit={addMaintenance} className="flex flex-wrap sm:flex-nowrap gap-2 mb-6">
              <input className={styles.input} placeholder="Type (e.g. Repair)" value={maintForm.type} onChange={(e) => setMaintForm({ ...maintForm, type: e.target.value })} />
              <input className={styles.input + ' max-w-[7rem]'} placeholder="Cost" type="number" value={maintForm.cost} onChange={(e) => setMaintForm({ ...maintForm, cost: e.target.value })} />
              <input className={styles.input} placeholder="Note" value={maintForm.note} onChange={(e) => setMaintForm({ ...maintForm, note: e.target.value })} />
              <button className={styles.btnSecondary} type="submit">Add</button>
            </form>
          </>
        )}

        {editing && <EditAssetModal asset={asset} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); toast.success('Asset updated'); load() }} />}

        <h2 className={styles.h2}>Lifecycle history</h2>
        <ul className="space-y-1">
          {asset.lifecycleHistory?.slice().reverse().map((h, i) => (
            <li key={i} className="text-sm text-slate-600">
              {transitionText(h.fromStatus, h.toStatus, assetStatusLabel)}
              {h.note ? ` — ${h.note}` : ''}
              <span className="text-slate-400 text-xs"> ({new Date(h.at).toLocaleString()})</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
