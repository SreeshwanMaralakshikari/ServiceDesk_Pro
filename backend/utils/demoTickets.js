import { TicketModel } from '../models/TicketModel.js'
import { WorkLogModel } from '../models/WorkLogModel.js'
import { UserModel } from '../models/UserModel.js'
import { CategoryModel } from '../models/CategoryModel.js'
import { SLAPolicyModel } from '../models/SLAPolicyModel.js'
import { generateSequentialId } from './generateSequentialId.js'

// Demo tickets for the dashboards and reports. Without them every chart is empty.
//
// The table is fixed (no randomness) and every time is "n hours before now", so a fresh seed
// always produces the same counts and the dashboard numbers can be checked against it.
// The SLA dates here are plain wall-clock hours from the start of the ticket, not business
// hours, so the met/missed outcome never depends on whether the seed ran on a weekend.
// (The live engine uses business hours; this only shapes the demo data.)
//
// Safe to re-run: a ticket is skipped when one with the same title and requester exists.
// Only the non-production seed calls this (demo people are not created in production).

const H = 3600000

// fields: title, cat, pri, req, tech, status, ageH (hours since created)
//   respH     hours from the start of the ticket to the first reply
//   resolveH  hours from the start of the ticket to the resolution
//   csat      the rating the requester gave after closing
//   holdAgoH  ON_HOLD: how long ago it was put on hold
//   reopen    { firstResolveH, reopenedAgoH, pastBreach }: resolved and closed once, then reopened
//   resp / res are listed in the comments only where an outcome is worth knowing
export const DEMO_TICKET_SPECS = [
  // closed after the requester confirmed (17): 13 within 30 days, 3 older than that, 1 never rated
  { title: 'Laptop will not power on after update', cat: 'Hardware', pri: 'MEDIUM', req: 'eli', tech: 'theo', status: 'CLOSED', ageH: 480, respH: 2, resolveH: 10, csat: 5 },
  { title: 'External monitor shows no signal', cat: 'Hardware', pri: 'HIGH', req: 'hana', tech: 'ravi', status: 'CLOSED', ageH: 432, respH: 1, resolveH: 6, csat: 4 },
  { title: 'Printer on floor 2 jams on every page', cat: 'Hardware', pri: 'LOW', req: 'omar', tech: 'theo', status: 'CLOSED', ageH: 384, respH: 5, resolveH: 30, csat: 5 },
  { title: 'Docking station not charging the laptop', cat: 'Hardware', pri: 'CRITICAL', req: 'eli', tech: 'ravi', status: 'CLOSED', ageH: 360, respH: 0.5, resolveH: 6, csat: 3 }, // resolved late (4h allowed)
  { title: 'Outlook keeps asking for the password', cat: 'Software', pri: 'MEDIUM', req: 'hana', tech: 'tara', status: 'CLOSED', ageH: 336, respH: 3, resolveH: 20, csat: 4 },
  { title: 'Excel crashes when opening the shared workbook', cat: 'Software', pri: 'HIGH', req: 'omar', tech: 'tara', status: 'CLOSED', ageH: 288, respH: 5, resolveH: 9, csat: 2 }, // late reply and late resolution
  { title: 'Request: install Visio on my laptop', cat: 'Software', pri: 'LOW', req: 'eli', tech: 'tara', status: 'CLOSED', ageH: 264, respH: 10, resolveH: 50, csat: 5 },
  { title: 'Teams meeting audio cuts out', cat: 'Software', pri: 'MEDIUM', req: 'hana', tech: 'theo', status: 'CLOSED', ageH: 216, respH: 2, resolveH: 22, csat: 4 },
  { title: 'VPN drops every few minutes', cat: 'Network', pri: 'HIGH', req: 'eli', tech: 'noor', status: 'CLOSED', ageH: 408, respH: 1, resolveH: 7, csat: 5 },
  { title: 'Network port dead in the meeting room', cat: 'Network', pri: 'CRITICAL', req: 'omar', tech: 'nia', status: 'CLOSED', ageH: 312, respH: 0.5, resolveH: 3, csat: 4 },
  { title: 'Wi-Fi very slow on the third floor', cat: 'Network', pri: 'MEDIUM', req: 'hana', tech: 'noor', status: 'CLOSED', ageH: 240, respH: 9, resolveH: 30, csat: 1 }, // late reply and late resolution
  { title: 'Cannot reach the intranet from the branch office', cat: 'Network', pri: 'HIGH', req: 'eli', tech: 'nia', status: 'CLOSED', ageH: 192, respH: 2, resolveH: 8, csat: 4 }, // resolved exactly on the deadline
  { title: 'New hardware: second monitor for the design team', cat: 'New Hardware Request', pri: 'LOW', req: 'omar', tech: 'ravi', status: 'CLOSED', ageH: 456, respH: 4, resolveH: 40, csat: 5 },
  { title: 'New hardware: wireless keyboard and mouse', cat: 'New Hardware Request', pri: 'LOW', req: 'hana', tech: 'theo', status: 'CLOSED', ageH: 168, respH: 6, resolveH: 60 }, // closed, never rated
  { title: 'Shared drive access denied', cat: 'Software', pri: 'HIGH', req: 'omar', tech: 'theo', status: 'CLOSED', ageH: 120, respH: 1, resolveH: 5, csat: 5 },
  { title: 'Laptop battery drains within an hour', cat: 'Hardware', pri: 'MEDIUM', req: 'eli', tech: 'ravi', status: 'CLOSED', ageH: 1080, respH: 2, resolveH: 14, csat: 4 }, // 45 days old
  { title: 'Firewall blocks the finance portal', cat: 'Network', pri: 'HIGH', req: 'hana', tech: 'noor', status: 'CLOSED', ageH: 1200, respH: 1, resolveH: 12, csat: 2 }, // 50 days old, late

  // resolved, waiting for the requester to confirm (3)
  { title: 'Keyboard keys are sticking', cat: 'Hardware', pri: 'MEDIUM', req: 'omar', tech: 'theo', status: 'RESOLVED', ageH: 72, respH: 2, resolveH: 12 },
  { title: 'Cannot print from Excel', cat: 'Software', pri: 'HIGH', req: 'eli', tech: 'tara', status: 'RESOLVED', ageH: 48, respH: 1, resolveH: 10 }, // resolved late
  { title: 'Guest Wi-Fi password needs a reset', cat: 'Network', pri: 'LOW', req: 'hana', tech: 'noor', status: 'RESOLVED', ageH: 96, respH: 6, resolveH: 20 },

  // in progress (5): on track, at risk, and two past the deadline
  { title: 'Webcam is not detected', cat: 'Hardware', pri: 'HIGH', req: 'eli', tech: 'ravi', status: 'IN_PROGRESS', ageH: 3, respH: 1 }, // on track
  { title: 'Very slow boot on my workstation', cat: 'Software', pri: 'MEDIUM', req: 'hana', tech: 'tara', status: 'IN_PROGRESS', ageH: 20, respH: 2 }, // at risk (24h allowed)
  { title: 'Core switch is dropping packets', cat: 'Network', pri: 'CRITICAL', req: 'omar', tech: 'noor', status: 'IN_PROGRESS', ageH: 5, respH: 0.5 }, // past the deadline (4h allowed)
  { title: 'Office VPN cannot reach the file server', cat: 'Network', pri: 'HIGH', req: 'hana', tech: 'nia', status: 'IN_PROGRESS', ageH: 9, respH: 3 }, // past the deadline (8h allowed)
  { title: 'Dock flickers on the CAD workstation', cat: 'Hardware', pri: 'CRITICAL', req: 'hana', tech: 'theo', status: 'IN_PROGRESS', ageH: 2, respH: 0.5 }, // on track

  // assigned, not started (3)
  { title: 'Replace the mouse scroll wheel', cat: 'Hardware', pri: 'MEDIUM', req: 'omar', tech: 'theo', status: 'ASSIGNED', ageH: 2 },
  { title: 'Install a PDF editor', cat: 'Software', pri: 'LOW', req: 'eli', tech: 'tara', status: 'ASSIGNED', ageH: 30 }, // reply overdue (24h allowed)
  { title: 'Meeting room display flickers', cat: 'Network', pri: 'MEDIUM', req: 'eli', tech: 'noor', status: 'ASSIGNED', ageH: 10 }, // reply overdue (8h allowed)

  // open, nobody has picked them up (4)
  { title: 'Request toner for the floor 1 printer', cat: 'Hardware', pri: 'LOW', req: 'hana', status: 'OPEN', ageH: 5 },
  { title: 'Cannot sign in to Teams', cat: 'Software', pri: 'HIGH', req: 'omar', status: 'OPEN', ageH: 7 }, // reply overdue, at risk
  { title: 'Wi-Fi drops in the cafeteria', cat: 'Network', pri: 'MEDIUM', req: 'hana', status: 'OPEN', ageH: 1 },
  { title: 'Server room temperature alert', cat: 'Network', pri: 'CRITICAL', req: 'eli', status: 'OPEN', ageH: 6 }, // reply overdue, past the deadline

  // on hold (2)
  { title: 'Laptop fan is very loud', cat: 'Hardware', pri: 'MEDIUM', req: 'eli', tech: 'theo', status: 'ON_HOLD', ageH: 30, respH: 2, holdAgoH: 6 },
  { title: 'Remote desktop gateway times out', cat: 'Network', pri: 'LOW', req: 'omar', tech: 'noor', status: 'ON_HOLD', ageH: 50, respH: 4, holdAgoH: 8 },

  // reopened after a confirmed close (2)
  { title: 'Email signature is not saved', cat: 'Software', pri: 'MEDIUM', req: 'eli', tech: 'tara', status: 'REOPENED', ageH: 144, respH: 2, reopen: { firstResolveH: 12, reopenedAgoH: 10 } },
  { title: 'Projector will not connect', cat: 'Hardware', pri: 'HIGH', req: 'hana', tech: 'ravi', status: 'REOPENED', ageH: 120, respH: 1, reopen: { firstResolveH: 12, reopenedAgoH: 9, pastBreach: 1 } }, // first cycle was late, the new one is past its deadline already

  // waiting for approval, rejected, cancelled (4)
  { title: 'New hardware: standing desk converter', cat: 'New Hardware Request', pri: 'LOW', req: 'eli', status: 'PENDING_APPROVAL', ageH: 6 },
  { title: 'New hardware: laptop for a new joiner', cat: 'New Hardware Request', pri: 'LOW', req: 'omar', status: 'PENDING_APPROVAL', ageH: 30 },
  { title: 'New hardware: gaming laptop', cat: 'New Hardware Request', pri: 'LOW', req: 'hana', status: 'REJECTED', ageH: 120 },
  { title: 'Need a spare charger', cat: 'Hardware', pri: 'LOW', req: 'omar', status: 'CANCELLED', ageH: 144 },
]

