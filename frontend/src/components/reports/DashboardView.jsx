import { StatCard, ChartCard, SimpleTable, BarList, TrendChart, RatingBars } from '../common/charts/index.js'
import { styles, statusColors } from '../../styles/common.js'

export const pct = (v) => (v === null || v === undefined ? '—' : `${v}%`)
export const hrs = (v) => (v === null || v === undefined ? '—' : `${v} h`)
const stars = (v) => (v === null || v === undefined ? '—' : `${v} / 5`)

export const DAY_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
]

const periodText = (days) => (days ? `last ${days} days` : 'all time')

// the dashboard body, shared by the manager page and the admin overview
export const DashboardView = ({ data, showTeams = false }) => {
  const { scope, totals, sla, times, csat, byStatus, backlogByPriority, trend, categories, workload, teams } = data
  const period = periodText(scope.days)
  const cur = sla.current

  return (
    <div className="space-y-6">
      {scope.truncated && (
        <p className="text-sm rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">
          Only the {scope.ticketsConsidered} most recent tickets were used, so figures may be incomplete.
        </p>
      )}

      <section aria-label="Service levels">
        <h2 className={styles.h2}>SLA compliance <span className="text-sm font-normal text-slate-500">({period})</span></h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Response SLA met" value={pct(sla.response.compliance)} hint={`${sla.response.met} met, ${sla.response.missed} missed`} />
          <StatCard label="Resolution SLA met" value={pct(sla.resolution.compliance)} hint={`${sla.resolution.met} met, ${sla.resolution.missed} missed`} />
          <StatCard label="Avg first response" value={hrs(times.firstResponse.avgHours)} hint={`${times.firstResponse.count} tickets`} />
          <StatCard label="Avg time to resolve" value={hrs(times.resolution.avgHours)} hint={`median ${hrs(times.resolution.medianHours)}, ${times.resolution.count} tickets`} />
        </div>
      </section>

      <section aria-label="Right now">
        <h2 className={styles.h2}>Right now <span className="text-sm font-normal text-slate-500">(live)</span></h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Breached" icon="⚠" tone={cur.breached ? 'bad' : 'neutral'} value={cur.breached} hint="open tickets past their resolution deadline" />
          <StatCard label="At risk" icon="◔" tone={cur.atRisk ? 'warn' : 'neutral'} value={cur.atRisk} hint="close to their deadline" />
          <StatCard label="Unassigned" value={cur.unassigned} hint="nobody has picked these up" />
          <StatCard label="Waiting for approval" value={cur.pendingApproval} hint={`${cur.awaitingConfirmation} resolved, awaiting confirmation`} />
        </div>
        <p className="text-xs text-slate-500 mt-2">
          On track {cur.onTrack} · on hold {cur.onHold} · response overdue {cur.responseOverdue} · earlier breaches on reopened tickets {sla.pastBreaches}
        </p>
      </section>

      <section aria-label="Volume" className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard label="Created" value={totals.created} hint={period} />
        <StatCard label="Resolved" value={totals.resolved} hint={period} />
        <StatCard label="Closed" value={totals.closed} hint={period} />
        <StatCard label="Open now" value={totals.open} />
        <StatCard label="Reopened now" value={totals.reopened} />
      </section>

      <div className="grid md:grid-cols-2 gap-4">
        <ChartCard title="Created vs resolved" subtitle={`per day, ${period}`} className="md:col-span-2"
          chart={<TrendChart points={trend} />}
          table={<SimpleTable columns={[
            { key: 'date', header: 'Day' },
            { key: 'created', header: 'Created', align: 'right' },
            { key: 'resolved', header: 'Resolved', align: 'right' },
          ]} rows={trend} />} />

        <ChartCard title="Open tickets by priority" subtitle="live backlog"
          chart={<BarList items={backlogByPriority.map((b) => ({ label: b.priority, value: b.count, hint: `${b.count} open` }))} empty="No open tickets" />}
          table={<SimpleTable columns={[{ key: 'priority', header: 'Priority' }, { key: 'count', header: 'Open', align: 'right' }]} rows={backlogByPriority} />} />

        <ChartCard title="Customer satisfaction" subtitle={`${csat.count} rating${csat.count === 1 ? '' : 's'}, average ${stars(csat.average)} (${period})`}
          chart={<RatingBars distribution={csat.distribution} />}
          table={<SimpleTable columns={[{ key: 'rating', header: 'Stars' }, { key: 'count', header: 'Ratings', align: 'right' }]} rows={csat.distribution} />} />

        <ChartCard title="All tickets by status" subtitle="all time, same totals as the ticket list"
          chart={<BarList items={byStatus.map((s) => ({ label: s.status.replace('_', ' '), value: s.count, hint: `${s.count} ${s.status}` }))} />}
          table={<SimpleTable columns={[
            { key: 'status', header: 'Status', render: (r) => <span className={`${styles.badge} ${statusColors[r.status] || ''}`}>{r.status}</span> },
            { key: 'count', header: 'Tickets', align: 'right' },
          ]} rows={byStatus} />} />

        <ChartCard title="Top categories" subtitle={`tickets created, ${period}`}
          chart={<BarList items={categories.map((c) => ({ label: c.name, value: c.count, hint: `${c.count} created` }))} />}
          table={<SimpleTable columns={[{ key: 'name', header: 'Category' }, { key: 'count', header: 'Created', align: 'right' }]} rows={categories} />} />
      </div>

      <section className={styles.card} aria-label="Workload">
        <h2 className={styles.h2}>Technician workload</h2>
        <p className="text-xs text-slate-500 mb-3">Open = assigned, in progress, reopened or on hold. Resolved, SLA and satisfaction cover the {period}.</p>
        <SimpleTable
          columns={[
            { key: 'name', header: 'Technician' },
            { key: 'open', header: 'Open', align: 'right' },
            { key: 'breached', header: 'Breached', align: 'right', render: (r) => (r.breached ? <span className="text-red-700 font-medium">⚠ {r.breached}</span> : 0) },
            { key: 'atRisk', header: 'At risk', align: 'right' },
            { key: 'resolved', header: 'Resolved', align: 'right' },
            { key: 'resolutionCompliance', header: 'SLA met', align: 'right', render: (r) => pct(r.resolutionCompliance) },
            { key: 'avgResolutionHours', header: 'Avg resolve', align: 'right', render: (r) => hrs(r.avgResolutionHours) },
            { key: 'csatAverage', header: 'CSAT', align: 'right', render: (r) => (r.csatCount ? `${r.csatAverage} (${r.csatCount})` : '—') },
          ]}
          rows={workload} />
        {workload.length === 0 && <p className="text-sm text-slate-400 py-2">No technicians in this scope</p>}
      </section>

      {showTeams && teams.length > 0 && (
        <section className={styles.card} aria-label="Teams">
          <h2 className={styles.h2}>Teams</h2>
          <SimpleTable
            columns={[
              { key: 'name', header: 'Team' },
              { key: 'open', header: 'Open', align: 'right' },
              { key: 'created', header: 'Created', align: 'right' },
              { key: 'breached', header: 'Breached', align: 'right' },
              { key: 'atRisk', header: 'At risk', align: 'right' },
              { key: 'unassigned', header: 'Unassigned', align: 'right' },
              { key: 'responseCompliance', header: 'Response met', align: 'right', render: (r) => pct(r.responseCompliance) },
              { key: 'resolutionCompliance', header: 'Resolution met', align: 'right', render: (r) => pct(r.resolutionCompliance) },
              { key: 'csatAverage', header: 'CSAT', align: 'right', render: (r) => (r.csatCount ? `${r.csatAverage} (${r.csatCount})` : '—') },
            ]}
            rows={teams} />
        </section>
      )}
    </div>
  )
}
