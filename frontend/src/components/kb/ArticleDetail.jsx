import { useEffect, useRef, useState, useCallback } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowLeft, Eye, Pencil, ThumbsUp, Trash2 } from 'lucide-react'
import { axiosInstance } from '../../axiosInstance.js'
import { useAuthStore } from '../../store/authStore.js'
import { styles } from '../../styles/common.js'
import { KbStatusBadge } from '../common/Badges.jsx'
import { PageSkeleton } from '../common/Skeleton.jsx'
import { NotFoundState } from '../common/NotFoundState.jsx'
import { kbStatusLabel, transitionText } from '../../utils/labels.js'
import { getErrorMessage } from '../../utils/errors.js'

// mirrors backend/utils/kbTransitions.js — the backend stays the source of truth
// Technicians write drafts and ask for a review; only a Manager/Admin publishes, archives or restores
const REVIEWER_ACTIONS = {
  DRAFT: ['publish', 'archive'],
  PUBLISHED: ['archive'],
  ARCHIVED: ['restore'],
}
const ACTION_LABELS = { publish: 'Publish', archive: 'Archive', restore: 'Restore to draft', 'request-review': 'Request review' }

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
  const isReviewer = user?.role === 'MANAGER' || user?.role === 'ADMIN'
  const isAuthor = Boolean(article && user) && article.author?._id === user._id
  const canManage = Boolean(article && user) && (isReviewer || (user.role === 'TECHNICIAN' && isAuthor))
  // what this person may do with this article right now
  const actions = !article ? [] : isReviewer
    ? (REVIEWER_ACTIONS[article.status] || [])
    : article.status === 'DRAFT' && isAuthor && !article.reviewRequestedAt ? ['request-review'] : []
  const canEdit = Boolean(article) && article.status !== 'ARCHIVED' && (isReviewer || (isAuthor && article.status === 'DRAFT'))
  const canDelete = Boolean(article) && article.status !== 'PUBLISHED'

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
      toast.success(action === 'request-review' ? 'Review requested. Your manager has been notified.' : `Article ${action} succeeded`)
      setNote('')
      // the PATCH response has ids (not populated author/category), so copy only
      // the workflow fields onto what's already on screen. No re-fetch: a GET
      // would count as a view for a Manager, and can race the history refresh.
      const p = data.payload
      setArticle((prev) => ({ ...prev, status: p.status, version: p.version, publishedAt: p.publishedAt, archivedAt: p.archivedAt, reviewRequestedAt: p.reviewRequestedAt }))
    } catch (err) {
      if (err.response?.status === 409) {
        toast.error('This article changed. Reloading…')
        load()
      } else {
        toast.error(getErrorMessage(err, `Failed to ${action}`))
      }
    }
  }

  const [voting, setVoting] = useState(false)
  const toggleHelpful = async () => {
    setVoting(true)
    try {
      const { data } = await axiosInstance.put(`/kb-api/articles/${articleId}/helpful`, { helpful: !article.markedHelpful })
      setArticle((prev) => ({ ...prev, helpfulCount: data.payload.helpfulCount, markedHelpful: data.payload.markedHelpful }))
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not save your vote'))
    } finally {
      setVoting(false)
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

  if (loading) return <PageSkeleton />
  if (!article) return <NotFoundState title="Article not found" hint="It may have been deleted, or you may not have access to it." backTo="/kb" backLabel="Back to Knowledge Base" />

  return (
    <div className={styles.container}>
      <Link to="/kb" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-indigo-600"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Knowledge Base</Link>

      <div className={styles.card + ' mt-3'}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs text-slate-400">{article.publicId}</p>
            <h1 className={styles.h1 + ' mb-1'}>{article.title}</h1>
            <p className="text-sm text-slate-500">
              {article.category?.name} · by {article.author?.firstName} {article.author?.lastName} · <Eye className="inline h-3.5 w-3.5 -mt-0.5" aria-hidden="true" /> {article.viewCount} views
              {article.publishedAt && ` · published ${new Date(article.publishedAt).toLocaleDateString()}`}
            </p>
          </div>
          <KbStatusBadge status={article.status} />
        </div>

        <p className="mt-4 text-slate-700 italic">{article.summary}</p>
        {/* rendered as plain text (pre-wrap) — never injected as HTML, so article content can't carry script */}
        <div className="mt-4 text-sm whitespace-pre-wrap leading-relaxed">{article.content}</div>

        {article.status === 'DRAFT' && article.reviewRequestedAt && (
          <p className="mt-4 text-sm rounded bg-amber-50 text-amber-800 px-3 py-2">
            Waiting for a manager to review (requested {new Date(article.reviewRequestedAt).toLocaleString()}).
          </p>
        )}

        {article.status === 'PUBLISHED' && (
          <div className="mt-5 flex items-center gap-3 text-sm">
            {isAuthor ? (
              <span className="inline-flex items-center gap-1.5 text-slate-500"><ThumbsUp className="h-4 w-4" aria-hidden="true" />{article.helpfulCount ?? 0} found this helpful</span>
            ) : (
              <>
                <button className={article.markedHelpful ? styles.btnPrimary : styles.btnSecondary} disabled={voting} onClick={toggleHelpful}>
                  <ThumbsUp className="h-4 w-4" aria-hidden="true" />{article.markedHelpful ? 'Marked helpful' : 'This helped'}
                </button>
                <span className="text-slate-500">{article.helpfulCount ?? 0} found this helpful</span>
              </>
            )}
          </div>
        )}

        {article.tags?.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {article.tags.map((t) => <span key={t} className={`${styles.badge} bg-slate-100 text-slate-600`}>#{t}</span>)}
          </div>
        )}
      </div>

      {canManage && (
        <div className={styles.card + ' mt-4'}>
          <h2 className={styles.h2}>Manage</h2>
          {actions.length > 0 && <input className={styles.input + ' mb-3'} placeholder="Optional note for the history log" value={note} onChange={(e) => setNote(e.target.value)} />}
          {!isReviewer && article.status === 'PUBLISHED' && <p className="text-sm text-slate-500 mb-2">Published articles are changed by a manager. Ask them if this one needs an update.</p>}
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => (
              <button key={a} className={a === 'publish' ? styles.btnPrimary : styles.btnSecondary} onClick={() => runAction(a)}>{ACTION_LABELS[a]}</button>
            ))}
            {canEdit && (
              <Link to={`/kb/${article.publicId}/edit`} className={styles.btnSecondary}><Pencil className="h-4 w-4" aria-hidden="true" />Edit</Link>
            )}
            {canDelete && (
              <button className={styles.btnDanger} onClick={handleDelete}><Trash2 className="h-4 w-4" aria-hidden="true" />Delete</button>
            )}
          </div>

          {history.length > 0 && (
            <div className="mt-5">
              <h2 className={styles.h2}>History</h2>
              <ul className="text-sm text-slate-600 space-y-1">
                {history.map((h, i) => (
                  <li key={i}>
                    <span className="text-slate-400">{new Date(h.at).toLocaleString()}</span>{' '}
                    {transitionText(h.fromStatus, h.toStatus, kbStatusLabel)}
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
