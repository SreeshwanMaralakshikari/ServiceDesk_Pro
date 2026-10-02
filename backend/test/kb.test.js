// Phase 5 tests. No MongoDB needed:
//  - pure logic (kbTransitions) is tested directly
//  - buildKbQuery scope is checked against sample docs with `sift`, the same
//    matcher Mongoose/MongoDB-style filters are modelled on
//  - schema rules use Mongoose's own validate()
//  - routes are exercised over real HTTP against the real router, with the
//    model *methods* swapped for an in-memory store
process.env.JWT_SECRET = 'test-secret'
process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://unused'
process.env.CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173'

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import exp from 'express'
import cookieParser from 'cookie-parser'
import jwt from 'jsonwebtoken'
// sift: declared as a devDependency, pinned to the exact version mongoose itself locks
import sift from 'sift'
import { applyUpdate } from '../testkit/applyUpdate.js'

import { KnowledgeArticleModel } from '../models/KnowledgeArticleModel.js'
import { CategoryModel } from '../models/CategoryModel.js'
import { UserModel } from '../models/UserModel.js'
import { AuditLogModel } from '../models/AuditLogModel.js'
import { isKbTransitionAllowed, KB_TRANSITIONS } from '../utils/kbTransitions.js'
import { buildKbQuery } from '../utils/buildKbQuery.js'
import { kbApp } from '../APIs/KnowledgeBaseAPI.js'
import { sanitizeBody } from '../middlewares/sanitize.js'

// ---------- ids / users ----------
const oid = (n) => String(n).padStart(24, '0')
const USERS = {
  admin:   { _id: oid(1), role: 'ADMIN' },
  manager: { _id: oid(2), role: 'MANAGER' },
  tech:    { _id: oid(3), role: 'TECHNICIAN' },
  tech2:   { _id: oid(4), role: 'TECHNICIAN' },
  emp:     { _id: oid(5), role: 'EMPLOYEE' },
  assetMgr:{ _id: oid(6), role: 'ASSET_MANAGER' },
}
const CAT_ID = oid(100)

describe('kbTransitions', () => {
  test('publish only from DRAFT', () => {
    assert.equal(isKbTransitionAllowed('publish', 'DRAFT', 'TECHNICIAN').ok, true)
    assert.equal(isKbTransitionAllowed('publish', 'PUBLISHED', 'TECHNICIAN').ok, false)
    assert.equal(isKbTransitionAllowed('publish', 'ARCHIVED', 'ADMIN').ok, false)
  })
  test('archive from DRAFT or PUBLISHED, not ARCHIVED', () => {
    assert.equal(isKbTransitionAllowed('archive', 'DRAFT', 'MANAGER').ok, true)
    assert.equal(isKbTransitionAllowed('archive', 'PUBLISHED', 'MANAGER').ok, true)
    assert.equal(isKbTransitionAllowed('archive', 'ARCHIVED', 'MANAGER').ok, false)
  })
  test('restore only from ARCHIVED and goes to DRAFT (never straight to PUBLISHED)', () => {
    const r = isKbTransitionAllowed('restore', 'ARCHIVED', 'ADMIN')
    assert.equal(r.ok, true)
    assert.equal(r.to, 'DRAFT')
    assert.equal(isKbTransitionAllowed('restore', 'PUBLISHED', 'ADMIN').ok, false)
  })
  test('EMPLOYEE / ASSET_MANAGER are never authorized', () => {
    for (const action of Object.keys(KB_TRANSITIONS)) {
      for (const role of ['EMPLOYEE', 'ASSET_MANAGER']) {
        const from = KB_TRANSITIONS[action].from[0]
        const r = isKbTransitionAllowed(action, from, role)
        assert.equal(r.ok, false)
        assert.match(r.reason, /authorized/) // route maps this to 403
      }
    }
  })
  test('unknown action rejected', () => {
    assert.equal(isKbTransitionAllowed('delete', 'DRAFT', 'ADMIN').ok, false)
  })
})

