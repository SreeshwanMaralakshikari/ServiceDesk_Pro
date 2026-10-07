import { Link, NavLink } from 'react-router-dom'
import { Headset } from 'lucide-react'
import { styles } from '../styles/common.js'

// the top bar on the signed-out pages (home, login, register). Signed-in pages
// use the sidebar layout in layout/AppShell.jsx instead.
export const Header = () => (
  <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
    <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
      <Link to="/" className="inline-flex items-center gap-2 font-semibold text-slate-900 whitespace-nowrap">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white" aria-hidden="true"><Headset className="h-4 w-4" /></span>
        ServiceDesk Pro
      </Link>
      <nav className="flex items-center gap-2 sm:gap-4" aria-label="Account">
        <NavLink to="/login" className={({ isActive }) => (isActive ? styles.navLinkActive : styles.navLink)}>Sign in</NavLink>
        <Link to="/register" className={styles.btnPrimary}>Create account</Link>
      </nav>
    </div>
  </header>
)
