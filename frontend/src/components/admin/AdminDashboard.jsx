import { useEffect, useState } from 'react'
import { axiosInstance } from '../../axiosInstance.js'
import { styles } from '../../styles/common.js'

export const AdminDashboard = () => {
  const [stats, setStats] = useState(null)

  useEffect(() => {
    axiosInstance.get('/admin-api/dashboard').then(({ data }) => setStats(data.payload))
  }, [])

  return (
    <div className={styles.container}>
      <h1 className={styles.h1}>Admin dashboard</h1>
      {!stats ? (
        <p className="text-slate-500">Loading…</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className={styles.card}><p className="text-slate-500 text-sm">Total tickets</p><p className="text-2xl font-semibold">{stats.totalTickets}</p></div>
          <div className={styles.card}><p className="text-slate-500 text-sm">Open tickets</p><p className="text-2xl font-semibold">{stats.openTickets}</p></div>
          <div className={styles.card}><p className="text-slate-500 text-sm">Active users</p><p className="text-2xl font-semibold">{stats.userCount}</p></div>
          <div className={styles.card}>
            <p className="text-slate-500 text-sm mb-1">By status</p>
            {stats.byStatus.map((s) => <p key={s._id} className="text-sm">{s._id}: {s.count}</p>)}
          </div>
        </div>
      )}
    </div>
  )
}
