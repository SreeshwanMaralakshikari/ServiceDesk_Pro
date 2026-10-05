import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { axiosInstance } from '../../axiosInstance.js'
import { styles, assetStatusColors } from '../../styles/common.js'
import { getErrorMessage } from '../../utils/errors.js'

const FINISHED_STATUSES = ['CLOSED', 'CANCELLED', 'REJECTED']
const ASSET_PAGE_ROLES = ['ASSET_MANAGER', 'ADMIN', 'TECHNICIAN']
const idOf = (value) => String(value?._id ?? value ?? '')

// the asset a ticket is about. Mirrors PATCH /ticket-api/tickets/:ticketId/related-asset:
// the requester may link one of their own assets; the assigned technician, a manager of
// the ticket's team and an admin may link any asset by its ID
export const RelatedAssetPanel = ({ ticket, user, onChanged }) => {
  const isOwner = idOf(ticket.requester) === idOf(user)
  const isStaff = user.role === 'ADMIN'
    || (Boolean(ticket.assignedTo) && idOf(ticket.assignedTo) === idOf(user))
    || (user.role === 'MANAGER' && idOf(user.department) === idOf(ticket.department))
  const canEdit = (isOwner || isStaff) && !FINISHED_STATUSES.includes(ticket.status)
  const pickFromOwn = isOwner && !isStaff

  const [myAssets, setMyAssets] = useState(null) // null while loading
  const [pick, setPick] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!canEdit || !pickFromOwn) return
    axiosInstance.get('/asset-api/my-assets').then(({ data }) => setMyAssets(data.payload)).catch((err) => { setMyAssets([]); toast.error(getErrorMessage(err, 'Could not load your assets')) })
  }, [canEdit, pickFromOwn])

  const save = async (assetId) => {
    setSaving(true)
    try {
      await axiosInstance.patch(`/ticket-api/tickets/${ticket.publicId}/related-asset`, { assetId })
      toast.success(assetId ? 'Asset linked' : 'Asset link removed')
      setPick('')
      onChanged()
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not change the related asset'))
    } finally {
      setSaving(false)
    }
  }

  const asset = ticket.relatedAsset && typeof ticket.relatedAsset === 'object' ? ticket.relatedAsset : null
  if (!asset && !canEdit) return null

  return (
    <div className="mb-6 border-t border-slate-100 pt-4" data-testid="related-asset">
      <h2 className={styles.h2}>Related asset</h2>
      {asset ? (
        <p className="text-sm text-slate-700 mb-2 flex flex-wrap items-center gap-2">
          {ASSET_PAGE_ROLES.includes(user.role)
            ? <Link to={`/assets/${asset.publicId}`} className="font-mono text-indigo-700 hover:underline">{asset.publicId}</Link>
            : <span className="font-mono">{asset.publicId}</span>}
          <span>{asset.name}{asset.assetClass ? ` (${asset.assetClass})` : ''}</span>
          {asset.status && <span className={`${styles.badge} ${assetStatusColors[asset.status] || ''}`}>{asset.status}</span>}
          {canEdit && <button type="button" className={styles.btnLink} disabled={saving} onClick={() => save(null)}>Remove link</button>}
        </p>
      ) : (
        <p className="text-sm text-slate-400 mb-2">No asset linked.</p>
      )}
      {canEdit && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!pick.trim()) return toast.error(pickFromOwn ? 'Pick one of your assets first' : 'Enter an asset ID first'); save(pick.trim()) }}>
          {pickFromOwn ? (
            <select className={styles.select} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Your assets">
              <option value="">{myAssets === null ? 'Loading your assets…' : myAssets.length ? 'Pick one of your assets…' : 'You have no assets assigned'}</option>
              {(myAssets ?? []).map((a) => <option key={a._id} value={a.publicId}>{a.publicId} — {a.name}</option>)}
            </select>
          ) : (
            <input className={styles.input} placeholder="Asset ID, e.g. AST-2026-00001" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Asset ID" />
          )}
          <button className={styles.btnSecondary} disabled={saving} type="submit">{asset ? 'Change' : 'Link'}</button>
        </form>
      )}
    </div>
  )
}
