import { Link } from 'react-router-dom'
import { styles } from '../styles/common.js'

export const NotFound = () => (
  <div className={styles.container}>
    <div className={styles.card}>
      <h1 className={styles.h1}>404 — Page not found</h1>
      <Link to="/" className={styles.btnPrimary}>Back home</Link>
    </div>
  </div>
)
