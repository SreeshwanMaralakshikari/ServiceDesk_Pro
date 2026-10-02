// what the background jobs are doing, exposed on /health so a deployed build
// can show whether SLA escalation and the warranty check are really running
export const cronStatus = { sla: 'not-started', warranty: 'not-started' }
