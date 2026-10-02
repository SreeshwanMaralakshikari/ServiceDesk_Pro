import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { axiosInstance } from '../../axiosInstance.js'
import { useFetch } from '../../hooks/useFetch.js'
import { DataTable } from '../common/DataTable.jsx'
import { styles } from '../../styles/common.js'
import { getErrorMessage } from '../../utils/errors.js'

export const NotificationsPage = () => {
  const [page, setPage] = useState(1)
  const { data, loading, error, reload } = useFetch('/notification-api/my-notifications', { page, limit: 15 })
  const navigate = useNavigate()

  const open = async (n) => {
    if (!n.isRead) await axiosInstance.put(`/notification-api/mark-read/${n._id}`).catch(() => {})
    if (n.link) navigate(n.link)
    else reload()
  }
  const markAll = async () => {
    try {
      await axiosInstance.put('/notification-api/mark-all-read')
      reload()
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to mark all as read'))
    }
  }

  const columns = [
    { key: 'message', header: 'Notification', render: (n) => <span className={n.isRead ? 'text-slate-500' : 'font-medium text-slate-800'}>{n.message}</span> },
    { key: 'createdAt', header: 'When', render: (n) => <span className="text-xs text-slate-400 whitespace-nowrap">{new Date(n.createdAt).toLocaleString()}</span> },
    { key: 'isRead', header: '', render: (n) => (n.isRead ? null : <span className="inline-block h-2 w-2 rounded-full bg-indigo-600" title="Unread" />) },
  ]

  return (
    <div className={styles.container}>
      <div className="flex items-center justify-between mb-4">
        <h1 className={styles.h1 + ' mb-0'}>Notifications</h1>
        <button className={styles.btnSecondary} onClick={markAll}>Mark all read</button>
      </div>
      <div className={styles.card}>
        <DataTable columns={columns} rows={data?.items} loading={loading} error={error} onRowClick={open}
          page={data?.page} totalPages={data?.totalPages} total={data?.total} onPageChange={setPage}
          emptyTitle="No notifications yet" emptyHint="Updates on your tickets and assets show up here." />
      </div>
    </div>
  )
}
