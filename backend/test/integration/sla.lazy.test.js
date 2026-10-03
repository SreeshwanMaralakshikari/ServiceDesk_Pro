// the lazy SLA check on ticket detail: fresh flags in the same response, and no flagging of finished tickets
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { bootApp, loginAs } from '../../testkit/boot.js'
import { createTicket, act } from '../../testkit/helpers.js'

describe('lazy SLA evaluation (real database)', () => {
  let ctx, emp, mgr, tech, assets, TicketModel
  const past = (h) => new Date(Date.now() - h * 3600000)
  const detail = async (agent, t) => (await agent.get(`/ticket-api/tickets/${t.publicId}`)).body.payload

  before(async () => {
    ctx = await bootApp()
    ;[emp, mgr, tech, assets] = await Promise.all(['emp@t.test', 'mgr.svc@t.test', 'tech.svc@t.test', 'assets@t.test'].map((e) => loginAs(ctx.app, e)))
    ;({ TicketModel } = await import('../../models/TicketModel.js'))
  })
  after(() => ctx.stop())

  test('a response deadline that has passed is flagged in the very response that notices it', async () => {
    const t = await createTicket(emp, ctx.fx.categories.hardware._id, { title: 'late reply' })
    await TicketModel.updateOne({ publicId: t.publicId }, { $set: { 'sla.responseDueAt': past(1) } })
    const view = await detail(mgr, t)
    assert.equal(view.sla.responseBreached, true, 'flag is up to date in this response')
    assert.equal(view.sla.escalationLevel, 1)
    assert.equal((await TicketModel.findOne({ publicId: t.publicId }).lean()).sla.responseBreached, true, 'and saved')
  })

  test('a resolution deadline that has passed escalates to level 2', async () => {
    const t = await createTicket(emp, ctx.fx.categories.hardware._id, { title: 'late fix' })
    await TicketModel.updateOne({ publicId: t.publicId }, { $set: { 'sla.resolutionDueAt': past(1) } })
    const view = await detail(mgr, t)
    assert.equal(view.sla.resolutionBreached, true); assert.equal(view.sla.escalationLevel, 2)
  })

  test('an answered ticket is never flagged for the response, even with a past response deadline', async () => {
    const t = await createTicket(emp, ctx.fx.categories.hardware._id, { title: 'answered in time' })
    let r = await act(tech, t, 'claim'); assert.equal(r.status, 200)
    r = await act(tech, r.body.payload, 'start'); assert.equal(r.status, 200)
    await TicketModel.updateOne({ publicId: t.publicId }, { $set: { 'sla.responseDueAt': past(1) } })
    const view = await detail(mgr, t)
    assert.equal(view.sla.responseBreached, false)
  })

  test('a ticket that is no longer running is not flagged', async () => {
    const t = await createTicket(emp, ctx.fx.categories.hardware._id, { title: 'cancelled early' })
    let r = await act(emp, t, 'cancel', { note: 'no longer needed' }); assert.equal(r.status, 200, JSON.stringify(r.body))
    await TicketModel.updateOne({ publicId: t.publicId }, { $set: { 'sla.responseDueAt': past(1), 'sla.resolutionDueAt': past(1) } })
    const { evaluateTicketSla } = await import('../../utils/evaluateSla.js')
    const row = await TicketModel.findOne({ publicId: t.publicId })
    assert.deepEqual(await evaluateTicketSla(row), {})
    const saved = await TicketModel.findOne({ publicId: t.publicId }).lean()
    assert.equal(saved.sla.responseBreached, false); assert.equal(saved.sla.resolutionBreached, false)
  })

  test('related-ticket list on an asset: an asset manager sees every team, a technician only their own', async () => {
    const mk = async (name, serial) => (await assets.post('/asset-api/assets').send({ name, type: 'HARDWARE', assetClass: 'LAPTOP', serialNumber: serial })).body.payload
    const asset = await mk('Shared laptop', 'SN-REL-1')
    const hw = await createTicket(emp, ctx.fx.categories.hardware._id, { title: 'service desk ticket' })
    const net = await createTicket(emp, ctx.fx.categories.network._id, { title: 'infrastructure ticket' })
    await TicketModel.updateMany({ publicId: { $in: [hw.publicId, net.publicId] } }, { $set: { relatedAsset: asset._id } })
    const titles = async (agent) => (await agent.get(`/asset-api/assets/${asset.publicId}/tickets`)).body.payload.map((x) => x.title).sort()
    assert.deepEqual(await titles(assets), ['infrastructure ticket', 'service desk ticket'])
    assert.deepEqual(await titles(tech), ['service desk ticket'])
  })
})
