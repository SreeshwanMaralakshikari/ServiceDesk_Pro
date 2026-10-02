// status groups shared by the admin guards, dashboards and the DSA features

// nothing more will happen on these tickets
export const FINISHED_STATUSES = ['CLOSED', 'CANCELLED', 'REJECTED']

// the assigned technician still has work to do (RESOLVED is waiting for the
// requester, so it does not count as load)
export const TECH_ACTIVE_STATUSES = ['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'REOPENED']
