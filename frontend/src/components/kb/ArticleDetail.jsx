import { useEffect, useRef, useState, useCallback } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { axiosInstance } from '../../axiosInstance.js'
import { useAuthStore } from '../../store/authStore.js'
import { styles, kbStatusColors } from '../../styles/common.js'
import { getErrorMessage } from '../../utils/errors.js'

// mirrors backend/utils/kbTransitions.js — the backend stays the source of truth
const ACTIONS_BY_STATUS = {
  DRAFT: ['publish', 'archive'],
  PUBLISHED: ['archive'],
  ARCHIVED: ['restore'],
}
const ACTION_LABELS = { publish: 'Publish', archive: 'Archive', restore: 'Restore to draft' }

export const ArticleDetail = () => {
  const { articleId } = useParams()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [article, setArticle] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [note, setNote] = useState('')

  // same rule as the backend: a Manager/Admin, or a Technician who wrote it.
  // (serialized users carry `_id`, not `id`)
  const canManage = Boolean(article && user) && (
    user.role === 'MANAGER' || user.role === 'ADMIN' ||
    (user.role === 'TECHNICIAN' && article.author?._id === user._id)
  )

  // only the most recent request may update state, so a slow earlier response
  // (or one for a previously viewed article) can't overwrite a newer one
  const latestRequest = useRef(0)
  const load = useCallback(() => {
    const mine = ++latestRequest.current
    return axiosInstance.get(`/kb-api/articles/${articleId}`)
      .then(({ data }) => { if (mine === latestRequest.current) setArticle(data.payload) })
      .catch((err) => {
        if (mine !== latestRequest.current) return
        toast.error(getErrorMessage(err, 'Failed to load article'))
        setArticle(null)
      })
      .finally(() => { if (mine === latestRequest.current) setLoading(false) })
  }, [articleId])

  // opening a different article must not keep showing the previous one
  useEffect(() => {
    setLoading(true)
    setArticle(null)
    setHistory([])
    setNote('')
    load()
  }, [load])

  useEffect(() => {
    if (!canManage) { setHistory([]); return }
    let cancelled = false
    axiosInstance.get(`/kb-api/articles/${articleId}/history`)
      .then(({ data }) => { if (!cancelled) setHistory(data.payload) })
      .catch(() => { if (!cancelled) setHistory([]) })
    return () => { cancelled = true }
  }, [articleId, canManage, article?.version, article?.status])

  const runAction = async (action) => {
    try {
      const { data } = await axiosInstance.patch(`/kb-api/articles/${articleId}/${action}`, { version: article.version, note: note.trim() || undefined })
      toast.success(`Article ${action} succeeded`)
      setNote('')
      // the PATCH response has ids (not populated author/category), so copy only
      // the workflow fields onto what's already on screen. No re-fetch: a GET
      // would count as a view for a Manager, and can race the history refresh.
      const p = data.payload
      setArticle((prev) => ({ ...prev, status: p.status, version: p.version, publishedAt: p.publishedAt, archivedAt: p.archivedAt }))
    } catch (err) {
      if (err.response?.status === 409) {
        toast.error('This article changed. Reloading…')
        load()
      } else {
        toast.error(getErrorMessage(err, `Failed to ${action}`))
      }
    }
  }

  const handleDelete = async () => {
    if (!window.confirm('Delete this article? This cannot be undone from the UI.')) return
    try {
      await axiosInstance.delete(`/kb-api/articles/${articleId}`)
      toast.success('Article deleted')
      navigate('/kb')
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to delete'))
    }
  }

  if (loading) return <div className={styles.container}><p className="text-slate-500">Loading…</p></div>
  if (!article) return <div className={styles.container}><p className="text-slate-500">Article not found.</p><Link to="/kb" className={styles.navLink}>← Back to Knowledge Base</Link></div>

  return (
    <div className={styles.container}>
      <Link to="/kb" className={styles.navLink}>← Back to Knowledge Base</Link>

      <div className={styles.card + ' mt-3'}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs text-slate-400">{article.publicId}</p>
            <h1 className={styles.h1 + ' mb-1'}>{article.title}</h1>
            <p className="text-sm text-slate-500">
              {article.category?.name} · by {article.author?.firstName} {article.author?.lastName} · {article.viewCount} views
              {article.publishedAt && ` · published ${new Date(article.publishedAt).toLocaleDateString()}`}
            </p>
          </div>
          <span className={`${styles.badge} ${kbStatusColors[article.status] || ''}`}>{article.status}</span>
        </div>

        <p className="mt-4 text-slate-700 italic">{article.summary}</p>
        {/* rendered as plain text (pre-wrap) — never injected as HTML, so article content can't carry script */}
        <div className="mt-4 text-sm whitespace-pre-wrap leading-relaxed">{article.content}</div>

        {article.tags?.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {article.tags.map((t) => <span key={t} className={`${styles.badge} bg-slate-100 text-slate-600`}>#{t}</span>)}
          </div>
        )}
      </div>

      {canManage && (
        <div className={styles.card + ' mt-4'}>
          <h2 className={styles.h2}>Manage</h2>
          <input className={styles.input + ' mb-3'} placeholder="Optional note for the history log" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            {(ACTIONS_BY_STATUS[article.status] || []).map((a) => (
              <button key={a} className={a === 'publish' ? styles.btnPrimary : styles.btnSecondary} onClick={() => runAction(a)}>{ACTION_LABELS[a]}</button>
            ))}
            {article.status !== 'ARCHIVED' && (
              <Link to={`/kb/${article.publicId}/edit`} className={styles.btnSecondary}>Edit</Link>
            )}
            {article.status !== 'PUBLISHED' && (
              <button className={styles.btnDanger} onClick={handleDelete}>Delete</button>
            )}
          </div>

          {history.length > 0 && (
            <div className="mt-5">
              <h2 className={styles.h2}>History</h2>
              <ul className="text-sm text-slate-600 space-y-1">
                {history.map((h, i) => (
                  <li key={i}>
                    <span className="text-slate-400">{new Date(h.at).toLocaleString()}</span>{' '}
                    {h.fromStatus ? `${h.fromStatus} → ${h.toStatus}` : h.toStatus}
                    {h.by && ` · ${h.by.firstName} ${h.by.lastName}`}
                    {h.note && ` — ${h.note}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
