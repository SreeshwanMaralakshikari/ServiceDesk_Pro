import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Search, Ticket } from 'lucide-react'
import { useFetch } from '../../hooks/useFetch.js'
import { DataTable } from '../common/DataTable.jsx'
import { StatusBadge, PriorityBadge, SLABadge } from '../common/Badges.jsx'
import { useAuthStore } from '../../store/authStore.js'
import { styles, statusColors } from '../../styles/common.js'
import { statusLabel } from '../../utils/labels.js'

const STATUSES = Object.keys(statusColors)
const PAGE_SIZE = 15

export const TicketList = () => {
  const [searchParams] = useSearchParams()
  const [page, setPage] = useState(1)
  // ?status=RESOLVED opens the list already filtered (links from the home page); anything unknown is ignored
  const [status, setStatus] = useState(() => (STATUSES.includes(searchParams.get('status')) ? searchParams.get('status') : ''))
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('') // applied search, so typing does not fire a request per key
  const navigate = useNavigate()
  const role = useAuthStore((s) => s.user?.role)
  // the backend only lets employees (and admin) create tickets, so nobody else is offered the button
  const canCreate = role === 'EMPLOYEE' || role === 'ADMIN'
  const { data, loading, error, reload } = useFetch('/ticket-api/tickets', { page, limit: PAGE_SIZE, status: status || undefined, q: q || undefined })

  const columns = [
    { key: 'publicId', header: 'ID', render: (t) => <span className="font-mono text-xs whitespace-nowrap">{t.publicId}</span> },
    { key: 'title', header: 'Title', render: (t) => <span className="font-medium text-slate-800">{t.title}</span> },
    { key: 'category', header: 'Category', className: 'hidden md:table-cell', render: (t) => t.category?.name },
    { key: 'priority', header: 'Priority', render: (t) => <PriorityBadge priority={t.priority} /> },
    { key: 'status', header: 'Status', render: (t) => <StatusBadge status={t.status} /> },
    { key: 'sla', header: 'SLA', render: (t) => <SLABadge ticket={t} /> },
  ]

  const applySearch = (e) => {
    e.preventDefault()
    setPage(1)
    setQ(search.trim())
  }

  return (
    <div className={styles.container}>
      <div className="flex items-center justify-between mb-4">
        <h1 className={styles.h1 + ' mb-0'}>Tickets</h1>
        {canCreate && <Link to="/tickets/new" className={styles.btnPrimary}><Plus className="h-4 w-4" aria-hidden="true" />New ticket</Link>}
      </div>
      <div className={styles.card}>
        <form onSubmit={applySearch} className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden="true" />
            <input className={styles.input + ' pl-9'} placeholder="Search title or description…" aria-label="Search tickets" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className={styles.select + ' max-w-[12rem]'} value={status} onChange={(e) => { setPage(1); setStatus(e.target.value) }} aria-label="Filter by status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
          <button className={styles.btnSecondary} type="submit">Search</button>
          {(q || status) && <button type="button" className="text-sm text-indigo-600 hover:underline" onClick={() => { setSearch(''); setQ(''); setStatus(''); setPage(1) }}>Clear</button>}
        </form>
        <DataTable columns={columns} rows={data?.items} loading={loading} error={error}
          onRowClick={(t) => navigate(`/tickets/${t.publicId}`)} onRetry={reload}
          page={data?.page} totalPages={data?.totalPages} total={data?.total} onPageChange={setPage}
          emptyTitle="No tickets found" emptyIcon={Ticket} emptyHint={q || status ? 'Try clearing the filters.' : canCreate ? 'Create one with “New ticket”.' : 'Tickets for your team will show up here.'}
          emptyAction={!q && !status && canCreate ? <Link to="/tickets/new" className={styles.btnPrimary}><Plus className="h-4 w-4" aria-hidden="true" />New ticket</Link> : undefined} />
      </div>
    </div>
  )
}
