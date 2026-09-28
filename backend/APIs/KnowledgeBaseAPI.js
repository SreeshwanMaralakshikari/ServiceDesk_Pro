import exp from 'express'
import { KnowledgeArticleModel } from '../models/KnowledgeArticleModel.js'
import { CategoryModel } from '../models/CategoryModel.js'
import { verifyToken } from '../middlewares/verifyToken.js'
import { generateSequentialId } from '../utils/generateSequentialId.js'
import { idOrPublicIdFilter } from '../utils/findByIdOrPublicId.js'
import { buildKbQuery } from '../utils/buildKbQuery.js'
import { isKbTransitionAllowed } from '../utils/kbTransitions.js'

export const kbApp = exp.Router()

const ALL_ROLES = ['ADMIN', 'MANAGER', 'TECHNICIAN', 'EMPLOYEE', 'ASSET_MANAGER']
const WRITE_ROLES = ['TECHNICIAN', 'MANAGER', 'ADMIN']
const ELEVATED_ROLES = ['MANAGER', 'ADMIN']

// an article not yet PUBLISHED (or ARCHIVED) is only visible to its author
// or a Manager/Admin — everyone else gets a 404 (not 403) so a restricted
// article's existence isn't leaked to an unauthorized viewer
// `article.author` is an ObjectId on most routes but a full *document* on routes
// that .populate('author') — and toString() on a populated document dumps the
// whole object instead of returning the id, so the ownership comparison must
// go through this helper, never `article.author.toString()` directly
const authorIdOf = (article) => String(article.author?._id ?? article.author)
const isAuthor = (article, user) => authorIdOf(article) === user.id

// tags arrive as user input: keep only a list of text, then trim/lowercase,
// drop blanks and de-duplicate. Returns null when the shape is wrong so the
// route can answer 400 (the schema separately enforces the count/length caps).
const normalizeTags = (tags) => {
  if (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string')) return null
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))]
}
const isText = (v) => typeof v === 'string'

const canViewNonPublished = (article, user) =>
  isAuthor(article, user) || ELEVATED_ROLES.includes(user.role)

// list — any active user. Employees/Asset Managers only ever see PUBLISHED
// articles (enforced in buildKbQuery's scope, not here) so self-service
// browsing and the eventual AI kb-suggestions lookup share one code path.
kbApp.get('/articles', verifyToken(...ALL_ROLES), async (req, res, next) => {
  try {
    const { status, category, q } = req.query
    const query = buildKbQuery(req.user, { status, category, q })

    // clamp paging so ?limit=0 / ?limit=abc / ?page=-3 can't yield
    // totalPages of Infinity/NaN or a negative skip
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100)
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1)
    const skip = (page - 1) * limit
    const [items, total] = await Promise.all([
      KnowledgeArticleModel.find(query)
        .select('-content -history') // list view: no need to ship the full body/audit trail
        .populate('category', 'name department')
        .populate('author', 'firstName lastName role')
        .sort({ publishedAt: -1, createdAt: -1, _id: -1 }) // _id last so equal timestamps still page deterministically
        .skip(skip)
        .limit(limit),
      KnowledgeArticleModel.countDocuments(query),
    ])
    //send res
    res.status(200).json({ message: 'articles fetched', payload: { items, total, page, totalPages: Math.ceil(total / limit) } })
  } catch (err) { next(err) }
})

// author's own articles regardless of status — registered before
// /articles/:articleId so "mine" is never swallowed as an id/publicId
// lookup (the same trap as /assets/warranty-expiring vs /:assetId and
// /tickets/:id/priority vs /tickets/:id/:action)
kbApp.get('/articles/mine', verifyToken(...WRITE_ROLES), async (req, res, next) => {
  try {
    const articles = await KnowledgeArticleModel.find({ author: req.user.id, isDeleted: false })
      .select('-content -history')
      .populate('category', 'name department')
      .sort({ updatedAt: -1 })
    //send res
    res.status(200).json({ message: 'my articles fetched', payload: articles })
  } catch (err) { next(err) }
})

