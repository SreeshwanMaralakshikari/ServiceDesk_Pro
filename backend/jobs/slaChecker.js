import cron from 'node-cron'
import { TicketModel } from '../models/TicketModel.js'
import { evaluateTicketSla, SLA_RUNNING_STATUSES } from '../utils/evaluateSla.js'

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
export const startSlaChecker = () => {
  cron.schedule('*/5 * * * *', async () => {
    try {
      const count = await runSlaCheck()
      if (count) console.log(`SLA checker: evaluated ${count} ticket(s)`)
    } catch (err) {
      console.log('SLA checker failed:', err.message)
    }
  })
  console.log('SLA checker scheduled (every 5 minutes)')
}
