import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { useFetch } from '../../hooks/useFetch.js'
import { StatSkeleton } from '../common/Skeleton.jsx'
import { ErrorState } from '../common/ErrorState.jsx'
import { StatusBadge, PriorityBadge } from '../common/Badges.jsx'
import { styles } from '../../styles/common.js'
import { pct } from '../reports/DashboardView.jsx'

export const AdminDashboard = () => {
  const { data: stats, loading, error, reload } = useFetch('/admin-api/dashboard')

  if (loading && !stats) return <StatSkeleton />
  if (error) return <div className={styles.card}><ErrorState message={error} onRetry={reload} /></div>
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
      <div className={styles.card + ' col-span-2 md:col-span-4'}>
        <p className="text-slate-500 text-sm mb-2">Service levels (last 30 days, all teams)</p>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span>Response SLA met: <b>{pct(stats.overview.sla.response.compliance)}</b></span>
          <span>Resolution SLA met: <b>{pct(stats.overview.sla.resolution.compliance)}</b></span>
          <span>Breached now: <b className={stats.overview.sla.current.breached ? 'inline-flex items-center gap-1 text-red-700' : ''}>{stats.overview.sla.current.breached ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> : null}{stats.overview.sla.current.breached}</b></span>
          <span>Unassigned: <b>{stats.overview.sla.current.unassigned}</b></span>
          <span>CSAT: <b>{stats.overview.csat.average === null ? '—' : `${stats.overview.csat.average} / 5`}</b> ({stats.overview.csat.count})</span>
        </div>
        <div className="flex gap-4 mt-3">
          <Link to="/manager/dashboard" className={styles.btnLink}>Open the full dashboard</Link>
          <Link to="/reports" className={styles.btnLink}>Ticket report and CSV</Link>
        </div>
      </div>
    </div>
  )
}
