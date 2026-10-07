import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ChevronDown, KeyRound, LogOut } from 'lucide-react'
import { useAuthStore } from '../../store/authStore.js'
import { RoleBadge } from '../common/Badges.jsx'

const initialsOf = (user) => [user?.firstName, user?.lastName].filter(Boolean).map((n) => n[0]).join('').toUpperCase() || '?'

export const Avatar = ({ user, size = 'h-8 w-8 text-xs' }) => (
  <span className={`flex shrink-0 items-center justify-center rounded-full bg-indigo-600 font-semibold text-white ${size}`} aria-hidden="true">
    {initialsOf(user)}
  </span>
)

// the avatar button in the top bar: who is signed in, change password, log out
export const UserMenu = () => {
  const { user, logout } = useAuthStore()
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)
  const navigate = useNavigate()

  // close on an outside click or Escape
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // same behaviour as the old header's Logout button
  const handleLogout = async () => {
    setOpen(false)
    try {
      await logout()
      toast.success('Logged out')
    } catch {
      // the session is cleared locally either way; the cookie expires on its own
      toast.error('Could not reach the server, you were signed out on this device')
    }
    navigate('/login')
  }

  return (
    <div className="relative" ref={boxRef}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}
        className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-slate-100 transition">
        <Avatar user={user} />
        <span className="hidden sm:block text-left leading-tight">
          <span className="block text-sm font-medium text-slate-700">{user?.firstName}</span>
        </span>
        <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-64 rounded-xl border border-slate-200 bg-white shadow-lg z-40 overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
            <Avatar user={user} size="h-10 w-10 text-sm" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800 truncate">{user?.firstName} {user?.lastName}</p>
              {user?.email && <p className="text-xs text-slate-500 truncate">{user.email}</p>}
              {user?.department?.name && <p className="text-xs text-slate-400 truncate">{user.department.name}</p>}
              <div className="mt-1"><RoleBadge role={user?.role} /></div>
            </div>
          </div>
          <Link to="/account/password" role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
            <KeyRound className="h-4 w-4 text-slate-400" aria-hidden="true" /> Change password
          </Link>
          <button type="button" role="menuitem" onClick={handleLogout} className="flex w-full items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50">
            <LogOut className="h-4 w-4" aria-hidden="true" /> Log out
          </button>
        </div>
      )}
    </div>
  )
}
