// Two simultaneous requests carrying the same version: exactly one wins (200),
// the other gets 409. Runs against a real MongoDB, which is the only way to
// prove the findOneAndUpdate guard really is atomic.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { bootApp, loginAs } from '../../testkit/boot.js'
import { createTicket, act, fetchTicket } from '../../testkit/helpers.js'

const outcome = (results) => results.map((r) => r.status).sort()

describe('concurrent transitions (real database)', () => {
  let ctx, emp, mgr, admin, tech, tech2, assetMgr

  before(async () => {
    ctx = await bootApp()
    const { app } = ctx
    ;[emp, mgr, admin, tech, tech2, assetMgr] = await Promise.all(
      ['emp@t.test', 'mgr.svc@t.test', 'admin@t.test', 'tech.svc@t.test', 'tech.svc2@t.test', 'assets@t.test'].map((e) => loginAs(app, e)),
    )
  })
  after(() => ctx.stop())

  test('two technicians claim the same ticket at once: exactly one 200 and one 409 (5 rounds)', async () => {
    for (let round = 0; round < 5; round++) {
      const t = await createTicket(emp, ctx.fx.categories.hardware._id, { title: `race ${round}` })
      const results = await Promise.all([act(tech, t, 'claim'), act(tech2, t, 'claim')])
      assert.deepEqual(outcome(results), [200, 409], `round ${round}: ${JSON.stringify(results.map((r) => [r.status, r.body.message]))}`)
      const after = await fetchTicket(admin, t)
      assert.equal(after.status, 'ASSIGNED'); assert.equal(after.version, 1)
      const winner = results.find((r) => r.status === 200).body.payload.assignedTo
      assert.equal(String(after.assignedTo._id), String(winner), 'the stored assignee is the winner, not the loser')
    }
  })

  test('manager and admin assign different technicians at once: one wins', async () => {
    const t = await createTicket(emp, ctx.fx.categories.hardware._id)
    const results = await Promise.all([
      act(mgr, t, 'assign', { technicianId: String(ctx.fx.users.techSvc._id) }),
      act(admin, t, 'assign', { technicianId: String(ctx.fx.users.techSvc2._id) }),
    ])
    assert.deepEqual(outcome(results), [200, 409])
  })

  test('double resolve by the same technician: one 200, one 409', async () => {
    let t = await createTicket(emp, ctx.fx.categories.hardware._id)
    t = (await act(tech, t, 'claim')).body.payload
    t = (await act(tech, t, 'start')).body.payload
    const results = await Promise.all([
      act(tech, t, 'resolve', { resolutionSummary: 'first' }),
      act(tech, t, 'resolve', { resolutionSummary: 'second' }),
    ])
    assert.deepEqual(outcome(results), [200, 409])
    const stored = await fetchTicket(admin, t)
    assert.equal(stored.status, 'RESOLVED')
    assert.equal(stored.statusHistory.filter((h) => h.to === 'RESOLVED').length, 1, 'only one RESOLVED entry in the history')
  })

  test('a stale version is rejected even when the status also changed', async () => {
    const t = await createTicket(emp, ctx.fx.categories.hardware._id)
    assert.equal((await act(tech, t, 'claim')).status, 200)
    assert.equal((await act(tech2, t, 'claim')).status, 409, 'old version, ticket already ASSIGNED')
    assert.equal((await act(tech2, { ...t, version: 1 }, 'claim')).status, 400, 'fresh version, but ASSIGNED cannot be claimed')
  })

  test('assets: two concurrent assigns -> one 200, one 409', async () => {
    const created = await assetMgr.post('/asset-api/assets').send({ name: 'Dell Latitude', type: 'HARDWARE', assetClass: 'Laptop', serialNumber: 'SN-1' })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    let asset = created.body.payload
    const url = `/asset-api/assets/${asset.publicId}`
    let r = await assetMgr.patch(`${url}/activate`).send({})
    assert.equal(r.status, 400, 'version required on assets too')
    r = await assetMgr.patch(`${url}/activate`).send({ version: asset.version })
    assert.equal(r.status, 200); asset = r.body.payload
    const results = await Promise.all([
      assetMgr.patch(`${url}/assign`).send({ version: asset.version, assignedTo: String(ctx.fx.users.emp._id) }),
      admin.patch(`${url}/assign`).send({ version: asset.version, assignedTo: String(ctx.fx.users.emp2._id) }),
    ])
    assert.deepEqual(outcome(results), [200, 409])
  })

  test('knowledge base: manager and admin publish the same draft at once -> one 200, one 409', async () => {
    const created = await tech.post('/kb-api/articles').send({ title: 'Fix', summary: 'S', content: 'C', categoryId: String(ctx.fx.categories.hardware._id) })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    const art = created.body.payload
    const results = await Promise.all([
      mgr.patch(`/kb-api/articles/${art.publicId}/publish`).send({ version: art.version }),
      admin.patch(`/kb-api/articles/${art.publicId}/publish`).send({ version: art.version }),
    ])
    assert.deepEqual(outcome(results), [200, 409])
    assert.equal((await mgr.patch(`/kb-api/articles/${art.publicId}/archive`).send({})).status, 400, 'version required on KB too')
  })
})
