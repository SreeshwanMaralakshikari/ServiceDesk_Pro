// the single place a ticket is turned into a response body. Every route that
// returns a ticket goes through here, so the internal-note rule cannot be
// forgotten on one of them (PATCH responses and the list used to leak).

const idOf = (value) => String(value?._id ?? value)

// TECHNICIAN/MANAGER of the ticket's own team, or ADMIN
export const canSeeInternal = (ticket, user) => {
  if (user.role === 'ADMIN') return true
  if (user.role === 'TECHNICIAN' || user.role === 'MANAGER') {
    return Boolean(user.department) && idOf(ticket.department) === user.department
  }
  return false
}

export const toTicketView = (ticket, user) => {
  const view = typeof ticket.toObject === 'function' ? ticket.toObject() : { ...ticket }
  if (!canSeeInternal(view, user)) {
    view.comments = (view.comments ?? []).filter((c) => !c.isInternal)
  }
  // the AI notes (and article suggestions) are for the support team, not the requester
  if (user.role === 'EMPLOYEE') delete view.ai
  return view
}

// list rows never carry comments at all; the detail route is the only place
// they are read
export const toTicketListItem = (ticket) => {
  const row = typeof ticket.toObject === 'function' ? ticket.toObject() : { ...ticket }
  delete row.comments
  delete row.ai
  return row
}
