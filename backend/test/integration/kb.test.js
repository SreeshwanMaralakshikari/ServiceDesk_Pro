// KB review flow (D4/R8) and helpful votes, through the real app on a real database.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { bootApp, loginAs } from '../../testkit/boot.js'

describe('knowledge base: review flow and helpful votes (real database)', () => {
  let ctx, emp, mgr, tech, tech2, techInfra, admin
  const kb = '/kb-api/articles'
  const create = (agent, category, over = {}) =>
    agent.post(kb).send({ title: 'VPN drops', summary: 'Fix for VPN drops', content: 'Restart the client', categoryId: String(category._id), tags: ['vpn'], ...over })
  const act = (agent, a, action, body = {}) => agent.patch(`${kb}/${a.publicId}/${action}`).send({ version: a.version, ...body })
  const notes = async (agent) => (await agent.get('/notification-api/my-notifications')).body.payload.items

  before(async () => {
    ctx = await bootApp()
    ;[emp, mgr, tech, tech2, techInfra, admin] = await Promise.all(
      ['emp@t.test', 'mgr.svc@t.test', 'tech.svc@t.test', 'tech.svc2@t.test', 'tech.infra@t.test', 'admin@t.test'].map((e) => loginAs(ctx.app, e)),
    )
  })
  after(() => ctx.stop())

  test('a technician drafts and requests review, but can never publish, archive or restore', async () => {
    const a = (await create(tech, ctx.fx.categories.hardware)).body.payload
    assert.equal(a.status, 'DRAFT')
    for (const action of ['publish', 'archive']) {
      const r = await act(tech, a, action)
      assert.equal(r.status, 403, `${action}: ${JSON.stringify(r.body)}`)
    }
    const archived = (await act(mgr, a, 'archive')).body.payload // a manager archives it
    assert.equal((await act(tech, archived, 'restore')).status, 403, 'the author cannot restore either')
    const back = (await act(mgr, archived, 'restore')).body.payload
    assert.equal(back.status, 'DRAFT'); a.version = back.version
    const rr = await act(tech, a, 'request-review')
    assert.equal(rr.status, 200, JSON.stringify(rr.body))
    assert.equal(rr.body.payload.status, 'DRAFT', 'still a draft until a manager decides')
    assert.ok(rr.body.payload.reviewRequestedAt)
    assert.equal(rr.body.payload.history.at(-1).note, 'review requested')
    // the other technician is not the author
    const a2 = (await create(tech, ctx.fx.categories.hardware)).body.payload
    assert.equal((await act(tech2, a2, 'request-review')).status, 403)
    // employees never
    assert.equal((await act(emp, a2, 'request-review')).status, 403)
  })

  test('request-review only works on a DRAFT and needs the current version', async () => {
    const a = (await create(tech, ctx.fx.categories.hardware)).body.payload
    assert.equal((await tech.patch(`${kb}/${a.publicId}/request-review`).send({})).status, 400)
    assert.equal((await tech.patch(`${kb}/${a.publicId}/request-review`).send({ version: 99 })).status, 409)
    const rr = await act(tech, a, 'request-review')
    assert.equal(rr.status, 200)
    const pub = await act(mgr, rr.body.payload, 'publish')
    assert.equal(pub.status, 200); assert.equal(pub.body.payload.status, 'PUBLISHED')
    assert.equal(pub.body.payload.reviewRequestedAt, undefined, 'a decision closes the review request')
    assert.equal((await act(tech, pub.body.payload, 'request-review')).status, 400, 'already published')
  })

  test('the category team managers are notified; a team with no manager falls back to the admins', async () => {
    const before = { mgr: (await notes(mgr)).length, admin: (await notes(admin)).length }
    const hw = (await create(tech, ctx.fx.categories.hardware, { title: 'Hardware tip' })).body.payload
    assert.equal((await act(tech, hw, 'request-review')).status, 200)
    const m = await notes(mgr)
    assert.equal(m.length, before.mgr + 1)
    assert.equal(m[0].type, 'KB_REVIEW_REQUESTED')
    assert.match(m[0].message, /Hardware tip/)
    assert.equal(m[0].link, `/kb/${hw.publicId}`)
    assert.equal((await notes(admin)).length, before.admin, 'admin not pinged when the team has a manager')

    // Network belongs to Infrastructure, which has no manager in the fixtures
    const net = (await create(techInfra, ctx.fx.categories.network, { title: 'Network tip' })).body.payload
    assert.equal((await act(techInfra, net, 'request-review')).status, 200)
    const adm = await notes(admin)
    assert.equal(adm.length, before.admin + 1)
    assert.match(adm[0].message, /Network tip/)
    assert.equal((await notes(mgr)).length, before.mgr + 1, 'the Service Desk manager is not pinged for Infrastructure')
  })

  test('the pending-review filter lists requested drafts for managers/admins and is forbidden for others', async () => {
    const a = (await create(tech, ctx.fx.categories.hardware, { title: 'Pending one' })).body.payload
    await create(tech, ctx.fx.categories.hardware, { title: 'Plain draft' })
    await act(tech, a, 'request-review')
    const r = await mgr.get(`${kb}?review=pending`)
    assert.equal(r.status, 200)
    const titles = r.body.payload.items.map((x) => x.title)
    assert.ok(titles.includes('Pending one'))
    assert.ok(!titles.includes('Plain draft'))
    assert.ok(r.body.payload.items.every((x) => x.status === 'DRAFT'))
    assert.equal((await admin.get(`${kb}?review=pending`)).status, 200)
    assert.equal((await tech.get(`${kb}?review=pending`)).status, 403)
    assert.equal((await emp.get(`${kb}?review=pending`)).status, 403)
  })

  test('a technician edits only their own DRAFT; a manager edits a published article', async () => {
    const a = (await create(tech, ctx.fx.categories.hardware, { title: 'Edit me' })).body.payload
    assert.equal((await tech.patch(`${kb}/${a.publicId}`).send({ title: 'Edited by author' })).status, 200)
    assert.equal((await tech2.patch(`${kb}/${a.publicId}`).send({ title: 'nope' })).status, 403)
    const pub = (await act(mgr, a, 'publish')).body.payload
    const r = await tech.patch(`${kb}/${a.publicId}`).send({ title: 'sneaky edit' })
    assert.equal(r.status, 400); assert.match(r.body.message, /draft/i)
    assert.equal((await mgr.patch(`${kb}/${a.publicId}`).send({ title: 'Manager fix' })).status, 200)
    assert.equal((await tech.get(`${kb}/${pub.publicId}`)).body.payload.title, 'Manager fix')
  })

  test('helpful votes: once each, can be taken back, own article refused, drafts invisible, voters never exposed', async () => {
    const d = (await create(tech, ctx.fx.categories.hardware, { title: 'Helpful' })).body.payload
    const draftVote = await emp.put(`${kb}/${d.publicId}/helpful`).send({ helpful: true })
    assert.equal(draftVote.status, 404, 'a draft is not votable')
    const a = (await act(mgr, d, 'publish')).body.payload
    const vote = (agent, helpful) => agent.put(`${kb}/${a.publicId}/helpful`).send({ helpful })

    let r = await vote(emp, true)
    assert.equal(r.status, 200); assert.deepEqual(r.body.payload, { helpfulCount: 1, markedHelpful: true })
    r = await vote(emp, true)
    assert.deepEqual(r.body.payload, { helpfulCount: 1, markedHelpful: true }, 'voting twice does not count twice')
    r = await vote(tech2, true)
    assert.equal(r.body.payload.helpfulCount, 2)
    assert.equal((await vote(tech, true)).status, 400, 'the author cannot vote on their own article')
    assert.equal((await vote(emp, 'yes')).status, 400)
    assert.equal((await emp.put(`${kb}/${a.publicId}/helpful`).send({})).status, 400)

    const detail = (await emp.get(`${kb}/${a.publicId}`)).body.payload
    assert.equal(detail.helpfulCount, 2); assert.equal(detail.markedHelpful, true)
    assert.equal(detail.helpfulBy, undefined, 'who voted stays private')
    const mine = (await mgr.get(`${kb}/${a.publicId}`)).body.payload
    assert.equal(mine.markedHelpful, false)
    const list = (await emp.get(kb)).body.payload.items.find((x) => x.publicId === a.publicId)
    assert.equal(list.helpfulBy, undefined)

    r = await vote(emp, false)
    assert.deepEqual(r.body.payload, { helpfulCount: 1, markedHelpful: false })
    r = await vote(emp, false)
    assert.deepEqual(r.body.payload, { helpfulCount: 1, markedHelpful: false }, 'removing twice does not go negative')
    // archived articles are not votable either
    const arch = (await act(mgr, (await mgr.get(`${kb}/${a.publicId}`)).body.payload, 'archive')).body.payload
    assert.equal((await vote(emp, true)).status, 404, `archived ${arch.status}`)
  })

  test('concurrent identical votes count once', async () => {
    const d = (await create(tech, ctx.fx.categories.hardware, { title: 'Race' })).body.payload
    const a = (await act(mgr, d, 'publish')).body.payload
    const rs = await Promise.all(Array.from({ length: 6 }, () => emp.put(`${kb}/${a.publicId}/helpful`).send({ helpful: true })))
    assert.ok(rs.every((r) => r.status === 200))
    assert.equal((await emp.get(`${kb}/${a.publicId}`)).body.payload.helpfulCount, 1)
  })
})
