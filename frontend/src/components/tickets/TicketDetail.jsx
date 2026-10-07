import { useEffect, useState, useCallback } from 'react'
import { Link, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  ArrowLeft, BookOpen, CalendarDays, CheckCircle2, Clock, FileText, Flag, Folder, Lock, MessageSquare,
  PauseCircle, RefreshCw, RotateCcw, Send, Sparkles, UserCheck, UserRound, XCircle,
} from 'lucide-react'
import { axiosInstance } from '../../axiosInstance.js'
import { useAuthStore } from '../../store/authStore.js'
import { styles } from '../../styles/common.js'
import { getSlaStatus, formatSlaCountdown } from '../../utils/sla.js'
import { getErrorMessage } from '../../utils/errors.js'
import { humanize } from '../../utils/labels.js'
import { StatusBadge, PriorityBadge } from '../common/Badges.jsx'
import { Modal } from '../common/Modal.jsx'
import { PageSkeleton } from '../common/Skeleton.jsx'
import { NotFoundState } from '../common/NotFoundState.jsx'
import { Avatar } from '../layout/UserMenu.jsx'
import { CsatPanel } from './CsatPanel.jsx'
import { WorkLogPanel } from './WorkLogPanel.jsx'
import { AuditPanel } from './AuditPanel.jsx'
import { TimelinePanel } from './TimelinePanel.jsx'
import { SimilarPanel } from './SimilarPanel.jsx'
import { RelatedAssetPanel } from './RelatedAssetPanel.jsx'

// actions that need a required text reason/note alongside them
const NOTE_REQUIRED_ACTIONS = ['reject', 'cancel', 'hold', 'reopen']
// actions that need a technician picked from the team
const ASSIGN_ACTIONS = ['assign', 'reassign']
// nothing can be added to a ticket in one of these statuses (mirrors the API)
const FINISHED_STATUSES = ['CLOSED', 'CANCELLED', 'REJECTED']

