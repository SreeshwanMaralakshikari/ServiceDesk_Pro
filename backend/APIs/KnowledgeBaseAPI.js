import exp from 'express'
import { KnowledgeArticleModel } from '../models/KnowledgeArticleModel.js'
import { CategoryModel } from '../models/CategoryModel.js'
import { verifyToken } from '../middlewares/verifyToken.js'
import { generateSequentialId } from '../utils/generateSequentialId.js'
import { idOrPublicIdFilter } from '../utils/findByIdOrPublicId.js'
import { buildKbQuery, TEXT_SCORE, textRankSort } from '../utils/buildKbQuery.js'
import { KB_TRANSITIONS, isKbTransitionAllowed } from '../utils/kbTransitions.js'
import { atomicTransition, isValidVersion, VERSION_REQUIRED_MESSAGE } from '../utils/atomicTransition.js'
import { getPagination, toPage } from '../utils/pagination.js'
import { logAudit } from '../utils/logAudit.js'
import { UserModel } from '../models/UserModel.js'
import { notifyMany } from '../utils/createNotification.js'
import { asText } from '../utils/queryParams.js'

export const kbApp = exp.Router()

const ALL_ROLES = ['ADMIN', 'MANAGER', 'TECHNICIAN', 'EMPLOYEE', 'ASSET_MANAGER']
const WRITE_ROLES = ['TECHNICIAN', 'MANAGER', 'ADMIN']
const ELEVATED_ROLES = ['MANAGER', 'ADMIN']
const KB_ACTION_MESSAGES = { 'request-review': 'review requested', publish: 'article published', archive: 'article archived', restore: 'article restored' }

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

// who voted is private: the response says how many found it helpful and whether the caller did
export const toArticleView = (article, user) => {
  const view = typeof article.toObject === 'function' ? article.toObject() : { ...article }
  const voters = (view.helpfulBy ?? []).map(String)
  view.markedHelpful = voters.includes(String(user.id))
  view.helpfulCount = view.helpfulCount ?? 0
  delete view.helpfulBy
  return view
}

const canViewNonPublished = (article, user) =>
  isAuthor(article, user) || ELEVATED_ROLES.includes(user.role)

// list — any active user. Employees/Asset Managers only ever see PUBLISHED
// articles (enforced in buildKbQuery's scope, not here) so self-service
// browsing and the eventual AI kb-suggestions lookup share one code path.
kbApp.get('/articles', verifyToken(...ALL_ROLES), async (req, res, next) => {
  try {
    const { status, category, q, review } = req.query
    // the review inbox is for the people who can act on it
    if (asText(review) === 'pending' && !ELEVATED_ROLES.includes(req.user.role)) {
      //send res
      return res.status(403).json({ message: 'only a manager or admin can list articles waiting for review' })
    }
    const query = buildKbQuery(req.user, { status, category, q, review })

    const paging = getPagination(req.query)
    // a text search is ranked by how well it matches; browsing shows the newest first
    const searching = Boolean(asText(q))
    const find = KnowledgeArticleModel.find(query)
      .select('-content -history -helpfulBy') // list view: no need to ship the full body, the audit trail or who voted
      .populate('category', 'name department')
      .populate('author', 'firstName lastName role')
    if (searching) find.select(TEXT_SCORE)
    const [items, total] = await Promise.all([
      find
        .sort(searching ? textRankSort : { publishedAt: -1, createdAt: -1, _id: -1 }) // _id last so equal timestamps still page deterministically
        .skip(paging.skip)
        .limit(paging.limit),
      KnowledgeArticleModel.countDocuments(query),
    ])
    //send res
    res.status(200).json({ message: 'articles fetched', payload: toPage(items, total, paging) })
  } catch (err) { next(err) }
})

