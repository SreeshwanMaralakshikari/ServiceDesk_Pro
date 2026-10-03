import exp from 'express'
import { TicketModel } from '../models/TicketModel.js'
import { AssetModel } from '../models/AssetModel.js'
import { DepartmentModel } from '../models/DepartmentModel.js'
import { verifyToken } from '../middlewares/verifyToken.js'
import { buildTicketQuery } from '../utils/buildTicketQuery.js'
import { getPagination, toPage } from '../utils/pagination.js'
import { asText, isObjectIdString } from '../utils/queryParams.js'
import { toCsv, CSV_BOM } from '../utils/toCsv.js'
import { TICKET_REPORT_COLUMNS, toTicketReportRow } from '../utils/ticketReport.js'
import { ASSET_REPORT_COLUMNS, toAssetReportRow } from '../utils/assetStats.js'
import { istDayKey } from '../utils/dashboardStats.js'
import { APP_UTC_OFFSET_MINUTES } from '../utils/timezone.js'
import { ROW_CAP } from '../utils/dashboardData.js'
import { logAudit } from '../utils/logAudit.js'

export const reportApp = exp.Router()

const DAY = 24 * 60 * 60 * 1000
const ASSET_STATUSES = ['PROCURED', 'IN_STOCK', 'ASSIGNED', 'IN_REPAIR', 'REPLACED', 'RETIRED']
const REPORT_FIELDS = 'publicId title type category department priority status requester assignedTo createdAt closedAt closeReason csat reopenCount sla resolution'

// "2026-10-07" -> the start of that IST day, or null when it is not a real calendar date
const istDayFromText = (text) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const utc = new Date(Date.UTC(year, month - 1, day))
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null
  return new Date(utc.getTime() - APP_UTC_OFFSET_MINUTES * 60000)
}

// the ticket filters shared by the preview and the CSV. The scope comes from buildTicketQuery (the same
// builder as the ticket list), the filters only narrow it. Returns { query } or { error }.
const buildReportQuery = async (req) => {
  const query = buildTicketQuery(req.user, { status: req.query.status, priority: req.query.priority, category: req.query.category, q: req.query.q })

  const from = asText(req.query.from)
  const to = asText(req.query.to)
  if (from || to) {
    const start = from ? istDayFromText(from) : undefined
    const end = to ? istDayFromText(to) : undefined
    if ((from && !start) || (to && !end)) return { error: 'from and to must be dates like 2026-10-07' }
    if (start && end && start > end) return { error: 'from must not be after to' }
    query.createdAt = {}
    if (start) query.createdAt.$gte = start
    if (end) query.createdAt.$lt = new Date(end.getTime() + DAY) // "to" is a whole day, inclusive
  }

  // only an admin can pick a team; a manager's team is fixed by the scope above
  const department = asText(req.query.department)
  if (department && req.user.role === 'ADMIN') {
    const team = isObjectIdString(department) ? await DepartmentModel.findOne({ _id: department, kind: 'IT_SUPPORT' }).select('_id') : null
    if (!team) return { error: 'department must be an IT support team' }
    query.department = department
  }
  return { query }
}

const populateTicket = (find) => find
  .populate('requester', 'firstName lastName')
  .populate('assignedTo', 'firstName lastName')
  .populate('category', 'name')
  .populate('department', 'name')

// paged preview of what the CSV will contain (same filters, same columns)
reportApp.get('/tickets', verifyToken('MANAGER', 'ADMIN'), async (req, res, next) => {
  try {
    const built = await buildReportQuery(req)
    if (built.error) {
      //send res
      return res.status(400).json({ message: built.error })
    }
    const paging = getPagination(req.query)
    const now = new Date()
    const [rows, total] = await Promise.all([
      populateTicket(TicketModel.find(built.query).select(REPORT_FIELDS).sort({ createdAt: -1, _id: -1 }).skip(paging.skip).limit(paging.limit)).lean(),
      TicketModel.countDocuments(built.query),
    ])
    //send res
    res.status(200).json({
      message: 'report fetched',
      payload: { ...toPage(rows.map((t) => toTicketReportRow(t, now)), total, paging), exportRows: Math.min(total, ROW_CAP), exportCap: ROW_CAP },
    })
  } catch (err) {
    next(err)
  }
})

// the CSV download: at most ROW_CAP rows, newest first; X-Truncated says when the cap cut it
reportApp.get('/tickets.csv', verifyToken('MANAGER', 'ADMIN'), async (req, res, next) => {
  try {
    const built = await buildReportQuery(req)
    if (built.error) {
      //send res
      return res.status(400).json({ message: built.error })
    }
    const now = new Date()
    const found = await populateTicket(TicketModel.find(built.query).select(REPORT_FIELDS).sort({ createdAt: -1, _id: -1 }).limit(ROW_CAP + 1)).lean()
    const truncated = found.length > ROW_CAP
    const rows = (truncated ? found.slice(0, ROW_CAP) : found).map((t) => toTicketReportRow(t, now))

    await logAudit({
      req, action: 'TICKET_EXPORT', entityType: 'REPORT', entityRef: 'tickets',
      after: { rows: rows.length, truncated, filters: Object.fromEntries(['status', 'priority', 'category', 'q', 'from', 'to', 'department'].map((k) => [k, asText(req.query[k])]).filter(([, v]) => v)) },
    })
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="tickets-${istDayKey(now)}.csv"`,
      'Cache-Control': 'no-store',
      'X-Row-Count': String(rows.length),
      'X-Truncated': String(truncated),
    })
    //send res
    res.status(200).send(CSV_BOM + toCsv(TICKET_REPORT_COLUMNS, rows))
  } catch (err) {
    next(err)
  }
})

// asset register export for the Asset Manager / Admin
reportApp.get('/assets.csv', verifyToken('ASSET_MANAGER', 'ADMIN'), async (req, res, next) => {
  try {
    const query = { isDeleted: false }
    const status = asText(req.query.status)
    if (status) {
      if (!ASSET_STATUSES.includes(status)) {
        //send res
        return res.status(400).json({ message: `status must be one of ${ASSET_STATUSES.join(', ')}` })
      }
      query.status = status
    }
    const found = await AssetModel.find(query)
      .select('publicId name type assetClass status serialNumber licenseKey vendor assignedTo purchaseDate purchaseCost warrantyExpiry maintenance.cost')
      .populate('vendor', 'name').populate('assignedTo', 'firstName lastName')
      .sort({ createdAt: -1, _id: -1 }).limit(ROW_CAP + 1).lean()
    const truncated = found.length > ROW_CAP
    const rows = (truncated ? found.slice(0, ROW_CAP) : found).map(toAssetReportRow)

    await logAudit({ req, action: 'ASSET_EXPORT', entityType: 'REPORT', entityRef: 'assets', after: { rows: rows.length, truncated, filters: status ? { status } : {} } })
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="assets-${istDayKey(new Date())}.csv"`,
      'Cache-Control': 'no-store',
      'X-Row-Count': String(rows.length),
      'X-Truncated': String(truncated),
    })
    //send res
    res.status(200).send(CSV_BOM + toCsv(ASSET_REPORT_COLUMNS, rows))
  } catch (err) {
    next(err)
  }
})