describe('buildKbQuery scope (matched with sift against sample docs)', () => {
  const docs = [
    { id: 'pub-by-tech',   status: 'PUBLISHED', author: USERS.tech._id,  isDeleted: false },
    { id: 'draft-by-tech', status: 'DRAFT',     author: USERS.tech._id,  isDeleted: false },
    { id: 'draft-by-t2',   status: 'DRAFT',     author: USERS.tech2._id, isDeleted: false },
    { id: 'arch-by-t2',    status: 'ARCHIVED',  author: USERS.tech2._id, isDeleted: false },
    { id: 'deleted-pub',   status: 'PUBLISHED', author: USERS.tech._id,  isDeleted: true },
  ]
  const ids = (user, filters) => docs.filter(sift(buildKbQuery({ id: user._id, role: user.role }, filters))).map((d) => d.id).sort()

  test('EMPLOYEE sees only non-deleted PUBLISHED', () => {
    assert.deepEqual(ids(USERS.emp, {}), ['pub-by-tech'])
  })
  test('EMPLOYEE passing ?status=DRAFT / ARCHIVED cannot widen scope (no leak)', () => {
    assert.deepEqual(ids(USERS.emp, { status: 'DRAFT' }), [])
    assert.deepEqual(ids(USERS.emp, { status: 'ARCHIVED' }), [])
    assert.deepEqual(ids(USERS.assetMgr, { status: 'DRAFT' }), [])
  })
  test('TECHNICIAN sees published + own non-published only', () => {
    assert.deepEqual(ids(USERS.tech, {}), ['draft-by-tech', 'pub-by-tech'])
    assert.deepEqual(ids(USERS.tech2, {}), ['arch-by-t2', 'draft-by-t2', 'pub-by-tech'])
  })
  test('TECHNICIAN ?status=DRAFT narrows to own drafts, not others\'', () => {
    assert.deepEqual(ids(USERS.tech, { status: 'DRAFT' }), ['draft-by-tech'])
  })
  test('MANAGER/ADMIN see all non-deleted; status filter narrows', () => {
    assert.equal(ids(USERS.manager, {}).length, 4)
    assert.deepEqual(ids(USERS.admin, { status: 'DRAFT' }), ['draft-by-t2', 'draft-by-tech'])
    assert.ok(!ids(USERS.admin, {}).includes('deleted-pub'))
  })
  test('non-string filter values (arrays / operator objects) are ignored, never passed to MongoDB', () => {
    const admin = { id: USERS.admin._id, role: 'ADMIN' }
    const q = buildKbQuery(admin, { q: ['a', 'b'], status: { $ne: 'PUBLISHED' }, category: { $ne: 'x' } })
    assert.equal(q.$text, undefined)
    assert.equal(q.status, undefined)
    assert.equal(q.category, undefined)
    assert.deepEqual(buildKbQuery(admin, { q: '  vpn  ', status: ' DRAFT ', category: CAT_ID }).$text, { $search: 'vpn' })
    assert.equal(buildKbQuery(admin, { q: '   ' }).$text, undefined) // blank search is no search
  })
  test('q becomes $text and does not disturb scope keys', () => {
    const q = buildKbQuery({ id: USERS.emp._id, role: 'EMPLOYEE' }, { q: 'vpn' })
    assert.deepEqual(q.$text, { $search: 'vpn' })
    assert.ok(q.$or && q.isDeleted === false)
  })
})

describe('KnowledgeArticle schema', () => {
  const valid = () => ({ publicId: 'KB-2026-00001', title: 't', summary: 's', content: 'c', category: CAT_ID, author: USERS.tech._id })
  test('valid doc passes and defaults to DRAFT / viewCount 0 / not deleted', async () => {
    const d = new KnowledgeArticleModel(valid())
    await d.validate()
    assert.equal(d.status, 'DRAFT'); assert.equal(d.viewCount, 0); assert.equal(d.isDeleted, false); assert.equal(d.version, 0)
  })
  for (const field of ['title', 'summary', 'content', 'category', 'author']) {
    test(`missing ${field} is rejected`, async () => {
      const data = valid(); delete data[field]
      await assert.rejects(new KnowledgeArticleModel(data).validate(), /required/i)
    })
  }
  test('invalid status rejected', async () => {
    await assert.rejects(new KnowledgeArticleModel({ ...valid(), status: 'LIVE' }).validate())
  })
  test('strict:"throw" rejects unknown fields', () => {
    assert.throws(() => new KnowledgeArticleModel({ ...valid(), bogus: 1 }))
  })
  test('tags are lowercased and trimmed', () => {
    const d = new KnowledgeArticleModel({ ...valid(), tags: ['  WiFi ', 'VPN'] })
    assert.deepEqual([...d.tags], ['wifi', 'vpn'])
  })
  test('text index covers title, summary, content, tags', () => {
    const textIdx = KnowledgeArticleModel.schema.indexes().find(([spec]) => Object.values(spec).includes('text'))
    assert.ok(textIdx)
    assert.deepEqual(Object.keys(textIdx[0]).sort(), ['content', 'summary', 'tags', 'title'])
  })
})

