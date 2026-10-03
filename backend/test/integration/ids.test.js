// public ids come from an atomic counter: unique under concurrency, never reused, and self-migrating
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { bootApp } from '../../testkit/boot.js'

describe('public id counter (real database)', () => {
  let ctx, generateSequentialId, TicketModel, CounterModel
  const year = new Date().getFullYear()
  before(async () => {
    ctx = await bootApp({}, { fixtures: false })
    ;({ generateSequentialId } = await import('../../utils/generateSequentialId.js'))
    ;({ TicketModel } = await import('../../models/TicketModel.js'))
    ;({ CounterModel } = await import('../../models/CounterModel.js'))
  })
  after(() => ctx.stop())

  test('an empty database starts at 00001 and counts up', async () => {
    assert.equal(await generateSequentialId(TicketModel, 'TKT'), `TKT-${year}-00001`)
    assert.equal(await generateSequentialId(TicketModel, 'TKT'), `TKT-${year}-00002`)
    assert.equal(await generateSequentialId(TicketModel, 'XYZ'), `XYZ-${year}-00001`, 'each prefix has its own counter')
  })

  test('the first use of a counter starts after the highest id already in the data, gaps included', async () => {
    await CounterModel.deleteMany({}) // as on a database that existed before counters
    // ids with a gap and a deleted-looking hole: a count-based generator would hand out 00003 again here
    await TicketModel.collection.insertMany([
      { publicId: `TKT-${year}-00001` }, { publicId: `TKT-${year}-00002` }, { publicId: `TKT-${year}-00009` },
      { publicId: `TKT-${year - 1}-00500` }, // another year does not count
    ])
    assert.equal(await generateSequentialId(TicketModel, 'TKT'), `TKT-${year}-00010`)
    assert.equal(await generateSequentialId(TicketModel, 'TKT'), `TKT-${year}-00011`)
  })

  test('twenty simultaneous requests all get different numbers, including the very first ones', async () => {
    await CounterModel.deleteMany({})
    const ids = await Promise.all(Array.from({ length: 20 }, () => generateSequentialId(TicketModel, 'CON')))
    assert.equal(new Set(ids).size, 20)
  })
})
