import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFetch } from '../../hooks/useFetch.js'
import { DataTable } from '../common/DataTable.jsx'
import { PriorityBadge } from '../common/Badges.jsx'
import { styles } from '../../styles/common.js'

const PAGE_SIZE = 15

// Manager/Admin inbox — just the ticket list filtered to PENDING_APPROVAL.
// Role scoping (Manager sees only their own team) is already enforced
// server-side by buildTicketQuery.js, so this reuses the same list route.
export const ApprovalsInbox = () => {
  const [page, setPage] = useState(1)
  const navigate = useNavigate()
  const { data, loading, error } = useFetch('/ticket-api/tickets', { status: 'PENDING_APPROVAL', page, limit: PAGE_SIZE })

  const columns = [
    { key: 'publicId', header: 'ID', render: (t) => <span className="font-mono text-xs">{t.publicId}</span> },
    { key: 'title', header: 'Title' },
    { key: 'requester', header: 'Requester', render: (t) => [t.requester?.firstName, t.requester?.lastName].filter(Boolean).join(' ') },
    { key: 'category', header: 'Category', render: (t) => t.category?.name },
    { key: 'priority', header: 'Priority', render: (t) => <PriorityBadge priority={t.priority} /> },
  ]

  return (
    <div className={styles.container}>
      <h1 className={styles.h1}>Approvals</h1>
      <div className={styles.card}>
        <DataTable columns={columns} rows={data?.items} loading={loading} error={error}
          onRowClick={(t) => navigate(`/tickets/${t.publicId}`)}
          page={data?.page} totalPages={data?.totalPages} total={data?.total} onPageChange={setPage}
          emptyTitle="Nothing waiting on approval right now." />
      </div>
    </div>
  )
}
