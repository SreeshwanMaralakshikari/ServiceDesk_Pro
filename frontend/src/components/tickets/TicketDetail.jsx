import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { axiosInstance } from '../../axiosInstance.js'
import { useAuthStore } from '../../store/authStore.js'
import { styles, statusColors, priorityColors } from '../../styles/common.js'

// which actions this role/status combo could plausibly try — the backend
// is still the source of truth (utils/ticketTransitions.js) and will
// reject anything not actually allowed
const actionsFor = (ticket, user) => {
  if (!ticket || !user) return []
  const { status } = ticket
  const isOwner = user.id === ticket.requester?._id
  const isAssignee = user.id === ticket.assignedTo?._id
  const isTeamStaff = (user.role === 'TECHNICIAN' || user.role === 'MANAGER')
  const options = []
  if (status === 'OPEN' && (user.role === 'MANAGER' || user.role === 'ADMIN')) options.push('assign')
  if (status === 'OPEN' && user.role === 'TECHNICIAN') options.push('claim')
  if (status === 'ASSIGNED' && isAssignee) options.push('start')
  if (status === 'IN_PROGRESS' && isAssignee) options.push('resolve')
  if (status === 'RESOLVED' && isOwner) { options.push('confirm', 'reopen') }
  if (status === 'CLOSED' && isOwner) options.push('reopen')
  if (['OPEN', 'ASSIGNED'].includes(status) && (isOwner || user.role === 'ADMIN')) options.push('cancel')
  return options
}

export const TicketDetail = () => {
  const { ticketId } = useParams()
  const user = useAuthStore((s) => s.user)
  const [ticket, setTicket] = useState(null)
  const [loading, setLoading] = useState(true)
  const [commentText, setCommentText] = useState('')
  const [isInternal, setIsInternal] = useState(false)
  const [resolutionSummary, setResolutionSummary] = useState('')

  const load = useCallback(() => {
    axiosInstance.get(`/ticket-api/tickets/${ticketId}`)
      .then(({ data }) => setTicket(data.payload))
      .catch((err) => toast.error(err.response?.data?.message || 'Failed to load ticket'))
      .finally(() => setLoading(false))
  }, [ticketId])

  useEffect(() => { load() }, [load])

  const runAction = async (action, body = {}) => {
    try {
      await axiosInstance.patch(`/ticket-api/tickets/${ticketId}/${action}`, { ...body, version: ticket.version })
      toast.success(`Ticket ${action} succeeded`)
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
        <p className="text-sm text-slate-500 mb-4">
          Requested by {ticket.requester?.firstName} {ticket.requester?.lastName} ·
          {' '}Category: {ticket.category?.name} ·
          {' '}Assigned to: {ticket.assignedTo ? `${ticket.assignedTo.firstName} ${ticket.assignedTo.lastName}` : 'unassigned'}
        </p>

        {actions.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6 border-t border-slate-100 pt-4">
            {actions.includes('resolve') ? (
              <form onSubmit={(e) => { e.preventDefault(); runAction('resolve', { resolutionSummary }) }} className="flex gap-2 w-full">
                <input className={styles.input} placeholder="Resolution summary…" required
                  value={resolutionSummary} onChange={(e) => setResolutionSummary(e.target.value)} />
                <button className={styles.btnPrimary} type="submit">Resolve</button>
              </form>
            ) : null}
            {actions.filter((a) => a !== 'resolve').map((action) => (
              <button key={action} className={action === 'cancel' ? styles.btnDanger : styles.btnSecondary}
                onClick={() => runAction(action)}>
                {action[0].toUpperCase() + action.slice(1)}
              </button>
            ))}
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
