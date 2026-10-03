import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/authStore.js'
import { styles } from '../styles/common.js'
import { NotificationBell } from './notifications/NotificationBell.jsx'

export const Header = () => {
  const { user, isAuthenticated, logout } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = async () => {
    try {
      await logout()
      toast.success('Logged out')
    } catch {
      // the session is cleared locally either way; the cookie expires on its own
      toast.error('Could not reach the server, you were signed out on this device')
    }
    navigate('/login')
  }

  return (
    <header className="sticky top-0 z-10 bg-white border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 min-h-14 py-2 flex items-center justify-between gap-4">
        <Link to="/" className="font-semibold text-indigo-600 whitespace-nowrap">ServiceDesk Pro</Link>
        <nav className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
          {isAuthenticated ? (
            <>
              {user?.role !== 'ASSET_MANAGER' && <Link to="/tickets" className={styles.navLink}>My Tickets</Link>}
              {user?.role === 'TECHNICIAN' && <Link to="/my-queue" className={styles.navLink}>My Queue</Link>}
              {user?.role === 'TECHNICIAN' && <Link to="/tech/dashboard" className={styles.navLink}>My Dashboard</Link>}
              {(user?.role === 'MANAGER' || user?.role === 'ADMIN') && <Link to="/manager/dashboard" className={styles.navLink}>Dashboard</Link>}
              {(user?.role === 'MANAGER' || user?.role === 'ADMIN') && <Link to="/approvals" className={styles.navLink}>Approvals</Link>}
              {(user?.role === 'MANAGER' || user?.role === 'ADMIN') && <Link to="/reports" className={styles.navLink}>Reports</Link>}
              <Link to="/kb" className={styles.navLink}>Knowledge Base</Link>
              <Link to="/my-assets" className={styles.navLink}>My Assets</Link>
              {(user?.role === 'ASSET_MANAGER' || user?.role === 'ADMIN' || user?.role === 'TECHNICIAN') && <Link to="/assets" className={styles.navLink}>Assets</Link>}
              {(user?.role === 'ASSET_MANAGER' || user?.role === 'ADMIN') && <Link to="/asset-stats" className={styles.navLink}>Asset Stats</Link>}
              {(user?.role === 'ASSET_MANAGER' || user?.role === 'ADMIN') && <Link to="/vendors" className={styles.navLink}>Vendors</Link>}
              {user?.role === 'ADMIN' && <Link to="/admin" className={styles.navLink}>Admin</Link>}
              <NotificationBell />
              <Link to="/account/password" className="text-sm text-slate-400 hover:text-indigo-600 whitespace-nowrap" title="Change password">{user?.firstName} · {user?.role}</Link>
              <button onClick={handleLogout} className={styles.btnSecondary}>Logout</button>
            </>
          ) : (
            <>
              <Link to="/login" className={styles.navLink}>Login</Link>
              <Link to="/register" className={styles.btnPrimary}>Register</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}