// which actions this role/status combo could plausibly try — the backend
// (utils/ticketTransitions.js) is still the source of truth and will
// reject anything not actually allowed
const actionsFor = (ticket, user) => {
  if (!ticket || !user) return []
  const { status } = ticket
  // serialized users carry `_id` (no `id` virtual), and guard the null case so
  // an unassigned ticket (assignedTo undefined) can't make undefined === undefined
  const isOwner = Boolean(ticket.requester) && user._id === ticket.requester._id
  const isAssignee = Boolean(ticket.assignedTo) && user._id === ticket.assignedTo._id
  const isManagerOrAdmin = user.role === 'MANAGER' || user.role === 'ADMIN'
  const options = []

  if (status === 'PENDING_APPROVAL' && isManagerOrAdmin) options.push('approve', 'reject')
  if (status === 'OPEN' && isManagerOrAdmin) options.push('assign')
  if (status === 'OPEN' && user.role === 'TECHNICIAN') options.push('claim')
  if (['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'REOPENED'].includes(status) && isManagerOrAdmin) options.push('reassign')
  if (['ASSIGNED', 'REOPENED'].includes(status) && isAssignee) options.push('start')
  if (status === 'IN_PROGRESS' && isAssignee) options.push('hold', 'resolve')
  if (status === 'ON_HOLD' && isAssignee) options.push('resume')
  if (status === 'RESOLVED' && isOwner) options.push('confirm', 'reopen')
  if (status === 'CLOSED' && isOwner) options.push('reopen')
  if (['PENDING_APPROVAL', 'OPEN', 'ASSIGNED'].includes(status) && (isOwner || user.role === 'ADMIN')) options.push('cancel')
  return options
}

const ASSIGN_METHOD = { AUTO: 'auto-assigned', MANUAL: 'assigned by a manager', CLAIM: 'claimed' }

const ACTION_LABELS = {
  approve: 'Approve', reject: 'Reject', cancel: 'Cancel', assign: 'Assign',
  reassign: 'Reassign', claim: 'Claim', start: 'Start work', hold: 'Put on hold',
  resume: 'Resume', resolve: 'Resolve', confirm: 'Confirm & close', reopen: 'Reopen',
}

const ACTION_ICONS = {
  approve: CheckCircle2, reject: XCircle, cancel: XCircle, assign: UserCheck, reassign: UserCheck,
  claim: UserCheck, start: Send, hold: PauseCircle, resume: RotateCcw, resolve: CheckCircle2,
  confirm: CheckCircle2, reopen: RotateCcw,
}

// the one button that is the obvious next step gets the primary style
const PRIMARY_ORDER = ['approve', 'claim', 'start', 'resolve', 'confirm', 'resume', 'assign', 'reassign']
const DANGER_ACTIONS = ['reject', 'cancel']

// what the dialog for each action asks for
const DIALOG_TEXT = {
  resolve: { title: 'Resolve ticket', label: 'Resolution summary', hint: 'The requester reads this before confirming the fix.', placeholder: 'What was wrong and what fixed it…' },
  reject: { title: 'Reject request', label: 'Reason', hint: 'The requester sees this reason.', placeholder: 'Why this request is rejected…' },
  cancel: { title: 'Cancel ticket', label: 'Reason', hint: 'Cancelled tickets cannot be reopened.', placeholder: 'Why this ticket is no longer needed…' },
  hold: { title: 'Put on hold', label: 'Reason', hint: 'The SLA clock pauses while the ticket is on hold.', placeholder: 'What are you waiting for…' },
  reopen: { title: 'Reopen ticket', label: 'Reason', hint: 'Tell the team what is still not working.', placeholder: 'What is still wrong…' },
}

const fullName = (person) => [person?.firstName, person?.lastName].filter(Boolean).join(' ')

// one label/value row in the details card
const DetailRow = ({ icon: Icon, label, children }) => (
  <div className="flex gap-3 py-2.5">
    <Icon className="h-4 w-4 shrink-0 text-slate-400 mt-0.5" aria-hidden="true" />
    <div className="min-w-0 flex-1">
      <p className="text-xs text-slate-500">{label}</p>
      <div className="text-sm text-slate-800 mt-0.5">{children}</div>
    </div>
  </div>
)

export const TicketDetail = () => {
  const { ticketId } = useParams()
  const user = useAuthStore((s) => s.user)
  // hoisted above the early returns below, since a hook (the KB-suggestions
  // effect) needs it and hooks can't follow a conditional return
  const isStaff = user?.role === 'ADMIN' || user?.role === 'MANAGER' || user?.role === 'TECHNICIAN'
  const [ticket, setTicket] = useState(null)
  const [technicians, setTechnicians] = useState([])
  const [priorities, setPriorities] = useState([])
  const [priorityPick, setPriorityPick] = useState('')
  const [loading, setLoading] = useState(true)
  const [commentText, setCommentText] = useState('')
  const [isInternal, setIsInternal] = useState(false)
  const [resolutionSummary, setResolutionSummary] = useState('')
  const [noteDrafts, setNoteDrafts] = useState({})
  const [technicianPick, setTechnicianPick] = useState('')
  const [reloadKey, setReloadKey] = useState(0) // bumps on every reload so the timeline refetches
  const [suggested, setSuggested] = useState([]) // ranked technicians for the assign form
  const [kbSuggestions, setKbSuggestions] = useState(null) // { matchedBy, articles } | null while loading or unavailable
  const [dialog, setDialog] = useState(null) // the action whose dialog is open, or null
  const [busy, setBusy] = useState(false) // an action request is in flight

  const load = useCallback(() => {
    axiosInstance.get(`/ticket-api/tickets/${ticketId}`)
      .then(({ data }) => { setTicket(data.payload); setReloadKey((n) => n + 1) })
      .catch((err) => toast.error(getErrorMessage(err, 'Failed to load ticket')))
      .finally(() => setLoading(false))
  }, [ticketId])

  useEffect(() => { load() }, [load])

  // AI-suggested KB articles for this ticket — staff only, and only once the
  // ticket itself has loaded (the endpoint re-derives its own visibility
  // scope from the ticket, so this can't leak anything the caller couldn't
  // already see via GET /ticket-api/tickets/:id)
  const [kbRefreshing, setKbRefreshing] = useState(false)
  const loadKbSuggestions = useCallback(async (refresh = false) => {
    if (refresh) setKbRefreshing(true)
    try {
      const { data } = await axiosInstance.get(`/ai-api/kb-suggestions/${ticketId}`, { params: refresh ? { refresh: 'true' } : undefined })
      setKbSuggestions(data.payload)
    } catch (err) {
      if (refresh) toast.error(getErrorMessage(err, 'Could not refresh suggestions'))
      else setKbSuggestions(null) // quietly optional — never blocks the ticket page
    } finally {
      if (refresh) setKbRefreshing(false)
    }
  }, [ticketId])
  useEffect(() => {
    if (!ticket || !isStaff) { setKbSuggestions(null); return }
    loadKbSuggestions()
  }, [ticket?._id, isStaff, loadKbSuggestions])

  useEffect(() => {
    if (user?.role === 'MANAGER' || user?.role === 'ADMIN') {
      axiosInstance.get('/meta-api/priorities').then(({ data }) => setPriorities(data.payload)).catch(() => {})
    }
  }, [user])

  // who can be assigned: a manager gets their own team from the server; an admin gets the ticket's
  // team, because the assign route refuses a technician from any other team
  const role = user?.role
  const adminDepartment = role === 'ADMIN' ? (ticket?.department?._id ?? ticket?.department) : undefined
  useEffect(() => {
    if (role === 'MANAGER') {
      axiosInstance.get('/ticket-api/team-technicians').then(({ data }) => setTechnicians(data.payload)).catch(() => {})
    } else if (adminDepartment) {
      axiosInstance.get('/ticket-api/team-technicians', { params: { department: adminDepartment } }).then(({ data }) => setTechnicians(data.payload)).catch(() => {})
    }
  }, [role, adminDepartment])

  // heap-ranked technicians for this ticket (lowest load, matching skills first),
  // fetched while the ticket still needs somebody
  const needsAssignee = ticket && ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'REOPENED'].includes(ticket.status)
  useEffect(() => {
    if (!ticket || !needsAssignee || !(user?.role === 'MANAGER' || user?.role === 'ADMIN')) { setSuggested([]); return }
    let cancelled = false
    axiosInstance.get(`/ticket-api/tickets/${ticketId}/suggested-technicians`)
      .then(({ data }) => { if (!cancelled) setSuggested(data.payload) })
      .catch(() => { if (!cancelled) setSuggested([]) })
    return () => { cancelled = true }
  }, [ticket?._id, ticket?.version, needsAssignee, user?.role, ticketId])

  const changePriority = async () => {
    if (!priorityPick || priorityPick === ticket.priority) return
    try {
      await axiosInstance.patch(`/ticket-api/tickets/${ticketId}/priority`, { priority: priorityPick, version: ticket.version })
      toast.success('Priority updated')
      setPriorityPick('')
      load()
    } catch (err) {
      if (err.response?.status === 409) {
        toast.error('This ticket changed. Reloading…')
        load()
      } else {
        toast.error(getErrorMessage(err, 'Failed to change priority'))
      }
    }
  }

  // 'ok' | 'conflict' (the ticket changed underneath us and was reloaded) | 'error'
  const runAction = async (action, body = {}) => {
    setBusy(true)
    try {
      await axiosInstance.patch(`/ticket-api/tickets/${ticketId}/${action}`, { ...body, version: ticket.version })
      toast.success(`Ticket ${action} succeeded`)
      setNoteDrafts((d) => ({ ...d, [action]: '' }))
      setTechnicianPick('')
      load()
      return 'ok'
    } catch (err) {
      if (err.response?.status === 409) {
        toast.error('This ticket changed. Reloading…')
        load()
        return 'conflict'
      }
      toast.error(getErrorMessage(err, `Failed to ${action}`))
      return 'error'
    } finally {
      setBusy(false)
    }
  }

  // a button press: actions that need input open their dialog, the rest run at once
  const startAction = (action) => {
    if (action === 'resolve' || NOTE_REQUIRED_ACTIONS.includes(action) || ASSIGN_ACTIONS.includes(action)) setDialog(action)
    else runAction(action)
  }

  // the dialog's submit: same checks the old inline forms made
  const submitDialog = async (e) => {
    e.preventDefault()
    const action = dialog
    let outcome
    if (action === 'resolve') {
      if (!resolutionSummary.trim()) return toast.error('A resolution summary is required')
      outcome = await runAction('resolve', { resolutionSummary })
      if (outcome === 'ok') setResolutionSummary('')
    } else if (ASSIGN_ACTIONS.includes(action)) {
      if (!technicianPick) return toast.error('Pick a technician first')
      outcome = await runAction(action, { technicianId: technicianPick })
    } else {
      const value = noteDrafts[action]
      if (!value?.trim()) return toast.error('A note is required')
      outcome = await runAction(action, { note: value })
    }
    // on a conflict the ticket was reloaded and this action may no longer apply, so close too
    if (outcome !== 'error') setDialog(null)
  }

  const addComment = async (e) => {
    e.preventDefault()
    if (!commentText.trim()) return
    try {
      await axiosInstance.post(`/ticket-api/tickets/${ticketId}/comments`, { text: commentText, isInternal: internalOnly || isInternal })
      setCommentText('')
      load()
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to add comment'))
    }
  }

  if (loading) return <PageSkeleton wide />
  if (!ticket) return <NotFoundState title="Ticket not found" hint="It may not exist, or you may not have access to it." backTo="/tickets" backLabel="Back to tickets" />

  const actions = actionsFor(ticket, user)
  const primaryAction = PRIMARY_ORDER.find((a) => actions.includes(a))
  const sla = getSlaStatus(ticket)
  const isRequester = Boolean(ticket.requester) && user._id === ticket.requester._id
  const isAssignee = Boolean(ticket.assignedTo) && user._id === ticket.assignedTo._id
  const isFinished = FINISHED_STATUSES.includes(ticket.status)
  // public replies: requester, assigned technician, manager, admin. Another technician of the team can only leave internal notes
  const canReplyPublic = isRequester || isAssignee || user.role === 'MANAGER' || user.role === 'ADMIN'
  const internalOnly = isStaff && !canReplyPublic
  const canChangePriority = (user.role === 'MANAGER' || user.role === 'ADMIN') && !['RESOLVED', 'CLOSED', 'CANCELLED', 'REJECTED'].includes(ticket.status)
  // the asset manager has no ticket list, so the back link would only bounce them
  const backTo = user.role === 'ASSET_MANAGER' ? '/' : '/tickets'

  const buttonClass = (action) => (action === primaryAction ? styles.btnPrimary : DANGER_ACTIONS.includes(action) ? styles.btnDangerSoft : styles.btnSecondary)
  const dialogText = dialog ? DIALOG_TEXT[dialog] : null

  return (
    <div className={styles.containerWide}>
      <Link to={backTo} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-indigo-600 mb-3">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />{backTo === '/' ? 'Home' : 'Tickets'}
      </Link>

      {/* header: what this is, where it stands, what can be done next */}
      <div className={styles.card + ' mb-6'}>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="font-mono text-xs text-slate-500">{ticket.publicId}</span>
          <StatusBadge status={ticket.status} />
          <PriorityBadge priority={ticket.priority} />
          {sla && <span className={`${styles.badge} whitespace-nowrap ${sla.className}`}>{sla.label}</span>}
        </div>
        <h1 className="text-2xl font-semibold text-slate-900 break-words">{ticket.title}</h1>
        <p className="mt-1 text-sm text-slate-500">
          Raised by {fullName(ticket.requester) || 'someone'}
          {ticket.createdAt && <> on {new Date(ticket.createdAt).toLocaleString()}</>}
          {ticket.category?.name && <> · {ticket.category.name}</>}
        </p>

        {/* status notes */}
        {ticket.status === 'REJECTED' && ticket.approval?.rejectionReason && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">Rejected: {ticket.approval.rejectionReason}</p>
        )}
        {ticket.status === 'CANCELLED' && ticket.cancellation?.reason && (
          <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">Cancelled: {ticket.cancellation.reason}</p>
        )}
        {ticket.status === 'ON_HOLD' && (
          <p className="mt-4 inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"><PauseCircle className="h-4 w-4" aria-hidden="true" />On hold — SLA clock paused</p>
        )}
        {ticket.status === 'CLOSED' && ticket.closedAt && (
          <p className="mt-3 text-xs text-slate-500">Closed {new Date(ticket.closedAt).toLocaleString()}{ticket.closeReason ? ` (${humanize(ticket.closeReason).toLowerCase()})` : ''}</p>
        )}
        {ticket.reopenCount > 0 && <p className="mt-1 text-xs text-orange-600">Reopened {ticket.reopenCount} time{ticket.reopenCount > 1 ? 's' : ''}</p>}

        {actions.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4" role="group" aria-label="Ticket actions">
            {[...actions].sort((a, b) => (a === primaryAction ? -1 : b === primaryAction ? 1 : 0)).map((action) => {
              const Icon = ACTION_ICONS[action]
              return (
                <button key={action} type="button" className={buttonClass(action)} disabled={busy} onClick={() => startAction(action)}>
                  {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}{ACTION_LABELS[action]}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* main column: the story of the ticket */}
        <div className="space-y-6 lg:col-span-2 min-w-0">
          <section className={styles.card} aria-label="Description">
            <h2 className={styles.h2 + ' flex items-center gap-2'}><FileText className="h-4 w-4 text-slate-400" aria-hidden="true" />Description</h2>
            <p className="text-slate-700 whitespace-pre-wrap break-words">{ticket.description}</p>
          </section>

          {ticket.resolution?.summary && ['RESOLVED', 'CLOSED'].includes(ticket.status) && (
            <section className={styles.card + ' border-teal-200 bg-teal-50/40'} data-testid="resolution-summary" aria-label="Resolution">
              <h2 className={styles.h2 + ' flex items-center gap-2'}><CheckCircle2 className="h-4 w-4 text-teal-600" aria-hidden="true" />Resolution</h2>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{ticket.resolution.summary}</p>
              {ticket.resolution.resolvedAt && <p className="text-xs text-slate-500 mt-2">Resolved {new Date(ticket.resolution.resolvedAt).toLocaleString()}</p>}
            </section>
          )}

          <CsatPanel ticket={ticket} isRequester={isRequester} onSaved={load} />

          <section className={styles.card} aria-label="Timeline and comments">
            <h2 className={styles.h2 + ' flex items-center gap-2 mb-4'}><MessageSquare className="h-4 w-4 text-slate-400" aria-hidden="true" />Timeline &amp; comments</h2>
            <TimelinePanel ticket={ticket} reloadKey={reloadKey} />

            {isFinished ? (
              <p className="text-sm text-slate-500 border-t border-slate-100 pt-4">This ticket is {ticket.status.toLowerCase()}, so no more comments can be added.</p>
            ) : (
              <form onSubmit={addComment} className="space-y-2 border-t border-slate-100 pt-4">
                <div className="flex gap-3">
                  <Avatar user={user} />
                  <textarea className={styles.textarea} maxLength={2000} aria-label={internalOnly ? 'Internal note' : 'Comment'} placeholder={internalOnly ? 'Add an internal note…' : 'Add a comment…'} value={commentText} onChange={(e) => setCommentText(e.target.value)} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 sm:pl-11">
                  {isStaff ? (
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                      <input type="checkbox" className={styles.checkbox} checked={internalOnly || isInternal} disabled={internalOnly} onChange={(e) => setIsInternal(e.target.checked)} />
                      <Lock className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
                      {internalOnly ? 'Internal note (only the assigned technician or a manager can reply publicly)' : 'Internal note (hidden from requester)'}
                    </label>
                  ) : <span />}
                  <button className={styles.btnPrimary} type="submit"><Send className="h-4 w-4" aria-hidden="true" />Post comment</button>
                </div>
              </form>
            )}
          </section>

          {isStaff && <WorkLogPanel ticket={ticket} canAdd={user.role === 'TECHNICIAN' && isAssignee && !isFinished} onChanged={() => setReloadKey((n) => n + 1)} />}
          {user.role === 'ADMIN' && <AuditPanel ticket={ticket} />}
        </div>

        {/* side column: the facts, and help for the people working on it */}
        <aside className="space-y-6 min-w-0" aria-label="Ticket details">
          <section className={styles.card} aria-label="Details">
            <h2 className={styles.h2}>Details</h2>
            <div className="divide-y divide-slate-100">
              <DetailRow icon={Clock} label="SLA">
                {sla ? <span className={`${styles.badge} ${sla.className}`}>{sla.label}</span> : <span className="text-slate-400">No clock running</span>}
                {sla && sla.label !== 'On hold' && ticket.sla?.resolutionDueAt && (
                  <p className="text-xs text-slate-500 mt-1">
                    {formatSlaCountdown(ticket.sla.resolutionDueAt)} to resolve
                    <span className="block text-slate-400">Due {new Date(ticket.sla.resolutionDueAt).toLocaleString()}</span>
                  </p>
                )}
              </DetailRow>
              <DetailRow icon={Flag} label="Priority">
                <PriorityBadge priority={ticket.priority} />
                {canChangePriority && (
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <select className={styles.select + ' max-w-[11rem]'} aria-label="Change priority" value={priorityPick} onChange={(e) => setPriorityPick(e.target.value)}>
                      <option value="">Change priority…</option>
                      {priorities.filter((p) => p.priority !== ticket.priority).map((p) => <option key={p._id} value={p.priority}>{p.label}</option>)}
                    </select>
                    {priorityPick && <button className={styles.btnSecondary} onClick={changePriority}>Apply</button>}
                  </div>
                )}
              </DetailRow>
              <DetailRow icon={UserRound} label="Requester">{fullName(ticket.requester) || '—'}</DetailRow>
              <DetailRow icon={UserCheck} label="Assigned to">
                {ticket.assignedTo
                  ? <>{fullName(ticket.assignedTo)}{ASSIGN_METHOD[ticket.assignmentMethod] && <span className="block text-xs text-slate-500">{ASSIGN_METHOD[ticket.assignmentMethod]}</span>}</>
                  : <span className="text-slate-400">Unassigned</span>}
              </DetailRow>
              <DetailRow icon={Folder} label="Category">{ticket.category?.name ?? '—'}{ticket.category?.ticketType && <span className="block text-xs text-slate-500">{humanize(ticket.category.ticketType)}</span>}</DetailRow>
              <DetailRow icon={CalendarDays} label="Created">{new Date(ticket.createdAt).toLocaleString()}</DetailRow>
            </div>
          </section>

          <RelatedAssetPanel ticket={ticket} user={user} onChanged={load} />

          {isStaff && kbSuggestions && (kbSuggestions.articles?.length > 0 || kbSuggestions.source === 'ai') && (
            <section className={styles.card} data-testid="kb-suggestions" aria-label="Suggested knowledge base articles">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h2 className={styles.h2 + ' mb-0 flex items-center gap-2'}><BookOpen className="h-4 w-4 text-slate-400" aria-hidden="true" />Suggested articles</h2>
                <button type="button" className={styles.btnLink + ' inline-flex items-center gap-1'} disabled={kbRefreshing} onClick={() => loadKbSuggestions(true)}>
                  <RefreshCw className={`h-3.5 w-3.5 ${kbRefreshing ? 'animate-spin' : ''}`} aria-hidden="true" />{kbRefreshing ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
              <span className={`${styles.badge} gap-1 mb-3 ${kbSuggestions.source === 'ai' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>
                {kbSuggestions.source === 'ai' ? <><Sparkles className="h-3 w-3" aria-hidden="true" />AI-ranked</> : 'Text match'}
              </span>
              {kbSuggestions.articles.length === 0 && <p className="text-sm text-slate-500">{kbSuggestions.source === 'ai' ? 'The AI found no helpful article for this ticket. Refresh to ask again.' : 'No matching article found for this ticket.'}</p>}
              <ul className="space-y-2">
                {kbSuggestions.articles.map((a) => (
                  <li key={a._id}>
                    <Link to={`/kb/${a.publicId}`} className="block rounded-lg border border-slate-200 p-3 hover:border-indigo-200 hover:bg-indigo-50/30 transition">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium text-indigo-700">{a.title}</p>
                        {typeof a.relevance === 'number' && <span className="text-xs font-medium text-slate-500 whitespace-nowrap">{a.relevance}% match</span>}
                      </div>
                      <p className="text-xs text-slate-500">{a.why || a.summary}</p>
                      {a.steps?.length > 0 && (
                        <ol className="mt-2 list-decimal list-inside text-xs text-slate-600 space-y-0.5">
                          {a.steps.map((st, i) => <li key={i}>{st}</li>)}
                        </ol>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
              {kbSuggestions.cached && kbSuggestions.generatedAt && (
                <p className="mt-2 text-xs text-slate-400">Saved {new Date(kbSuggestions.generatedAt).toLocaleString()}. Refresh to ask again.</p>
              )}
            </section>
          )}

          {isStaff && <SimilarPanel ticket={ticket} />}
        </aside>
      </div>

      {/* the dialog for actions that need input */}
      {dialog && (
        <Modal title={ASSIGN_ACTIONS.includes(dialog) ? `${ACTION_LABELS[dialog]} ticket` : dialogText.title} onClose={() => setDialog(null)}>
          <form onSubmit={submitDialog} noValidate>
            {ASSIGN_ACTIONS.includes(dialog) ? (
              <>
                {suggested[0] && (
                  <p className="text-sm text-slate-600 mb-3 rounded-lg bg-indigo-50 border border-indigo-100 px-3 py-2" data-testid="suggestion">
                    Suggested: <strong>{suggested[0].firstName} {suggested[0].lastName}</strong>
                    {' '}({suggested[0].openTickets} open{suggested[0].matchedSkills.length > 0 ? `, skills: ${suggested[0].matchedSkills.join(', ')}` : ''})
                    {technicianPick !== suggested[0]._id && <button type="button" className={styles.btnLink + ' ml-2'} onClick={() => setTechnicianPick(suggested[0]._id)}>Use suggestion</button>}
                  </p>
                )}
                <label className="block">
                  <span className={styles.label}>Technician</span>
                  <select className={styles.select} value={technicianPick} onChange={(e) => setTechnicianPick(e.target.value)} autoFocus>
                    <option value="">Select technician…</option>
                    {technicians.map((t) => <option key={t._id} value={t._id}>{t.firstName} {t.lastName}{Number.isInteger(t.openTickets) ? ` (${t.openTickets} open)` : ''}</option>)}
                  </select>
                </label>
              </>
            ) : (
              <label className="block">
                <span className={styles.label}>{dialogText.label}</span>
                <textarea className={styles.textarea} autoFocus placeholder={dialogText.placeholder}
                  value={dialog === 'resolve' ? resolutionSummary : (noteDrafts[dialog] || '')}
                  onChange={(e) => (dialog === 'resolve' ? setResolutionSummary(e.target.value) : setNoteDrafts((d) => ({ ...d, [dialog]: e.target.value })))} />
                {dialogText.hint && <span className="block text-xs text-slate-500 mt-1">{dialogText.hint}</span>}
              </label>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className={styles.btnSecondary} onClick={() => setDialog(null)}>Back</button>
              <button type="submit" className={DANGER_ACTIONS.includes(dialog) ? styles.btnDanger : styles.btnPrimary} disabled={busy}>
                {busy ? 'Working…' : ACTION_LABELS[dialog]}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
