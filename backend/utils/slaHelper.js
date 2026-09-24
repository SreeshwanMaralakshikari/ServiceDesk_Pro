// MVP SLA math: plain wall-clock hours (no business-hours engine yet —
// see PLAN.md Phase 5 for the full business-hours version).
export const computeSlaDueDates = (startedAt, policy) => {
  if (!policy) return { responseDueAt: null, resolutionDueAt: null }
  const responseDueAt = new Date(startedAt.getTime() + policy.responseTimeHours * 3600 * 1000)
  const resolutionDueAt = new Date(startedAt.getTime() + policy.resolutionTimeHours * 3600 * 1000)
  return { responseDueAt, resolutionDueAt }
}
