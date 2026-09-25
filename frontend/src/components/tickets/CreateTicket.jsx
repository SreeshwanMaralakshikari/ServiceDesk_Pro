import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { axiosInstance } from '../../axiosInstance.js'
import { styles } from '../../styles/common.js'

export const CreateTicket = () => {
  const [categories, setCategories] = useState([])
  const [priorities, setPriorities] = useState([])
  const [form, setForm] = useState({ title: '', description: '', categoryId: '', priority: '' })
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    axiosInstance.get('/meta-api/categories').then(({ data }) => setCategories(data.payload))
    axiosInstance.get('/meta-api/priorities').then(({ data }) => setPriorities(data.payload))
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const { data } = await axiosInstance.post('/ticket-api/tickets', form)
      toast.success(data.payload.status === 'PENDING_APPROVAL' ? `Ticket ${data.payload.publicId} submitted for approval` : `Ticket ${data.payload.publicId} created`)
      navigate(`/tickets/${data.payload.publicId}`)
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create ticket')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.container}>
      <div className={`${styles.card} max-w-lg mx-auto`}>
        <h1 className={styles.h1}>Create ticket</h1>
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
              {categories.map((c) => <option key={c._id} value={c._id}>{c.name} ({c.ticketType})</option>)}
            </select>
          </div>
          <div>
            <label className={styles.label}>Priority (optional — defaults to the category's)</label>
            <select className={styles.select} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              <option value="">Use category default</option>
              {priorities.map((p) => <option key={p._id} value={p.priority}>{p.label}</option>)}
            </select>
          </div>
          <button className={styles.btnPrimary} disabled={loading} type="submit">
            {loading ? 'Submitting…' : 'Submit ticket'}
          </button>
        </form>
      </div>
    </div>
  )
}
