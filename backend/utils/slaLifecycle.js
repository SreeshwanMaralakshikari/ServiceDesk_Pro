import { computeDueDate } from './businessHours.js'

// Starts (or restarts) the SLA clock at `startedAt` for a given policy.
// Used when a ticket enters OPEN (creation or approval) and, with only
// resolutionDueAt/warnAt, on reopen (the response SLA never re-runs).
export const startSlaClock = (startedAt, policy, settings) => {
  if (!policy) return { startedAt, responseDueAt: null, resolutionDueAt: null, warnAt: null }
  return {
    startedAt,
    responseDueAt: computeDueDate(startedAt, policy.responseTimeHours, policy, settings),
    resolutionDueAt: computeDueDate(startedAt, policy.resolutionTimeHours, policy, settings),
    warnAt: computeDueDate(startedAt, policy.resolutionTimeHours * 0.75, policy, settings),
  }
}

// On priority change: due dates + warnAt recompute from the *same*
// startedAt plus however much business time has already been paused —
// addBusinessHours(startedAt, policyHours + totalPausedMs/3.6e6) per the
// handoff plan. The response due date only moves if nobody has responded
// yet; any breach flag clears if its new due date is back in the future.
export const recomputeSlaForPriorityChange = (ticketSla, newPolicy, settings) => {
  const now = new Date()
  const pausedHours = (ticketSla.totalPausedMs || 0) / 3600000
  const startedAt = ticketSla.startedAt || now
  const patch = { policy: newPolicy._id }

  if (!ticketSla.firstRespondedAt) {
    patch.responseDueAt = computeDueDate(startedAt, newPolicy.responseTimeHours + pausedHours, newPolicy, settings)
    patch.responseBreached = patch.responseDueAt > now ? false : ticketSla.responseBreached
  }

  patch.resolutionDueAt = computeDueDate(startedAt, newPolicy.resolutionTimeHours + pausedHours, newPolicy, settings)
  patch.warnAt = computeDueDate(startedAt, newPolicy.resolutionTimeHours * 0.75 + pausedHours, newPolicy, settings)
  patch.resolutionBreached = patch.resolutionDueAt > now ? false : ticketSla.resolutionBreached
  patch.warningSent = patch.warnAt > now ? false : ticketSla.warningSent

  // keep escalationLevel in sync with the *effective* final breach flags —
  // responseBreached may not be in `patch` at all (skipped when there's
  // already a first response), in which case its real value is whatever
  // ticketSla already had, not "false"
  const effectiveResponseBreached = 'responseBreached' in patch ? patch.responseBreached : ticketSla.responseBreached
  if (patch.resolutionBreached) patch.escalationLevel = 2
  else if (effectiveResponseBreached) patch.escalationLevel = 1
  else patch.escalationLevel = 0

  return patch
}
