// the row cap: a dashboard or export never loads more than REPORT_ROW_CAP tickets and says so
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { bootApp, loginAs } from '../../testkit/boot.js'
import { parseCsv } from '../../testkit/helpers.js'

describe('row cap (real database, cap lowered to 10)', () => {
  let ctx, admin
  before(async () => {
    ctx = await bootApp({ REPORT_ROW_CAP: '10' }, { fixtures: false })
    const { seedIfEmpty } = await import('../../utils/seedData.js')
    await seedIfEmpty({ extraDemoTickets: false })
    admin = await loginAs(ctx.app, 'admin@sdp.test')
  })
  after(() => ctx.stop())

  test('the CSV stops at the cap and says so', async () => {
    const res = await admin.get('/report-api/tickets.csv').buffer(true).parse((r, cb) => { let d = ''; r.setEncoding('utf8'); r.on('data', (c) => (d += c)); r.on('end', () => cb(null, d)) })
    assert.equal(res.status, 200)
    assert.equal(res.headers['x-truncated'], 'true')
    assert.equal(res.headers['x-row-count'], '10')
    assert.equal(parseCsv(res.body).length, 11)
    const preview = (await admin.get('/report-api/tickets')).body.payload
    assert.equal(preview.total, 40) // the preview still counts everything
    assert.equal(preview.exportRows, 10)
    assert.equal(preview.exportCap, 10)
  })

  test('the dashboard flags that it looked at only part of the tickets', async () => {
    const d = (await admin.get('/manager-api/dashboard')).body.payload
    assert.equal(d.scope.truncated, true)
    assert.equal(d.scope.ticketsConsidered, 10)
  })
})
