import { useFetch } from '../../hooks/useFetch.js'
import { Spinner } from '../common/Spinner.jsx'
import { StatusBadge, PriorityBadge } from '../common/Badges.jsx'
import { styles } from '../../styles/common.js'

export const AdminDashboard = () => {
  const { data: stats, loading, error } = useFetch('/admin-api/dashboard')

  if (loading) return <Spinner />
  if (error) return <p className="text-red-600 text-sm">{error}</p>
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className={styles.card}><p className="text-slate-500 text-sm">Total tickets</p><p className="text-2xl font-semibold">{stats.totalTickets}</p></div>
      <div className={styles.card}><p className="text-slate-500 text-sm">Open tickets</p><p className="text-2xl font-semibold">{stats.openTickets}</p></div>
      <div className={styles.card}><p className="text-slate-500 text-sm">Active users</p><p className="text-2xl font-semibold">{stats.userCount}</p></div>
      <div className={styles.card}>
        <p className="text-slate-500 text-sm mb-1">By priority</p>
        {stats.byPriority.length === 0 && <p className="text-sm text-slate-400">No tickets yet</p>}
        {stats.byPriority.map((p) => <p key={p._id} className="text-sm flex items-center gap-2"><PriorityBadge priority={p._id} /> {p.count}</p>)}
      </div>
      <div className={styles.card + ' col-span-2 md:col-span-4'}>
        <p className="text-slate-500 text-sm mb-2">By status</p>
        <div className="flex flex-wrap gap-3">
          {stats.byStatus.map((s) => <span key={s._id} className="text-sm flex items-center gap-2"><StatusBadge status={s._id} /> {s.count}</span>)}
        </div>
      </div>
    </div>
  )
}
