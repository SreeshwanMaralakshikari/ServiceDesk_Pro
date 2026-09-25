import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { axiosInstance } from '../../axiosInstance.js'
import { useAuthStore } from '../../store/authStore.js'
import { styles, statusColors, priorityColors } from '../../styles/common.js'

// actions that need a required text reason/note alongside them
const NOTE_REQUIRED_ACTIONS = ['reject', 'cancel', 'hold', 'reopen']
// actions that need a technician picked from the team
const ASSIGN_ACTIONS = ['assign', 'reassign']

// which actions this role/status combo could plausibly try — the backend
// (utils/ticketTransitions.js) is still the source of truth and will
// reject anything not actually allowed
const actionsFor = (ticket, user) => {
  if (!ticket || !user) return []
  const { status } = ticket
  const isOwner = user.id === ticket.requester?._id
  const isAssignee = user.id === ticket.assignedTo?._id
  const isManagerOrAdmin = user.role === 'MANAGER' || user.role === 'ADMIN'
  const options = []

  if (status === 'PENDING_APPROVAL' && isManagerOrAdmin) options.push('approve', 'reject')
  if (status === 'OPEN' && isManagerOrAdmin) options.push('assign')
  if (status === 'OPEN' && user.role === 'TECHNICIAN') options.push('claim')
  if (['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'REOPENED'].includes(status) && isManagerOrAdmin) options.push('reassign')
  if (['ASSIGNED', 'REOPENED'].includes(status) && isAssignee) options.push('start')
  if (status === 'IN_PROGRESS' && isAssignee) options.push('hold', 'resolve')
  if (status === 'ON_HOLD' && isAssignee) options.push('resume')
  if (status === 'RESOLVED' && isOwner) options.push('confirm', 'reopen')
  if (status === 'CLOSED' && isOwner) options.push('reopen')
  if (['PENDING_APPROVAL', 'OPEN', 'ASSIGNED'].includes(status) && (isOwner || user.role === 'ADMIN')) options.push('cancel')
  return options
}

const ACTION_LABELS = {
  approve: 'Approve', reject: 'Reject', cancel: 'Cancel', assign: 'Assign',
  reassign: 'Reassign', claim: 'Claim', start: 'Start work', hold: 'Put on hold',
  resume: 'Resume', resolve: 'Resolve', confirm: 'Confirm & close', reopen: 'Reopen',
}

export const TicketDetail = () => {
  const { ticketId } = useParams()
  const user = useAuthStore((s) => s.user)
  const [ticket, setTicket] = useState(null)
  const [technicians, setTechnicians] = useState([])
  const [loading, setLoading] = useState(true)
  const [commentText, setCommentText] = useState('')
  const [isInternal, setIsInternal] = useState(false)
  const [resolutionSummary, setResolutionSummary] = useState('')
  const [noteDrafts, setNoteDrafts] = useState({})
  const [technicianPick, setTechnicianPick] = useState('')

  const load = useCallback(() => {
    axiosInstance.get(`/ticket-api/tickets/${ticketId}`)
      .then(({ data }) => setTicket(data.payload))
      .catch((err) => toast.error(err.response?.data?.message || 'Failed to load ticket'))
      .finally(() => setLoading(false))
  }, [ticketId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (user?.role === 'MANAGER' || user?.role === 'ADMIN') {
      axiosInstance.get('/ticket-api/team-technicians').then(({ data }) => setTechnicians(data.payload)).catch(() => {})
    }
  }, [user])

  const runAction = async (action, body = {}) => {
    try {
      await axiosInstance.patch(`/ticket-api/tickets/${ticketId}/${action}`, { ...body, version: ticket.version })
      toast.success(`Ticket ${action} succeeded`)
      setNoteDrafts((d) => ({ ...d, [action]: '' }))
      setTechnicianPick('')
      load()
    } catch (err) {
      if (err.response?.status === 409) {
        toast.error('This ticket changed. Reloading…')
        load()
      } else {
        toast.error(err.response?.data?.message || `Failed to ${action}`)
      }
    }
  }

  const addComment = async (e) => {
    e.preventDefault()
    if (!commentText.trim()) return
    try {
      await axiosInstance.post(`/ticket-api/tickets/${ticketId}/comments`, { text: commentText, isInternal })
      setCommentText('')
      load()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to add comment')
    }
  }

  if (loading) return <div className={styles.container}>Loading…</div>
  if (!ticket) return <div className={styles.container}>Ticket not found.</div>

  const actions = actionsFor(ticket, user)
  const isStaff = user.role === 'ADMIN' || user.role === 'MANAGER' || user.role === 'TECHNICIAN'
  const simpleActions = actions.filter((a) => a !== 'resolve' && !NOTE_REQUIRED_ACTIONS.includes(a) && !ASSIGN_ACTIONS.includes(a))

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className="flex items-start justify-between mb-2">
          <div>
            <p className="font-mono text-xs text-slate-400">{ticket.publicId}</p>
            <h1 className={styles.h1 + ' mb-1'}>{ticket.title}</h1>
          </div>
          <div className="flex gap-2">
            <span className={`${styles.badge} ${priorityColors[ticket.priority] || ''}`}>{ticket.priority}</span>
            <span className={`${styles.badge} ${statusColors[ticket.status] || ''}`}>{ticket.status}</span>
          </div>
        </div>
        <p className="text-slate-700 mb-4 whitespace-pre-wrap">{ticket.description}</p>
        <p className="text-sm text-slate-500 mb-2">
          Requested by {ticket.requester?.firstName} {ticket.requester?.lastName} ·
          {' '}Category: {ticket.category?.name} ·
          {' '}Assigned to: {ticket.assignedTo ? `${ticket.assignedTo.firstName} ${ticket.assignedTo.lastName}` : 'unassigned'}
        </p>
        {ticket.status === 'REJECTED' && ticket.approval?.rejectionReason && (
          <p className="text-sm text-red-600 mb-2">Rejected: {ticket.approval.rejectionReason}</p>
        )}
        {ticket.status === 'CANCELLED' && ticket.cancellation?.reason && (
          <p className="text-sm text-slate-500 mb-2">Cancelled: {ticket.cancellation.reason}</p>
        )}
        {ticket.status === 'ON_HOLD' && <p className="text-sm text-amber-600 mb-2">On hold — SLA clock paused</p>}
        {ticket.reopenCount > 0 && <p className="text-xs text-orange-500 mb-4">Reopened {ticket.reopenCount} time{ticket.reopenCount > 1 ? 's' : ''}</p>}

        {actions.length > 0 && (
          <div className="flex flex-col gap-3 mb-6 border-t border-slate-100 pt-4">
            {actions.includes('resolve') && (
              <form onSubmit={(e) => { e.preventDefault(); runAction('resolve', { resolutionSummary }) }} className="flex gap-2">
                <input className={styles.input} placeholder="Resolution summary…" required
                  value={resolutionSummary} onChange={(e) => setResolutionSummary(e.target.value)} />
                <button className={styles.btnPrimary} type="submit">Resolve</button>
              </form>
            )}

            {actions.filter((a) => ASSIGN_ACTIONS.includes(a)).map((action) => (
              <form key={action} onSubmit={(e) => { e.preventDefault(); if (!technicianPick) return toast.error('Pick a technician first'); runAction(action, { technicianId: technicianPick }) }} className="flex gap-2">
                <select className={styles.select} value={technicianPick} onChange={(e) => setTechnicianPick(e.target.value)}>
                  <option value="">Select technician…</option>
                  {technicians.map((t) => <option key={t._id} value={t._id}>{t.firstName} {t.lastName}</option>)}
                </select>
                <button className={styles.btnPrimary} type="submit">{ACTION_LABELS[action]}</button>
              </form>
            ))}

            {actions.filter((a) => NOTE_REQUIRED_ACTIONS.includes(a)).map((action) => (
              <form key={action} onSubmit={(e) => { e.preventDefault(); const value = noteDrafts[action]; if (!value?.trim()) return toast.error('A note is required'); runAction(action, { note: value }) }} className="flex gap-2">
                <input className={styles.input} placeholder={`Reason for ${ACTION_LABELS[action].toLowerCase()}…`}
                  value={noteDrafts[action] || ''} onChange={(e) => setNoteDrafts((d) => ({ ...d, [action]: e.target.value }))} />
                <button className={action === 'cancel' || action === 'reject' ? styles.btnDanger : styles.btnSecondary} type="submit">
                  {ACTION_LABELS[action]}
                </button>
              </form>
            ))}

            {simpleActions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {simpleActions.map((action) => (
                  <button key={action} className={styles.btnSecondary} onClick={() => runAction(action)}>
                    {ACTION_LABELS[action]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <h2 className={styles.h2}>Timeline & comments</h2>
        <ul className="space-y-2 mb-4">
          {ticket.comments?.map((c, i) => (
            <li key={i} className={`rounded-lg p-3 text-sm ${c.isInternal ? 'bg-amber-50 border border-amber-200' : 'bg-slate-50'}`}>
              <p className="font-medium text-slate-700">
                {c.author?.firstName} {c.author?.lastName} {c.isInternal && <span className="text-amber-600">(internal)</span>}
              </p>
              <p className="text-slate-600">{c.text}</p>
            </li>
          ))}
          {(!ticket.comments || ticket.comments.length === 0) && <p className="text-slate-400 text-sm">No comments yet.</p>}
        </ul>

        <form onSubmit={addComment} className="space-y-2">
          <textarea className={styles.textarea} placeholder="Add a comment…" value={commentText} onChange={(e) => setCommentText(e.target.value)} />
          <div className="flex items-center justify-between">
            {isStaff && (
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={isInternal} onChange={(e) => setIsInternal(e.target.checked)} />
                Internal note (hidden from requester)
              </label>
            )}
            <button className={styles.btnPrimary} type="submit">Post comment</button>
          </div>
        </form>
      </div>
    </div>
  )
}
