// QA: runs the REAL seed code against stubbed DB writes and asserts five scenarios:
//  A fresh DB, B existing DB with an empty KB (top-up), C repeat run (no duplicates),
//  D a renamed/missing category (skips instead of crashing), E a KB write failure
//  (must NOT propagate: server.js would retry the DB connection and process.exit(1)).
// Every KB article is also validated against the real Mongoose schema.
process.env.MONGO_URI = 'mongodb://unused'; process.env.JWT_SECRET = 'x'; process.env.CLIENT_URL = 'http://x'
import { fileURLToPath, pathToFileURL } from 'url'
import nodePath from 'path'
import assert from 'node:assert/strict'
const ROOT = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '..')
const load = (p) => import(pathToFileURL(p).href)
const base = ROOT + '/backend/'

const { Types } = await load(base + 'node_modules/mongoose/index.js')
const { UserModel } = await load(base + 'models/UserModel.js')
const { DepartmentModel } = await load(base + 'models/DepartmentModel.js')
const { CategoryModel } = await load(base + 'models/CategoryModel.js')
const { SLAPolicyModel } = await load(base + 'models/SLAPolicyModel.js')
const { VendorModel } = await load(base + 'models/VendorModel.js')
const { AssetModel } = await load(base + 'models/AssetModel.js')
const { KnowledgeArticleModel } = await load(base + 'models/KnowledgeArticleModel.js')
const { seedIfEmpty, seedKnowledgeBaseIfEmpty } = await load(base + 'utils/seedData.js')

const withId = (d) => ({ _id: new Types.ObjectId(), ...d })
// generic in-memory store: findOne matches every key of the filter, create stores
const store = new Map()
const rows = (M) => { if (!store.has(M)) store.set(M, []); return store.get(M) }
const matches = (doc, f) => Object.entries(f).every(([k, v]) => String(doc[k]) === String(v))
for (const M of [UserModel, DepartmentModel, CategoryModel, SLAPolicyModel, VendorModel, AssetModel]) {
  M.findOne = async (f) => rows(M).find((d) => matches(d, f)) || null
  M.create = async (d) => { const r = withId(d); rows(M).push(r); return r }
  M.countDocuments = async () => rows(M).length
}
DepartmentModel.findByIdAndUpdate = async () => ({})
let kb = []
Object.defineProperty(globalThis, '__cats', { get: () => rows(CategoryModel), set: (v) => store.set(CategoryModel, v) })
KnowledgeArticleModel.countDocuments = async () => kb.length
const realCreate = async (d) => { await new KnowledgeArticleModel(d).validate(); kb.push(d); return d } // real schema validation
KnowledgeArticleModel.create = realCreate

const quiet = async (fn) => { const o = console.log; const out = []; console.log = (...a) => out.push(a.join(' ')); try { await fn() } finally { console.log = o } return out }
const statuses = () => kb.reduce((m, a) => ((m[a.status] = (m[a.status] || 0) + 1), m), {})
const expectedStatuses = { PUBLISHED: 10, DRAFT: 2, ARCHIVED: 1 }

await quiet(seedIfEmpty)
assert.equal(kb.length, 13, 'A: 13 articles'); assert.equal(new Set(kb.map((a) => a.publicId)).size, 13, 'A: unique ids')
assert.deepEqual(statuses(), expectedStatuses, 'A: status mix')
assert.ok(kb.every((a) => a.tags.every((t) => t === t.toLowerCase().trim())), 'A: tags normalised')
assert.ok(!kb.some((a) => /\\/.test(a.title + a.summary + a.content)), 'A: no stray backslashes')
console.log('ok  A fresh database seeds 13 valid articles (10 published / 2 draft / 1 archived)')

await quiet(seedIfEmpty)
assert.equal(kb.length, 13, 'A2: rerun must not add more')
console.log('ok  A2 re-running the seed is idempotent')

kb = []
const outB = await quiet(seedIfEmpty)
assert.equal(kb.length, 13, 'B: existing DB must be topped up'); assert.ok(outB.some((l) => /ensuring seed data/.test(l)))
console.log('ok  B an existing database (users present, KB empty) is topped up')

const before = kb.length
await quiet(seedKnowledgeBaseIfEmpty)
assert.equal(kb.length, before, 'C: no duplicates')
console.log('ok  C repeated top-up never duplicates')

kb = []; const net = __cats.find((c) => c.name === 'Network'); __cats = __cats.filter((c) => c.name !== 'Network')
const outD = await quiet(seedKnowledgeBaseIfEmpty)
assert.equal(kb.length, 0, 'D: nothing seeded'); assert.ok(outD.some((l) => /skipped/.test(l)))
console.log('ok  D a missing category skips seeding gracefully instead of crashing')

__cats.push(net); kb = []
KnowledgeArticleModel.create = async () => { throw new Error('simulated write failure') }
let threw = false
const outE = await quiet(async () => { try { await seedIfEmpty() } catch { threw = true } })
assert.equal(threw, false, 'E: a KB seed failure must not escape seedIfEmpty'); assert.ok(outE.some((l) => /non-fatal/.test(l)))
KnowledgeArticleModel.create = realCreate
console.log('ok  E a KB write failure is logged and swallowed (server.js would otherwise retry then exit)')

// F: re-running must not add ANY row to any collection
const count = () => [UserModel, DepartmentModel, CategoryModel, SLAPolicyModel, VendorModel, AssetModel].map((M) => rows(M).length).join(',')
await quiet(seedIfEmpty); const c1 = count(); await quiet(seedIfEmpty)
assert.equal(count(), c1, 'F: second run adds nothing')
assert.ok(rows(SLAPolicyModel).some((p) => p.priority === 'TEST' && p.level === 0), 'F: TEST priority ensured')
console.log('ok  F the ensure-style seed adds nothing on a second run and keeps the TEST priority')

// G: production gating - no demo accounts, admin only from SEED_ADMIN_PASSWORD
store.clear(); kb = []; process.env.NODE_ENV = 'production'; delete process.env.SEED_ADMIN_PASSWORD
const outG = await quiet(seedIfEmpty)
assert.equal(rows(UserModel).length, 0, 'G: no users without SEED_ADMIN_PASSWORD'); assert.ok(outG.some((l) => /SEED_ADMIN_PASSWORD/.test(l)))
process.env.SEED_ADMIN_PASSWORD = 'short'; await quiet(seedIfEmpty)
assert.equal(rows(UserModel).length, 0, 'G: short password refused')
process.env.SEED_ADMIN_PASSWORD = 'a-long-enough-pass'; await quiet(seedIfEmpty); await quiet(seedIfEmpty)
assert.equal(rows(UserModel).length, 1, 'G: exactly one admin, created once'); assert.equal(rows(UserModel)[0].role, 'ADMIN')
assert.notEqual(rows(UserModel)[0].password, 'a-long-enough-pass', 'G: stored hashed')
assert.equal(rows(AssetModel).length, 0, 'G: no demo assets in production')
console.log('ok  G production seeds no demo data; the admin comes only from SEED_ADMIN_PASSWORD (>=12 chars, hashed, once)')
process.exit(0)
