import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { axiosInstance } from '../../axiosInstance.js'
import { styles } from '../../styles/common.js'

const POLL_MS = 60000

// bell in the header: unread count (polled once a minute while the tab is
// visible), a dropdown with the latest few, mark-as-read on click
export const NotificationBell = () => {
  const [count, setCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const boxRef = useRef(null)
  const navigate = useNavigate()

  const refreshCount = useCallback(() => {
    if (document.visibilityState === 'hidden') return
    axiosInstance.get('/notification-api/unread-count')
      .then(({ data }) => setCount(data.payload.count))
      .catch(() => {}) // a missed poll is not worth a toast
  }, [])

  useEffect(() => {
    refreshCount()
    const id = setInterval(refreshCount, POLL_MS)
    return () => clearInterval(id)
  }, [refreshCount])

  // close on an outside click
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (!next) return
    setLoading(true)
    try {
      const { data } = await axiosInstance.get('/notification-api/my-notifications', { params: { limit: 8 } })
      setItems(data.payload.items)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  const openItem = async (n) => {
    setOpen(false)
    if (!n.isRead) {
      setCount((c) => Math.max(0, c - 1))
      axiosInstance.put(`/notification-api/mark-read/${n._id}`).catch(() => {})
    }
    if (n.link) navigate(n.link)
  }

  const markAll = async () => {
    try {
      await axiosInstance.put('/notification-api/mark-all-read')
      setCount(0)
      setItems((list) => list.map((n) => ({ ...n, isRead: true })))
    } catch { /* ignore, the next poll corrects the count */ }
  }

  return (
    <div className="relative" ref={boxRef}>
      <button onClick={toggle} className="relative p-1 text-slate-600 hover:text-indigo-600" aria-label={`Notifications${count ? `, ${count} unread` : ''}`}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
        </svg>
        {count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-red-600 text-white text-[10px] leading-4 text-center">{count > 99 ? '99+' : count}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-xl shadow-lg z-20">
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
            <span className="text-sm font-medium text-slate-700">Notifications</span>
            {count > 0 && <button className="text-xs text-indigo-600 hover:underline" onClick={markAll}>Mark all read</button>}
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {loading && <li className="px-3 py-3 text-sm text-slate-400">Loading…</li>}
            {!loading && items.length === 0 && <li className="px-3 py-3 text-sm text-slate-400">No notifications yet.</li>}
            {items.map((n) => (
              <li key={n._id}>
                <button onClick={() => openItem(n)} className={`w-full text-left px-3 py-2 text-sm border-b border-slate-50 hover:bg-slate-50 ${n.isRead ? 'text-slate-500' : 'text-slate-800 font-medium bg-indigo-50/40'}`}>
                  {n.message}
                  <span className="block text-xs font-normal text-slate-400">{new Date(n.createdAt).toLocaleString()}</span>
                </button>
              </li>
            ))}
          </ul>
          <Link to="/notifications" onClick={() => setOpen(false)} className={styles.navLink + ' block text-center py-2 border-t border-slate-100'}>View all</Link>
        </div>
      )}
    </div>
  )
}
