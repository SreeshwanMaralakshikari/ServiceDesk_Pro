import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { axiosInstance } from '../../axiosInstance.js'
import { useAuthStore } from '../../store/authStore.js'
import { styles, kbStatusColors } from '../../styles/common.js'
import { getErrorMessage } from '../../utils/errors.js'

const STAFF_ROLES = ['TECHNICIAN', 'MANAGER', 'ADMIN']

export const KnowledgeBase = () => {
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()
  const isStaff = STAFF_ROLES.includes(user?.role)

  const [items, setItems] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchText, setSearchText] = useState('') // typed text; only applied on submit
  const [applied, setApplied] = useState({ q: '', category: '', status: '' })
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
          params: { q: applied.q || undefined, category: applied.category || undefined, status: applied.status || undefined, page },
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
      <div className="flex items-center justify-between mb-4">
        <h1 className={styles.h1 + ' mb-0'}>Knowledge Base</h1>
        {isStaff && <Link to="/kb/new" className={styles.btnPrimary}>+ New article</Link>}
      </div>

      <div className={styles.card + ' mb-4'}>
        <form onSubmit={submitSearch} className="flex flex-wrap gap-2">
          <input
            className={styles.input + ' flex-1 min-w-48'}
            placeholder="Search articles (e.g. vpn, printer, password)…"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            disabled={mine}
          />
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
          {isStaff && (
            <button type="button" className={mine ? styles.btnPrimary : styles.btnSecondary} onClick={() => { setMine((v) => !v); setPage(1) }}>
              {mine ? 'Showing: my articles' : 'My articles'}
            </button>
          )}
        </form>
      </div>

      <div className={styles.card}>
        {loading && <p className="text-slate-500">Loading…</p>}
        {!loading && items.length === 0 && <p className="text-slate-500">No articles found.</p>}
        {!loading && items.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr className={styles.tableHeadRow}>
                <th className="py-2">ID</th>
                <th className="py-2">Article</th>
                <th className="py-2">Category</th>
                {!mine && <th className="py-2">Views</th>}
                {isStaff && <th className="py-2">Status</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a._id} className={styles.tableRow} onClick={() => navigate(`/kb/${a.publicId}`)}>
                  <td className="py-2 font-mono text-xs align-top">{a.publicId}</td>
                  <td className="py-2">
                    <div className="font-medium">{a.title}</div>
                    <div className="text-xs text-slate-500">{a.summary}</div>
                  </td>
                  <td className="py-2 align-top">{a.category?.name || '—'}</td>
                  {!mine && <td className="py-2 align-top">{a.viewCount}</td>}
                  {isStaff && (
                    <td className="py-2 align-top">
                      <span className={`${styles.badge} ${kbStatusColors[a.status] || ''}`}>{a.status}</span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!mine && totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <button className={styles.btnSecondary} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <span className="text-sm text-slate-500">Page {page} of {totalPages}</span>
            <button className={styles.btnSecondary} disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        )}
      </div>
    </div>
  )
}