// create — Technician/Manager/Admin only, always starts as a DRAFT
kbApp.post('/articles', verifyToken(...WRITE_ROLES), async (req, res, next) => {
  try {
    const { title, summary, content, categoryId, tags } = req.body ?? {}
    if (!title || !summary || !content || !categoryId) {
      //send res
      return res.status(400).json({ message: 'title, summary, content and categoryId are required' })
    }
    if (![title, summary, content, categoryId].every(isText)) {
      //send res
      return res.status(400).json({ message: 'title, summary, content and categoryId must be text' })
    }
    const cleanTags = tags === undefined ? [] : normalizeTags(tags)
    if (!cleanTags) {
      //send res
      return res.status(400).json({ message: 'tags must be a list of text' })
    }
    const category = await CategoryModel.findOne({ _id: categoryId, isActive: true })
    if (!category) {
      //send res
      return res.status(400).json({ message: 'invalid category' })
    }
    // generateSequentialId counts existing articles, so two simultaneous
    // creates can pick the same number and one hits the unique index on
    // publicId (E11000). Recounting picks the next free number, so retry a
    // couple of times before treating it as a real conflict.
    let article
    for (let attempt = 1; ; attempt++) {
      try {
        const publicId = await generateSequentialId(KnowledgeArticleModel, 'KB')
        article = await KnowledgeArticleModel.create({
          publicId, title, summary, content, category: categoryId, tags: cleanTags,
          author: req.user.id,
          status: 'DRAFT',
          history: [{ toStatus: 'DRAFT', by: req.user.id, note: 'article created' }],
        })
        break
      } catch (err) {
        const code = err.code ?? err.cause?.code
        const dupField = Object.keys(err.keyValue ?? err.cause?.keyValue ?? {})[0]
        if (code !== 11000 || dupField !== 'publicId' || attempt >= 3) throw err
      }
    }
    //send res
    res.status(201).json({ message: 'article created', payload: article })
  } catch (err) { next(err) }
})

// detail — visibility gated by status; increments viewCount for published reads by other users
kbApp.get('/articles/:articleId', verifyToken(...ALL_ROLES), async (req, res, next) => {
  try {
    const article = await KnowledgeArticleModel.findOne({ ...idOrPublicIdFilter(req.params.articleId), isDeleted: false })
      .populate('category', 'name department')
      .populate('author', 'firstName lastName role')
    if (!article || (article.status !== 'PUBLISHED' && !canViewNonPublished(article, req.user))) {
      //send res
      return res.status(404).json({ message: 'article not found' })
    }
    // the author's own visits (e.g. the reload right after clicking Publish)
    // don't count as reads; everyone else's do
    if (article.status === 'PUBLISHED' && !isAuthor(article, req.user)) {
      // atomic increment — avoids a lost update if two reads race, and
      // keeps this route from needing a second .save() round-trip
      await KnowledgeArticleModel.updateOne({ _id: article._id }, { $inc: { viewCount: 1 } })
      article.viewCount += 1
    }
    //send res
    res.status(200).json({ message: 'article fetched', payload: article })
  } catch (err) { next(err) }
})

// edit core fields — author or Manager/Admin, and only while not ARCHIVED
// (an archived article must be restored to DRAFT first — keeps archived
// content a stable, untouched historical record)
kbApp.patch('/articles/:articleId', verifyToken(...WRITE_ROLES), async (req, res, next) => {
  try {
    const { title, summary, content, categoryId, tags } = req.body ?? {}
    // validate the shape of what was sent before touching the database
    if ([title, summary, content, categoryId].some((v) => v !== undefined && !isText(v))) {
      //send res
      return res.status(400).json({ message: 'title, summary, content and categoryId must be text' })
    }
    const cleanTags = tags === undefined ? undefined : normalizeTags(tags)
    if (cleanTags === null) {
      //send res
      return res.status(400).json({ message: 'tags must be a list of text' })
    }
    const article = await KnowledgeArticleModel.findOne({ ...idOrPublicIdFilter(req.params.articleId), isDeleted: false })
    if (!article) {
      //send res
      return res.status(404).json({ message: 'article not found' })
    }
    if (req.user.role === 'TECHNICIAN' && !isAuthor(article, req.user)) {
      //send res
      return res.status(403).json({ message: 'only the author (or a manager/admin) can edit this article' })
    }
    if (article.status === 'ARCHIVED') {
      //send res
      return res.status(400).json({ message: 'restore this article to draft before editing it' })
    }
    if (categoryId !== undefined) {
      const category = await CategoryModel.findOne({ _id: categoryId, isActive: true })
      if (!category) {
        //send res
        return res.status(400).json({ message: 'invalid category' })
      }
      article.category = categoryId
    }
    if (title !== undefined) article.title = title
    if (summary !== undefined) article.summary = summary
    if (content !== undefined) article.content = content
    if (cleanTags !== undefined) article.tags = cleanTags
    await article.save()
    //send res
    res.status(200).json({ message: 'article updated', payload: article })
  } catch (err) { next(err) }
})

