// Human-readable text for the codes the API sends (IN_PROGRESS, ASSET_MANAGER…).
// The codes themselves never change: they are still what the app sends to and
// compares against the server. Only what people read goes through here.

// "IN_PROGRESS" -> "In progress"; also fine for codes an admin invents later
// (custom priorities, for example), which have no entry in the maps below
export const humanize = (code) => {
  if (code === null || code === undefined || code === '') return ''
  const text = String(code).replace(/_/g, ' ').trim().toLowerCase()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const label = (map) => (code) => map[code] ?? humanize(code)

export const statusLabel = label({
  PENDING_APPROVAL: 'Pending approval',
  OPEN: 'Open',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  ON_HOLD: 'On hold',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
  REOPENED: 'Reopened',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
})

export const roleLabel = label({
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  TECHNICIAN: 'Technician',
  EMPLOYEE: 'Employee',
  ASSET_MANAGER: 'Asset manager',
})

// the default four; custom priorities fall back to humanize()
export const priorityLabel = label({
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
})

export const assetStatusLabel = label({
  PROCURED: 'Procured',
  IN_STOCK: 'In stock',
  ASSIGNED: 'Assigned',
  IN_REPAIR: 'In repair',
  REPLACED: 'Replaced',
  RETIRED: 'Retired',
})

export const kbStatusLabel = label({
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
})

export const assetTypeLabel = label({
  HARDWARE: 'Hardware',
  SOFTWARE: 'Software',
})

export const entityLabel = label({
  TICKET: 'Ticket',
  ASSET: 'Asset',
  KB_ARTICLE: 'KB article',
  USER: 'User',
  DEPARTMENT: 'Department',
  CATEGORY: 'Category',
  SLA_POLICY: 'SLA policy',
  ORG_SETTINGS: 'Org settings',
  REPORT: 'Report',
})

// "ASSIGNED → IN_PROGRESS" style moves, shown with readable names on both sides
export const transitionText = (from, to, toLabel = humanize) => (from && from !== to ? `${toLabel(from)} → ${toLabel(to)}` : toLabel(to))
