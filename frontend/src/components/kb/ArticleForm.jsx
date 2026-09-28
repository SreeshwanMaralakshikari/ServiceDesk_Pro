import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { axiosInstance } from '../../axiosInstance.js'
import { styles } from '../../styles/common.js'
import { getErrorMessage } from '../../utils/errors.js'

// mirror the server's schema caps so people hit a friendly limit, not a 400
const LIMITS = { title: 200, summary: 500, content: 50000, tags: 10, tagLength: 30 }

// one form for both create (/kb/new) and edit (/kb/:articleId/edit)
export const ArticleForm = () => {
  const { articleId } = useParams()
  const isEdit = Boolean(articleId)
  const navigate = useNavigate()
  const [categories, setCategories] = useState([])
  const [form, setForm] = useState({ title: '', summary: '', content: '', categoryId: '', tags: '' })
  const [loading, setLoading] = useState(false)
  const [loadingArticle, setLoadingArticle] = useState(isEdit)

  useEffect(() => {
    axiosInstance.get('/meta-api/categories').then(({ data }) => setCategories(data.payload)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!isEdit) return
    axiosInstance.get(`/kb-api/articles/${articleId}`)
      .then(({ data }) => {
        const a = data.payload
        setForm({ title: a.title, summary: a.summary, content: a.content, categoryId: a.category?._id || '', tags: (a.tags || []).join(', ') })
      })
      .catch((err) => { toast.error(getErrorMessage(err, 'Failed to load article')); navigate('/kb') })
      .finally(() => setLoadingArticle(false))
  }, [articleId, isEdit, navigate])

  const submit = async (e) => {
    e.preventDefault()
    if (!form.categoryId) return toast.error('Pick a category')
    if (![form.title, form.summary, form.content].every((v) => v.trim())) return toast.error('Title, summary and content cannot be blank')
    const tags = [...new Set(form.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))]
    if (tags.length > LIMITS.tags) return toast.error(`Use at most ${LIMITS.tags} tags`)
    if (tags.some((t) => t.length > LIMITS.tagLength)) return toast.error(`Each tag must be ${LIMITS.tagLength} characters or fewer`)
    const body = { title: form.title, summary: form.summary, content: form.content, categoryId: form.categoryId, tags }
    setLoading(true)
    try {
      const { data } = isEdit
        ? await axiosInstance.patch(`/kb-api/articles/${articleId}`, body)
        : await axiosInstance.post('/kb-api/articles', body)
      toast.success(isEdit ? 'Article updated' : 'Draft created')
      navigate(`/kb/${data.payload.publicId}`)
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to save article'))
    } finally {
      setLoading(false)
    }
  }

  if (loadingArticle) return <div className={styles.container}><p className="text-slate-500">Loading…</p></div>

  return (
    <div className={styles.container}>
      <h1 className={styles.h1}>{isEdit ? 'Edit article' : 'New article'}</h1>
      <div className={styles.card}>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className={styles.label}>Title</label>
            <input className={styles.input} required maxLength={LIMITS.title} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div>
            <label className={styles.label}>Category</label>
            <select className={styles.select} required value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              <option value="">Select…</option>
              {categories.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className={styles.label}>Summary</label>
            <input className={styles.input} required maxLength={LIMITS.summary} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
          </div>
          <div>
            <label className={styles.label}>Content</label>
            <textarea className={styles.textarea + ' min-h-64'} required maxLength={LIMITS.content} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
          </div>
          <div>
            <label className={styles.label}>Tags (comma-separated, up to 10)</label>
            <input className={styles.input} placeholder="vpn, network, remote" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
          </div>
          <button className={styles.btnPrimary} disabled={loading} type="submit">
            {loading ? 'Saving…' : isEdit ? 'Save changes' : 'Create draft'}
          </button>
          {!isEdit && <p className="text-xs text-slate-500">New articles start as drafts — publish from the article page when ready.</p>}
        </form>
      </div>
    </div>
  )
}
