import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/authStore.js'
import { styles } from '../styles/common.js'
import { NotificationBell } from './notifications/NotificationBell.jsx'

export const Header = () => {
  const { user, isAuthenticated, logout } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    toast.success('Logged out')
    navigate('/login')
  }

  return (
    <header className="sticky top-0 z-10 bg-white border-b border-slate-200">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link to="/" className="font-semibold text-indigo-600">ServiceDesk Pro</Link>
        <nav className="flex items-center gap-4">
          {isAuthenticated ? (
            <>
              {user?.role !== 'ASSET_MANAGER' && <Link to="/tickets" className={styles.navLink}>My Tickets</Link>}
              {user?.role === 'TECHNICIAN' && <Link to="/my-queue" className={styles.navLink}>My Queue</Link>}
              {(user?.role === 'MANAGER' || user?.role === 'ADMIN') && <Link to="/approvals" className={styles.navLink}>Approvals</Link>}
              <Link to="/kb" className={styles.navLink}>Knowledge Base</Link>
              <Link to="/my-assets" className={styles.navLink}>My Assets</Link>
              {(user?.role === 'ASSET_MANAGER' || user?.role === 'ADMIN' || user?.role === 'TECHNICIAN') && <Link to="/assets" className={styles.navLink}>Assets</Link>}
              {(user?.role === 'ASSET_MANAGER' || user?.role === 'ADMIN') && <Link to="/vendors" className={styles.navLink}>Vendors</Link>}
              {user?.role === 'ADMIN' && <Link to="/admin" className={styles.navLink}>Admin</Link>}
              <NotificationBell />
              <Link to="/account/password" className="text-sm text-slate-400 hover:text-indigo-600" title="Change password">{user?.firstName} · {user?.role}</Link>
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
