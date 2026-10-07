import { Link } from 'react-router-dom'
import {
  ArrowRight, BarChart3, BookOpen, Boxes, CheckCircle2, ClipboardCheck, Clock, Gauge, Headset,
  History, Laptop, ShieldCheck, Sparkles, Timer, UserRound, Users, Wrench, Zap,
} from 'lucide-react'
import { styles } from '../../styles/common.js'

const FEATURES = [
  { icon: Timer, title: 'SLA engine with business hours', text: 'Response and resolution clocks that pause on hold, count only working hours and warn before a breach.' },
  { icon: Zap, title: 'Smart auto-assignment', text: 'New tickets go to the least-busy technician with matching skills, picked with a min-heap.' },
  { icon: Sparkles, title: 'AI triage and suggestions', text: 'Suggested category and priority while a ticket is written, and ranked knowledge-base fixes for the team.' },
  { icon: Laptop, title: 'Asset lifecycle', text: 'Assign, repair, replace and retire equipment, with warranty alerts and a full history per asset.' },
  { icon: BarChart3, title: 'Dashboards and reports', text: 'SLA compliance, backlog, workload and satisfaction for every role, with CSV export.' },
  { icon: History, title: 'Complete audit trail', text: 'Every status change, assignment and setting is logged and can never be edited or deleted.' },
]

const FLOW = [
  { icon: UserRound, title: 'Raise', text: 'An employee describes the problem' },
  { icon: ClipboardCheck, title: 'Approve', text: 'A manager OKs requests that need it' },
  { icon: Users, title: 'Assign', text: 'Auto-assigned or claimed by a technician' },
  { icon: Wrench, title: 'Resolve', text: 'Work is logged and a fix is written up' },
  { icon: CheckCircle2, title: 'Confirm', text: 'The requester confirms and rates it' },
]

const ROLES = [
  { icon: UserRound, name: 'Employee', text: 'Raises tickets, follows progress, confirms fixes and rates the support.' },
  { icon: Wrench, name: 'Technician', text: 'Works a queue sorted by SLA urgency, logs time and writes KB drafts.' },
  { icon: Gauge, name: 'Manager', text: 'Approves requests, assigns work and watches the team dashboard.' },
  { icon: Boxes, name: 'Asset manager', text: 'Tracks every device and licence from purchase to retirement.' },
  { icon: ShieldCheck, name: 'Admin', text: 'Manages users, teams, categories, SLA targets and business hours.' },
]

const STACK = ['MongoDB', 'Express', 'React', 'Node.js', 'Tailwind CSS', 'Groq AI']

