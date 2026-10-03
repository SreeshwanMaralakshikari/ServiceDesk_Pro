// small helpers shared by the integration tests
export const createTicket = async (agent, categoryId, over = {}) => {
  const res = await agent.post('/ticket-api/tickets').send({ title: 'Laptop will not boot', description: 'No lights after pressing power', categoryId, ...over })
  if (res.status !== 201) throw new Error(`ticket create failed: ${res.status} ${JSON.stringify(res.body)}`)
  return res.body.payload
}

// PATCH an action with the ticket's current version
export const act = (agent, ticket, action, body = {}) =>
  agent.patch(`/ticket-api/tickets/${ticket.publicId}/${action}`).send({ version: ticket.version, ...body })

// the ticket as the caller sees it now
export const fetchTicket = async (agent, ticket) => (await agent.get(`/ticket-api/tickets/${ticket.publicId}`)).body.payload

export const noInternal = (ticket) => (ticket.comments ?? []).every((c) => c.isInternal === false)

// a small RFC 4180 reader for the CSV export tests: quoted fields, doubled quotes, line breaks inside quotes.
// Returns an array of rows (arrays of strings); a leading BOM is dropped
export const parseCsv = (text) => {
  const src = text.replace(/^\uFEFF/, '')
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\r' && src[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++ }
    else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}
