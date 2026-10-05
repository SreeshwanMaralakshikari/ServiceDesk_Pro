// the 400 text for an action the current status does not allow, worded for people:
// "cannot assign a ticket that is in progress", not "cannot assign a IN_PROGRESS ticket"
export const statusRefusal = (action, status, noun) => {
  const article = /^[aeiou]/i.test(noun) ? 'an' : 'a'
  return `cannot ${action} ${article} ${noun} that is ${String(status).toLowerCase().replace(/_/g, ' ')}`
}
