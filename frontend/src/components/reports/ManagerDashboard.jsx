import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FileBarChart, RefreshCw } from 'lucide-react'
import { useFetch } from '../../hooks/useFetch.js'
import { useAuthStore } from '../../store/authStore.js'
import { StatSkeleton } from '../common/Skeleton.jsx'
import { ErrorState } from '../common/ErrorState.jsx'
import { styles } from '../../styles/common.js'
import { DashboardView, DAY_OPTIONS } from './DashboardView.jsx'

export const ManagerDashboard = () => {
  const isAdmin = useAuthStore((s) => s.user?.role) === 'ADMIN'
  const [days, setDays] = useState('30')
  const [department, setDepartment] = useState('')
  // the team switcher is for admins only; a manager's team is fixed on the server
  const { data: teamData } = useFetch(isAdmin ? '/admin-api/departments' : null, { limit: 50, kind: 'IT_SUPPORT', isActive: true })
  const { data, loading, error, reload } = useFetch('/manager-api/dashboard', { days, department: isAdmin && department ? department : undefined })

  return (
    <div className={styles.containerWide}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 className={styles.h1 + ' mb-0'}>Dashboard</h1>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <select className={styles.select + ' max-w-[12rem]'} value={department} onChange={(e) => setDepartment(e.target.value)} aria-label="Team">
              <option value="">All teams</option>
              {teamData?.items?.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
            </select>
          )}
          <select className={styles.select + ' max-w-[10rem]'} value={days} onChange={(e) => setDays(e.target.value)} aria-label="Period">
            {DAY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button className={styles.btnSecondary} onClick={reload}><RefreshCw className="h-4 w-4" aria-hidden="true" />Refresh</button>
          <Link to="/reports" className={styles.btnSecondary}><FileBarChart className="h-4 w-4" aria-hidden="true" />Reports</Link>
        </div>
      </div>
      {loading && !data && <StatSkeleton />}
      {error && <div className={styles.card}><ErrorState message={error} onRetry={reload} /></div>}
      {data && <DashboardView data={data} showTeams={isAdmin && !department} />}
    </div>
  )
}
