// Route tests for /ai-api. No MongoDB and no real network call: Category/
// SLAPolicy/Ticket/KnowledgeArticle/User/AiLog model *methods* are swapped
// for an in-memory store (same technique as test/kb.test.js), and
// `groqClient` — a single mutable object exported by config/groq.js — has
// its `chatCompletion`/`isConfigured` methods stubbed directly, the same way
// this codebase's tests replace a Mongoose model's methods rather than
// mocking modules.
process.env.JWT_SECRET = 'test-secret'
process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://unused'
process.env.CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173'
process.env.AI_RATE_LIMIT_MAX = '10000' // this file makes far more than 20 calls a minute; the limiter itself is tested in the integration suite

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import exp from 'express'
import cookieParser from 'cookie-parser'
import jwt from 'jsonwebtoken'
import sift from 'sift'

import { CategoryModel } from '../models/CategoryModel.js'
import { SLAPolicyModel } from '../models/SLAPolicyModel.js'
import { TicketModel } from '../models/TicketModel.js'
import { KnowledgeArticleModel } from '../models/KnowledgeArticleModel.js'
import { UserModel } from '../models/UserModel.js'
import { AiLogModel } from '../models/AiLogModel.js'
import { groqClient } from '../config/groq.js'
import { aiApp } from '../APIs/AiAPI.js'
import { sanitizeBody } from '../middlewares/sanitize.js'

const oid = (n) => String(n).padStart(24, '0')
const DEPT_IT = oid(200)
const DEPT_HR = oid(201)
const USERS = {
  admin:    { _id: oid(1), role: 'ADMIN' },
  manager:  { _id: oid(2), role: 'MANAGER', department: DEPT_IT },
  tech:     { _id: oid(3), role: 'TECHNICIAN', department: DEPT_IT },
  techHr:   { _id: oid(4), role: 'TECHNICIAN', department: DEPT_HR },
  emp:      { _id: oid(5), role: 'EMPLOYEE' },
}
const CAT_NETWORK = oid(100)
const CAT_HARDWARE = oid(101)

