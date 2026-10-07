import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Bell, CalendarClock, CheckCircle2, ClipboardCheck, Hourglass, Inbox, ListChecks, Plus, Boxes } from 'lucide-react'
import { useAuthStore } from '../../store/authStore.js'
import { useFetch } from '../../hooks/useFetch.js'
import { styles } from '../../styles/common.js'
import { RoleBadge } from '../common/Badges.jsx'
import { SkeletonLine } from '../common/Skeleton.jsx'
import { navItemsFor, canCreateTicket, dashboardFor } from '../layout/navConfig.js'

const greeting = () => {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

const TONES = {
  neutral: 'bg-indigo-50 text-indigo-600',
  good: 'bg-green-50 text-green-600',
  warn: 'bg-amber-50 text-amber-600',
  bad: 'bg-red-50 text-red-600',
}

// one "needs your attention" number. `value` undefined = still loading; null = unavailable (hidden)
const AttentionCard = ({ icon: Icon, label, hint, value, to, tone = 'neutral' }) => {
  if (value === null) return null
  const body = (
    <>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${TONES[tone] ?? TONES.neutral}`} aria-hidden="true">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        {value === undefined
          ? <SkeletonLine className="h-7 w-10 mb-1" />
          : <p className="text-2xl font-semibold text-slate-900 tabular-nums leading-tight">{value}</p>}
        <p className="text-sm text-slate-600">{label}</p>
        {hint && <p className="text-xs text-slate-400 mt-0.5">{hint}</p>}
      </div>
      {to && <ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-indigo-500 transition self-center" aria-hidden="true" />}
    </>
  )
  const box = 'group flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm'
  return to
    ? <Link to={to} className={box + ' hover:border-indigo-200 hover:shadow-md transition'}>{body}</Link>
    : <div className={box}>{body}</div>
}

// value of a fetched number: undefined while loading, null when the request failed
const valueOf = ({ data, loading, error }, pick) => {
  if (error) return null
  if (loading || data === null || data === undefined) return undefined
  const v = pick(data)
  return Number.isFinite(v) ? v : null
}

export const Welcome = () => {
  const user = useAuthStore((s) => s.user)
  const role = user?.role
  const isEmployee = role === 'EMPLOYEE'
  const isTech = role === 'TECHNICIAN'
  const isLead = role === 'MANAGER' || role === 'ADMIN'
  const isAssetMgr = role === 'ASSET_MANAGER'

  // each request only runs for the roles that use it (a null url skips it); all of
  // them are routes these roles already call elsewhere, scoped by the server
  const resolved = useFetch(isEmployee ? '/ticket-api/tickets' : null, { status: 'RESOLVED', limit: 1 })
  const pending = useFetch(isEmployee || isLead ? '/ticket-api/tickets' : null, { status: 'PENDING_APPROVAL', limit: 1 })
  const open = useFetch(isLead ? '/ticket-api/tickets' : null, { status: 'OPEN', limit: 1 })
  const queue = useFetch(isTech ? '/tech-api/queue' : null)
  const assetStats = useFetch(isAssetMgr ? '/asset-api/stats' : null)
  const unread = useFetch('/notification-api/unread-count')

  const cards = []
  if (isEmployee) {
    cards.push({ key: 'resolved', icon: CheckCircle2, label: 'Waiting for you to confirm', hint: 'Resolved tickets: confirm or reopen', value: valueOf(resolved, (d) => d.total), to: '/tickets?status=RESOLVED', tone: 'good' })
    cards.push({ key: 'pending', icon: Hourglass, label: 'Waiting for approval', hint: 'Requests a manager still has to OK', value: valueOf(pending, (d) => d.total), to: '/tickets?status=PENDING_APPROVAL' })
  }
  if (isTech) {
    cards.push({ key: 'mine', icon: ListChecks, label: 'Assigned to you', hint: 'Your open work', value: valueOf(queue, (d) => d.mine?.length), to: '/my-queue' })
    const breached = valueOf(queue, (d) => d.mine?.filter((t) => t.urgency === 'BREACHED').length)
    cards.push({ key: 'breached', icon: AlertTriangle, label: 'Past their deadline', hint: 'On your queue', value: breached, to: '/my-queue', tone: breached ? 'bad' : 'good' })
    cards.push({ key: 'unassigned', icon: Inbox, label: 'Unclaimed in your team', hint: 'Open a ticket and press Claim', value: valueOf(queue, (d) => d.unassigned?.length), to: '/my-queue', tone: 'warn' })
  }
  if (isLead) {
    const approvals = valueOf(pending, (d) => d.total)
    cards.push({ key: 'approvals', icon: ClipboardCheck, label: 'Waiting for your approval', hint: role === 'ADMIN' ? 'All teams' : 'Your team', value: approvals, to: '/approvals', tone: approvals ? 'warn' : 'good' })
    cards.push({ key: 'open', icon: Inbox, label: 'Open, nobody assigned yet', hint: 'Assign or wait for a claim', value: valueOf(open, (d) => d.total), to: '/tickets?status=OPEN' })
  }
  if (isAssetMgr) {
    cards.push({ key: 'assets', icon: Boxes, label: 'Assets tracked', hint: 'Across every status', value: valueOf(assetStats, (d) => d.total), to: '/assets' })
    const soon = valueOf(assetStats, (d) => d.warranty?.expiringSoon)
    cards.push({ key: 'warranty', icon: CalendarClock, label: 'Warranties ending soon', hint: 'See the warranty view on the asset list', value: soon, to: '/assets', tone: soon ? 'warn' : 'good' })
  }
  cards.push({ key: 'unread', icon: Bell, label: 'Unread notifications', value: valueOf(unread, (d) => d.count), to: '/notifications' })

  const shortcuts = navItemsFor(role).filter((item) => item.to !== '/')
  const dashboard = dashboardFor(role)

  return (
    <div className={styles.containerWide}>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <p className="text-sm text-slate-500">{greeting()},</p>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex flex-wrap items-center gap-3">
            {user?.firstName} <RoleBadge role={role} />
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {dashboard && <Link to={dashboard} className={styles.btnSecondary}>Open my dashboard</Link>}
          {canCreateTicket(role) && <Link to="/tickets/new" className={styles.btnPrimary}><Plus className="h-4 w-4" aria-hidden="true" />New ticket</Link>}
        </div>
      </div>

      <section aria-labelledby="attention-heading">
        <h2 id="attention-heading" className={styles.h2 + ' mb-3'}>Needs your attention</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map(({ key, ...card }) => <AttentionCard key={key} {...card} />)}
        </div>
      </section>

      <section aria-labelledby="shortcuts-heading" className="mt-10">
        <h2 id="shortcuts-heading" className={styles.h2 + ' mb-3'}>Go to</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shortcuts.map(({ to, label, description, icon: Icon }) => (
            <Link key={to} to={to} className="group flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-indigo-200 hover:shadow-md transition">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition" aria-hidden="true">
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="font-medium text-slate-800 group-hover:text-indigo-700">{label}</p>
                {description && <p className="text-sm text-slate-500">{description}</p>}
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
