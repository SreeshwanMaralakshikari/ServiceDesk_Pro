import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { BookOpen, Eye, Plus, Search, ThumbsUp } from 'lucide-react'
import { axiosInstance } from '../../axiosInstance.js'
import { useAuthStore } from '../../store/authStore.js'
import { styles } from '../../styles/common.js'
import { DataTable } from '../common/DataTable.jsx'
import { KbStatusBadge } from '../common/Badges.jsx'
import { getErrorMessage } from '../../utils/errors.js'

const STAFF_ROLES = ['TECHNICIAN', 'MANAGER', 'ADMIN']
const REVIEWER_ROLES = ['MANAGER', 'ADMIN']

export const KnowledgeBase = () => {
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()
  const isStaff = STAFF_ROLES.includes(user?.role)
  const isReviewer = REVIEWER_ROLES.includes(user?.role)

  const [items, setItems] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchText, setSearchText] = useState('') // typed text; only applied on submit
  const [applied, setApplied] = useState({ q: '', category: '', status: '', review: '' })
  const [mine, setMine] = useState(false)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  useEffect(() => {
    axiosInstance.get('/meta-api/categories').then(({ data }) => setCategories(data.payload)).catch(() => {})
  }, [])

  useEffect(() => {
    // `cancelled` drops the response of a superseded request, so a slow earlier
    // search can't overwrite the results of a newer filter/page change
    let cancelled = false
    setLoading(true)
    const request = mine
      ? axiosInstance.get('/kb-api/articles/mine').then(({ data }) => {
          if (cancelled) return
          setItems(data.payload); setTotalPages(1)
        })
      : axiosInstance.get('/kb-api/articles', {
          params: { q: applied.q || undefined, category: applied.category || undefined, status: applied.status || undefined, review: applied.review || undefined, page },
        }).then(({ data }) => {
          if (cancelled) return
          setItems(data.payload.items); setTotalPages(data.payload.totalPages || 1)
        })
    request
      .catch((err) => {
        if (cancelled) return
        setItems([]); setTotalPages(1)
        toast.error(getErrorMessage(err, 'Failed to load articles')) // don't let a failed request look like "no results"
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [applied, page, mine])

  const columns = [
    { key: 'publicId', header: 'ID', className: 'hidden sm:table-cell', render: (a) => <span className="font-mono text-xs whitespace-nowrap">{a.publicId}</span> },
    { key: 'title', header: 'Article', render: (a) => (
      <div>
        <div className="font-medium text-slate-800">{a.title}</div>
        <div className="text-xs text-slate-500">{a.summary}</div>
      </div>
    ) },
    { key: 'category', header: 'Category', className: 'hidden md:table-cell', render: (a) => a.category?.name || '—' },
    ...(!mine ? [{ key: 'views', header: 'Views', render: (a) => (
      <span className="inline-flex items-center gap-3 text-slate-600 whitespace-nowrap">
        <span className="inline-flex items-center gap-1" title="Views"><Eye className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />{a.viewCount}</span>
        {a.helpfulCount > 0 && <span className="inline-flex items-center gap-1 text-xs" title="Found helpful"><ThumbsUp className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />{a.helpfulCount}</span>}
      </span>
    ) }] : []),
    ...(isStaff ? [{ key: 'status', header: 'Status', render: (a) => (
      <div className="flex flex-wrap gap-1">
        <KbStatusBadge status={a.status} />
        {a.status === 'DRAFT' && a.reviewRequestedAt && <span className={`${styles.badge} bg-amber-100 text-amber-800 whitespace-nowrap`}>Review requested</span>}
      </div>
    ) }] : []),
  ]

  const submitSearch = (e) => {
    e.preventDefault()
    setPage(1)
    setApplied((a) => ({ ...a, q: searchText.trim() }))
  }
  const changeFilter = (key, value) => {
    setPage(1)
    setApplied((a) => ({ ...a, [key]: value }))
  }

  return (
    <div className={styles.container}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 className={styles.h1 + ' mb-0'}>Knowledge Base</h1>
        {isStaff && <Link to="/kb/new" className={styles.btnPrimary}><Plus className="h-4 w-4" aria-hidden="true" />New article</Link>}
      </div>

      <div className={styles.card + ' mb-4'}>
        <form onSubmit={submitSearch} className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-48">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden="true" />
            <input
              className={styles.input + ' pl-9'}
              placeholder="Search articles (e.g. vpn, printer, password)…"
              aria-label="Search articles"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              disabled={mine}
            />
          </div>
          <select className={styles.select + ' w-44'} value={applied.category} onChange={(e) => changeFilter('category', e.target.value)} disabled={mine}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </select>
          {isStaff && (
            <select className={styles.select + ' w-36'} value={applied.status} onChange={(e) => changeFilter('status', e.target.value)} disabled={mine}>
              <option value="">Any status</option>
              <option value="PUBLISHED">Published</option>
              <option value="DRAFT">Draft</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          )}
          <button className={styles.btnPrimary} type="submit" disabled={mine}>Search</button>
          {isReviewer && (
            <button type="button" className={applied.review ? styles.btnPrimary : styles.btnSecondary} disabled={mine}
              onClick={() => changeFilter('review', applied.review ? '' : 'pending')}>
              {applied.review ? 'Showing: pending review' : 'Pending review'}
            </button>
          )}
          {isStaff && (
            <button type="button" className={mine ? styles.btnPrimary : styles.btnSecondary} onClick={() => { setMine((v) => !v); setPage(1) }}>
              {mine ? 'Showing: my articles' : 'My articles'}
            </button>
          )}
        </form>
      </div>

      <div className={styles.card}>
        <DataTable columns={columns} rows={items} loading={loading}
          onRowClick={(a) => navigate(`/kb/${a.publicId}`)}
          page={page} totalPages={mine ? 1 : totalPages} onPageChange={setPage}
          emptyTitle={mine ? 'You have not written any articles yet' : 'No articles found'}
          emptyHint={mine ? 'Start one with “New article”.' : applied.q || applied.category || applied.status || applied.review ? 'Try other words or clear the filters.' : undefined}
          emptyIcon={BookOpen} />
      </div>
    </div>
  )
}
