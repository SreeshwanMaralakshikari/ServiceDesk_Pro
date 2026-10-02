import { useNavigate } from 'react-router-dom'
import { useFetch } from '../../hooks/useFetch.js'
import { DataTable } from '../common/DataTable.jsx'
import { PriorityBadge, StatusBadge } from '../common/Badges.jsx'
import { styles } from '../../styles/common.js'
import { formatSlaCountdown } from '../../utils/sla.js'

const URGENCY = {
  BREACHED: { label: 'Breached', className: 'bg-red-100 text-red-700' },
  AT_RISK: { label: 'At risk', className: 'bg-amber-100 text-amber-700' },
  ON_TRACK: { label: 'On track', className: 'bg-green-100 text-green-700' },
  NO_CLOCK: { label: 'No SLA clock', className: 'bg-slate-100 text-slate-600' },
  ON_HOLD: { label: 'On hold', className: 'bg-orange-100 text-orange-700' },
}

const columns = [
  { key: 'rank', header: '#', render: (t) => <span className="text-slate-400">{t.rank}</span> },
  { key: 'publicId', header: 'ID', render: (t) => <span className="font-mono text-xs">{t.publicId}</span> },
  { key: 'title', header: 'Title' },
  { key: 'priority', header: 'Priority', render: (t) => <PriorityBadge priority={t.priority} /> },
  { key: 'status', header: 'Status', render: (t) => <StatusBadge status={t.status} /> },
  {
    key: 'urgency', header: 'SLA',
    render: (t) => {
      const u = URGENCY[t.urgency] ?? URGENCY.NO_CLOCK
      return (
        <div>
          <span className={`${styles.badge} ${u.className}`}>{u.label}</span>
          {t.urgency !== 'ON_HOLD' && t.sla?.resolutionDueAt && <p className="text-xs text-slate-400 mt-0.5">{formatSlaCountdown(t.sla.resolutionDueAt)}</p>}
        </div>
      )
    },
  },
]

const withRank = (rows) => rows?.map((t, i) => ({ ...t, rank: i + 1 }))

// the technician's work list. The server orders both lists with a min-heap:
// SLA urgency first, then the soonest due date, higher priority and older tickets.
export const MyQueue = () => {
  const navigate = useNavigate()
  const { data, loading, error, reload } = useFetch('/tech-api/queue')
  const open = (t) => navigate(`/tickets/${t.publicId}`)

  return (
    <div className={styles.container}>
      <div className="flex items-center justify-between mb-4">
        <h1 className={styles.h1 + ' mb-0'}>My queue</h1>
        <button className={styles.btnSecondary} onClick={reload}>Refresh</button>
      </div>

      <div className={styles.card + ' mb-6'}>
        <h2 className={styles.h2}>Assigned to me ({data?.mine?.length ?? 0})</h2>
        <DataTable columns={columns} rows={withRank(data?.mine)} loading={loading} error={error} onRowClick={open}
          emptyTitle="Nothing assigned to you" emptyHint="Claim a ticket from the list below." />
      </div>

      <div className={styles.card}>
        <h2 className={styles.h2}>Open in my team, nobody has it yet ({data?.unassigned?.length ?? 0})</h2>
        <p className="text-xs text-slate-500 mb-3">Most urgent first. Open a ticket and press Claim to take it.</p>
        <DataTable columns={columns} rows={withRank(data?.unassigned)} loading={loading} error={error} onRowClick={open}
          emptyTitle="No unassigned tickets" emptyHint="Everything open in your team has an owner." />
      </div>
    </div>
  )
}
