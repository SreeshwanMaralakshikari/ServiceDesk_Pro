import { useState } from 'react'
import toast from 'react-hot-toast'
import { Star } from 'lucide-react'
import { axiosInstance } from '../../axiosInstance.js'
import { styles } from '../../styles/common.js'
import { getErrorMessage } from '../../utils/errors.js'

const Stars = ({ value, onPick }) => (
  <div className="flex gap-1" role="radiogroup" aria-label="Rating">
    {[1, 2, 3, 4, 5].map((n) => (
      <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? 's' : ''}`}
        onClick={onPick ? () => onPick(n) : undefined} disabled={!onPick}
        className={`text-2xl leading-none ${n <= value ? 'text-amber-400' : 'text-slate-300'} ${onPick ? 'hover:text-amber-500' : 'cursor-default'}`}>★</button>
    ))}
  </div>
)

// the requester rates a ticket once it is closed (confirmed). Everyone who can
// see the ticket sees the rating once it exists.
export const CsatPanel = ({ ticket, isRequester, onSaved }) => {
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)

  const closedConfirmed = ticket.status === 'CLOSED' && ticket.closeReason === 'CONFIRMED'
  // a rating older than the current closure belongs to an earlier closure
  const rated = Boolean(ticket.csat?.submittedAt && ticket.closedAt && new Date(ticket.csat.submittedAt) >= new Date(ticket.closedAt))

  if (!closedConfirmed && !ticket.csat?.rating) return null
  if (closedConfirmed && !rated && !isRequester) return null

  const submit = async (e) => {
    e.preventDefault()
    if (!rating) return toast.error('Pick a rating from 1 to 5')
    setSaving(true)
    try {
      await axiosInstance.post(`/ticket-api/tickets/${ticket.publicId}/csat`, { rating, comment: comment.trim() || undefined })
      toast.success('Thank you for your feedback')
      onSaved()
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to save your rating'))
      if (err.response?.status === 409) onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={styles.card} aria-label="Customer satisfaction">
      <h2 className={styles.h2 + ' flex items-center gap-2'}><Star className="h-4 w-4 text-amber-400" aria-hidden="true" />Customer satisfaction</h2>
      {rated || (!closedConfirmed && ticket.csat?.rating) ? (
        <div>
          <Stars value={ticket.csat.rating} />
          <p className="text-sm text-slate-500 mt-1">
            {ticket.csat.rating}/5{ticket.csat.comment ? ` — “${ticket.csat.comment}”` : ''}
            {!closedConfirmed && ' (from an earlier closure)'}
          </p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-2">
          <p className="text-sm text-slate-600">How did we do? Your rating helps the team improve.</p>
          <Stars value={rating} onPick={setRating} />
          <textarea className={styles.textarea + ' min-h-16'} maxLength={500} placeholder="Optional comment…" value={comment} onChange={(e) => setComment(e.target.value)} />
          <button className={styles.btnPrimary} disabled={saving} type="submit">{saving ? 'Sending…' : 'Submit rating'}</button>
        </form>
      )}
    </section>
  )
}
