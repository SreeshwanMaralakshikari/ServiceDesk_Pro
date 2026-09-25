import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { axiosInstance } from '../../axiosInstance.js'
import { styles, priorityColors } from '../../styles/common.js'

// Manager/Admin inbox — just the ticket list filtered to PENDING_APPROVAL.
// Role scoping (Manager sees only their own team) is already enforced
// server-side by buildTicketQuery.js, so this reuses the same list route.
export const ApprovalsInbox = () => {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    axiosInstance.get('/ticket-api/tickets?status=PENDING_APPROVAL')
      .then(({ data }) => setItems(data.payload.items))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className={styles.container}>
      <h1 className={styles.h1}>Approvals</h1>
      <div className={styles.card}>
        {loading && <p className="text-slate-500">Loading…</p>}
        {!loading && items.length === 0 && <p className="text-slate-500">Nothing waiting on approval right now.</p>}
        {!loading && items.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr className={styles.tableHeadRow}>
                <th className="py-2">ID</th>
                <th className="py-2">Title</th>
                <th className="py-2">Requester</th>
                <th className="py-2">Category</th>
                <th className="py-2">Priority</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t._id} className={styles.tableRow} onClick={() => navigate(`/tickets/${t.publicId}`)}>
                  <td className="py-2 font-mono text-xs">{t.publicId}</td>
                  <td className="py-2">{t.title}</td>
                  <td className="py-2">{t.requester?.firstName} {t.requester?.lastName}</td>
                  <td className="py-2">{t.category?.name}</td>
                  <td className="py-2"><span className={`${styles.badge} ${priorityColors[t.priority] || ''}`}>{t.priority}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
