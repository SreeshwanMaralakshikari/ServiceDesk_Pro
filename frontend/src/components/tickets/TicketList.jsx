import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useFetch } from '../../hooks/useFetch.js'
import { DataTable } from '../common/DataTable.jsx'
import { StatusBadge, PriorityBadge, SLABadge } from '../common/Badges.jsx'
import { styles, statusColors } from '../../styles/common.js'

const STATUSES = Object.keys(statusColors)
const PAGE_SIZE = 15

export const TicketList = () => {
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('') // applied search, so typing does not fire a request per key
  const navigate = useNavigate()
  const { data, loading, error } = useFetch('/ticket-api/tickets', { page, limit: PAGE_SIZE, status: status || undefined, q: q || undefined })

  const columns = [
    { key: 'publicId', header: 'ID', render: (t) => <span className="font-mono text-xs">{t.publicId}</span> },
    { key: 'title', header: 'Title' },
    { key: 'category', header: 'Category', render: (t) => t.category?.name },
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
        <Link to="/tickets/new" className={styles.btnPrimary}>+ New ticket</Link>
      </div>
      <div className={styles.card}>
        <form onSubmit={applySearch} className="flex flex-wrap items-center gap-2 mb-4">
          <input className={styles.input + ' max-w-xs'} placeholder="Search title or description…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className={styles.select + ' max-w-[12rem]'} value={status} onChange={(e) => { setPage(1); setStatus(e.target.value) }} aria-label="Filter by status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          <button className={styles.btnSecondary} type="submit">Search</button>
          {(q || status) && <button type="button" className="text-sm text-indigo-600 hover:underline" onClick={() => { setSearch(''); setQ(''); setStatus(''); setPage(1) }}>Clear</button>}
        </form>
        <DataTable columns={columns} rows={data?.items} loading={loading} error={error}
          onRowClick={(t) => navigate(`/tickets/${t.publicId}`)}
          page={data?.page} totalPages={data?.totalPages} total={data?.total} onPageChange={setPage}
          emptyTitle="No tickets found" emptyHint={q || status ? 'Try clearing the filters.' : 'Create one with “New ticket”.'} />
      </div>
    </div>
  )
}
