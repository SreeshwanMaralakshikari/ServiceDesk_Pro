// asset replace: both assets change together, or neither does
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { bootApp, loginAs } from '../../testkit/boot.js'

describe('asset replace (real database)', () => {
  let ctx, assets, emp, AssetModel
  const make = async (name, serial) => {
    const r = await assets.post('/asset-api/assets').send({ name, type: 'HARDWARE', assetClass: 'LAPTOP', serialNumber: serial })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    return r.body.payload
  }
  const act = (a, action, body) => assets.patch(`/asset-api/assets/${a.publicId}/${action}`).send(body)
  const fetch = async (a) => (await assets.get(`/asset-api/assets/${a.publicId}`)).body.payload
  const stocked = async (name, serial) => {
    const a = await make(name, serial)
    const r = await act(a, 'activate', { version: a.version })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    return r.body.payload
  }
  const assigned = async (name, serial) => {
    const a = await stocked(name, serial)
    const r = await act(a, 'assign', { version: a.version, assignedTo: String(ctx.fx.users.emp._id) })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    return r.body.payload
  }

  before(async () => {
    ctx = await bootApp()
    assets = await loginAs(ctx.app, 'assets@t.test')
    emp = await loginAs(ctx.app, 'emp@t.test')
    ;({ AssetModel } = await import('../../models/AssetModel.js'))
    const mongoose = (await import('mongoose')).default
    const hello = await mongoose.connection.db.admin().command({ hello: 1 })
    console.log(`# replace runs against: ${hello.setName ? 'a replica set (real transaction path)' : 'a standalone server (fallback path, undo by hand)'}`)
  })
  after(() => ctx.stop())

  test('happy path: old is REPLACED, new takes over the assignee, links on both sides', async () => {
    const oldA = await assigned('Old laptop', 'SN-OLD-1')
    const newA = await stocked('New laptop', 'SN-NEW-1')
    const r = await assets.patch(`/asset-api/assets/${oldA.publicId}/replace`).send({ newAssetId: newA.publicId, version: oldA.version, note: 'screen broke' })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const o = await fetch(oldA); const n = await fetch(newA)
    assert.equal(o.status, 'REPLACED'); assert.equal(String(o.replacedBy._id ?? o.replacedBy), String(n._id))
    assert.equal(n.status, 'ASSIGNED'); assert.equal(String(n.assignedTo._id ?? n.assignedTo), String(ctx.fx.users.emp._id))
    assert.equal(o.lifecycleHistory.at(-1).toStatus, 'REPLACED'); assert.equal(n.lifecycleHistory.at(-1).toStatus, 'ASSIGNED')
  })

  test('refused cases change nothing: replacement not in stock (400), stale version (409), unknown replacement (404), missing version (400)', async () => {
    const oldA = await assigned('Old 2', 'SN-OLD-2')
    const notStock = await make('Still procured', 'SN-PROC-2')
    const call = (body) => assets.patch(`/asset-api/assets/${oldA.publicId}/replace`).send(body)
    assert.equal((await call({ newAssetId: notStock.publicId, version: oldA.version })).status, 400)
    const good = await stocked('Good 2', 'SN-NEW-2')
    assert.equal((await call({ newAssetId: good.publicId, version: oldA.version + 5 })).status, 409)
    assert.equal((await call({ newAssetId: 'AST-2026-99999', version: oldA.version })).status, 404)
    assert.equal((await call({ newAssetId: good.publicId })).status, 400)
    assert.equal((await fetch(oldA)).status, 'ASSIGNED')
    assert.equal((await fetch(good)).status, 'IN_STOCK')
  })

  test('a failure on the second write leaves both assets exactly as they were', async () => {
    const oldA = await assigned('Old 3', 'SN-OLD-3')
    const newA = await stocked('New 3', 'SN-NEW-3')
    const real = AssetModel.findOneAndUpdate
    let calls = 0
    AssetModel.findOneAndUpdate = function (...args) {
      calls += 1
      if (calls === 2) return Promise.reject(new Error('simulated failure on the second write'))
      return real.apply(this, args)
    }
    let r
    try {
      r = await assets.patch(`/asset-api/assets/${oldA.publicId}/replace`).send({ newAssetId: newA.publicId, version: oldA.version })
    } finally {
      AssetModel.findOneAndUpdate = real
    }
    assert.equal(r.status, 500)
    const o = await fetch(oldA); const n = await fetch(newA)
    assert.equal(o.status, 'ASSIGNED'); assert.equal(o.replacedBy, undefined); assert.equal(o.version, oldA.version); assert.equal(o.lifecycleHistory.length, oldA.lifecycleHistory.length)
    assert.equal(n.status, 'IN_STOCK'); assert.equal(n.version, newA.version)
  })

  test('only asset managers and admins can replace', async () => {
    const oldA = await assigned('Old 4', 'SN-OLD-4')
    const newA = await stocked('New 4', 'SN-NEW-4')
    const r = await emp.patch(`/asset-api/assets/${oldA.publicId}/replace`).send({ newAssetId: newA.publicId, version: oldA.version })
    assert.equal(r.status, 403)
  })
})
