import { Link } from 'react-router-dom'
import { styles } from '../styles/common.js'

export const Unauthorized = () => (
  <div className={styles.container}>
    <div className={styles.card}>
      <h1 className={styles.h1}>403 — Not authorized</h1>
      <p className="text-slate-600 mb-4">You don't have permission to view that page.</p>
      <Link to="/" className={styles.btnPrimary}>Back home</Link>
    </div>
  </div>
)
