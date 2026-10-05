import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useFetch } from '../../hooks/useFetch.js'
import { useAuthStore } from '../../store/authStore.js'
import { DataTable } from '../common/DataTable.jsx'
import { styles, statusColors, priorityColors } from '../../styles/common.js'
import { getErrorMessage } from '../../utils/errors.js'
import { downloadCsv } from './downloadCsv.js'

const STATUSES = Object.keys(statusColors)
// fallback until /meta-api/priorities answers
const DEFAULT_PRIORITIES = Object.keys(priorityColors)
const PAGE_SIZE = 15
const BLANK = { q: '', status: '', priority: '', from: '', to: '', department: '' }

const columns = [
  { key: 'publicId', header: 'ID', render: (r) => <span className="font-mono text-xs whitespace-nowrap">{r.publicId}</span> },
  { key: 'title', header: 'Title' },
  { key: 'team', header: 'Team' },
  { key: 'priority', header: 'Priority' },
  { key: 'status', header: 'Status' },
  { key: 'assignedTo', header: 'Assigned to' },
  { key: 'createdAt', header: 'Created (IST)' },
  { key: 'resolutionSla', header: 'Resolution SLA' },
]

export const ReportsPage = () => {
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'ADMIN'
  const [draft, setDraft] = useState(BLANK)
  const [applied, setApplied] = useState(BLANK)
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState(false)
  const { data: priorityData } = useFetch('/meta-api/priorities')
  const priorityOptions = priorityData?.length ? priorityData.map((p) => p.priority) : DEFAULT_PRIORITIES
  const { data: teamData } = useFetch(isAdmin ? '/admin-api/departments' : null, { limit: 50, kind: 'IT_SUPPORT', isActive: true })

  const params = Object.fromEntries(Object.entries(applied).filter(([, v]) => v))
  const { data, loading, error } = useFetch('/report-api/tickets', { ...params, page, limit: PAGE_SIZE })

  const apply = (e) => {
    e.preventDefault()
    setPage(1)
    setApplied({ ...draft, q: draft.q.trim() })
  }
  const clear = () => { setDraft(BLANK); setApplied(BLANK); setPage(1) }
  const set = (key) => (e) => setDraft({ ...draft, [key]: e.target.value })

  const exportCsv = async () => {
    setBusy(true)
    try {
      const { rows, truncated } = await downloadCsv('/report-api/tickets.csv', params, 'tickets.csv')
      toast.success(truncated ? `Downloaded the first ${rows} rows (cap reached, narrow the filters for the rest)` : `Downloaded ${rows} rows`)
    } catch (err) {
      toast.error(getErrorMessage(err, 'Download failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.containerWide}>
      <div className="flex items-center justify-between mb-4">
        <h1 className={styles.h1 + ' mb-0'}>Ticket report</h1>
        <Link to="/manager/dashboard" className={styles.btnSecondary}>Dashboard</Link>
      </div>
      <div className={styles.card}>
        <form onSubmit={apply} className="flex flex-wrap items-end gap-2 mb-4">
          <label className="text-xs text-slate-500 flex flex-col gap-1">Search
            <input className={styles.input + ' max-w-[13rem]'} placeholder="Title or description" value={draft.q} onChange={set('q')} />
          </label>
          <label className="text-xs text-slate-500 flex flex-col gap-1">Status
            <select className={styles.select + ' max-w-[11rem]'} value={draft.status} onChange={set('status')}>
              <option value="">All</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-500 flex flex-col gap-1">Priority
            <select className={styles.select + ' max-w-[9rem]'} value={draft.priority} onChange={set('priority')}>
              <option value="">All</option>
              {priorityOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          {isAdmin && (
            <label className="text-xs text-slate-500 flex flex-col gap-1">Team
              <select className={styles.select + ' max-w-[11rem]'} value={draft.department} onChange={set('department')}>
                <option value="">All teams</option>
                {teamData?.items?.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
              </select>
            </label>
          )}
          <label className="text-xs text-slate-500 flex flex-col gap-1">Created from
            <input type="date" className={styles.input + ' max-w-[10rem]'} value={draft.from} onChange={set('from')} />
          </label>
          <label className="text-xs text-slate-500 flex flex-col gap-1">to
            <input type="date" className={styles.input + ' max-w-[10rem]'} value={draft.to} onChange={set('to')} />
          </label>
          <button className={styles.btnSecondary} type="submit">Apply</button>
          {Object.values(applied).some(Boolean) && <button type="button" className={styles.btnLink} onClick={clear}>Clear</button>}
          <button type="button" className={styles.btnPrimary + ' ml-auto'} onClick={exportCsv} disabled={busy || !data || data.total === 0}>
            {busy ? 'Preparing…' : 'Download CSV'}
          </button>
        </form>
        {data && (
          <p className="text-xs text-slate-500 mb-3">
            {data.total} ticket{data.total === 1 ? '' : 's'} match. The CSV has the same columns plus requester, dates and close reason
            {data.total > data.exportCap ? ` (limited to the newest ${data.exportCap})` : ''}. Dates are in IST.
          </p>
        )}
        <DataTable columns={columns} rows={data?.items} loading={loading} error={error}
          page={data?.page} totalPages={data?.totalPages} total={data?.total} onPageChange={setPage}
          emptyTitle="No tickets match" emptyHint="Try widening the dates or clearing the filters." />
      </div>
    </div>
  )
}
