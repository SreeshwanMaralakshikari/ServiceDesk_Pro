import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { axiosInstance } from '../../axiosInstance.js'
import { styles, statusColors, priorityColors } from '../../styles/common.js'
import { getSlaStatus } from '../../utils/sla.js'

export const TicketList = () => {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    axiosInstance.get('/ticket-api/tickets')
      .then(({ data }) => setItems(data.payload.items))
      .catch((err) => setError(err.response?.data?.message || 'Failed to load tickets'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className={styles.container}>
      <div className="flex items-center justify-between mb-4">
        <h1 className={styles.h1 + ' mb-0'}>Tickets</h1>
        <Link to="/tickets/new" className={styles.btnPrimary}>+ New ticket</Link>
      </div>
      <div className={styles.card}>
        {loading && <p className="text-slate-500">Loading…</p>}
        {error && <p className="text-red-600">{error}</p>}
        {!loading && !error && items.length === 0 && <p className="text-slate-500">No tickets yet.</p>}
        {!loading && items.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr className={styles.tableHeadRow}>
                <th className="py-2">ID</th>
                <th className="py-2">Title</th>
                <th className="py-2">Category</th>
                <th className="py-2">Priority</th>
                <th className="py-2">Status</th>
                <th className="py-2">SLA</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => {
                const sla = getSlaStatus(t)
                return (
                  <tr key={t._id} className={styles.tableRow} onClick={() => navigate(`/tickets/${t.publicId}`)}>
                    <td className="py-2 font-mono text-xs">{t.publicId}</td>
                    <td className="py-2">{t.title}</td>
                    <td className="py-2">{t.category?.name}</td>
                    <td className="py-2"><span className={`${styles.badge} ${priorityColors[t.priority] || ''}`}>{t.priority}</span></td>
                    <td className="py-2"><span className={`${styles.badge} ${statusColors[t.status] || ''}`}>{t.status}</span></td>
                    <td className="py-2">{sla ? <span className={`${styles.badge} ${sla.className}`}>{sla.label}</span> : <span className="text-slate-300 text-xs">—</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
