import { useState } from 'react'
import { useFetch } from '../../hooks/useFetch.js'
import { DataTable } from '../common/DataTable.jsx'
import { styles } from '../../styles/common.js'

const ENTITY_TYPES = ['TICKET', 'ASSET', 'KB_ARTICLE', 'USER', 'DEPARTMENT', 'CATEGORY', 'SLA_POLICY', 'ORG_SETTINGS', 'REPORT']
const BLANK = { entityType: '', entityRef: '', action: '' }

export const AuditPage = () => {
  const [page, setPage] = useState(1)
  const [draft, setDraft] = useState(BLANK)
  const [applied, setApplied] = useState(BLANK) // typing does not fire a request per key
  const { data, loading, error } = useFetch('/admin-api/audit-logs', {
    page, limit: 20, entityType: applied.entityType || undefined, entityRef: applied.entityRef || undefined, action: applied.action || undefined,
  })

  const apply = (e) => {
    e.preventDefault()
    setPage(1)
    setApplied({ entityType: draft.entityType, entityRef: draft.entityRef.trim(), action: draft.action.trim().toUpperCase() })
  }
  const clear = () => { setDraft(BLANK); setApplied(BLANK); setPage(1) }

  const columns = [
    { key: 'createdAt', header: 'When', render: (e) => <span className="whitespace-nowrap text-xs">{new Date(e.createdAt).toLocaleString()}</span> },
    { key: 'actor', header: 'Who', render: (e) => (e.actor ? `${e.actor.firstName} ${e.actor.lastName ?? ''}`.trim() : <span className="text-slate-400">system</span>) },
    { key: 'action', header: 'Action', render: (e) => <span className="font-mono text-xs">{e.action}</span> },
    { key: 'entityType', header: 'What', render: (e) => <span>{e.entityType.replace('_', ' ')} <span className="text-slate-400 text-xs">{e.entityRef}</span></span> },
    { key: 'details', header: 'Details', render: (e) => (e.before || e.after
      ? <details><summary className="cursor-pointer text-indigo-600 text-xs">show</summary><pre className="text-xs bg-slate-50 rounded p-2 mt-1 max-w-xs overflow-x-auto">{JSON.stringify({ before: e.before, after: e.after }, null, 1)}</pre></details>
      : null) },
  ]

  return (
    <div className={styles.card}>
      <h2 className={styles.h2}>Audit log</h2>
      <p className="text-sm text-slate-500 mb-4">Every change to tickets, assets, articles, users and settings. Entries can never be edited or deleted.</p>
      <form onSubmit={apply} className="flex flex-wrap items-center gap-2 mb-4">
        <select className={styles.select + ' max-w-[11rem]'} value={draft.entityType} onChange={(e) => setDraft({ ...draft, entityType: e.target.value })} aria-label="Filter by type">
          <option value="">All types</option>
          {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
        </select>
        <input className={styles.input + ' max-w-[13rem]'} placeholder="Reference, e.g. TKT-2026-00004" value={draft.entityRef} onChange={(e) => setDraft({ ...draft, entityRef: e.target.value })} />
        <input className={styles.input + ' max-w-[13rem]'} placeholder="Action, e.g. USER_CREATED" value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })} />
        <button className={styles.btnSecondary} type="submit">Filter</button>
        <button type="button" className={styles.btnLink} onClick={clear}>Clear</button>
      </form>
      <DataTable columns={columns} rows={data?.items} loading={loading} error={error}
        page={data?.page} totalPages={data?.totalPages} total={data?.total} onPageChange={setPage} emptyTitle="No entries match" />
    </div>
  )
}