// ---------- HTTP layer with an in-memory store ----------
describe('KB routes over HTTP (stubbed models)', () => {
  let server, base, store
  const originals = {}

  // Fidelity note: the store keeps JSON snapshots (ids as strings, so `sift` can
  // match filters), but every read hands back a REAL hydrated Mongoose document,
  // and `.populate()` swaps in real user/category documents the way Mongoose
  // does. An earlier version of this harness used plain objects with string
  // ids, which hid a populated-author bug (see 'detail: author can open their
  // own draft' below).
  const snap = (doc) => JSON.parse(JSON.stringify(doc))
  const NAMES = { [oid(1)]: 'Ava', [oid(2)]: 'Mia', [oid(3)]: 'Theo', [oid(4)]: 'Tina', [oid(5)]: 'Eli', [oid(6)]: 'Amy' }
  const populateDoc = (doc, paths) => {
    for (const path of paths) {
      if (path === 'author' && doc.author) {
        const id = String(doc.author)
        const u = USERS_BY_ID[id]
        // no password field, like a real `.populate('author', 'firstName lastName role')`
        doc.author = new UserModel({ _id: id, firstName: NAMES[id], lastName: 'X', role: u?.role })
      }
      if (path === 'category' && doc.category) {
        doc.category = new CategoryModel({ _id: String(doc.category), name: 'Hardware' })
      }
    }
    return doc
  }
  const USERS_BY_ID = Object.fromEntries(Object.values(USERS).map((u) => [u._id, u]))
  const chain = (result) => {
    const paths = []
    const resolve = () => (Array.isArray(result) ? result.map((d) => populateDoc(d, paths)) : result ? populateDoc(result, paths) : result)
    const q = {
      select: () => q, sort: () => q, skip: () => q, limit: () => q,
      populate: (path) => { paths.push(path); return q },
      then: (a, b) => Promise.resolve().then(resolve).then(a, b),
      catch: (b) => Promise.resolve().then(resolve).catch(b),
    }
    return q
  }
  const attach = (doc) => {
    doc.save = async function () {
      await this.validate() // real schema validation on every save
      store = store.map((s) => (s._id === String(this._id) ? snap(this) : s))
      return this
    }
    return doc
  }
  const hydrateCopy = (s) => attach(KnowledgeArticleModel.hydrate(JSON.parse(JSON.stringify(s))))
  const strip = (q) => { const { $text, ...rest } = q; return rest }
  const cur = (d) => store.find((s) => s._id === String(d._id)) // current stored snapshot
  let seq
  const seedDoc = (over) => {
    seq += 1
    const d = attach(new KnowledgeArticleModel({
      _id: oid(1000 + seq), publicId: `KB-2026-${String(seq).padStart(5, '0')}`,
      title: 't' + seq, summary: 's', content: 'c', category: CAT_ID, tags: [],
      status: 'DRAFT', author: USERS.tech._id, viewCount: 0, history: [], version: 0, isDeleted: false, ...over,
    }))
    store.push(snap(d)); return d
  }
  const call = async (as, method, path, body) => {
    const headers = { 'Content-Type': 'application/json' }
    if (as) headers.Cookie = `token=${jwt.sign({ id: USERS[as]._id }, 'test-secret')}`
    const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
    return { status: res.status, body: await res.json() }
  }

  // no Content-Type, no body at all — what curl / a careless client sends.
  // Express 5 leaves req.body undefined here, so destructuring it throws.
  const callBare = async (as, method, path) => {
    const headers = as ? { Cookie: `token=${jwt.sign({ id: USERS[as]._id }, 'test-secret')}` } : {}
    const res = await fetch(base + path, { method, headers })
    return { status: res.status, body: await res.json() }
  }

  before(async () => {
    for (const [k, obj, names] of [
      ['kb', KnowledgeArticleModel, ['findOne', 'findOneAndUpdate', 'find', 'countDocuments', 'updateOne', 'create']],
      ['cat', CategoryModel, ['findOne']],
      ['user', UserModel, ['findById']],
    ]) { originals[k] = {}; for (const n of names) originals[k][n] = obj[n] }

    UserModel.findById = (id) => chain(Object.values(USERS).find((u) => u._id === String(id)) && { ...Object.values(USERS).find((u) => u._id === String(id)), isActive: true })
    CategoryModel.findOne = (f) => chain(String(f._id) === CAT_ID ? { _id: CAT_ID } : null)
    // like real Mongoose, hand back a separate hydrated copy, not the stored object itself
    KnowledgeArticleModel.findOne = (f) => { const hit = store.find(sift(f)); return chain(hit ? hydrateCopy(hit) : null) }
    // atomic update stub: match on the filter (status/version included), apply the operators, return the new document
    KnowledgeArticleModel.findOneAndUpdate = async (f, u) => {
      const i = store.findIndex(sift(JSON.parse(JSON.stringify(f))))
      if (i < 0) return null
      applyUpdate(store[i], u)
      return hydrateCopy(store[i])
    }
    KnowledgeArticleModel.find = (f) => chain(store.filter(sift(strip(f))).map(hydrateCopy))
    KnowledgeArticleModel.countDocuments = async (f) => store.filter(sift(strip(f))).length
    KnowledgeArticleModel.updateOne = async (f, u) => {
      const d = store.find((x) => x._id === String(f._id))
      if (d && u.$inc) for (const k in u.$inc) d[k] += u.$inc[k]
      return {}
    }
    KnowledgeArticleModel.create = async (data) => {
      const d = attach(new KnowledgeArticleModel({ ...data, _id: oid(5000 + store.length) }))
      await d.validate() // real schema validation
      store.push(snap(d)); return d
    }

    // no database in this file: audit writes are accepted and dropped (the real path is covered by the real-DB tests)
    AuditLogModel.create = async () => ({})

    const app = exp()
    app.use(exp.json()); app.use(cookieParser()); app.use(sanitizeBody)
    app.use('/kb-api', kbApp)
    app.use((err, req, res, next) => res.status(err.name === 'ValidationError' ? 400 : 500).json({ message: 'error occurred', error: err.message }))
    await new Promise((r) => { server = app.listen(0, r) })
    base = `http://127.0.0.1:${server.address().port}/kb-api`
  })
  after(() => {
    server.close()
    for (const [k, obj] of [['kb', KnowledgeArticleModel], ['cat', CategoryModel], ['user', UserModel]]) Object.assign(obj, originals[k])
  })
  const reset = () => { store = []; seq = 0 }

  test('auth: no cookie -> 401', async () => {
    reset()
    assert.equal((await call(null, 'GET', '/articles')).status, 401)
  })

  test('ROUTE ORDER: GET /articles/mine hits the "mine" handler, not :articleId', async () => {
    reset(); seedDoc({ author: USERS.tech._id }); seedDoc({ author: USERS.tech2._id })
    const r = await call('tech', 'GET', '/articles/mine')
    assert.equal(r.status, 200)
    assert.equal(r.body.message, 'my articles fetched')
    assert.equal(r.body.payload.length, 1)
  })

  test('/articles/mine is forbidden for EMPLOYEE (403), not a 404 from the id route', async () => {
    reset()
    assert.equal((await call('emp', 'GET', '/articles/mine')).status, 403)
  })

  test('create: tech can, employee cannot; starts as DRAFT with history + KB publicId', async () => {
    reset()
    const body = { title: 'T', summary: 'S', content: 'C', categoryId: CAT_ID, tags: ['A'] }
    assert.equal((await call('emp', 'POST', '/articles', body)).status, 403)
    const r = await call('tech', 'POST', '/articles', body)
    assert.equal(r.status, 201)
    assert.equal(r.body.payload.status, 'DRAFT')
    assert.match(r.body.payload.publicId, /^KB-\d{4}-00001$/)
    assert.equal(r.body.payload.author, USERS.tech._id)
    assert.equal(r.body.payload.history[0].toStatus, 'DRAFT')
  })

  test('create: 400 on missing fields and on invalid category; mass-assignment of status/author ignored', async () => {
    reset()
    assert.equal((await call('tech', 'POST', '/articles', { title: 'x' })).status, 400)
    assert.equal((await call('tech', 'POST', '/articles', { title: 'T', summary: 'S', content: 'C', categoryId: oid(999) })).status, 400)
    const r = await call('tech', 'POST', '/articles', { title: 'T', summary: 'S', content: 'C', categoryId: CAT_ID, status: 'PUBLISHED', author: USERS.admin._id, viewCount: 999 })
    assert.equal(r.status, 201)
    assert.equal(r.body.payload.status, 'DRAFT')
    assert.equal(r.body.payload.author, USERS.tech._id)
    assert.equal(r.body.payload.viewCount, 0)
  })

  test('list: EMPLOYEE sees only PUBLISHED even with ?status=DRAFT', async () => {
    reset(); seedDoc({ status: 'PUBLISHED' }); seedDoc({ status: 'DRAFT' }); seedDoc({ status: 'ARCHIVED' })
    assert.equal((await call('emp', 'GET', '/articles')).body.payload.total, 1)
    assert.equal((await call('emp', 'GET', '/articles?status=DRAFT')).body.payload.total, 0)
    assert.equal((await call('manager', 'GET', '/articles')).body.payload.total, 3)
    assert.equal((await call('manager', 'GET', '/articles?status=DRAFT')).body.payload.total, 1)
  })

  test('list: category filter works and pagination metadata is right', async () => {
    reset(); for (let i = 0; i < 5; i++) seedDoc({ status: 'PUBLISHED' }); seedDoc({ status: 'PUBLISHED', category: oid(101) })
    const r = await call('emp', 'GET', `/articles?category=${CAT_ID}&limit=2`)
    assert.equal(r.body.payload.total, 5)
    assert.equal(r.body.payload.totalPages, 3)
  })

  test('list: junk paging params are clamped, never Infinity/NaN', async () => {
    reset(); for (let i = 0; i < 3; i++) seedDoc({ status: 'PUBLISHED' })
    for (const qs of ['limit=0', 'limit=abc', 'limit=-5', 'page=-3', 'page=abc', 'limit=99999']) {
      const r = await call('emp', 'GET', `/articles?${qs}`)
      assert.equal(r.status, 200, qs)
      assert.ok(Number.isFinite(r.body.payload.totalPages) && r.body.payload.totalPages >= 1, qs)
      assert.ok(r.body.payload.page >= 1, qs)
    }
  })

  test('detail: draft is 404 (not 403) for other users, visible to author and manager', async () => {
    reset(); const d = seedDoc({ status: 'DRAFT', author: USERS.tech._id })
    assert.equal((await call('emp', 'GET', `/articles/${d.publicId}`)).status, 404)
    assert.equal((await call('tech2', 'GET', `/articles/${d.publicId}`)).status, 404)
    assert.equal((await call('tech', 'GET', `/articles/${d.publicId}`)).status, 200)
    assert.equal((await call('manager', 'GET', `/articles/${d._id}`)).status, 200) // by _id too
  })

  test('detail: author can open their own draft/archived article (populated author must still match by id)', async () => {
    reset()
    const draft = seedDoc({ status: 'DRAFT', author: USERS.tech._id })
    const arch = seedDoc({ status: 'ARCHIVED', author: USERS.tech._id })
    for (const d of [draft, arch]) {
      const r = await call('tech', 'GET', `/articles/${d.publicId}`)
      assert.equal(r.status, 200, `author should see own ${d.status}`)
      assert.equal(r.body.payload.author.firstName, 'Theo') // and the populate still reaches the client
    }
    // the ownership check must not have become permissive for someone else
    assert.equal((await call('tech2', 'GET', `/articles/${draft.publicId}`)).status, 404)
  })

  test('create -> immediately open (the exact flow the UI does after saving a draft)', async () => {
    reset()
    const c = await call('tech', 'POST', '/articles', { title: 'T', summary: 'S', content: 'C', categoryId: CAT_ID })
    assert.equal(c.status, 201)
    const r = await call('tech', 'GET', `/articles/${c.body.payload.publicId}`)
    assert.equal(r.status, 200)
  })

  test('detail: published read bumps viewCount by exactly 1 per view; draft view does not', async () => {
    reset(); const p = seedDoc({ status: 'PUBLISHED', viewCount: 10 }); const dr = seedDoc({ status: 'DRAFT', viewCount: 0 })
    const r = await call('emp', 'GET', `/articles/${p.publicId}`)
    assert.equal(r.body.payload.viewCount, 11)
    assert.equal(cur(p).viewCount, 11)
    await call('tech', 'GET', `/articles/${dr.publicId}`)
    assert.equal(cur(dr).viewCount, 0)
  })

  test('detail: unknown id and soft-deleted article -> 404; garbage id does not 500', async () => {
    reset(); const del = seedDoc({ status: 'PUBLISHED', isDeleted: true })
    assert.equal((await call('emp', 'GET', '/articles/KB-2026-99999')).status, 404)
    assert.equal((await call('emp', 'GET', `/articles/${del.publicId}`)).status, 404)
    assert.equal((await call('emp', 'GET', '/articles/not-an-id!!')).status, 404)
  })

  test('edit: author ok, other technician 403, manager ok, employee 403', async () => {
    reset(); const d = seedDoc({ status: 'DRAFT', author: USERS.tech._id })
    assert.equal((await call('tech2', 'PATCH', `/articles/${d.publicId}`, { title: 'hax' })).status, 403)
    assert.equal((await call('emp', 'PATCH', `/articles/${d.publicId}`, { title: 'hax' })).status, 403)
    assert.equal((await call('tech', 'PATCH', `/articles/${d.publicId}`, { title: 'mine' })).status, 200)
    assert.equal((await call('manager', 'PATCH', `/articles/${d.publicId}`, { summary: 'mgr' })).status, 200)
    const after = cur(d)
    assert.equal(after.title, 'mine'); assert.equal(after.summary, 'mgr')
  })

  test('edit: PUBLISHED is editable in place, ARCHIVED is locked (400), bad category 400', async () => {
    reset(); const p = seedDoc({ status: 'PUBLISHED' }); const a = seedDoc({ status: 'ARCHIVED' })
    assert.equal((await call('tech', 'PATCH', `/articles/${p.publicId}`, { title: 'typo fix' })).status, 200)
    assert.equal((await call('tech', 'PATCH', `/articles/${a.publicId}`, { title: 'x' })).status, 400)
    assert.equal((await call('tech', 'PATCH', `/articles/${p.publicId}`, { categoryId: oid(999) })).status, 400)
  })

  test('workflow: DRAFT -> publish -> archive -> restore -> publish, with history, timestamps, version', async () => {
    reset(); const d = seedDoc({ status: 'DRAFT', author: USERS.tech._id })
    let r = await call('tech', 'PATCH', `/articles/${d.publicId}/publish`, { version: 0 })
    assert.equal(r.status, 200); assert.equal(r.body.payload.status, 'PUBLISHED'); assert.ok(r.body.payload.publishedAt); assert.equal(r.body.payload.version, 1)
    r = await call('tech', 'PATCH', `/articles/${d.publicId}/archive`, { note: 'old', version: 1 })
    assert.equal(r.body.payload.status, 'ARCHIVED'); assert.ok(r.body.payload.archivedAt)
    r = await call('tech', 'PATCH', `/articles/${d.publicId}/restore`, { version: 2 })
    assert.equal(r.body.payload.status, 'DRAFT'); assert.equal(r.body.payload.archivedAt, undefined)
    r = await call('manager', 'PATCH', `/articles/${d.publicId}/publish`, { version: 3 })
    assert.equal(r.body.payload.status, 'PUBLISHED'); assert.equal(r.body.payload.version, 4)
    assert.deepEqual(r.body.payload.history.map((h) => `${h.fromStatus}>${h.toStatus}`), ['DRAFT>PUBLISHED', 'PUBLISHED>ARCHIVED', 'ARCHIVED>DRAFT', 'DRAFT>PUBLISHED'])
    assert.equal(r.body.payload.history[1].note, 'old')
  })

  test('workflow: illegal transitions -> 400; unknown action -> 400; wrong role -> 403', async () => {
    reset(); const p = seedDoc({ status: 'PUBLISHED' }); const a = seedDoc({ status: 'ARCHIVED' }); const d = seedDoc({ status: 'DRAFT' })
    assert.equal((await call('tech', 'PATCH', `/articles/${p.publicId}/publish`, { version: 0 })).status, 400)
    assert.equal((await call('tech', 'PATCH', `/articles/${a.publicId}/archive`, { version: 0 })).status, 400)
    assert.equal((await call('tech', 'PATCH', `/articles/${d.publicId}/restore`, { version: 0 })).status, 400)
    assert.equal((await call('tech', 'PATCH', `/articles/${d.publicId}/explode`, { version: 0 })).status, 400)
    assert.equal((await call('emp', 'PATCH', `/articles/${d.publicId}/publish`, { version: 0 })).status, 403)
  })

  test('workflow: another technician cannot publish/archive someone else\'s article; manager can', async () => {
    reset(); const d = seedDoc({ status: 'DRAFT', author: USERS.tech._id }); const p = seedDoc({ status: 'PUBLISHED', author: USERS.tech._id })
    assert.equal((await call('tech2', 'PATCH', `/articles/${d.publicId}/publish`, { version: 0 })).status, 403)
    assert.equal((await call('tech2', 'PATCH', `/articles/${p.publicId}/archive`, { version: 0 })).status, 403)
    assert.equal(cur(d).status, 'DRAFT') // untouched
    assert.equal((await call('manager', 'PATCH', `/articles/${d.publicId}/publish`, { version: 0 })).status, 200)
    assert.equal((await call('admin', 'PATCH', `/articles/${p.publicId}/archive`, { version: 0 })).status, 200)
  })

  test('workflow: stale version -> 409, matching version ok, missing version -> 400', async () => {
    reset(); const d = seedDoc({ status: 'DRAFT', version: 3 })
    assert.equal((await call('tech', 'PATCH', `/articles/${d.publicId}/publish`, { version: 1 })).status, 409)
    assert.equal(cur(d).status, 'DRAFT')
    assert.equal((await call('tech', 'PATCH', `/articles/${d.publicId}/publish`, {})).status, 400)
    assert.equal(cur(d).status, 'DRAFT')
    assert.equal((await call('tech', 'PATCH', `/articles/${d.publicId}/publish`, { version: 3 })).status, 200)
    // a stale version wins over a status mismatch (already published now): the client must refresh
    assert.equal((await call('tech', 'PATCH', `/articles/${d.publicId}/publish`, { version: 3 })).status, 409)
    assert.equal((await call('tech', 'PATCH', `/articles/${d.publicId}/publish`, { version: 4 })).status, 400)
  })

  test('history: staff only, author-or-elevated; 404 for missing', async () => {
    reset(); const d = seedDoc({ status: 'PUBLISHED', author: USERS.tech._id, history: [{ toStatus: 'DRAFT' }] })
    assert.equal((await call('emp', 'GET', `/articles/${d.publicId}/history`)).status, 403)
    assert.equal((await call('tech2', 'GET', `/articles/${d.publicId}/history`)).status, 403)
    assert.equal((await call('tech', 'GET', `/articles/${d.publicId}/history`)).status, 200)
    assert.equal((await call('manager', 'GET', `/articles/${d.publicId}/history`)).status, 200)
    assert.equal((await call('manager', 'GET', '/articles/KB-2026-99999/history')).status, 404)
  })

  test('delete: blocked while PUBLISHED, ok once archived/draft, soft (row kept, flagged), author/elevated only', async () => {
    reset(); const p = seedDoc({ status: 'PUBLISHED', author: USERS.tech._id }); const d = seedDoc({ status: 'DRAFT', author: USERS.tech._id })
    assert.equal((await call('tech', 'DELETE', `/articles/${p.publicId}`)).status, 400)
    assert.equal((await call('tech2', 'DELETE', `/articles/${d.publicId}`)).status, 403)
    assert.equal((await call('emp', 'DELETE', `/articles/${d.publicId}`)).status, 403)
    assert.equal((await call('tech', 'DELETE', `/articles/${d.publicId}`)).status, 200)
    assert.equal(cur(d).isDeleted, true)
    assert.equal((await call('manager', 'GET', `/articles/${d.publicId}`)).status, 404) // now invisible to everyone
    assert.equal((await call('manager', 'GET', '/articles')).body.payload.total, 1)
  })

  test('bodyless requests get a clean 4xx/2xx, never a 500 from destructuring an undefined body', async () => {
    reset(); const d = seedDoc({ status: 'DRAFT', author: USERS.tech._id })
    assert.equal((await callBare('tech', 'POST', '/articles')).status, 400)               // create: missing fields
    assert.equal((await callBare('tech', 'PATCH', `/articles/${d.publicId}`)).status, 200) // edit: nothing to change
    assert.equal((await callBare('tech', 'PATCH', `/articles/${d.publicId}/publish`)).status, 400) // version is required, so no body is a clean 400
    assert.equal(cur(d).status, 'DRAFT')
  })

  test('crafted query strings (?q=a&q=b, ?status[$ne]=x) are answered with 200 and never leak scope', async () => {
    reset(); seedDoc({ status: 'PUBLISHED' }); seedDoc({ status: 'DRAFT' })
    for (const qs of ['q=a&q=b', 'status[$ne]=PUBLISHED', 'category[$ne]=x', 'status=DRAFT&status=ARCHIVED']) {
      const r = await call('emp', 'GET', `/articles?${qs}`)
      assert.equal(r.status, 200, qs)
      assert.ok(r.body.payload.items.every((a) => a.status === 'PUBLISHED'), qs)
    }
  })

  test('viewCount: a view by the article\'s own author does not inflate it; other viewers do', async () => {
    reset(); const p = seedDoc({ status: 'PUBLISHED', author: USERS.tech._id, viewCount: 5 })
    await call('tech', 'GET', `/articles/${p.publicId}`)    // author (e.g. reloading after clicking Publish)
    assert.equal(cur(p).viewCount, 5)
    await call('tech2', 'GET', `/articles/${p.publicId}`)   // other staff
    await call('emp', 'GET', `/articles/${p.publicId}`)     // employee
    assert.equal(cur(p).viewCount, 7)
  })

  const good = () => ({ title: 'T', summary: 'S', content: 'C', categoryId: CAT_ID })

  test('integrity: whitespace-only or non-text fields are rejected on create and on edit', async () => {
    reset(); const d = seedDoc({ status: 'DRAFT', author: USERS.tech._id, title: 'keep me' })
    for (const bad of [{ title: '   ' }, { summary: '\n \t' }, { content: '    ' }, { title: { a: 1 } }, { content: ['x'] }]) {
      assert.equal((await call('tech', 'POST', '/articles', { ...good(), ...bad })).status, 400, JSON.stringify(bad))
      assert.equal((await call('tech', 'PATCH', `/articles/${d.publicId}`, bad)).status, 400, 'edit ' + JSON.stringify(bad))
    }
    assert.equal(cur(d).title, 'keep me') // nothing half-applied
  })

  test('integrity: size caps (title 200, summary 500, content 50000) — one over is rejected, at the limit is fine', async () => {
    reset()
    for (const [field, max] of [['title', 200], ['summary', 500], ['content', 50000]]) {
      assert.equal((await call('tech', 'POST', '/articles', { ...good(), [field]: 'a'.repeat(max) })).status, 201, `${field} at limit`)
      assert.equal((await call('tech', 'POST', '/articles', { ...good(), [field]: 'a'.repeat(max + 1) })).status, 400, `${field} over limit`)
    }
  })

  test('integrity: tags are trimmed, lowercased, de-duplicated, blanks dropped; max 10 tags of max 30 chars; must be an array', async () => {
    reset()
    const ok = await call('tech', 'POST', '/articles', { ...good(), tags: ['  VPN ', 'vpn', '', '   ', 'Wi-Fi'] })
    assert.equal(ok.status, 201)
    assert.deepEqual(ok.body.payload.tags, ['vpn', 'wi-fi'])
    const ten = Array.from({ length: 10 }, (_, i) => 't' + i)
    assert.equal((await call('tech', 'POST', '/articles', { ...good(), tags: ten })).status, 201)
    assert.equal((await call('tech', 'POST', '/articles', { ...good(), tags: [...ten, 'eleven'] })).status, 400)
    assert.equal((await call('tech', 'POST', '/articles', { ...good(), tags: ['x'.repeat(31)] })).status, 400)
    assert.equal((await call('tech', 'POST', '/articles', { ...good(), tags: 'vpn' })).status, 400)
    assert.equal((await call('tech', 'POST', '/articles', { ...good(), tags: [{ a: 1 }] })).status, 400)
  })

  test('integrity: a workflow note must be short text, and a bad note leaves the article untouched', async () => {
    reset(); const d = seedDoc({ status: 'PUBLISHED', author: USERS.tech._id })
    assert.equal((await call('tech', 'PATCH', `/articles/${d.publicId}/archive`, { note: 'x'.repeat(501), version: 0 })).status, 400)
    assert.equal((await call('tech', 'PATCH', `/articles/${d.publicId}/archive`, { note: { a: 1 }, version: 0 })).status, 400)
    assert.equal(cur(d).status, 'PUBLISHED'); assert.equal(cur(d).version, 0)
    assert.equal((await call('tech', 'PATCH', `/articles/${d.publicId}/archive`, { note: 'x'.repeat(500), version: 0 })).status, 200)
  })

  test('operator injection in body is stripped by sanitizeBody before reaching the route', async () => {
    reset()
    const r = await call('tech', 'POST', '/articles', { title: 'T', summary: 'S', content: 'C', categoryId: CAT_ID, tags: ['ok'], $where: '1' })
    assert.equal(r.status, 201)
  })
})
