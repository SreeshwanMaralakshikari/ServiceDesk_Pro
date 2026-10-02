import { useState } from 'react'
import toast from 'react-hot-toast'
import { axiosInstance } from '../../axiosInstance.js'
import { useFetch } from '../../hooks/useFetch.js'
import { styles } from '../../styles/common.js'
import { getErrorMessage } from '../../utils/errors.js'

const formatMinutes = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`)

// time spent on the ticket. Visible to the ticket's team and Admin (the API
// answers 404 to anyone else, in which case the panel simply does not render);
// only the assigned technician gets the form.
export const WorkLogPanel = ({ ticket, canAdd, onChanged }) => {
  const { data, loading, error, reload } = useFetch(`/worklog-api/${ticket.publicId}`, { limit: 50 })
  const [description, setDescription] = useState('')
  const [minutes, setMinutes] = useState('')
  const [saving, setSaving] = useState(false)

  if (error) return null
  if (loading && !data) return null

  const add = async (e) => {
    e.preventDefault()
    const minutesSpent = Number.parseInt(minutes, 10)
    if (!description.trim()) return toast.error('Describe the work you did')
    if (!Number.isInteger(minutesSpent) || minutesSpent < 1 || minutesSpent > 1440) return toast.error('Minutes must be a whole number from 1 to 1440')
    setSaving(true)
    try {
      await axiosInstance.post(`/worklog-api/${ticket.publicId}`, { description: description.trim(), minutesSpent })
      setDescription('')
      setMinutes('')
      reload()
      onChanged?.()
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to add work log'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mb-6 border-t border-slate-100 pt-4">
      <div className="flex items-baseline justify-between">
        <h2 className={styles.h2}>Work log</h2>
        <span className="text-sm text-slate-500">Total: {formatMinutes(data?.totalMinutes ?? 0)}</span>
      </div>
      {data?.items?.length === 0 && <p className="text-sm text-slate-400 mb-2">No work logged yet.</p>}
      <ul className="space-y-1 mb-3">
        {data?.items?.map((w) => (
          <li key={w._id} className="text-sm bg-slate-50 rounded-lg px-3 py-2 flex justify-between gap-3">
            <span><span className="font-medium text-slate-700">{w.technician?.firstName} {w.technician?.lastName}</span> — {w.description}</span>
            <span className="text-slate-500 whitespace-nowrap">{formatMinutes(w.minutesSpent)}</span>
          </li>
        ))}
      </ul>
      {canAdd && (
        <form onSubmit={add} className="flex flex-wrap gap-2">
          <input className={styles.input + ' flex-1 min-w-48'} maxLength={1000} placeholder="What did you do?" value={description} onChange={(e) => setDescription(e.target.value)} />
          <input className={styles.input + ' w-28'} type="number" min="1" max="1440" step="1" placeholder="Minutes" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          <button className={styles.btnSecondary} disabled={saving} type="submit">Add</button>
        </form>
      )}
    </div>
  )
}
