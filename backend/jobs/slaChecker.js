import { TicketModel } from '../models/TicketModel.js'
import { evaluateTicketSla, SLA_RUNNING_STATUSES } from '../utils/evaluateSla.js'
import { cronStatus } from './status.js'

// only pulls tickets whose SLA clock is running AND have at least one
// due-date/warn-date already in the past — evaluateTicketSla's own
// conditional updateOne guards make repeat runs idempotent regardless,
// but this keeps each run's query cheap.
export const runSlaCheck = async () => {
  const now = new Date()
  const tickets = await TicketModel.find({
    isDeleted: false,
    status: { $in: SLA_RUNNING_STATUSES },
    $or: [
      { 'sla.responseDueAt': { $lte: now } },
      { 'sla.resolutionDueAt': { $lte: now } },
      { 'sla.warnAt': { $lte: now } },
    ],
  })
  for (const ticket of tickets) {
    await evaluateTicketSla(ticket)
  }
  return tickets.length
}

// Render's free tier sleeps when idle, so this cron is a best-effort pass —
// the lazy check on ticket fetch (see TicketAPI.js) is the real safety net
// that catches anything the cron missed while the service was asleep.
//
// node-cron is imported lazily, inside this function, instead of as a
// top-level `import` — a top-level import is resolved before ANY server
// code runs, so on a machine where `npm install` hasn't pulled in node-cron
// yet, that alone would crash the entire server at startup, not just disable
// this one background job. Importing it here means a missing package just
// disables the cron sweep with a clear log line; every HTTP route, including
// the lazy SLA check on ticket fetch, still works.
export const startSlaChecker = async () => {
  let cron
  try {
    cron = (await import('node-cron')).default
  } catch {
    cronStatus.sla = 'disabled'
    console.log('SLA checker disabled: node-cron is not installed (run `npm install` in backend/). Tickets are still SLA-evaluated lazily on fetch — see TicketAPI.js.')
    return
  }
  cron.schedule('*/5 * * * *', async () => {
    try {
      const count = await runSlaCheck()
      if (count) console.log(`SLA checker: evaluated ${count} ticket(s)`)
    } catch (err) {
      console.log('SLA checker failed:', err.message)
    }
  })
  cronStatus.sla = 'running'
  console.log('SLA checker scheduled (every 5 minutes)')
}
