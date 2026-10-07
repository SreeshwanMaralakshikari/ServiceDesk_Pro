import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { Headset, Menu } from 'lucide-react'
import { NotificationBell } from '../notifications/NotificationBell.jsx'
import { WakingBanner } from '../common/WakingBanner.jsx'
import { Sidebar } from './Sidebar.jsx'
import { UserMenu } from './UserMenu.jsx'

// the frame around every page once someone is signed in: a fixed sidebar on
// wide screens, a slide-in drawer on small ones, and a top bar with the
// notification bell and the user menu
export const AppShell = () => {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()

  // any navigation closes the drawer
  useEffect(() => { setDrawerOpen(false) }, [location.pathname])

  // Escape closes it too, and the page behind must not scroll while it is open
  useEffect(() => {
    if (!drawerOpen) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setDrawerOpen(false) }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [drawerOpen])

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* wide screens: always-visible sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-20 lg:flex lg:w-64 lg:flex-col border-r border-slate-200">
        <Sidebar />
      </aside>

      {/* small screens: drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-xl">
            <Sidebar onClose={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <WakingBanner />
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur">
          <button type="button" onClick={() => setDrawerOpen(true)} className="rounded-lg p-2 -ml-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open menu" aria-expanded={drawerOpen}>
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <Link to="/" className="inline-flex items-center gap-2 font-semibold text-slate-900 lg:hidden">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white" aria-hidden="true"><Headset className="h-4 w-4" /></span>
            <span className="hidden min-[400px]:inline">ServiceDesk Pro</span>
          </Link>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <NotificationBell />
            <UserMenu />
          </div>
        </header>
        <main>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