// author's own articles regardless of status — registered before
// /articles/:articleId so "mine" is never swallowed as an id/publicId
// lookup (the same trap as /assets/warranty-expiring vs /:assetId and
// /tickets/:id/priority vs /tickets/:id/:action)
kbApp.get('/articles/mine', verifyToken(...WRITE_ROLES), async (req, res, next) => {
  try {
    const articles = await KnowledgeArticleModel.find({ author: req.user.id, isDeleted: false })
      .select('-content -history -helpfulBy')
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
    // the id comes from an atomic counter, so a clash on publicId should not
    // happen; the retry only covers a counter that fell behind the data
    // (for example after a database restore): the next try takes the next number
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
    await logAudit({ req, action: 'KB_CREATED', entityType: 'KB_ARTICLE', entity: article, after: { status: article.status } })
    //send res
    res.status(201).json({ message: 'article created', payload: toArticleView(article, req.user) })
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
    res.status(200).json({ message: 'article fetched', payload: toArticleView(article, req.user) })
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
    // a published article is reviewed content: a technician changes it by asking a manager
    if (req.user.role === 'TECHNICIAN' && article.status !== 'DRAFT') {
      //send res
      return res.status(400).json({ message: 'technicians can only edit drafts; ask a manager to change a published article' })
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
    const fields = Object.entries({ title, summary, content, categoryId, tags }).filter(([, value]) => value !== undefined).map(([key]) => key)
    await logAudit({ req, action: 'KB_UPDATED', entityType: 'KB_ARTICLE', entity: article, after: { fields } })
    //send res
    res.status(200).json({ message: 'article updated', payload: toArticleView(article, req.user) })
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
    if (!isValidVersion(version)) {
      //send res
      return res.status(400).json({ message: VERSION_REQUIRED_MESSAGE })
    }

    const check = isKbTransitionAllowed(action, article.status, req.user.role)
    if (!check.ok) {
      // a stale version beats "wrong status": the caller is looking at old data
      if (check.reason.startsWith('cannot ') && version !== article.version) {
        //send res
        return res.status(409).json({ message: 'article was updated by someone else, please refresh' })
      }
      //send res
      return res.status(check.reason.includes('authorized') ? 403 : 400).json({ message: check.reason })
    }
    if (check.authorOnlyForTechnician && req.user.role === 'TECHNICIAN' && !isAuthor(article, req.user)) {
      //send res
      return res.status(403).json({ message: 'only the author (or a manager/admin) can do this' })
    }
    if (version !== article.version) {
      //send res
      return res.status(409).json({ message: 'article was updated by someone else, please refresh' })
    }

    // asking again would notify the managers a second time
    if (action === 'request-review' && article.reviewRequestedAt) {
      //send res
      return res.status(400).json({ message: 'a review was already requested for this article' })
    }

    const now = new Date()
    const set = {}
    const unset = {}
    if (check.to) set.status = check.to
    if (action === 'request-review') set.reviewRequestedAt = now
    if (action === 'publish') set.publishedAt = now
    if (action === 'archive') set.archivedAt = now
    if (action === 'restore') unset.archivedAt = ''
    // any decision on the draft closes the review request
    if (check.to) unset.reviewRequestedAt = ''

    const result = await atomicTransition({
      Model: KnowledgeArticleModel, doc: article, action, noun: 'article', from: KB_TRANSITIONS[action].from, version,
      set, unset,
      push: { history: { fromStatus: article.status, toStatus: check.to ?? article.status, by: req.user.id, note: note ?? (action === 'request-review' ? 'review requested' : undefined), at: now } },
    })
    if (result.error) {
      //send res
      return res.status(result.error.status).json({ message: result.error.message })
    }
    await logAudit({ req, action: `KB_${action.toUpperCase()}`, entityType: 'KB_ARTICLE', entity: result.doc, before: { status: article.status, version }, after: { status: result.doc.status, version: result.doc.version } })
    if (action === 'request-review') {
      // managers of the category's team hear about it; a team without a manager falls back to the admins
      const category = await CategoryModel.findById(article.category).select('department')
      let recipients = category ? await UserModel.find({ role: 'MANAGER', department: category.department, isActive: true }).select('_id') : []
      if (recipients.length === 0) recipients = await UserModel.find({ role: 'ADMIN', isActive: true }).select('_id')
      await notifyMany(recipients.map((u) => u._id), {
        type: 'KB_REVIEW_REQUESTED',
        message: `Article ${article.publicId} "${article.title}" is ready for review`,
        link: `/kb/${article.publicId}`,
      })
    }
    //send res
    res.status(200).json({ message: KB_ACTION_MESSAGES[action], payload: toArticleView(result.doc, req.user) })
  } catch (err) { next(err) }
})

// helpful vote — anyone who can read a PUBLISHED article, once each, and it can be taken back.
// One atomic update per direction: the filter only matches while the vote is (not) there, so
// two quick clicks can never count twice. Authors cannot vote on their own article.
kbApp.put('/articles/:articleId/helpful', verifyToken(...ALL_ROLES), async (req, res, next) => {
  try {
    const { helpful } = req.body ?? {}
    if (typeof helpful !== 'boolean') {
      //send res
      return res.status(400).json({ message: 'helpful must be true or false' })
    }
    const article = await KnowledgeArticleModel.findOne({ ...idOrPublicIdFilter(req.params.articleId), isDeleted: false, status: 'PUBLISHED' }).select('author')
    if (!article) {
      //send res
      return res.status(404).json({ message: 'article not found' })
    }
    if (isAuthor(article, req.user)) {
      //send res
      return res.status(400).json({ message: 'you cannot vote on your own article' })
    }
    if (helpful) {
      await KnowledgeArticleModel.updateOne({ _id: article._id, helpfulBy: { $ne: req.user.id } }, { $addToSet: { helpfulBy: req.user.id }, $inc: { helpfulCount: 1 } })
    } else {
      await KnowledgeArticleModel.updateOne({ _id: article._id, helpfulBy: req.user.id }, { $pull: { helpfulBy: req.user.id }, $inc: { helpfulCount: -1 } })
    }
    const fresh = await KnowledgeArticleModel.findById(article._id).select('helpfulBy helpfulCount')
    //send res
    res.status(200).json({ message: 'vote saved', payload: { helpfulCount: fresh.helpfulCount, markedHelpful: fresh.helpfulBy.map(String).includes(String(req.user.id)) } })
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
    await logAudit({ req, action: 'KB_DELETED', entityType: 'KB_ARTICLE', entity: article, before: { status: article.status } })
    //send res
    res.status(200).json({ message: 'article deleted' })
  } catch (err) { next(err) }
})
