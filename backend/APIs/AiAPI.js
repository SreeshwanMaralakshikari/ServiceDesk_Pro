import exp from 'express'
import { CategoryModel } from '../models/CategoryModel.js'
import { SLAPolicyModel } from '../models/SLAPolicyModel.js'
import { TicketModel } from '../models/TicketModel.js'
import { KnowledgeArticleModel } from '../models/KnowledgeArticleModel.js'
import { AiLogModel } from '../models/AiLogModel.js'
import { verifyToken } from '../middlewares/verifyToken.js'
import { aiLimiter } from '../middlewares/rateLimiters.js'
import { idOrPublicIdFilter } from '../utils/findByIdOrPublicId.js'
import { buildTicketQuery } from '../utils/buildTicketQuery.js'
import { buildKbQuery, TEXT_SCORE, textRankSort } from '../utils/buildKbQuery.js'
import { parseModelJson, hashInput } from '../utils/aiJson.js'
import { groqClient, resolveModel } from '../config/groq.js'
import { guessCategory, guessPriority } from '../utils/aiFallback.js'

export const aiApp = exp.Router()

// input caps: keep the prompt small and bounded regardless of how much text
// a person pastes into the create-ticket form — truncate, never reject
const TITLE_CAP = 300
const DESCRIPTION_CAP = 3000
const cap = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '')
const isText = (v) => typeof v === 'string'

// best-effort audit log — never lets a logging failure break the response
// resolves to the saved log (so its id can go back to the client) or null
const logAttempt = (fields) => AiLogModel.create(fields).catch((err) => { console.log('AiLog write failed (non-fatal):', err.message); return null })
const CACHE_HOURS = 24

// POST /ai-api/classify-ticket — same roles as ticket creation (EMPLOYEE,
// ADMIN), called from the create-ticket form BEFORE the ticket exists, so
// there is no ticket id yet and this never touches TicketModel.
// The answer carries an `aiLogId`; the create form sends it back with the ticket and the
// server uses it to record whether the person accepted the suggestion.
aiApp.post('/classify-ticket', verifyToken('EMPLOYEE', 'ADMIN'), aiLimiter, async (req, res, next) => {
  const start = Date.now()
  try {
    const { title, description } = req.body ?? {}
    if ((title !== undefined && !isText(title)) || (description !== undefined && !isText(description))) {
      //send res
      return res.status(400).json({ message: 'title and description must be text' })
    }
    // whitespace-only counts as missing — same rule Phase 5 applied to the KB
    // (title/summary/content trim before `required`): an all-blank string
    // must not silently proceed and get a fallback classification of nothing
    if (!title?.trim() && !description?.trim()) {
      //send res
      return res.status(400).json({ message: 'title or description is required' })
    }
    const cleanTitle = cap(title, TITLE_CAP)
    const cleanDescription = cap(description, DESCRIPTION_CAP)
    const text = `${cleanTitle}\n${cleanDescription}`.trim()

    const [categories, priorityDocs] = await Promise.all([
      CategoryModel.find({ isActive: true }).select('name').sort({ name: 1 }), // deterministic order for the fallback tie-break and the AI prompt's list
      // TEST is an internal demo-only priority (Phase 3) — never a real suggestion
      SLAPolicyModel.find({ isActive: true, level: { $gt: 0 } }).select('priority').sort({ level: 1 }),
    ])
    const priorityCodes = priorityDocs.map((p) => p.priority)

    const fallback = () => {
      const cat = guessCategory(text, categories)
      return {
        categoryId: cat?._id ?? null,
        categoryName: cat?.name ?? null,
        priority: guessPriority(text, priorityCodes),
        probableIssue: null,
        source: 'fallback',
      }
    }
    const reply = (result, log, message) => res.status(200).json({ message, payload: { ...result, aiLogId: log?._id ?? null } })

    if (!groqClient.isConfigured()) {
      const result = fallback()
      const log = await logAttempt({
        kind: 'CLASSIFY_TICKET', status: 'FALLBACK', requestedBy: req.user.id,
        inputSnippet: cap(text, 200), output: result, errorMessage: 'no API key configured',
        latencyMs: Date.now() - start,
      })
      //send res
      return reply(result, log, 'classification suggested (fallback)')
    }

    // the same wording again (and the model, categories and priorities unchanged) reuses the earlier answer: faster, free, and the free tier lasts longer
    const inputHash = hashInput(resolveModel(), categories.map((c) => c.name).join(','), priorityCodes.join(','), text)
    const earlier = await AiLogModel.findOne({
      kind: 'CLASSIFY_TICKET', inputHash, status: 'SUCCESS', cached: { $ne: true },
      createdAt: { $gt: new Date(Date.now() - CACHE_HOURS * 3600 * 1000) },
    }).sort({ createdAt: -1 })
    const stillValid = earlier?.output && categories.find((c) => String(c._id) === String(earlier.output.categoryId))
    if (stillValid) {
      const result = { ...earlier.output, categoryId: stillValid._id, categoryName: stillValid.name, source: 'ai' }
      const log = await logAttempt({
        kind: 'CLASSIFY_TICKET', status: 'SUCCESS', cached: true, requestedBy: req.user.id, inputSnippet: cap(text, 200),
        inputHash, output: result, model: resolveModel(), latencyMs: Date.now() - start,
      })
      //send res
      return reply(result, log, 'classification suggested')
    }

    let result
    let status = 'SUCCESS'
    let errorMessage
    try {
      const system = [
        'You are an IT helpdesk triage assistant.',
        `Choose exactly one category name from this list: ${categories.map((c) => c.name).join(', ')}.`,
        `Choose exactly one priority from this list: ${priorityCodes.join(', ')}.`,
        'Reply with ONLY a compact JSON object of the shape',
        '{"categoryName": string, "priority": string, "probableIssue": string}',
        'and no other text, no markdown fences.',
      ].join(' ')
      const raw = await groqClient.chatCompletion({ system, user: text, maxTokens: 200 })
      const parsed = parseModelJson(raw)
      const matchedCategory = categories.find((c) => c.name.toLowerCase() === String(parsed.categoryName).toLowerCase())
      const matchedPriority = priorityCodes.find((p) => p.toLowerCase() === String(parsed.priority).toLowerCase())
      if (!matchedCategory || !matchedPriority || !isText(parsed.probableIssue)) {
        throw new Error('AI response did not match the allowed categories/priorities')
      }
      result = {
        categoryId: matchedCategory._id, categoryName: matchedCategory.name,
        priority: matchedPriority, probableIssue: cap(parsed.probableIssue, 300), source: 'ai',
      }
    } catch (err) {
      status = 'ERROR'
      errorMessage = cap(err.message, 300)
      result = fallback()
    }

    const log = await logAttempt({
      kind: 'CLASSIFY_TICKET', status, requestedBy: req.user.id, inputSnippet: cap(text, 200),
      inputHash, output: result, errorMessage, model: resolveModel(), latencyMs: Date.now() - start,
    })
    //send res
    reply(result, log, status === 'SUCCESS' ? 'classification suggested' : 'classification suggested (fallback)')
  } catch (err) { next(err) }
})

