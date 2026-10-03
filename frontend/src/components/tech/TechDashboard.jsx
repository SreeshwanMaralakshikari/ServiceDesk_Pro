import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useFetch } from '../../hooks/useFetch.js'
import { Spinner } from '../common/Spinner.jsx'
import { StatCard, ChartCard, SimpleTable, BarList, TrendChart, RatingBars } from '../common/charts/index.js'
import { styles } from '../../styles/common.js'
import { DAY_OPTIONS, pct, hrs } from '../reports/DashboardView.jsx'

export const TechDashboard = () => {
  const [days, setDays] = useState('30')
  const { data, loading, error, reload } = useFetch('/tech-api/dashboard', { days })
  const period = data?.scope.days ? `last ${data.scope.days} days` : 'all time'

  return (
    <div className={styles.containerWide}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 className={styles.h1 + ' mb-0'}>My dashboard</h1>
        <div className="flex items-center gap-2">
          <select className={styles.select + ' max-w-[10rem]'} value={days} onChange={(e) => setDays(e.target.value)} aria-label="Period">
            {DAY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button className={styles.btnSecondary} onClick={reload}>Refresh</button>
          <Link to="/my-queue" className={styles.btnSecondary}>My queue</Link>
        </div>
      </div>
      {loading && !data && <Spinner />}
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Open on me" value={data.open.total} hint={`${data.open.onHold} on hold, ${data.open.awaitingConfirmation} awaiting confirmation`} />
            <StatCard label="Breached" icon="⚠" tone={data.open.breached ? 'bad' : 'neutral'} value={data.open.breached} />
            <StatCard label="At risk" icon="◔" tone={data.open.atRisk ? 'warn' : 'neutral'} value={data.open.atRisk} />
            <StatCard label="Resolved" value={data.resolved} hint={period} />
            <StatCard label="Resolution SLA met" value={pct(data.sla.resolution.compliance)} hint={`${data.sla.resolution.met} met, ${data.sla.resolution.missed} missed`} />
            <StatCard label="Avg time to resolve" value={hrs(data.times.resolution.avgHours)} hint={`median ${hrs(data.times.resolution.medianHours)}`} />
            <StatCard label="Satisfaction" value={data.csat.average === null ? '—' : `${data.csat.average} / 5`} hint={`${data.csat.count} rating${data.csat.count === 1 ? '' : 's'}`} />
            <StatCard label="Time logged" value={`${data.work.hours} h`} hint={`${data.work.entries} work log entries`} />
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <ChartCard title="Created vs resolved" subtitle={`my tickets per day, ${period}`} className="md:col-span-2"
              chart={<TrendChart points={data.trend} />}
              table={<SimpleTable columns={[{ key: 'date', header: 'Day' }, { key: 'created', header: 'Created', align: 'right' }, { key: 'resolved', header: 'Resolved', align: 'right' }]} rows={data.trend} />} />
            <ChartCard title="My open tickets by status"
              chart={<BarList items={data.open.byStatus.map((s) => ({ label: s.status.replace('_', ' '), value: s.count, hint: `${s.count} ${s.status}` }))} empty="Nothing open" />}
              table={<SimpleTable columns={[{ key: 'status', header: 'Status' }, { key: 'count', header: 'Tickets', align: 'right' }]} rows={data.open.byStatus} />} />
            <ChartCard title="Ratings from requesters" subtitle={period}
              chart={<RatingBars distribution={data.csat.distribution} />}
              table={<SimpleTable columns={[{ key: 'rating', header: 'Stars' }, { key: 'count', header: 'Ratings', align: 'right' }]} rows={data.csat.distribution} />} />
          </div>
        </div>
      )}
    </div>
  )
}