// audit trail — same visibility rule as the detail route
kbApp.get('/articles/:articleId/history', verifyToken(...WRITE_ROLES), async (req, res, next) => {
  try {
    const article = await KnowledgeArticleModel.findOne({ ...idOrPublicIdFilter(req.params.articleId), isDeleted: false })
      .select('history author status')
      .populate('history.by', 'firstName lastName role')
    if (!article) {
      //send res
      return res.status(404).json({ message: 'article not found' })
    }
    // history is staff-only regardless of publish status, so the same
    // author-or-elevated check applies even to a PUBLISHED article
    if (!canViewNonPublished(article, req.user)) {
      //send res
      return res.status(403).json({ message: "only the author (or a manager/admin) can view this article's history" })
    }
    //send res
    res.status(200).json({ message: 'article history fetched', payload: article.history })
  } catch (err) { next(err) }
})

// publish / archive / restore — the only third-segment PATCH route on this
// router, so there's no wildcard-vs-literal collision to guard against here
// the way /tickets/:id/priority and /assets/:id/replace had to be ordered;
// still keeping the lesson in mind if a literal sub-route is ever added later.
kbApp.patch('/articles/:articleId/:action', verifyToken(...WRITE_ROLES), async (req, res, next) => {
  try {
    const { articleId, action } = req.params
    const { note, version } = req.body ?? {}
    if (note !== undefined && (!isText(note) || note.length > 500)) {
      //send res
      return res.status(400).json({ message: 'note must be text of at most 500 characters' })
    }

    const article = await KnowledgeArticleModel.findOne({ ...idOrPublicIdFilter(articleId), isDeleted: false })
    if (!article) {
      //send res
      return res.status(404).json({ message: 'article not found' })
    }

    const check = isKbTransitionAllowed(action, article.status, req.user.role)
    if (!check.ok) {
      //send res
      return res.status(check.reason.includes('authorized') ? 403 : 400).json({ message: check.reason })
    }
    if (check.authorOrElevatedOnly && req.user.role === 'TECHNICIAN' && !isAuthor(article, req.user)) {
      //send res
      return res.status(403).json({ message: 'only the author (or a manager/admin) can do this' })
    }
    if (typeof version === 'number' && version !== article.version) {
      //send res
      return res.status(409).json({ message: 'article was updated by someone else, please refresh' })
    }

    const from = article.status
    article.status = check.to
    article.version += 1
    article.history.push({ fromStatus: from, toStatus: check.to, by: req.user.id, note })
    if (action === 'publish') article.publishedAt = new Date()
    if (action === 'archive') article.archivedAt = new Date()
    if (action === 'restore') article.archivedAt = undefined

    await article.save()
    //send res
    res.status(200).json({ message: `article ${action}ed`, payload: article })
  } catch (err) { next(err) }
})

// soft delete — author or Manager/Admin, and only once an article is no
// longer live (archive it first, same reasoning as the edit-lock above)
kbApp.delete('/articles/:articleId', verifyToken(...WRITE_ROLES), async (req, res, next) => {
  try {
    const article = await KnowledgeArticleModel.findOne({ ...idOrPublicIdFilter(req.params.articleId), isDeleted: false })
    if (!article) {
      //send res
      return res.status(404).json({ message: 'article not found' })
    }
    if (req.user.role === 'TECHNICIAN' && !isAuthor(article, req.user)) {
      //send res
      return res.status(403).json({ message: 'only the author (or a manager/admin) can delete this article' })
    }
    if (article.status === 'PUBLISHED') {
      //send res
      return res.status(400).json({ message: 'archive this article before deleting it' })
    }
    article.isDeleted = true
    await article.save()
    //send res
    res.status(200).json({ message: 'article deleted' })
  } catch (err) { next(err) }
})