// a small, decorative picture of the app (built from markup, not an image file)
const ProductPreview = () => (
  <div className="relative" aria-hidden="true">
    <div className="absolute -inset-4 rounded-3xl bg-gradient-to-tr from-indigo-200/60 via-sky-100/60 to-transparent blur-2xl" />
    <div className="relative rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden">
      <div className="flex items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-green-300" />
        <span className="ml-3 text-xs text-slate-400">Team dashboard</span>
      </div>
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {[['SLA met', '94%', 'text-green-600'], ['Open', '18', 'text-slate-900'], ['At risk', '3', 'text-amber-600']].map(([label, value, tone]) => (
            <div key={label} className="rounded-xl border border-slate-100 p-3">
              <p className="text-[11px] text-slate-500">{label}</p>
              <p className={`text-xl font-semibold ${tone}`}>{value}</p>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-slate-100 p-3">
          <p className="text-[11px] text-slate-500 mb-2">Created vs resolved</p>
          <div className="flex items-end gap-1.5 h-16">
            {[40, 65, 50, 80, 60, 90, 70, 55, 85, 75, 95, 68].map((h, i) => (
              <div key={i} className="flex-1 rounded-t bg-indigo-500/80" style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>
        <ul className="space-y-2">
          {[
            ['TKT-2026-00058', 'VPN drops every few minutes', 'In progress', 'bg-amber-100 text-amber-700'],
            ['TKT-2026-00057', 'New monitor for the design team', 'Pending approval', 'bg-yellow-100 text-yellow-700'],
            ['TKT-2026-00055', 'Webcam is not detected', 'Resolved', 'bg-teal-100 text-teal-700'],
          ].map(([id, title, status, tone]) => (
            <li key={id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2">
              <div className="min-w-0">
                <p className="font-mono text-[10px] text-slate-400">{id}</p>
                <p className="text-xs font-medium text-slate-700 truncate">{title}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${tone}`}>{status}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  </div>
)

export const Landing = () => (
  <div className="bg-white">
    {/* hero */}
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,#e2e8f0_1px,transparent_0)] [background-size:24px_24px] opacity-70" aria-hidden="true" />
      <div className="absolute inset-x-0 top-0 h-96 bg-gradient-to-b from-indigo-50 to-transparent" aria-hidden="true" />
      <div className="relative max-w-6xl mx-auto px-4 pt-14 pb-16 md:pt-20 md:pb-24 grid gap-12 lg:grid-cols-2 lg:items-center">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white px-3 py-1 text-xs font-medium text-indigo-700 shadow-sm">
            <Headset className="h-3.5 w-3.5" aria-hidden="true" /> IT helpdesk &amp; asset management
          </span>
          <h1 className="mt-5 text-4xl md:text-5xl font-bold tracking-tight text-slate-900 leading-tight">
            Tickets, SLAs and IT assets, <span className="text-indigo-600">in one place.</span>
          </h1>
          <p className="mt-5 text-lg text-slate-600 max-w-xl">
            ServiceDesk Pro routes every request to the right technician, keeps an eye on every deadline and tracks every laptop and licence, so nothing slips through the cracks.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/login" className={styles.btnPrimary + ' px-5 py-2.5'}>Sign in <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
            <Link to="/register" className={styles.btnSecondary + ' px-5 py-2.5'}>Create an account</Link>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-500">
            <li className="inline-flex items-center gap-1.5"><Users className="h-4 w-4 text-indigo-500" aria-hidden="true" />5 roles</li>
            <li className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4 text-indigo-500" aria-hidden="true" />Business-hours SLAs</li>
            <li className="inline-flex items-center gap-1.5"><BookOpen className="h-4 w-4 text-indigo-500" aria-hidden="true" />Knowledge base</li>
          </ul>
        </div>
        <ProductPreview />
      </div>
    </section>

    {/* features */}
    <section className="border-t border-slate-100 bg-slate-50 py-16 md:py-20">
      <div className="max-w-6xl mx-auto px-4">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold text-indigo-600">What it does</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Everything a support team needs, nothing it doesn't</h2>
        </div>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md hover:-translate-y-0.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600" aria-hidden="true">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 font-semibold text-slate-900">{title}</h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* how a ticket flows */}
    <section className="py-16 md:py-20">
      <div className="max-w-6xl mx-auto px-4">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold text-indigo-600">How it works</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">From "it's broken" to "it's fixed"</h2>
        </div>
        <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {FLOW.map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="relative rounded-2xl border border-slate-200 p-5">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600 text-white text-sm font-semibold">{i + 1}</span>
                <Icon className="h-5 w-5 text-slate-400" aria-hidden="true" />
              </div>
              <h3 className="mt-4 font-semibold text-slate-900">{title}</h3>
              <p className="mt-1 text-sm text-slate-600">{text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>

    {/* roles */}
    <section className="border-t border-slate-100 bg-slate-50 py-16 md:py-20">
      <div className="max-w-6xl mx-auto px-4">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold text-indigo-600">Built for five roles</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Everyone sees exactly what they need</h2>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {ROLES.map(({ icon: Icon, name, text }) => (
            <div key={name} className="rounded-2xl border border-slate-200 bg-white p-5">
              <Icon className="h-5 w-5 text-indigo-600" aria-hidden="true" />
              <h3 className="mt-3 font-semibold text-slate-900">{name}</h3>
              <p className="mt-1 text-sm text-slate-600">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* call to action */}
    <section className="py-16">
      <div className="max-w-6xl mx-auto px-4">
        <div className="rounded-3xl bg-gradient-to-br from-indigo-600 to-indigo-800 px-6 py-12 md:px-12 text-center shadow-lg">
          <h2 className="text-2xl md:text-3xl font-bold text-white">Ready to get your IT requests under control?</h2>
          <p className="mt-3 text-indigo-100">Sign in with your work account, or create one to raise your first ticket.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/login" className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50 transition">Sign in <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
            <Link to="/register" className="inline-flex items-center rounded-lg border border-indigo-300 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500/40 transition">Create an account</Link>
          </div>
        </div>
      </div>
    </section>

    <footer className="border-t border-slate-200 py-8">
      <div className="max-w-6xl mx-auto px-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-slate-500"><span className="font-semibold text-slate-700">ServiceDesk Pro</span> · IT helpdesk &amp; asset management</p>
        <ul className="flex flex-wrap gap-2" aria-label="Built with">
          {STACK.map((s) => <li key={s} className={styles.chip}>{s}</li>)}
        </ul>
      </div>
    </footer>
  </div>
)
