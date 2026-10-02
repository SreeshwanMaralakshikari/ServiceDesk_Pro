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
import { buildKbQuery } from '../utils/buildKbQuery.js'
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
const logAttempt = (fields) => AiLogModel.create(fields).catch((err) => console.log('AiLog write failed (non-fatal):', err.message))

// POST /ai-api/classify-ticket — same roles as ticket creation (EMPLOYEE,
// ADMIN), called from the create-ticket form BEFORE the ticket exists, so
// there is no ticket id yet and this never touches TicketModel.
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

    if (!groqClient.isConfigured()) {
      const result = fallback()
      await logAttempt({
        kind: 'CLASSIFY_TICKET', status: 'FALLBACK', requestedBy: req.user.id,
        inputSnippet: cap(text, 200), output: result, errorMessage: 'no API key configured',
        latencyMs: Date.now() - start,
      })
      //send res
      return res.status(200).json({ message: 'classification suggested (fallback)', payload: result })
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
      const parsed = JSON.parse(raw)
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

    await logAttempt({
      kind: 'CLASSIFY_TICKET', status, requestedBy: req.user.id, inputSnippet: cap(text, 200),
      output: result, errorMessage, model: resolveModel(), latencyMs: Date.now() - start,
    })
    //send res
    res.status(200).json({ message: status === 'SUCCESS' ? 'classification suggested' : 'classification suggested (fallback)', payload: result })
  } catch (err) { next(err) }
})

// GET /ai-api/kb-suggestions/:ticketId — technician-facing. Retrieval only,
// no LLM round trip: a relevance search over PUBLISHED KB content only —
// drafts and archived articles are never suggested, whatever the caller's role
// (buildKbQuery would otherwise show Managers/Admins everything and
// Technicians their own drafts).
aiApp.get('/kb-suggestions/:ticketId', verifyToken('TECHNICIAN', 'MANAGER', 'ADMIN'), aiLimiter, async (req, res, next) => {
  try {
    // same visibility rule as GET /ticket-api/tickets/:ticketId — a
    // Technician can only pull suggestions for a ticket they could open
    const ticket = await TicketModel.findOne({ ...buildTicketQuery(req.user), ...idOrPublicIdFilter(req.params.ticketId) }).select('title category')
    if (!ticket) {
      //send res
      return res.status(404).json({ message: 'ticket not found' })
    }

    const fields = 'publicId title summary category viewCount status'
    const publishedOnly = (filters) => ({ ...buildKbQuery(req.user, filters), status: 'PUBLISHED' })
    let articles = await KnowledgeArticleModel.find(publishedOnly({ category: ticket.category?.toString(), q: ticket.title }))
      .select(fields).sort({ viewCount: -1, _id: -1 }).limit(5) // _id tiebreak: same determinism rule Phase 5 applied to the KB list route
    let matchedBy = 'text+category'
    if (articles.length === 0) {
      // no text hit — fall back to just the category, ranked by popularity,
      // so the panel still shows something rather than coming up empty
      articles = await KnowledgeArticleModel.find(publishedOnly({ category: ticket.category?.toString() }))
        .select(fields).sort({ viewCount: -1, _id: -1 }).limit(5)
      matchedBy = 'category'
    }

    await logAttempt({
      kind: 'KB_SUGGESTIONS', status: 'SUCCESS', requestedBy: req.user.id, ticket: ticket._id,
      output: { matchedBy, articleIds: articles.map((a) => a.publicId) },
    })
    //send res
    res.status(200).json({ message: 'kb suggestions fetched', payload: { matchedBy, articles } })
  } catch (err) { next(err) }
})
