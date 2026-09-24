import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { useAuthStore } from '../store/authStore.js'
import { Header } from './Header.jsx'
import { styles } from '../styles/common.js'

export const RootLayout = () => {
  const checkAuth = useAuthStore((s) => s.checkAuth)
  const isChecking = useAuthStore((s) => s.isChecking)

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  if (isChecking) {
    return <div className={styles.page}><div className={styles.container}>Loading…</div></div>
  }

  return (
    <div className={styles.page}>
      <Header />
      <Outlet />
    </div>
  )
}