// 20 more tickets for the second half of the demo (HARDENING seed): the five newer categories, a Finance requester,
// and older tickets so the 90-day window shows more than the 30-day one. They are kept apart from the table above
// on purpose: the dashboard and report tests pin their numbers to the 40-ticket table, and call the seed with
// { extraDemoTickets: false } to keep working from it.
export const EXTRA_DEMO_TICKET_SPECS = [
  // closed after the requester confirmed (8)
  { title: 'Reset my account lockout', cat: 'Access & Accounts', pri: 'MEDIUM', req: 'fay', tech: 'tara', status: 'CLOSED', ageH: 1500, respH: 1, resolveH: 5, csat: 5 },
  { title: 'Request access to the finance share', cat: 'Access & Accounts', pri: 'HIGH', req: 'fay', tech: 'theo', status: 'CLOSED', ageH: 500, respH: 2, resolveH: 7, csat: 4 },
  { title: 'MFA app lost after a phone change', cat: 'Access & Accounts', pri: 'HIGH', req: 'eli', tech: 'tara', status: 'CLOSED', ageH: 960, respH: 3, resolveH: 12, csat: 2 }, // resolved late (8h allowed)
  { title: 'Printer queue stuck on floor 3', cat: 'Printing', pri: 'LOW', req: 'hana', tech: 'ravi', status: 'CLOSED', ageH: 700, respH: 6, resolveH: 40, csat: 4 },
  { title: 'Scanner will not email documents', cat: 'Printing', pri: 'MEDIUM', req: 'fay', tech: 'theo', status: 'CLOSED', ageH: 250, respH: 2, resolveH: 18, csat: 5 },
  { title: 'Suspicious email reported by finance', cat: 'Security', pri: 'HIGH', req: 'fay', tech: 'nia', status: 'CLOSED', ageH: 300, respH: 1, resolveH: 6, csat: 5 },
  { title: 'Backup job failed on the shared drive', cat: 'Server & Storage', pri: 'HIGH', req: 'omar', tech: 'noor', status: 'CLOSED', ageH: 1800, respH: 2, resolveH: 9, csat: 3 }, // resolved late
  { title: 'New software: accounting plug-in', cat: 'New Software Request', pri: 'LOW', req: 'fay', tech: 'ravi', status: 'CLOSED', ageH: 400, respH: 5, resolveH: 50, csat: 4 },

  // resolved, waiting for the requester to confirm (2)
  { title: 'Cannot log in to the HR portal', cat: 'Access & Accounts', pri: 'MEDIUM', req: 'hana', tech: 'tara', status: 'RESOLVED', ageH: 36, respH: 2, resolveH: 14 },
  { title: 'Disk almost full on the file server', cat: 'Server & Storage', pri: 'CRITICAL', req: 'omar', tech: 'noor', status: 'RESOLVED', ageH: 20, respH: 0.5, resolveH: 3.5 },

  // in progress (3)
  { title: 'Printer shows a low toner warning', cat: 'Printing', pri: 'LOW', req: 'fay', tech: 'ravi', status: 'IN_PROGRESS', ageH: 6, respH: 2 },
  { title: 'Phishing link clicked by a colleague', cat: 'Security', pri: 'CRITICAL', req: 'hana', tech: 'nia', status: 'IN_PROGRESS', ageH: 3, respH: 0.5 },
  { title: 'Shared mailbox permissions are wrong', cat: 'Access & Accounts', pri: 'MEDIUM', req: 'eli', tech: 'theo', status: 'IN_PROGRESS', ageH: 22, respH: 3 }, // at risk

  // assigned, not started (2)
  { title: 'Security camera feed is offline', cat: 'Security', pri: 'MEDIUM', req: 'omar', tech: 'nia', status: 'ASSIGNED', ageH: 12 }, // reply overdue
  { title: 'Move my mailbox to the new laptop', cat: 'Access & Accounts', pri: 'LOW', req: 'fay', tech: 'tara', status: 'ASSIGNED', ageH: 4 },

  // open (2)
  { title: 'Storage quota reached on the shared drive', cat: 'Server & Storage', pri: 'MEDIUM', req: 'hana', status: 'OPEN', ageH: 9 }, // reply overdue
  { title: 'Scan to folder is not working', cat: 'Printing', pri: 'LOW', req: 'omar', status: 'OPEN', ageH: 2 },

  // on hold, waiting for approval, cancelled (3)
  { title: 'Server certificate renewal', cat: 'Server & Storage', pri: 'HIGH', req: 'fay', tech: 'noor', status: 'ON_HOLD', ageH: 40, respH: 3, holdAgoH: 12 },
  { title: 'New software: design tool licences', cat: 'New Software Request', pri: 'LOW', req: 'omar', status: 'PENDING_APPROVAL', ageH: 14 },
  { title: 'Duplicate request for a headset', cat: 'Hardware', pri: 'LOW', req: 'fay', status: 'CANCELLED', ageH: 90 },
]

