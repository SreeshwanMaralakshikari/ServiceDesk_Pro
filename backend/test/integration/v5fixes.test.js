// fixes after the DOCS phase (F-094, F-102), through the real app and a real database
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { bootApp, loginAs } from '../../testkit/boot.js'
import { createTicket, fetchTicket } from '../../testkit/helpers.js'

describe('v5 fixes (real database)', () => {
  let ctx, admin, assets, mgr, emp, emp2, tech
  const trail = async (action) => (await admin.get(`/admin-api/audit-logs?entityType=TICKET&action=${action}&limit=50`)).body.payload.items
  const newAsset = async (over = {}) => {
    const r = await assets.post('/asset-api/assets').send({ name: 'Laptop', type: 'HARDWARE', assetClass: 'Laptop', ...over })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    return r.body.payload
  }
  // PROCURED -> IN_STOCK -> ASSIGNED to the given user
  const assignedAsset = async (userId, over = {}) => {
    const a = await newAsset(over)
    const s = await assets.patch(`/asset-api/assets/${a.publicId}/activate`).send({ version: a.version })
    assert.equal(s.status, 200, JSON.stringify(s.body))
    const g = await assets.patch(`/asset-api/assets/${a.publicId}/assign`).send({ version: s.body.payload.version, assignedTo: String(userId) })
    assert.equal(g.status, 200, JSON.stringify(g.body))
    return g.body.payload
  }

  before(async () => {
    ctx = await bootApp()
    ;[admin, assets, mgr, emp, emp2, tech] = await Promise.all(['admin@t.test', 'assets@t.test', 'mgr.svc@t.test', 'emp@t.test', 'emp2@t.test', 'tech.svc@t.test'].map((e) => loginAs(ctx.app, e)))
  })
  after(() => ctx.stop())

  test('F-102: the ticket page gets the related asset with its public id and name, and links are audited', async () => {
    const mine = await assignedAsset(ctx.fx.users.emp._id, { name: 'Dell Latitude 7450' })
    const t = await createTicket(emp, ctx.fx.categories.hardware._id)

    const linked = await emp.patch(`/ticket-api/tickets/${t.publicId}/related-asset`).send({ assetId: mine.publicId })
    assert.equal(linked.status, 200, JSON.stringify(linked.body))
    const view = await fetchTicket(emp, t)
    assert.equal(view.relatedAsset.publicId, mine.publicId)
    assert.equal(view.relatedAsset.name, 'Dell Latitude 7450')
    assert.equal(view.relatedAsset.status, 'ASSIGNED')
    assert.equal(view.relatedAsset.licenseKey, undefined, 'only the fields the page shows')

    const row = (await trail('TICKET_ASSET_LINKED')).find((e) => e.entityRef === t.publicId)
    assert.ok(row, 'link is audited')
    assert.equal(row.after.relatedAsset, mine.publicId)

    const cleared = await emp.patch(`/ticket-api/tickets/${t.publicId}/related-asset`).send({ assetId: null })
    assert.equal(cleared.status, 200)
    assert.equal((await fetchTicket(emp, t)).relatedAsset ?? null, null)
    const gone = (await trail('TICKET_ASSET_UNLINKED')).find((e) => e.entityRef === t.publicId)
    assert.equal(gone.before.relatedAsset, mine.publicId, 'the audit names the asset by its public id')
  })

  test('F-102: an employee links only their own asset; staff link any asset', async () => {
    const others = await assignedAsset(ctx.fx.users.emp2._id, { name: 'Eve laptop' })
    const t = await createTicket(emp, ctx.fx.categories.hardware._id)
    const refused = await emp.patch(`/ticket-api/tickets/${t.publicId}/related-asset`).send({ assetId: others.publicId })
    assert.equal(refused.status, 403)
    assert.equal(refused.body.message, 'you can only link an asset assigned to you')
    assert.equal((await mgr.patch(`/ticket-api/tickets/${t.publicId}/related-asset`).send({ assetId: others.publicId })).status, 200, 'a manager of the ticket team may')
    assert.equal((await fetchTicket(admin, t)).relatedAsset.publicId, others.publicId)
    // an employee who is not the requester cannot touch it at all
    assert.equal((await emp2.patch(`/ticket-api/tickets/${t.publicId}/related-asset`).send({ assetId: null })).status, 403)
  })

  test('F-102: the edit form can clear optional asset fields with an empty value', async () => {
    const a = await newAsset({ purchaseCost: 1200, purchaseDate: '2026-01-15', location: 'Floor 1', serialNumber: 'SN-1' })
    const r = await assets.patch(`/asset-api/assets/${a.publicId}`).send({ purchaseCost: '', purchaseDate: '', location: '', serialNumber: '', name: 'Laptop (renamed)' })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const after = (await assets.get(`/asset-api/assets/${a.publicId}`)).body.payload
    assert.equal(after.name, 'Laptop (renamed)')
    assert.equal(after.purchaseCost ?? null, null)
    assert.equal(after.purchaseDate ?? null, null)
    assert.equal(after.location ?? '', '')
    // a required field cannot be blanked
    assert.equal((await assets.patch(`/asset-api/assets/${a.publicId}`).send({ name: '' })).status, 400)
    // a technician can read assets but not edit them
    assert.equal((await tech.patch(`/asset-api/assets/${a.publicId}`).send({ location: 'x' })).status, 403)
  })

  test('F-094: the warranty-expiring report is paged and sorted soonest first', async () => {
    const inDays = (n) => new Date(Date.now() + n * 86400000)
    const made = []
    for (const n of [25, 3, 12]) made.push(await newAsset({ name: `Warranty ${n}d`, warrantyExpiry: inDays(n) }))
    const p1 = await assets.get('/asset-api/assets/warranty-expiring?limit=2&page=1')
    assert.equal(p1.status, 200)
    assert.deepEqual(Object.keys(p1.body.payload).sort(), ['items', 'page', 'total', 'totalPages'])
    assert.equal(p1.body.payload.items.length, 2)
    assert.ok(p1.body.payload.total >= 3)
    assert.equal(p1.body.payload.totalPages, Math.ceil(p1.body.payload.total / 2))
    const all = []
    for (let page = 1; page <= p1.body.payload.totalPages; page++) {
      all.push(...(await assets.get(`/asset-api/assets/warranty-expiring?limit=2&page=${page}`)).body.payload.items)
    }
    const dates = all.map((a) => new Date(a.warrantyExpiry).getTime())
    assert.deepEqual(dates, [...dates].sort((a, b) => a - b), 'soonest first across pages')
    for (const m of made) assert.ok(all.some((a) => a.publicId === m.publicId))
    assert.equal(new Set(all.map((a) => a.publicId)).size, all.length, 'no row twice across pages')
  })
})
