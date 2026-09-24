import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/authStore.js'
import { styles } from '../styles/common.js'

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
              <Link to="/tickets" className={styles.navLink}>My Tickets</Link>
              {user?.role === 'ADMIN' && <Link to="/admin" className={styles.navLink}>Admin</Link>}
              <span className="text-sm text-slate-400">{user?.firstName} · {user?.role}</span>
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