export const DEMO_EMAILS = {
  eli: 'employee@sdp.test',
  hana: 'hana@sdp.test',
  omar: 'omar@sdp.test',
  fay: 'fay@sdp.test',
  theo: 'tech@sdp.test',
  tara: 'tara@sdp.test',
  ravi: 'ravi@sdp.test',
  noor: 'noor@sdp.test',
  nia: 'nia@sdp.test',
  mia: 'manager@sdp.test',
  ian: 'ian@sdp.test',
}

const WORKED_STATUSES = ['IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CLOSED', 'REOPENED']

// turns one table row into the ticket document (and its work log rows). Pure: takes everything it needs
export const buildDemoTicket = (spec, index, { now, publicId, users, category, policy }) => {
  const at = (hoursAgo) => new Date(now.getTime() - hoursAgo * H)
  const requester = users[spec.req]
  const tech = spec.tech ? users[spec.tech] : undefined
  const manager = users[category.managerKey]
  const needsApproval = Boolean(category.requiresApproval)

  const created = at(spec.ageH)
  const approved = needsApproval && !['PENDING_APPROVAL', 'REJECTED'].includes(spec.status)
  // the SLA clock starts when the ticket enters OPEN: at creation, or one hour later for an approved request
  const startedAt = approved ? new Date(created.getTime() + H) : created
  const after = (hours, from = startedAt) => new Date(from.getTime() + hours * H)

  const history = []
  let prev
  const step = (to, when, by, note) => {
    history.push({ from: prev, to, by: by?._id, note, at: when })
    prev = to
  }
  const assignedAt = tech ? after(0.25) : undefined
  const firstRespondedAt = spec.respH !== undefined ? after(spec.respH) : undefined
  const isAuto = category.autoAssign
  const assignmentMethod = tech ? (isAuto ? 'AUTO' : index % 2 ? 'CLAIM' : 'MANUAL') : undefined

  const noClock = ['PENDING_APPROVAL', 'REJECTED'].includes(spec.status)
  step(noClock ? 'PENDING_APPROVAL' : needsApproval ? 'PENDING_APPROVAL' : 'OPEN', created, requester, needsApproval ? 'ticket created — awaiting approval' : 'ticket created')
  if (approved) step('OPEN', startedAt, manager, 'approved')

  const doc = {
    publicId,
    title: spec.title,
    description: `${spec.title}. Reported through the service desk (demo data).`,
    type: category.ticketType,
    requester: requester._id,
    requesterDepartment: requester.department,
    department: category.department,
    category: category._id,
    priority: spec.pri,
    status: spec.status,
    statusHistory: history,
    reopenCount: 0,
    version: 0,
    isDeleted: false,
  }
  if (approved) doc.approval = { approvedBy: manager._id, approvedAt: startedAt }

  let lastEvent = approved ? startedAt : created
  const touch = (date) => {
    if (date > lastEvent) lastEvent = date
  }

  if (spec.status === 'REJECTED') {
    const rejectedAt = after(3, created)
    doc.approval = { rejectedBy: manager._id, rejectedAt, rejectionReason: 'Not covered by the hardware policy' }
    step('REJECTED', rejectedAt, manager, 'Not covered by the hardware policy')
    touch(rejectedAt)
  }

  if (!noClock) {
    const resHours = policy.resolutionTimeHours
    const respHours = policy.responseTimeHours
    const responseDueAt = after(respHours)
    let resolutionDueAt = after(resHours)
    let warnAt = after(resHours * 0.75)
    let cycleStart = startedAt

    if (tech && assignedAt) {
      doc.assignedTo = tech._id
      doc.assignedBy = assignmentMethod === 'AUTO' ? undefined : assignmentMethod === 'CLAIM' ? tech._id : manager._id
      doc.assignedAt = assignedAt
      doc.assignmentMethod = assignmentMethod
      step('ASSIGNED', assignedAt, assignmentMethod === 'MANUAL' ? manager : assignmentMethod === 'CLAIM' ? tech : undefined, assignmentMethod === 'AUTO' ? 'auto-assigned' : undefined)
      touch(assignedAt)
    }
    if (firstRespondedAt && ['IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CLOSED', 'REOPENED'].includes(spec.status)) {
      step('IN_PROGRESS', firstRespondedAt, tech)
      touch(firstRespondedAt)
    }

    let resolvedAt
    if (spec.resolveH !== undefined) {
      resolvedAt = after(spec.resolveH)
      doc.resolution = { summary: 'Fixed and verified with the requester.', resolvedBy: tech._id, resolvedAt, confirmedByRequester: false }
      step('RESOLVED', resolvedAt, tech, 'Fixed and verified with the requester.')
      touch(resolvedAt)
    }
    if (spec.status === 'CLOSED') {
      const closedAt = after(2, resolvedAt)
      doc.resolution.confirmedByRequester = true
      doc.resolution.confirmedAt = closedAt
      doc.closeReason = 'CONFIRMED'
      doc.closedAt = closedAt
      step('CLOSED', closedAt, requester, 'confirmed by the requester')
      touch(closedAt)
      if (spec.csat) {
        const submittedAt = after(3, closedAt)
        doc.csat = { rating: spec.csat, submittedAt, ...(spec.csat <= 2 ? { comment: 'Took longer than I expected.' } : spec.csat === 5 ? { comment: 'Quick and friendly.' } : {}) }
        touch(submittedAt)
      }
    }

    let pastBreaches = 0
    if (spec.reopen) {
      // resolved and closed once, then reopened: the response stays, the resolution clock restarts
      const firstResolved = after(spec.reopen.firstResolveH)
      const firstClosed = after(2, firstResolved)
      step('RESOLVED', firstResolved, tech, 'Fixed and verified with the requester.')
      step('CLOSED', firstClosed, requester, 'confirmed by the requester')
      const reopenedAt = at(spec.reopen.reopenedAgoH)
      step('REOPENED', reopenedAt, requester, 'The problem came back')
      touch(reopenedAt)
      cycleStart = reopenedAt
      resolutionDueAt = after(resHours, reopenedAt)
      warnAt = after(resHours * 0.75, reopenedAt)
      pastBreaches = spec.reopen.pastBreach ?? 0
      doc.reopenCount = 1
    }

    if (spec.status === 'CANCELLED') {
      const cancelledAt = after(2, created)
      doc.cancellation = { cancelledBy: requester._id, cancelledAt, reason: 'No longer needed' }
      step('CANCELLED', cancelledAt, requester, 'No longer needed')
      touch(cancelledAt)
    }

    let pausedAt
    if (spec.status === 'ON_HOLD') {
      pausedAt = at(spec.holdAgoH)
      step('ON_HOLD', pausedAt, tech, 'Waiting for a part')
      touch(pausedAt)
    }

    // the breach flags the SLA checker would have set by now
    const running = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'REOPENED'].includes(spec.status)
    const finishedWithoutAnswer = spec.status === 'CANCELLED'
    const responseBreached = firstRespondedAt ? firstRespondedAt > responseDueAt : !finishedWithoutAnswer && now > responseDueAt
    const resolutionBreached = resolvedAt ? resolvedAt > resolutionDueAt : running && now > resolutionDueAt
    const endOfClock = resolvedAt ?? now
    doc.sla = {
      policy: policy._id,
      startedAt: cycleStart,
      responseDueAt,
      resolutionDueAt,
      firstRespondedAt,
      warnAt,
      responseBreached,
      resolutionBreached,
      warningSent: !resolutionBreached && endOfClock > warnAt && spec.status !== 'ON_HOLD',
      escalationLevel: resolutionBreached ? 2 : responseBreached ? 1 : 0,
      pastBreaches,
      pausedAt,
      totalPausedMs: 0,
    }
  }

  doc.createdAt = created
  doc.updatedAt = lastEvent

  // two work log rows for a ticket somebody has worked on; times are always in the past
  const workLogs = []
  if (tech && WORKED_STATUSES.includes(spec.status) && firstRespondedAt) {
    workLogs.push({ ticket: undefined, technician: tech._id, description: 'Initial diagnosis', minutesSpent: 30 + 15 * (index % 3), createdAt: after(0.25, firstRespondedAt) })
    if (doc.resolution?.resolvedAt) {
      workLogs.push({ ticket: undefined, technician: tech._id, description: 'Fix applied and verified', minutesSpent: 45, createdAt: after(-0.25, doc.resolution.resolvedAt) })
    }
  }
  return { doc, workLogs }
}

