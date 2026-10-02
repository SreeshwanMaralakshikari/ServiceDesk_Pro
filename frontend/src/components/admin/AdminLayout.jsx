import { NavLink, Outlet } from 'react-router-dom'
import { styles } from '../../styles/common.js'

const TABS = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/departments', label: 'Departments' },
  { to: '/admin/categories', label: 'Categories' },
  { to: '/admin/sla', label: 'Priorities & SLA' },
  { to: '/admin/settings', label: 'Business hours' },
  { to: '/admin/audit', label: 'Audit log' },
]

export const AdminLayout = () => (
  <div className={styles.containerWide}>
    <h1 className={styles.h1}>Admin</h1>
    <nav className="flex flex-wrap gap-1 border-b border-slate-200 mb-6" aria-label="Admin sections">
      {TABS.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => (isActive ? styles.tabActive : styles.tab)}>{tab.label}</NavLink>
      ))}
    </nav>
    <Outlet />
  </div>
)
