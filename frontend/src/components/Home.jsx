import { Link } from 'react-router-dom'
import { useAuthStore } from '../store/authStore.js'
import { styles } from '../styles/common.js'

export const Home = () => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.h1}>ServiceDesk Pro</h1>
        <p className="text-slate-600 mb-4">IT helpdesk & asset management — MVP build.</p>
        {!isAuthenticated && (
          <div className="flex gap-3">
            <Link to="/login" className={styles.btnPrimary}>Login</Link>
            <Link to="/register" className={styles.btnSecondary}>Register</Link>
          </div>
        )}
        {isAuthenticated && <Link to="/tickets" className={styles.btnPrimary}>Go to my tickets</Link>}
      </div>
    </div>
  )
}