describe('POST /ai-api/classify-ticket and GET /ai-api/kb-suggestions', () => {
  let server, base
  const originals = {}
  let categories, priorities, ticketStore, kbStore, aiLogs
  let chatCompletionCalls
  let ticketUpdates = 0

  const chain = (result) => {
    let arr = Array.isArray(result) ? [...result] : result
    const q = {
      select: () => q,
      sort: (spec) => {
        // real Mongo sort is compound: apply every key in order as a
        // tiebreaker for the ones before it, not just the first key
        if (Array.isArray(arr) && spec) {
          const entries = Object.entries(spec)
          arr = [...arr].sort((a, b) => {
            for (const [key, dir] of entries) {
              if (typeof dir === 'object') continue // { $meta: 'textScore' }: the stub has no scores, later keys break the tie
              const cmp = (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * dir
              if (cmp !== 0) return cmp
            }
            return 0
          })
        }
        return q
      },
      limit: (n) => { if (Array.isArray(arr)) arr = arr.slice(0, n); return q },
      then: (res, rej) => Promise.resolve(arr).then(res, rej),
      catch: (rej) => Promise.resolve(arr).catch(rej),
    }
    return q
  }
  // a lightweight $text simulator: real MongoDB does stemmed/tokenized
  // matching, this just checks whole-word overlap against the same fields
  // KnowledgeArticleModel's text index covers (title/summary/content/tags)
  const matchesText = (doc, search) => {
    const words = new Set((search || '').toLowerCase().match(/[a-z0-9]+/g) || [])
    const hay = `${doc.title} ${doc.summary} ${doc.content || ''} ${(doc.tags || []).join(' ')}`.toLowerCase()
    return [...words].some((w) => w.length > 2 && hay.includes(w))
  }
  const matchesFilter = (doc, filter) => {
    const { $text, $or, ...rest } = filter
    if ($text && !matchesText(doc, $text.$search)) return false
    if ($or && !$or.some((cond) => sift(cond)(doc))) return false
    return sift(rest)(doc)
  }

  // the test server closes idle connections; on a busy machine fetch can reuse one that was just closed (ECONNRESET), so try once more
  const fetchOnce = async (url, options) => {
    try { return await fetch(url, options) } catch (err) {
      if (err?.cause?.code !== 'ECONNRESET') throw err
      return fetch(url, options)
    }
  }
  const call = async (as, method, path, body) => {
    const headers = { 'Content-Type': 'application/json' }
    if (as) headers.Cookie = `token=${jwt.sign({ id: USERS[as]._id }, 'test-secret')}`
    const res = await fetchOnce(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
    return { status: res.status, body: await res.json() }
  }
  const callBare = async (as, method, path) => {
    const headers = as ? { Cookie: `token=${jwt.sign({ id: USERS[as]._id }, 'test-secret')}` } : {}
    const res = await fetchOnce(base + path, { method, headers })
    return { status: res.status, body: await res.json() }
  }

  before(async () => {
    for (const [k, obj, names] of [
      ['cat', CategoryModel, ['find']],
      ['sla', SLAPolicyModel, ['find']],
      ['ticket', TicketModel, ['findOne', 'updateOne']],
      ['kb', KnowledgeArticleModel, ['find']],
      ['user', UserModel, ['findById']],
      ['log', AiLogModel, ['create', 'findOne']],
      ['groq', groqClient, ['isConfigured', 'chatCompletion']],
    ]) { originals[k] = {}; for (const n of names) originals[k][n] = obj[n] }

    UserModel.findById = (id) => chain(Object.values(USERS).find((u) => u._id === String(id)) && { ...Object.values(USERS).find((u) => u._id === String(id)), isActive: true })
    CategoryModel.find = (f) => chain(categories.filter(sift(f)))
    SLAPolicyModel.find = (f) => chain(priorities.filter(sift(f)))
    TicketModel.findOne = (f) => chain(ticketStore.find(sift(f)) || null)
    KnowledgeArticleModel.find = (f) => chain(kbStore.filter((d) => matchesFilter(d, f)))
    TicketModel.updateOne = async (f, u) => {
      const t = ticketStore.find(sift(f))
      if (t && u.$set?.['ai.kbSuggestions']) { t.ai = { ...(t.ai ?? {}), kbSuggestions: u.$set['ai.kbSuggestions'] }; ticketUpdates += 1 }
      return {}
    }
    AiLogModel.findOne = (f) => {
      const q = chain(aiLogs.filter(sift(f)))
      const list = q.then
      q.then = (res, rej) => list((arr) => arr[0] ?? null).then(res, rej) // findOne: first match or null
      return q
    }

    const app = exp()
    app.use(exp.json()); app.use(cookieParser()); app.use(sanitizeBody)
    app.use('/ai-api', aiApp)
    app.use((err, req, res, next) => res.status(err.name === 'ValidationError' ? 400 : 500).json({ message: 'error occurred', error: err.message }))
    await new Promise((r) => { server = app.listen(0, r) })
    base = `http://127.0.0.1:${server.address().port}/ai-api`
  })
  after(() => {
    server.close()
    for (const [k, obj] of [['cat', CategoryModel], ['sla', SLAPolicyModel], ['ticket', TicketModel], ['kb', KnowledgeArticleModel], ['user', UserModel], ['log', AiLogModel], ['groq', groqClient]]) Object.assign(obj, originals[k])
  })

  const reset = () => {
    categories = [{ _id: CAT_NETWORK, name: 'Network', isActive: true }, { _id: CAT_HARDWARE, name: 'Hardware', isActive: true }]
    priorities = [
      { _id: oid(300), priority: 'TEST', level: 0, isActive: true },
      { _id: oid(301), priority: 'LOW', level: 1, isActive: true },
      { _id: oid(302), priority: 'MEDIUM', level: 2, isActive: true },
      { _id: oid(303), priority: 'HIGH', level: 3, isActive: true },
      { _id: oid(304), priority: 'CRITICAL', level: 4, isActive: true },
    ]
    ticketStore = []; kbStore = []; aiLogs = []; chatCompletionCalls = []; ticketUpdates = 0
    groqClient.isConfigured = () => false
    groqClient.chatCompletion = async (args) => { chatCompletionCalls.push(args); return '{}' }
    // reset the AiLog write stub too — a test that deliberately breaks logging
    // (to check it's non-fatal) must not leave every later test unable to log
    AiLogModel.create = async (data) => {
      await new AiLogModel(data).validate() // real schema validation
      const d = { _id: oid(9000 + aiLogs.length), createdAt: new Date(), ...data }
      aiLogs.push(d)
      return d
    }
  }
  const seedTicket = (over = {}) => {
    const t = { _id: oid(2000 + ticketStore.length), publicId: `TKT-2026-${String(ticketStore.length + 1).padStart(5, '0')}`, title: 'Wifi is down', category: CAT_NETWORK, department: DEPT_IT, requester: USERS.emp._id, isDeleted: false, ...over }
    ticketStore.push(t); return t
  }
  const seedArticle = (over = {}) => {
    const a = { _id: oid(3000 + kbStore.length), publicId: `KB-2026-${String(kbStore.length + 1).padStart(5, '0')}`, title: 't', summary: 's', content: 'c', tags: [], category: CAT_NETWORK, status: 'PUBLISHED', author: USERS.tech._id, viewCount: 0, isDeleted: false, ...over }
    kbStore.push(a); return a
  }

  describe('classify-ticket', () => {
    test('auth: no cookie -> 401; wrong role (Technician) -> 403', async () => {
      reset()
      assert.equal((await call(null, 'POST', '/classify-ticket', { title: 'x' })).status, 401)
      assert.equal((await call('tech', 'POST', '/classify-ticket', { title: 'x' })).status, 403)
    })

    test('validation: needs at least one of title/description as text', async () => {
      reset()
      assert.equal((await call('emp', 'POST', '/classify-ticket', {})).status, 400)
      assert.equal((await call('emp', 'POST', '/classify-ticket', { title: '' })).status, 400)
      assert.equal((await call('emp', 'POST', '/classify-ticket', { title: 123 })).status, 400)
      assert.equal((await call('emp', 'POST', '/classify-ticket', { description: ['x'] })).status, 400)
      assert.equal((await call('emp', 'POST', '/classify-ticket', { title: 'ok' })).status, 200)
    })

    test('whitespace-only title/description must be rejected like real KB validation (Phase 5 lesson), not silently proceed', async () => {
      reset()
      assert.equal((await call('emp', 'POST', '/classify-ticket', { title: '   ' })).status, 400)
      assert.equal((await call('emp', 'POST', '/classify-ticket', { description: '\n\t ' })).status, 400)
      assert.equal((await call('emp', 'POST', '/classify-ticket', { title: '  ', description: '  ' })).status, 400)
    })

    test('bodyless request is a clean 400, not a 500', async () => {
      reset()
      assert.equal((await callBare('emp', 'POST', '/classify-ticket')).status, 400)
    })

    test('no API key: returns a fallback suggestion, never calls the AI, logs FALLBACK', async () => {
      reset() // isConfigured() = false
      const r = await call('emp', 'POST', '/classify-ticket', { title: 'Wifi network is down', description: 'urgent, cannot connect' })
      assert.equal(r.status, 200)
      assert.equal(r.body.payload.source, 'fallback')
      assert.equal(r.body.payload.categoryName, 'Network')
      assert.equal(r.body.payload.priority, 'HIGH')
      assert.equal(chatCompletionCalls.length, 0)
      assert.equal(aiLogs.length, 1)
      assert.equal(aiLogs[0].status, 'FALLBACK')
      assert.equal(aiLogs[0].kind, 'CLASSIFY_TICKET')
      assert.equal(aiLogs[0].requestedBy, USERS.emp._id)
    })

    test('ADMIN may also call classify-ticket (matches who may create a ticket)', async () => {
      reset()
      assert.equal((await call('admin', 'POST', '/classify-ticket', { title: 'printer issue' })).status, 200)
    })

    test('fallback never guesses a category when nothing overlaps, and priority defaults to MEDIUM', async () => {
      reset()
      const r = await call('emp', 'POST', '/classify-ticket', { title: 'a completely unrelated request' })
      assert.equal(r.body.payload.categoryId, null)
      assert.equal(r.body.payload.categoryName, null)
      assert.equal(r.body.payload.priority, 'MEDIUM')
    })

    test('AI path: valid JSON response matching a real category/priority -> SUCCESS, source "ai"', async () => {
      reset()
      groqClient.isConfigured = () => true
      groqClient.chatCompletion = async (args) => { chatCompletionCalls.push(args); return '{"categoryName":"network","priority":"high","probableIssue":"Router outage"}' }
      const r = await call('emp', 'POST', '/classify-ticket', { title: 'Wifi down', description: 'cannot connect' })
      assert.equal(r.status, 200)
      assert.equal(r.body.payload.source, 'ai')
      assert.equal(r.body.payload.categoryName, 'Network') // matched case-insensitively, returned with real casing
      assert.equal(r.body.payload.categoryId, CAT_NETWORK)
      assert.equal(r.body.payload.priority, 'HIGH')
      assert.equal(r.body.payload.probableIssue, 'Router outage')
      assert.equal(chatCompletionCalls.length, 1)
      assert.equal(aiLogs[0].status, 'SUCCESS')
      assert.ok(aiLogs[0].model)
      // the model is only ever offered real, active choices — never TEST
      assert.ok(chatCompletionCalls[0].system.includes('Network'))
      assert.ok(!chatCompletionCalls[0].system.includes('TEST'))
    })

    test('AI path: unparsable JSON -> falls back gracefully, logs ERROR, still 200', async () => {
      reset()
      groqClient.isConfigured = () => true
      groqClient.chatCompletion = async () => 'not json at all'
      const r = await call('emp', 'POST', '/classify-ticket', { title: 'Wifi down' })
      assert.equal(r.status, 200)
      assert.equal(r.body.payload.source, 'fallback')
      assert.equal(aiLogs[0].status, 'ERROR')
      assert.ok(aiLogs[0].errorMessage)
    })

    test('AI path: hallucinated category/priority not in the real lists -> falls back, logs ERROR', async () => {
      reset()
      groqClient.isConfigured = () => true
      groqClient.chatCompletion = async () => '{"categoryName":"Plumbing","priority":"SUPER_URGENT","probableIssue":"x"}'
      const r = await call('emp', 'POST', '/classify-ticket', { title: 'Wifi down' })
      assert.equal(r.body.payload.source, 'fallback')
      assert.equal(aiLogs[0].status, 'ERROR')
    })

    test('AI path: missing probableIssue field -> treated as invalid, falls back', async () => {
      reset()
      groqClient.isConfigured = () => true
      groqClient.chatCompletion = async () => '{"categoryName":"Network","priority":"HIGH"}'
      const r = await call('emp', 'POST', '/classify-ticket', { title: 'Wifi down' })
      assert.equal(r.body.payload.source, 'fallback')
    })

    test('AI path: the client call itself throwing (network/timeout) -> falls back, 200 not 500', async () => {
      reset()
      groqClient.isConfigured = () => true
      groqClient.chatCompletion = async () => { throw new Error('AI request timed out') }
      const r = await call('emp', 'POST', '/classify-ticket', { title: 'Wifi down' })
      assert.equal(r.status, 200)
      assert.equal(r.body.payload.source, 'fallback')
      assert.equal(aiLogs[0].status, 'ERROR')
      assert.match(aiLogs[0].errorMessage, /timed out/)
    })

    test('input caps: oversized title/description are truncated before being sent to the AI and before being logged', async () => {
      reset()
      groqClient.isConfigured = () => true
      groqClient.chatCompletion = async (args) => { chatCompletionCalls.push(args); return '{"categoryName":"Network","priority":"MEDIUM","probableIssue":"x"}' }
      const hugeTitle = 'T'.repeat(1000)
      const hugeDescription = 'D'.repeat(10000)
      const r = await call('emp', 'POST', '/classify-ticket', { title: hugeTitle, description: hugeDescription })
      assert.equal(r.status, 200)
      const sentText = chatCompletionCalls[0].user
      assert.ok(sentText.length <= 300 + 1 + 3000) // TITLE_CAP + '\n' + DESCRIPTION_CAP
      assert.ok(!sentText.includes('T'.repeat(301)))
      assert.ok(!sentText.includes('D'.repeat(3001)))
      assert.ok(aiLogs[0].inputSnippet.length <= 200)
    })

    test('$where / operator-injection keys in the body are stripped before the route sees them', async () => {
      reset()
      const r = await call('emp', 'POST', '/classify-ticket', { title: 'ok', $where: '1', 'a.b': 2 })
      assert.equal(r.status, 200)
    })

    test('a failure writing the AiLog does not break the response (best-effort logging)', async () => {
      reset()
      AiLogModel.create = async () => { throw new Error('simulated db write failure') }
      const r = await call('emp', 'POST', '/classify-ticket', { title: 'Wifi down' })
      assert.equal(r.status, 200)
      assert.equal(r.body.payload.source, 'fallback')
    })
  })

  describe('kb-suggestions', () => {
    test('auth: no cookie -> 401; EMPLOYEE -> 403', async () => {
      reset(); const t = seedTicket()
      assert.equal((await call(null, 'GET', `/kb-suggestions/${t.publicId}`)).status, 401)
      assert.equal((await call('emp', 'GET', `/kb-suggestions/${t.publicId}`)).status, 403)
    })

    test('unknown / garbage ticket id -> 404, not 500', async () => {
      reset()
      assert.equal((await call('tech', 'GET', `/kb-suggestions/${oid(999)}`)).status, 404)
      assert.equal((await call('tech', 'GET', '/kb-suggestions/not-a-real-id!!')).status, 404)
    })

    test('a Technician cannot pull suggestions for a ticket outside their own department', async () => {
      reset(); const t = seedTicket({ department: DEPT_HR })
      assert.equal((await call('tech', 'GET', `/kb-suggestions/${t.publicId}`)).status, 404) // tech is DEPT_IT
      assert.equal((await call('techHr', 'GET', `/kb-suggestions/${t.publicId}`)).status, 200)
    })

    test('MANAGER is scoped the same way; ADMIN sees any department', async () => {
      reset(); const t = seedTicket({ department: DEPT_HR })
      assert.equal((await call('manager', 'GET', `/kb-suggestions/${t.publicId}`)).status, 404) // manager is DEPT_IT
      assert.equal((await call('admin', 'GET', `/kb-suggestions/${t.publicId}`)).status, 200)
    })

    test('text+category match beats an empty result: returns matching published articles', async () => {
      reset()
      const t = seedTicket({ title: 'Wifi keeps dropping' })
      seedArticle({ title: 'Fixing wifi drops', category: CAT_NETWORK, viewCount: 5 })
      seedArticle({ title: 'Printer setup', category: CAT_HARDWARE, viewCount: 50 }) // wrong category, must not appear
      const r = await call('tech', 'GET', `/kb-suggestions/${t.publicId}`)
      assert.equal(r.status, 200)
      assert.equal(r.body.payload.matchedBy, 'text+category')
      assert.equal(r.body.payload.articles.length, 1)
      assert.equal(r.body.payload.articles[0].title, 'Fixing wifi drops')
    })

    test('no text hit -> falls back to category-only, ranked by viewCount desc', async () => {
      reset()
      const t = seedTicket({ title: 'zzz nonmatching zzz', category: CAT_NETWORK })
      seedArticle({ title: 'VPN setup guide', category: CAT_NETWORK, viewCount: 10 })
      seedArticle({ title: 'Wifi password reset', category: CAT_NETWORK, viewCount: 99 })
      const r = await call('tech', 'GET', `/kb-suggestions/${t.publicId}`)
      assert.equal(r.body.payload.matchedBy, 'category')
      assert.equal(r.body.payload.articles.length, 2)
      assert.equal(r.body.payload.articles[0].viewCount, 99) // most popular first
    })

    test('empty result is a clean 200 with an empty array, not an error', async () => {
      reset(); const t = seedTicket({ category: CAT_HARDWARE, title: 'zzz' })
      const r = await call('tech', 'GET', `/kb-suggestions/${t.publicId}`)
      assert.equal(r.status, 200)
      assert.deepEqual(r.body.payload.articles, [])
    })

    test('respects KB visibility scope: a draft by another author never appears, even on a perfect text+category match', async () => {
      reset()
      const t = seedTicket({ title: 'Wifi outage' })
      seedArticle({ title: 'Wifi outage checklist', category: CAT_NETWORK, status: 'DRAFT', author: USERS.techHr._id })
      const r = await call('tech', 'GET', `/kb-suggestions/${t.publicId}`)
      assert.deepEqual(r.body.payload.articles, [])
    })

    test('caps at 5 results even when more match', async () => {
      reset(); const t = seedTicket({ title: 'wifi wifi wifi' })
      for (let i = 0; i < 7; i++) seedArticle({ title: `wifi article ${i}`, category: CAT_NETWORK, viewCount: i })
      const r = await call('tech', 'GET', `/kb-suggestions/${t.publicId}`)
      assert.equal(r.body.payload.articles.length, 5)
    })

    test('equal viewCount is broken deterministically by _id desc, not left to insertion order', async () => {
      reset(); const t = seedTicket({ title: 'wifi wifi wifi' })
      // deliberately seeded with the LOWER _id last, so a correct _id-desc
      // tiebreak must reorder them — a missing tiebreak (or one that just
      // preserves array order) would return them in seed order instead
      const low = seedArticle({ title: 'wifi low id', category: CAT_NETWORK, viewCount: 5, _id: oid(3500) })
      const high = seedArticle({ title: 'wifi high id', category: CAT_NETWORK, viewCount: 5, _id: oid(3600) })
      const r = await call('tech', 'GET', `/kb-suggestions/${t.publicId}`)
      assert.deepEqual(r.body.payload.articles.map((a) => a.publicId), [high.publicId, low.publicId])
    })

    test('logs a KB_SUGGESTIONS AiLog entry tied to the ticket', async () => {
      reset(); const t = seedTicket({ title: 'wifi issue' })
      seedArticle({ title: 'wifi fix', category: CAT_NETWORK })
      await call('tech', 'GET', `/kb-suggestions/${t.publicId}`)
      assert.equal(aiLogs.length, 1)
      assert.equal(aiLogs[0].kind, 'KB_SUGGESTIONS')
      assert.equal(aiLogs[0].ticket, t._id)
      assert.equal(aiLogs[0].status, 'SUCCESS')
    })

    test('an AiLog write failure does not break the response', async () => {
      reset(); const t = seedTicket()
      AiLogModel.create = async () => { throw new Error('simulated db write failure') }
      const r = await call('tech', 'GET', `/kb-suggestions/${t.publicId}`)
      assert.equal(r.status, 200)
    })

    test('works when looked up by real Mongo _id, not just publicId', async () => {
      reset(); const t = seedTicket()
      assert.equal((await call('tech', 'GET', `/kb-suggestions/${t._id}`)).status, 200)
    })
  })

  describe('classify-ticket: fences, aiLogId, cache', () => {
    const useAi = (reply) => {
      groqClient.isConfigured = () => true
      groqClient.chatCompletion = async (args) => { chatCompletionCalls.push(args); return typeof reply === 'function' ? reply(args) : reply }
    }
    const NET = '{"categoryName":"Network","priority":"HIGH","probableIssue":"Router outage"}'

    test('a ```json fenced reply (what models often send) is accepted', async () => {
      reset(); useAi('```json\n' + NET + '\n```')
      const r = await call('emp', 'POST', '/classify-ticket', { title: 'Wifi down' })
      assert.equal(r.body.payload.source, 'ai')
      assert.equal(r.body.payload.categoryName, 'Network')
      assert.equal(aiLogs[0].status, 'SUCCESS')
    })

    test('every answer (AI, cached, fallback) carries the id of its log so the create form can send it back', async () => {
      reset()
      let r = await call('emp', 'POST', '/classify-ticket', { title: 'Wifi down' })
      assert.equal(r.body.payload.source, 'fallback'); assert.equal(r.body.payload.aiLogId, aiLogs[0]._id)
      useAi(NET)
      r = await call('emp', 'POST', '/classify-ticket', { title: 'Printer jam' })
      assert.equal(r.body.payload.aiLogId, aiLogs[1]._id)
      assert.ok(aiLogs[1].inputHash)
    })

    test('the same wording again reuses the earlier answer: no second model call, logged as cached', async () => {
      reset(); useAi(NET)
      const first = await call('emp', 'POST', '/classify-ticket', { title: 'Wifi down', description: 'cannot connect' })
      const again = await call('emp', 'POST', '/classify-ticket', { title: '  WIFI  down ', description: 'cannot   connect' })
      assert.equal(chatCompletionCalls.length, 1, 'one model call for two identical questions')
      assert.deepEqual({ ...again.body.payload, aiLogId: 0 }, { ...first.body.payload, aiLogId: 0 })
      assert.equal(aiLogs.length, 2)
      assert.equal(aiLogs[1].cached, true)
      assert.notEqual(again.body.payload.aiLogId, first.body.payload.aiLogId, 'each call gets its own log')
      // different text is a new question
      await call('emp', 'POST', '/classify-ticket', { title: 'Printer jam' })
      assert.equal(chatCompletionCalls.length, 2)
    })

    test('invalid JSON is retried once: a good second answer is used, two bad ones fall back', async () => {
      reset()
      let n = 0
      useAi(() => (++n === 1 ? '{"categoryName": "Network", "priority": "HIGH" "probableIssue": "x"}' : NET))
      const r = await call('emp', 'POST', '/classify-ticket', { title: 'Wifi down' })
      assert.equal(r.body.payload.source, 'ai'); assert.equal(chatCompletionCalls.length, 2)
      assert.equal(aiLogs.at(-1).status, 'SUCCESS')

      reset(); useAi('still not json')
      const bad = await call('emp', 'POST', '/classify-ticket', { title: 'Wifi down' })
      assert.equal(bad.body.payload.source, 'fallback'); assert.equal(chatCompletionCalls.length, 2)
      assert.equal(aiLogs.at(-1).status, 'ERROR')

      // a thrown error (network, HTTP) is not retried
      reset(); useAi(() => { throw new Error('AI request failed (HTTP 429)') })
      await call('emp', 'POST', '/classify-ticket', { title: 'Wifi down' })
      assert.equal(chatCompletionCalls.length, 1)
    })

    test('a cached answer is not reused when its category was deactivated, and failures are never cached', async () => {
      reset(); useAi(NET)
      await call('emp', 'POST', '/classify-ticket', { title: 'Wifi down' })
      categories = categories.filter((c) => c._id !== CAT_NETWORK)
      useAi('{"categoryName":"Hardware","priority":"LOW","probableIssue":"x"}')
      const r = await call('emp', 'POST', '/classify-ticket', { title: 'Wifi down' })
      assert.equal(r.body.payload.categoryName, 'Hardware')
      assert.equal(chatCompletionCalls.length, 2)

      reset(); useAi('not json')
      await call('emp', 'POST', '/classify-ticket', { title: 'Wifi down' })
      useAi(NET)
      const ok = await call('emp', 'POST', '/classify-ticket', { title: 'Wifi down' })
      assert.equal(ok.body.payload.source, 'ai', 'an earlier ERROR is not served from cache')
    })
  })

  describe('kb-suggestions: AI re-ranking (D5)', () => {
    const useAi = (reply) => {
      groqClient.isConfigured = () => true
      groqClient.chatCompletion = async (args) => { chatCompletionCalls.push(args); return typeof reply === 'function' ? reply(args) : reply }
    }
    const setup = (n = 3) => {
      reset()
      const t = seedTicket({ title: 'wifi keeps dropping', description: 'every few minutes' })
      const arts = Array.from({ length: n }, (_, i) => seedArticle({ title: `wifi article ${i}`, summary: 'sum', content: 'steps...', category: CAT_NETWORK }))
      return { t, arts }
    }
    const reply = (...items) => JSON.stringify({ results: items })

    test('no key: retrieval only, source "retrieval", model never called, and no article body leaks', async () => {
      const { t } = setup()
      const r = await call('tech', 'GET', `/kb-suggestions/${t.publicId}`)
      assert.equal(r.body.payload.source, 'retrieval')
      assert.equal(chatCompletionCalls.length, 0)
      assert.ok(r.body.payload.articles.every((a) => a.content === undefined && a.relevance === undefined))
    })

    test('the model re-orders by relevance and adds why + steps; the article text is sent to the model', async () => {
      const { t, arts } = setup()
      useAi(reply(
        { articleId: arts[2].publicId, relevance: 92, why: 'Same symptom', steps: ['Forget the network', 'Rejoin'] },
        { articleId: arts[0].publicId, relevance: 55, why: 'Related', steps: [] },
      ))
      const r = await call('tech', 'GET', `/kb-suggestions/${t.publicId}`)
      assert.equal(r.status, 200)
      const p = r.body.payload
      assert.equal(p.source, 'ai'); assert.equal(p.cached, false)
      assert.deepEqual(p.articles.map((a) => a.publicId), [arts[2].publicId, arts[0].publicId])
      assert.equal(p.articles[0].relevance, 92); assert.equal(p.articles[0].why, 'Same symptom')
      assert.deepEqual(p.articles[0].steps, ['Forget the network', 'Rejoin'])
      assert.equal(p.articles[0].content, undefined, 'the body is for the model, not the client')
      assert.match(chatCompletionCalls[0].user, /wifi keeps dropping/)
      assert.match(chatCompletionCalls[0].user, new RegExp(arts[1].publicId))
      assert.equal(aiLogs.at(-1).kind, 'KB_RERANK'); assert.equal(aiLogs.at(-1).status, 'SUCCESS')
    })

    test('made-up ids, repeats, junk numbers and over-long text are cleaned; irrelevant ones (<20) are left out', async () => {
      const { t, arts } = setup()
      useAi(reply(
        { articleId: 'KB-2026-99999', relevance: 99, why: 'invented', steps: [] },
        { articleId: arts[0].publicId, relevance: 250, why: 'x'.repeat(900), steps: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 42, ''] },
        { articleId: arts[0].publicId, relevance: 10, why: 'dup', steps: [] },
        { articleId: arts[1].publicId, relevance: 'high', why: 'not a number', steps: [] },
        { articleId: arts[2].publicId, relevance: 5, why: 'barely', steps: [] },
      ))
      const r = await call('tech', 'GET', `/kb-suggestions/${t.publicId}`)
      const a = r.body.payload.articles
      assert.deepEqual(a.map((x) => x.publicId), [arts[0].publicId])
      assert.equal(a[0].relevance, 100)
      assert.equal(a[0].why.length, 200)
      assert.equal(a[0].steps.length, 5)
      assert.ok(a[0].steps.every((s) => typeof s === 'string' && s.length > 0))
    })

    test('a fenced reply works; an explicit empty list means "nothing here helps" and is honoured', async () => {
      const { t, arts } = setup()
      useAi('```json\n' + reply({ articleId: arts[1].publicId, relevance: 70, why: 'ok', steps: [] }) + '\n```')
      let r = await call('tech', 'GET', `/kb-suggestions/${t.publicId}?refresh=true`)
      assert.equal(r.body.payload.source, 'ai'); assert.equal(r.body.payload.articles.length, 1)
      useAi(reply())
      r = await call('tech', 'GET', `/kb-suggestions/${t.publicId}?refresh=true`)
      assert.equal(r.body.payload.source, 'ai'); assert.deepEqual(r.body.payload.articles, [])
    })

    test('garbage, wrong shape or a thrown error fall back to retrieval order, 200, logged as ERROR', async () => {
      const { t, arts } = setup()
      for (const bad of ['sorry I cannot', '{"foo":1}', '[]', () => { throw new Error('timed out') }]) {
        chatCompletionCalls.length = 0
        useAi(bad)
        const r = await call('tech', 'GET', `/kb-suggestions/${t.publicId}`)
        assert.equal(r.status, 200)
        assert.equal(r.body.payload.source, 'retrieval')
        assert.equal(r.body.payload.articles.length, arts.length)
        assert.equal(aiLogs.at(-1).kind, 'KB_RERANK'); assert.equal(aiLogs.at(-1).status, 'ERROR')
      }
      assert.equal(ticketUpdates, 0, 'a failed attempt is never saved on the ticket')
    })

    test('re-ranking retries once on malformed JSON before falling back', async () => {
      const { t, arts } = setup()
      let n = 0
      useAi(() => (++n === 1 ? '{"results":[{"articleId":"' + arts[0].publicId + '","relevance":80,"why":"a" "steps":[]}]}' : reply({ articleId: arts[0].publicId, relevance: 80, why: 'ok', steps: [] })))
      const r = await call('tech', 'GET', `/kb-suggestions/${t.publicId}`)
      assert.equal(r.body.payload.source, 'ai'); assert.equal(chatCompletionCalls.length, 2)
      assert.equal(aiLogs.at(-1).status, 'SUCCESS')
    })

    test('a good answer is saved on the ticket and served from there next time; ?refresh=true asks the model again', async () => {
      const { t, arts } = setup()
      useAi(reply({ articleId: arts[0].publicId, relevance: 80, why: 'match', steps: ['do it'] }))
      await call('tech', 'GET', `/kb-suggestions/${t.publicId}`)
      assert.equal(ticketUpdates, 1)
      assert.equal(ticketStore[0].ai.kbSuggestions.source, 'ai')
      const again = await call('tech', 'GET', `/kb-suggestions/${t.publicId}`)
      assert.equal(chatCompletionCalls.length, 1, 'second view costs no model call')
      assert.equal(again.body.payload.cached, true); assert.equal(again.body.payload.source, 'ai')
      assert.equal(again.body.payload.articles[0].why, 'match'); assert.deepEqual(again.body.payload.articles[0].steps, ['do it'])
      const fresh = await call('tech', 'GET', `/kb-suggestions/${t.publicId}?refresh=true`)
      assert.equal(chatCompletionCalls.length, 2); assert.equal(fresh.body.payload.cached, false)
    })

    test('a saved suggestion for an article that is no longer published is dropped, never shown', async () => {
      const { t, arts } = setup()
      useAi(reply({ articleId: arts[0].publicId, relevance: 80, why: 'a', steps: [] }, { articleId: arts[1].publicId, relevance: 70, why: 'b', steps: [] }))
      await call('tech', 'GET', `/kb-suggestions/${t.publicId}`)
      arts[0].status = 'ARCHIVED'
      const r = await call('tech', 'GET', `/kb-suggestions/${t.publicId}`)
      assert.equal(r.body.payload.cached, true)
      assert.deepEqual(r.body.payload.articles.map((a) => a.publicId), [arts[1].publicId])
    })

    test('drafts are never shown to the model, and a technician from another team is refused before any model call', async () => {
      const { t } = setup(1)
      const draft = seedArticle({ title: 'wifi secret draft', category: CAT_NETWORK, status: 'DRAFT', author: USERS.tech._id })
      useAi(reply())
      await call('tech', 'GET', `/kb-suggestions/${t.publicId}`)
      assert.ok(!chatCompletionCalls[0].user.includes(draft.publicId))
      chatCompletionCalls.length = 0
      assert.equal((await call('techHr', 'GET', `/kb-suggestions/${t.publicId}`)).status, 404)
      assert.equal(chatCompletionCalls.length, 0)
    })

    test('no candidate articles at all: no model call', async () => {
      reset(); const t = seedTicket(); useAi(reply())
      const r = await call('tech', 'GET', `/kb-suggestions/${t.publicId}`)
      assert.deepEqual(r.body.payload.articles, [])
      assert.equal(chatCompletionCalls.length, 0)
    })
  })
})
