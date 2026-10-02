// AI features through the real app and a real database. Only the Groq client is stubbed
// (no network in tests); everything else, including the AiLog and Ticket writes, is real.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { bootApp, loginAs } from '../../testkit/boot.js'

describe('AI: classify -> create ticket -> acceptedByUser, and KB re-ranking (real database)', () => {
  let ctx, emp, emp2, tech, mgr, groqClient, calls
  const NET = (over = {}) => JSON.stringify({ categoryName: 'Hardware', priority: 'HIGH', probableIssue: 'Dead battery', ...over })
  const useAi = (reply) => { groqClient.isConfigured = () => true; groqClient.chatCompletion = async (a) => { calls.push(a); return typeof reply === 'function' ? reply(a) : reply } }
  const classify = (agent, body = { title: 'Laptop dead', description: 'no lights after pressing power' }) => agent.post('/ai-api/classify-ticket').send(body)
  const create = (agent, over = {}) => agent.post('/ticket-api/tickets').send({ title: 'Laptop dead', description: 'no lights after pressing power', categoryId: String(ctx.fx.categories.hardware._id), ...over })

  before(async () => {
    ctx = await bootApp({ AI_RATE_LIMIT_MAX: '1000' })
    ;({ groqClient } = await import('../../config/groq.js'))
    ;[emp, emp2, tech, mgr] = await Promise.all(['emp@t.test', 'emp2@t.test', 'tech.svc@t.test', 'mgr.svc@t.test'].map((e) => loginAs(ctx.app, e)))
  })
  after(() => ctx.stop())
  const reset = () => { calls = []; groqClient.isConfigured = () => false }
  const aiOnTicket = async (publicId) => {
    const { TicketModel } = await import('../../models/TicketModel.js')
    return (await TicketModel.findOne({ publicId }).lean()).ai
  }

  test('accepting the suggestion is recorded as acceptedByUser: true, computed by the server', async () => {
    reset(); useAi(NET())
    const c = await classify(emp)
    assert.equal(c.status, 200); assert.equal(c.body.payload.source, 'ai'); assert.ok(c.body.payload.aiLogId)
    const r = await create(emp, { priority: 'HIGH', aiLogId: c.body.payload.aiLogId })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    const ai = await aiOnTicket(r.body.payload.publicId)
    assert.equal(ai.source, 'ai'); assert.equal(ai.acceptedByUser, true)
    assert.equal(String(ai.suggestedCategory), String(ctx.fx.categories.hardware._id))
    assert.equal(ai.suggestedPriority, 'HIGH'); assert.equal(ai.probableIssue, 'Dead battery')
    assert.equal(String(ai.aiLogId), c.body.payload.aiLogId)
    // the requester never sees the AI notes
    assert.equal(r.body.payload.ai, undefined)
  })

  test('changing the category or the priority is recorded as acceptedByUser: false', async () => {
    reset(); useAi(NET())
    const c = await classify(emp)
    const other = await create(emp, { priority: 'HIGH', categoryId: String(ctx.fx.categories.network._id), aiLogId: c.body.payload.aiLogId })
    assert.equal((await aiOnTicket(other.body.payload.publicId)).acceptedByUser, false)
    const low = await create(emp, { priority: 'LOW', aiLogId: c.body.payload.aiLogId })
    assert.equal((await aiOnTicket(low.body.payload.publicId)).acceptedByUser, false)
  })

  test('a client cannot claim acceptance, point at someone else\'s log, or send junk ids', async () => {
    reset(); useAi(NET())
    const c = await classify(emp)
    // someone else's classification
    const stolen = await create(emp2, { priority: 'HIGH', aiLogId: c.body.payload.aiLogId })
    assert.equal(stolen.status, 201)
    assert.equal((await aiOnTicket(stolen.body.payload.publicId))?.aiLogId, undefined, 'not their log: ignored')
    // a made-up acceptedByUser is just an unknown field: ignored, never stored
    const fake = await create(emp, { priority: 'LOW', aiLogId: c.body.payload.aiLogId, acceptedByUser: true, ai: { acceptedByUser: true } })
    assert.equal(fake.status, 201)
    assert.equal((await aiOnTicket(fake.body.payload.publicId)).acceptedByUser, false)
    for (const bad of ['nope', '000000000000000000000000', ['x'], { $ne: 1 }, 42]) {
      const r = await create(emp, { aiLogId: bad })
      assert.equal(r.status, 201, `aiLogId ${JSON.stringify(bad)}`)
      assert.equal((await aiOnTicket(r.body.payload.publicId))?.aiLogId, undefined)
    }
  })

  test('the fallback answer is also remembered, with source "fallback"', async () => {
    reset()
    const c = await classify(emp, { title: 'Hardware broken', description: 'urgent' })
    assert.equal(c.body.payload.source, 'fallback')
    const r = await create(emp, { aiLogId: c.body.payload.aiLogId, priority: c.body.payload.priority })
    assert.equal((await aiOnTicket(r.body.payload.publicId)).source, 'fallback')
  })

  test('identical questions reuse the answer (one model call) on a real database', async () => {
    reset(); useAi(NET())
    const a = await classify(emp, { title: 'Screen flickers', description: 'every minute' })
    const b = await classify(emp2, { title: 'SCREEN  flickers', description: 'every minute' })
    assert.equal(calls.length, 1)
    assert.equal(b.body.payload.categoryName, a.body.payload.categoryName)
    assert.notEqual(b.body.payload.aiLogId, a.body.payload.aiLogId)
    const { AiLogModel } = await import('../../models/AiLogModel.js')
    const log = await AiLogModel.findById(b.body.payload.aiLogId).lean()
    assert.equal(log.cached, true); assert.equal(String(log.requestedBy), String(ctx.fx.users.emp2._id))
  })

  test('staff see ai on the ticket detail; list rows never carry it', async () => {
    reset(); useAi(NET())
    const c = await classify(emp, { title: 'Docking station', description: 'not detected' })
    const t = (await create(emp, { priority: 'HIGH', aiLogId: c.body.payload.aiLogId })).body.payload
    const detail = (await tech.get(`/ticket-api/tickets/${t.publicId}`)).body.payload
    assert.equal(detail.ai.acceptedByUser, true)
    assert.equal((await emp.get(`/ticket-api/tickets/${t.publicId}`)).body.payload.ai, undefined)
    const list = (await mgr.get('/ticket-api/tickets')).body.payload.items
    assert.ok(list.length > 0 && list.every((x) => x.ai === undefined))
  })

  test('re-ranked KB suggestions are saved on the ticket, served from there, and refreshable; fallback keeps working', async () => {
    reset()
    const { KnowledgeArticleModel } = await import('../../models/KnowledgeArticleModel.js')
    const mk = (title, over = {}) => KnowledgeArticleModel.create({ publicId: `KB-2026-9${String(Math.floor(Math.random() * 9000) + 1000)}`, title, summary: `${title} summary`, content: `${title} content`, category: ctx.fx.categories.hardware._id, author: ctx.fx.users.techSvc._id, status: 'PUBLISHED', publishedAt: new Date(), ...over })
    const a1 = await mk('Laptop will not power on')
    const a2 = await mk('Replace a laptop battery')
    const draft = await mk('Laptop secret draft', { status: 'DRAFT' })
    const t = (await create(emp, { title: 'Laptop will not power on', description: 'battery maybe' })).body.payload

    // no key: plain retrieval, drafts excluded
    let r = await tech.get(`/ai-api/kb-suggestions/${t.publicId}`)
    assert.equal(r.status, 200); assert.equal(r.body.payload.source, 'retrieval')
    const ids = r.body.payload.articles.map((a) => a.publicId)
    assert.ok(ids.includes(a1.publicId) && ids.includes(a2.publicId) && !ids.includes(draft.publicId))

    useAi(JSON.stringify({ results: [
      { articleId: a2.publicId, relevance: 88, why: 'Battery is the likely cause', steps: ['Open the case', 'Swap the battery'] },
      { articleId: 'KB-2026-00000', relevance: 99, why: 'invented', steps: [] },
    ] }))
    r = await tech.get(`/ai-api/kb-suggestions/${t.publicId}`)
    assert.equal(r.body.payload.source, 'ai'); assert.equal(r.body.payload.cached, false)
    assert.deepEqual(r.body.payload.articles.map((a) => a.publicId), [a2.publicId])
    assert.equal(r.body.payload.articles[0].why, 'Battery is the likely cause')
    const saved = (await aiOnTicket(t.publicId)).kbSuggestions
    assert.equal(saved.source, 'ai'); assert.equal(saved.items.length, 1); assert.equal(saved.items[0].publicId, a2.publicId)

    r = await tech.get(`/ai-api/kb-suggestions/${t.publicId}`)
    assert.equal(r.body.payload.cached, true); assert.equal(calls.length, 1)
    assert.equal(r.body.payload.articles[0].steps.length, 2)

    r = await tech.get(`/ai-api/kb-suggestions/${t.publicId}?refresh=true`)
    assert.equal(calls.length, 2)

    // archive the suggested article: the saved suggestion stops showing it
    await KnowledgeArticleModel.updateOne({ _id: a2._id }, { status: 'ARCHIVED' })
    useAi('this is not json')
    r = await tech.get(`/ai-api/kb-suggestions/${t.publicId}`)
    assert.equal(r.status, 200)
    assert.equal(r.body.payload.source, 'retrieval', 'saved answer is empty now, the model failed, retrieval answers')
    assert.ok(r.body.payload.articles.every((a) => a.publicId !== a2.publicId))
    // the requester cannot use it
    assert.equal((await emp.get(`/ai-api/kb-suggestions/${t.publicId}`)).status, 403)
  })
})
