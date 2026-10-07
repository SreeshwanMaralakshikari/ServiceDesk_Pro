import { Link, NavLink } from 'react-router-dom'
import { Headset, Plus, X } from 'lucide-react'
import { useAuthStore } from '../../store/authStore.js'
import { styles } from '../../styles/common.js'
import { navFor, canCreateTicket } from './navConfig.js'

const linkClass = ({ isActive }) =>
  `group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${isActive
    ? 'bg-indigo-50 text-indigo-700'
    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`

// the left navigation. On wide screens it is always there; on small ones it
// slides in as a drawer (`onClose` shows the close button and runs on a link click)
export const Sidebar = ({ onClose }) => {
  const role = useAuthStore((s) => s.user?.role)
  const sections = navFor(role)

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-4">
        <Link to="/" onClick={onClose} className="inline-flex items-center gap-2 font-semibold text-slate-900">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white" aria-hidden="true"><Headset className="h-4 w-4" /></span>
          ServiceDesk Pro
        </Link>
        {onClose && (
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden" aria-label="Close menu">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main">
        {canCreateTicket(role) && (
          <Link to="/tickets/new" onClick={onClose} className={styles.btnPrimary + ' w-full mb-4'}>
            <Plus className="h-4 w-4" aria-hidden="true" />New ticket
          </Link>
        )}
        {sections.map((section, i) => (
          <div key={section.title ?? i} className={i > 0 ? 'mt-5' : ''}>
            {section.title && <p className="px-3 mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{section.title}</p>}
            <ul className="space-y-0.5">
              {section.items.map(({ to, end, label, icon: Icon }) => (
                <li key={to}>
                  <NavLink to={to} end={end} onClick={onClose} className={linkClass}>
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  )
}