// ---- KB suggestions for a ticket (technician-facing) ----
// Step 1, retrieval: up to 5 PUBLISHED articles, best text match first (same category, then
// the whole category by popularity if nothing matches the words).
// Step 2, AI re-ranking (when a key is set): the model is shown only those 5 and returns, for each,
// how relevant it is (0-100), why, and a few steps taken from the article. It can only pick
// from what it was shown: unknown ids are dropped, numbers are clamped, text is capped.
// Any failure falls back to the retrieval order. A good AI answer is saved on the ticket
// (`ai.kbSuggestions`) so reopening the ticket costs nothing; `?refresh=true` asks again.
const RERANK_MIN_RELEVANCE = 20
const FIELDS = 'publicId title summary category viewCount status'
const clampText = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '')

const validateRerank = (parsed, sent) => {
  if (!parsed || !Array.isArray(parsed.results)) throw new Error('AI response had no results list')
  const allowed = new Set(sent.map((a) => a.publicId))
  const seen = new Set()
  const items = []
  for (const r of parsed.results) {
    const id = typeof r?.articleId === 'string' ? r.articleId.trim() : ''
    if (!allowed.has(id) || seen.has(id)) continue // made-up or repeated id
    const relevance = Math.round(Number(r.relevance))
    if (!Number.isFinite(relevance)) continue
    seen.add(id)
    const steps = (Array.isArray(r.steps) ? r.steps : []).map((x) => clampText(x, 200)).filter(Boolean).slice(0, 5)
    items.push({ publicId: id, relevance: Math.min(100, Math.max(0, relevance)), why: clampText(r.why, 200), steps })
  }
  // highest first; equal scores keep the retrieval order
  const order = new Map(sent.map((a, i) => [a.publicId, i]))
  return items.filter((i) => i.relevance >= RERANK_MIN_RELEVANCE).sort((a, b) => b.relevance - a.relevance || order.get(a.publicId) - order.get(b.publicId))
}