// adds whatever demo tickets are missing. Returns { created, existing, workLogs }; or { skipped } when the
// base seed (people, categories, SLA policies) is not there yet
export const ensureDemoTickets = async ({ now = new Date(), extra = true } = {}) => {
  const emails = Object.values(DEMO_EMAILS)
  const found = await UserModel.find({ email: { $in: emails } })
  const users = {}
  for (const [key, email] of Object.entries(DEMO_EMAILS)) users[key] = found.find((u) => u.email === email)
  const missingUser = Object.entries(users).find(([, u]) => !u)
  if (missingUser) return { skipped: `demo user ${DEMO_EMAILS[missingUser[0]]} is missing` }

  const specs = extra ? [...DEMO_TICKET_SPECS, ...EXTRA_DEMO_TICKET_SPECS] : DEMO_TICKET_SPECS
  const usedCategories = [...new Set(specs.map((spec) => spec.cat))]
  const categoryRows = await CategoryModel.find({ name: { $in: usedCategories } })
  const policyRows = await SLAPolicyModel.find({ priority: { $in: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] } })
  const categories = {}
  for (const row of categoryRows) {
    // the approver is the manager of the team that handles the category
    const managerKey = String(row.department) === String(users.ian.department) ? 'ian' : 'mia'
    categories[row.name] = Object.assign(row.toObject(), { managerKey })
  }
  const policies = Object.fromEntries(policyRows.map((p) => [p.priority, p]))
  if (Object.keys(categories).length < usedCategories.length || Object.keys(policies).length < 4) return { skipped: 'categories or SLA policies are missing' }

  // oldest first, so the ticket numbers grow with time
  const ordered = [...specs].sort((a, b) => b.ageH - a.ageH)
  const result = { created: 0, existing: 0, workLogs: 0 }
  for (const [index, spec] of ordered.entries()) {
    const requester = users[spec.req]
    if (await TicketModel.exists({ title: spec.title, requester: requester._id, isDeleted: false })) {
      result.existing++
      continue
    }
    const publicId = await generateSequentialId(TicketModel, 'TKT')
    const { doc, workLogs } = buildDemoTicket(spec, index, { now, publicId, users, category: categories[spec.cat], policy: policies[spec.pri] })
    // timestamps are written by hand so the demo tickets keep their back-dated times
    const [ticket] = await TicketModel.create([doc], { timestamps: false })
    result.created++
    if (workLogs.length) {
      await WorkLogModel.create(workLogs.map((w) => ({ ...w, ticket: ticket._id })), { timestamps: false })
      result.workLogs += workLogs.length
    }
  }
  return result
}
