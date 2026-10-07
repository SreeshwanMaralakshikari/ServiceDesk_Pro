import { Link } from 'react-router-dom'
import { CheckCircle2, Headset } from 'lucide-react'

const POINTS = [
  'Raise a ticket in under a minute, with AI help picking the category',
  'See exactly where your request is and when it is due',
  'Find answers yourself in the knowledge base',
]

// split screen for the sign-in pages: a brand panel on wide screens, the form on the right
export const AuthLayout = ({ title, subtitle, children, footer }) => (
  <div className="min-h-[calc(100vh-3.5rem)] grid lg:grid-cols-2">
    <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-700 to-slate-900 p-12 text-white">
      <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />
      <div className="absolute -left-16 bottom-0 h-64 w-64 rounded-full bg-indigo-400/20 blur-2xl" aria-hidden="true" />
      <Link to="/" className="relative inline-flex items-center gap-2 font-semibold text-lg">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15" aria-hidden="true"><Headset className="h-5 w-5" /></span>
        ServiceDesk Pro
      </Link>
      <div className="relative max-w-md">
        <h2 className="text-3xl font-bold leading-tight">IT support that keeps its promises.</h2>
        <ul className="mt-8 space-y-4">
          {POINTS.map((p) => (
            <li key={p} className="flex gap-3 text-indigo-100">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-indigo-300 mt-0.5" aria-hidden="true" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="relative text-sm text-indigo-200">IT helpdesk &amp; asset management</p>
    </aside>

    <div className="flex items-center justify-center px-4 py-12 sm:px-8">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        <div className="mt-8">{children}</div>
        {footer && <div className="mt-6 text-sm text-slate-500">{footer}</div>}
      </div>
    </div>
  </div>
)
