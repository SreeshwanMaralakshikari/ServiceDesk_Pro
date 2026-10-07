import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Sparkles } from 'lucide-react'
import { axiosInstance } from '../../axiosInstance.js'
import { useAuthStore } from '../../store/authStore.js'
import { styles } from '../../styles/common.js'
import { humanize } from '../../utils/labels.js'
import { getErrorMessage } from '../../utils/errors.js'

export const CreateTicket = () => {
  const [categories, setCategories] = useState([])
  const [priorities, setPriorities] = useState([])
  const [form, setForm] = useState({ title: '', description: '', categoryId: '', priority: '' })
  const [loading, setLoading] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestion, setSuggestion] = useState(null) // { source: 'ai'|'fallback', probableIssue, categoryId } | null
  const navigate = useNavigate()
  const isAdmin = useAuthStore((s) => s.user?.role === 'ADMIN')

  const suggest = async () => {
    if (!form.title.trim() && !form.description.trim()) {
      toast.error('Type a title or description first')
      return
    }
    setSuggesting(true)
    try {
      const { data } = await axiosInstance.post('/ai-api/classify-ticket', { title: form.title, description: form.description })
      const s = data.payload
      // fills in the pickers but never overwrites a category/priority the
      // person already chose themselves
      setForm((f) => ({ ...f, categoryId: f.categoryId || s.categoryId || '', priority: f.priority || s.priority || '' }))
      setSuggestion(s)
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not get a suggestion'))
    } finally {
      setSuggesting(false)
    }
  }

  useEffect(() => {
    axiosInstance.get('/meta-api/categories').then(({ data }) => setCategories(data.payload)).catch((err) => toast.error(getErrorMessage(err, 'Could not load categories')))
    axiosInstance.get('/meta-api/priorities').then(({ data }) => setPriorities(data.payload)).catch((err) => toast.error(getErrorMessage(err, 'Could not load priorities')))
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      // aiLogId only says which suggestion was shown; the server works out whether it was kept
      const { data } = await axiosInstance.post('/ticket-api/tickets', { ...form, aiLogId: suggestion?.aiLogId || undefined })
      toast.success(data.payload.status === 'PENDING_APPROVAL' ? `Ticket ${data.payload.publicId} submitted for approval` : `Ticket ${data.payload.publicId} created`)
      navigate(`/tickets/${data.payload.publicId}`)
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to create ticket'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.container}>
      <div className={`${styles.card} max-w-lg mx-auto`}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h1 className={styles.h1 + ' mb-0'}>Create ticket</h1>
          <button type="button" className={styles.btnSecondary} onClick={suggest} disabled={suggesting}>
            <Sparkles className="h-4 w-4 text-indigo-500" aria-hidden="true" />
            {suggesting ? 'Thinking…' : 'Suggest category & priority'}
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={styles.label}>Title</label>
            <input className={styles.input} required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div>
            <label className={styles.label}>Description</label>
            <textarea className={styles.textarea} required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div>
            <label className={styles.label}>Category</label>
            <select className={styles.select} required value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              <option value="">Select…</option>
              {categories.map((c) => <option key={c._id} value={c._id}>{c.name} ({humanize(c.ticketType)})</option>)}
            </select>
          </div>
          <div>
            <label className={styles.label}>Priority (optional — defaults to the category's)</label>
            <select className={styles.select} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              <option value="">Use category default</option>
              {/* the level-0 TEST priority is for demos: the server only accepts it from an admin */}
              {priorities.filter((p) => p.level > 0 || isAdmin).map((p) => <option key={p._id} value={p.priority}>{p.label}</option>)}
            </select>
          </div>
          {suggestion && (
            <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-3 text-sm text-indigo-900">
              <p className="font-medium">{suggestion.source === 'ai' ? 'AI suggestion' : 'Best-effort suggestion (AI unavailable right now)'}</p>
              {suggestion.probableIssue && <p className="mt-1">{suggestion.probableIssue}</p>}
              {!suggestion.categoryId && <p className="mt-1 text-indigo-700">No confident category match — please pick one yourself.</p>}
            </div>
          )}
          <button className={styles.btnPrimary} disabled={loading} type="submit">
            {loading ? 'Submitting…' : 'Submit ticket'}
          </button>
        </form>
      </div>
    </div>
  )
}
