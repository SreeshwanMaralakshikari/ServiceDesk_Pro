import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { Headset } from 'lucide-react'
import { useAuthStore } from '../store/authStore.js'
import { Header } from './Header.jsx'
import { WakingBanner } from './common/WakingBanner.jsx'
import { AppShell } from './layout/AppShell.jsx'
import { styles } from '../styles/common.js'

export const RootLayout = () => {
  const checkAuth = useAuthStore((s) => s.checkAuth)
  const isChecking = useAuthStore((s) => s.isChecking)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  if (isChecking) {
    return (
      <div className={styles.page}>
        <WakingBanner />
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4" role="status">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-lg animate-pulse" aria-hidden="true">
            <Headset className="h-6 w-6" />
          </span>
          <p className="text-sm text-slate-500">Loading…</p>
        </div>
      </div>
    )
  }

  // signed in: sidebar layout; signed out: simple top bar
  if (isAuthenticated) return <AppShell />

  return (
    <div className={styles.page}>
      <WakingBanner />
      <Header />
      <main>
        <Outlet />
      </main>
    </div>
  )
}
