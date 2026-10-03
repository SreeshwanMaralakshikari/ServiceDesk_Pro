// the full demo seed: the planned shape, safe to run twice, and ids that never repeat
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { bootApp } from '../../testkit/boot.js'

describe('demo seed (real database)', () => {
  let ctx, M
  before(async () => {
    ctx = await bootApp({ NODE_ENV: 'test' }, { fixtures: false })
    M = {
      User: (await import('../../models/UserModel.js')).UserModel,
      Dept: (await import('../../models/DepartmentModel.js')).DepartmentModel,
      Cat: (await import('../../models/CategoryModel.js')).CategoryModel,
      Ticket: (await import('../../models/TicketModel.js')).TicketModel,
    }
    const { seedIfEmpty } = await import('../../utils/seedData.js')
    M.seed = seedIfEmpty
    await seedIfEmpty()
  })
  after(() => ctx.stop())

  test('the planned shape: 3 business teams, 2 IT teams with a manager each, 4 employees, 9 categories, 60 tickets', async () => {
    const depts = await M.Dept.find().lean()
    assert.equal(depts.filter((d) => d.kind === 'BUSINESS').length, 3)
    const it = depts.filter((d) => d.kind === 'IT_SUPPORT')
    assert.equal(it.length, 2)
    for (const d of it) {
      assert.ok(d.manager, `${d.name} has a manager`)
      const manager = await M.User.findById(d.manager)
      assert.equal(manager.role, 'MANAGER'); assert.equal(String(manager.department), String(d._id))
      const techs = await M.User.countDocuments({ role: 'TECHNICIAN', department: d._id })
      assert.ok(techs >= 2, `${d.name} has at least 2 technicians`)
    }
    assert.equal(await M.User.countDocuments({ role: 'EMPLOYEE' }), 4)
    assert.equal(await M.Cat.countDocuments(), 9)
    assert.equal(await M.Ticket.countDocuments(), 60)
  })

  test('every category is handled by an IT team, and every ticket has a unique id', async () => {
    const itIds = new Set((await M.Dept.find({ kind: 'IT_SUPPORT' })).map((d) => String(d._id)))
    for (const c of await M.Cat.find()) assert.ok(itIds.has(String(c.department)), c.name)
    const ids = (await M.Ticket.find().select('publicId').lean()).map((t) => t.publicId)
    assert.equal(new Set(ids).size, ids.length)
    for (const id of ids) assert.match(id, /^TKT-\d{4}-\d{5}$/)
  })

  test('running the seed again changes nothing', async () => {
    const before = [await M.User.countDocuments(), await M.Cat.countDocuments(), await M.Ticket.countDocuments()]
    await M.seed()
    assert.deepEqual([await M.User.countDocuments(), await M.Cat.countDocuments(), await M.Ticket.countDocuments()], before)
  })

  test('a ticket created through the app after the seed continues the numbering', async () => {
    const { generateSequentialId } = await import('../../utils/generateSequentialId.js')
    const year = new Date().getFullYear()
    assert.equal(await generateSequentialId(M.Ticket, 'TKT'), `TKT-${year}-00061`)
  })
})
