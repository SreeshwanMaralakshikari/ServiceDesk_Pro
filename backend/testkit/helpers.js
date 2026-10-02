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
