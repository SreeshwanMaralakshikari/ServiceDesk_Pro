// fixes from the 5 Oct error check (F-076 to F-089), through the real app and a real database
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { bootApp, loginAs } from '../../testkit/boot.js'
import { createTicket, act, fetchTicket } from '../../testkit/helpers.js'

describe('deploy fixes (real database)', () => {
  let ctx, admin, assets, mgr, emp, tech, AssetModel, TicketModel, SLAPolicyModel, VendorModel, NotificationModel
  const trail = async (entityType, action) => (await admin.get(`/admin-api/audit-logs?entityType=${entityType}&action=${action}&limit=50`)).body.payload.items
  const newAsset = async (over = {}) => {
    const r = await assets.post('/asset-api/assets').send({ name: 'Laptop', type: 'HARDWARE', assetClass: 'LAPTOP', ...over })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    return r.body.payload
  }

  before(async () => {
    ctx = await bootApp()
    ;[admin, assets, mgr, emp, tech] = await Promise.all(['admin@t.test', 'assets@t.test', 'mgr.svc@t.test', 'emp@t.test', 'tech.svc@t.test'].map((e) => loginAs(ctx.app, e)))
    ;({ AssetModel } = await import('../../models/AssetModel.js'))
    ;({ TicketModel } = await import('../../models/TicketModel.js'))
    ;({ SLAPolicyModel } = await import('../../models/SLAPolicyModel.js'))
    ;({ VendorModel } = await import('../../models/VendorModel.js'))
    ;({ NotificationModel } = await import('../../models/NotificationModel.js'))
  })
  after(() => ctx.stop())

  test('F-076: an asset can be created with no vendor or department ("" from a form select)', async () => {
    const a = await newAsset({ vendor: '', department: '', purchaseDate: '', purchaseCost: '', warrantyExpiry: '' })
    assert.equal(a.vendor, undefined); assert.equal(a.department, undefined)
    // an empty value on edit clears a vendor that was set
    const v = (await assets.post('/vendor-api/vendors').send({ name: 'Dell' })).body.payload
    const b = await newAsset({ vendor: v._id })
    assert.equal(String(b.vendor), String(v._id))
    const r = await assets.patch(`/asset-api/assets/${b.publicId}`).send({ vendor: '' })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.payload.vendor ?? null, null)
    // a junk id is still refused
    assert.equal((await assets.patch(`/asset-api/assets/${b.publicId}`).send({ vendor: 'not-an-id' })).status, 400)
  })

  test('F-081 and F-080: vendor deactivation only accepts a real boolean, and vendor writes are audited', async () => {
    const v = (await assets.post('/vendor-api/vendors').send({ name: 'HP' })).body.payload
    await newAsset({ vendor: String(v._id) })
    assert.equal((await assets.patch(`/vendor-api/vendors/${v._id}`).send({ isActive: 'false' })).status, 400, 'the string "false" used to slip past the guard')
    assert.equal((await assets.patch(`/vendor-api/vendors/${v._id}`).send({ isActive: false })).status, 409)
    assert.equal((await VendorModel.findById(v._id)).isActive, true)
    const free = (await assets.post('/vendor-api/vendors').send({ name: 'Unused Ltd' })).body.payload
    assert.equal((await assets.patch(`/vendor-api/vendors/${free._id}`).send({ isActive: false })).status, 200)
    assert.equal((await assets.patch(`/vendor-api/vendors/${free._id}`).send({ phone: '123' })).status, 200)
    assert.ok((await trail('VENDOR', 'VENDOR_CREATED')).some((e) => e.entityRef === 'Unused Ltd'))
    assert.ok((await trail('VENDOR', 'VENDOR_DEACTIVATED')).some((e) => e.entityRef === 'Unused Ltd'))
    assert.ok((await trail('VENDOR', 'VENDOR_UPDATED')).some((e) => e.entityRef === 'Unused Ltd'))
  })

  test('F-080: asset edits and maintenance entries are audited (field names, not values)', async () => {
    const a = await newAsset({ type: 'SOFTWARE', assetClass: 'LICENSE', licenseKey: 'SECRET-KEY' })
    assert.equal((await assets.patch(`/asset-api/assets/${a.publicId}`).send({ location: 'Floor 2', licenseKey: 'NEW-SECRET' })).status, 200)
    assert.equal((await assets.post(`/asset-api/assets/${a.publicId}/maintenance`).send({ type: 'Service' })).status, 201)
    const edited = (await trail('ASSET', 'ASSET_UPDATED')).find((e) => e.entityRef === a.publicId)
    assert.deepEqual(edited.after.fields.sort(), ['licenseKey', 'location'])
    assert.ok(!JSON.stringify(edited).includes('SECRET'))
    assert.ok((await trail('ASSET', 'ASSET_MAINTENANCE_ADDED')).some((e) => e.entityRef === a.publicId))
  })

  test('F-086: a REPLACED asset is not a warranty alert', async () => {
    const soon = new Date(Date.now() + 5 * 86400000)
    const live = await newAsset({ name: 'Live', warrantyExpiry: soon })
    const gone = await newAsset({ name: 'Replaced one', warrantyExpiry: soon })
    await AssetModel.updateOne({ publicId: gone.publicId }, { status: 'REPLACED' })
    const r = await assets.get('/asset-api/assets/warranty-expiring')
    const ids = r.body.payload.map((x) => x.publicId)
    assert.ok(ids.includes(live.publicId)); assert.ok(!ids.includes(gone.publicId))
    const { runWarrantyCheck } = await import('../../jobs/warrantyChecker.js')
    await AssetModel.updateMany({}, { warrantyNotified: false })
    await runWarrantyCheck()
    assert.equal((await AssetModel.findOne({ publicId: gone.publicId })).warrantyNotified, false, 'no notification was sent for it')
    assert.equal((await AssetModel.findOne({ publicId: live.publicId })).warrantyNotified, true)
    const past = await newAsset({ name: 'Old warranty', warrantyExpiry: new Date(Date.now() - 3 * 86400000) })
    await runWarrantyCheck()
    const note = await NotificationModel.findOne({ message: new RegExp(`${past.publicId}.*warranty expired`) })
    assert.ok(note, 'a past date says "expired"')
  })

  test('F-083 and F-084: KB messages read correctly and a review cannot be requested twice', async () => {
    const draft = (await tech.post('/kb-api/articles').send({ title: 'VPN drops', summary: 's', content: 'c', categoryId: String(ctx.fx.categories.hardware._id) })).body.payload
    const step = (agent, a, action) => agent.patch(`/kb-api/articles/${a.publicId}/${action}`).send({ version: a.version })
    let r = await step(tech, draft, 'request-review')
    assert.equal(r.status, 200); assert.equal(r.body.message, 'review requested')
    const again = await step(tech, r.body.payload, 'request-review')
    assert.equal(again.status, 400); assert.match(again.body.message, /already requested/)
    const managerNotes = await NotificationModel.countDocuments({ user: ctx.fx.users.mgrSvc._id, type: 'KB_REVIEW_REQUESTED' })
    assert.equal(managerNotes, 1, 'the manager was told once')
    r = await step(mgr, r.body.payload, 'publish'); assert.equal(r.body.message, 'article published')
    r = await step(mgr, r.body.payload, 'archive'); assert.equal(r.body.message, 'article archived')
    r = await step(mgr, r.body.payload, 'restore'); assert.equal(r.body.message, 'article restored')
  })

  test('F-080: KB edit and delete are audited', async () => {
    const a = (await tech.post('/kb-api/articles').send({ title: 'To edit', summary: 's', content: 'c', categoryId: String(ctx.fx.categories.hardware._id) })).body.payload
    assert.equal((await tech.patch(`/kb-api/articles/${a.publicId}`).send({ title: 'Edited' })).status, 200)
    assert.equal((await tech.delete(`/kb-api/articles/${a.publicId}`)).status, 200)
    assert.deepEqual((await trail('KB_ARTICLE', 'KB_UPDATED')).find((e) => e.entityRef === a.publicId).after.fields, ['title'])
    assert.ok((await trail('KB_ARTICLE', 'KB_DELETED')).some((e) => e.entityRef === a.publicId))
  })

  test('F-082: a user without a last name shows as "Theo", never "Theo undefined"', async () => {
    const t = await createTicket(emp, String(ctx.fx.categories.hardware._id))
    const assign = await act(mgr, t, 'assign', { technicianId: String(ctx.fx.users.techSvc._id) })
    assert.equal(assign.status, 200, JSON.stringify(assign.body))
    const r = await emp.get(`/ticket-api/tickets/${t.publicId}/timeline`)
    assert.equal(r.status, 200)
    const text = JSON.stringify(r.body.payload)
    assert.ok(!text.includes('undefined'), text)
    assert.ok(r.body.payload.some((e) => e.by?.name === 'Mia'))
  })

  test('F-088: reopening keeps the SLA policy the ticket ran on, even if that priority was switched off after it closed', async () => {
    const t = await createTicket(emp, String(ctx.fx.categories.hardware._id), { priority: 'LOW' })
    const policy = await SLAPolicyModel.findOne({ priority: 'LOW' })
    assert.equal(String((await TicketModel.findOne({ publicId: t.publicId })).sla.policy), String(policy._id))
    await TicketModel.updateOne({ publicId: t.publicId }, { status: 'CLOSED', closedAt: new Date(), 'resolution.resolvedAt': new Date(), 'resolution.confirmedByRequester': true })
    await SLAPolicyModel.updateOne({ _id: policy._id }, { isActive: false })
    const fresh = await fetchTicket(emp, t)
    const r = await act(emp, fresh, 'reopen', { note: 'came back' })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const after = await TicketModel.findOne({ publicId: t.publicId })
    assert.ok(after.sla.resolutionDueAt, 'a due date was set from the old policy')
    await SLAPolicyModel.updateOne({ _id: policy._id }, { isActive: true })
  })
})