aiApp.get('/kb-suggestions/:ticketId', verifyToken('TECHNICIAN', 'MANAGER', 'ADMIN'), aiLimiter, async (req, res, next) => {
  const start = Date.now()
  try {
    // same visibility rule as GET /ticket-api/tickets/:ticketId — a
    // Technician can only pull suggestions for a ticket they could open
    const ticket = await TicketModel.findOne({ ...buildTicketQuery(req.user), ...idOrPublicIdFilter(req.params.ticketId) }).select('title description category ai')
    if (!ticket) {
      //send res
      return res.status(404).json({ message: 'ticket not found' })
    }
    const refresh = req.query.refresh === 'true'
    // drafts and archived articles are never suggested, whatever the caller's role
    // (buildKbQuery would otherwise show Managers/Admins everything and Technicians their own drafts)
    const publishedOnly = (filters) => ({ ...buildKbQuery(req.user, filters), status: 'PUBLISHED' })
    const category = ticket.category?.toString()
    const merge = (articles, items) => items.map((i) => {
      const a = articles.find((x) => x.publicId === i.publicId)
      return a && { ...(typeof a.toObject === 'function' ? a.toObject() : a), relevance: i.relevance, why: i.why, steps: i.steps }
    }).filter(Boolean)
    const done = (payload) => res.status(200).json({ message: 'kb suggestions fetched', payload })

    // 1) a saved AI answer, as long as those articles are still live
    const saved = ticket.ai?.kbSuggestions
    if (!refresh && saved?.source === 'ai' && saved.items?.length) {
      const live = await KnowledgeArticleModel.find({ ...publishedOnly({}), publicId: { $in: saved.items.map((i) => i.publicId) } }).select(FIELDS)
      const articles = merge(live, saved.items.map((i) => (typeof i.toObject === 'function' ? i.toObject() : i)))
      if (articles.length > 0) {
        await logAttempt({ kind: 'KB_SUGGESTIONS', status: 'SUCCESS', cached: true, requestedBy: req.user.id, ticket: ticket._id, output: { source: 'cache', articleIds: articles.map((a) => a.publicId) } })
        //send res
        return done({ matchedBy: saved.matchedBy ?? 'text+category', source: 'ai', cached: true, generatedAt: saved.at, articles })
      }
    }

    // 2) retrieval
    const query = `${ticket.title ?? ''} ${cap(ticket.description, 300)}`.trim()
    let articles = []
    let matchedBy = 'text+category'
    try {
      articles = await KnowledgeArticleModel.find(publishedOnly({ category, q: query }))
        .select({ publicId: 1, title: 1, summary: 1, category: 1, viewCount: 1, status: 1, content: 1, ...TEXT_SCORE }).sort(textRankSort).limit(5)
    } catch (err) {
      // a missing text index must not take the whole panel down; the category fallback still answers
      console.log('KB text search failed (falling back to category):', err.message)
    }
    if (articles.length === 0) {
      // no text hit — fall back to just the category, ranked by popularity,
      // so the panel still shows something rather than coming up empty
      articles = await KnowledgeArticleModel.find(publishedOnly({ category }))
        .select(`${FIELDS} content`).sort({ viewCount: -1, _id: -1 }).limit(5) // _id tiebreak: same determinism rule Phase 5 applied to the KB list route
      matchedBy = 'category'
    }
    const plain = (a) => { const o = typeof a.toObject === 'function' ? a.toObject() : { ...a }; delete o.content; delete o.score; return o }
    const retrieval = () => articles.map(plain)

    // 3) AI re-ranking
    if (articles.length > 0 && groqClient.isConfigured()) {
      try {
        const system = [
          'You help an IT support technician find knowledge-base articles that fix a ticket.',
          'You are given the ticket and a numbered list of candidate articles. Judge only from what is shown.',
          'Reply with ONLY JSON of the shape {"results":[{"articleId": string, "relevance": number 0-100, "why": string, "steps": [string]}]}.',
          'Use only the articleId values from the list. Leave out articles that do not help. "why" is one short sentence.',
          '"steps" are at most 4 short steps taken from that article that apply to this ticket. No markdown fences, no other text.',
        ].join(' ')
        const user = [
          `TICKET: ${cap(ticket.title, 200)}`, cap(ticket.description, 1000), '', 'ARTICLES:',
          ...articles.map((a) => `[${a.publicId}] ${a.title}\nSummary: ${cap(a.summary, 300)}\nContent: ${cap(a.content, 700)}`),
        ].join('\n')
        const raw = await groqClient.chatCompletion({ system, user, maxTokens: 700 })
        const items = validateRerank(parseModelJson(raw), articles)
        const ranked = merge(articles.map(plain), items)
        const at = new Date()
        await logAttempt({
          kind: 'KB_RERANK', status: 'SUCCESS', requestedBy: req.user.id, ticket: ticket._id, model: resolveModel(),
          output: { matchedBy, articleIds: ranked.map((a) => a.publicId) }, latencyMs: Date.now() - start,
        })
        await TicketModel.updateOne({ _id: ticket._id }, { $set: { 'ai.kbSuggestions': { at, source: 'ai', matchedBy, items } } })
          .catch((err) => console.log('saving KB suggestions failed (non-fatal):', err.message))
        //send res
        return done({ matchedBy, source: 'ai', cached: false, generatedAt: at, articles: ranked })
      } catch (err) {
        await logAttempt({
          kind: 'KB_RERANK', status: 'ERROR', requestedBy: req.user.id, ticket: ticket._id, model: resolveModel(),
          errorMessage: cap(err.message, 300), output: { matchedBy, articleIds: articles.map((a) => a.publicId) }, latencyMs: Date.now() - start,
        })
        //send res
        return done({ matchedBy, source: 'retrieval', cached: false, articles: retrieval() })
      }
    }

    await logAttempt({
      kind: 'KB_SUGGESTIONS', status: 'SUCCESS', requestedBy: req.user.id, ticket: ticket._id,
      output: { matchedBy, articleIds: articles.map((a) => a.publicId) },
    })
    //send res
    done({ matchedBy, source: 'retrieval', cached: false, articles: retrieval() })
  } catch (err) { next(err) }
})
