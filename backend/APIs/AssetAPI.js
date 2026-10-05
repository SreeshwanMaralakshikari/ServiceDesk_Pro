import exp from 'express'
import { AssetModel } from '../models/AssetModel.js'
import { UserModel } from '../models/UserModel.js'
import { TicketModel } from '../models/TicketModel.js'
import { verifyToken } from '../middlewares/verifyToken.js'
import { generateSequentialId } from '../utils/generateSequentialId.js'
import { idOrPublicIdFilter } from '../utils/findByIdOrPublicId.js'
import { ASSET_TRANSITIONS, isAssetTransitionAllowed } from '../utils/assetTransitions.js'
import { runAtomically } from '../utils/runAtomically.js'
import { atomicTransition, isValidVersion, VERSION_REQUIRED_MESSAGE } from '../utils/atomicTransition.js'
import { getPagination, toPage } from '../utils/pagination.js'
import { asText } from '../utils/queryParams.js'
import { createNotification } from '../utils/createNotification.js'
import { logAudit } from '../utils/logAudit.js'
import { VendorModel } from '../models/VendorModel.js'
import { buildAssetStats, NO_WARRANTY_ALERT_STATUSES } from '../utils/assetStats.js'
import { ROW_CAP } from '../utils/dashboardData.js'

export const assetApp = exp.Router()

const MANAGE_ROLES = ['ASSET_MANAGER', 'ADMIN']
const READ_ROLES = ['ASSET_MANAGER', 'ADMIN', 'TECHNICIAN']

// any active user, for the asset-assignment picker (Asset Manager/Admin only)
assetApp.get('/assignable-users', verifyToken(...MANAGE_ROLES), async (req, res, next) => {
  try {
    const users = await UserModel.find({ isActive: true }).select('firstName lastName email role').sort({ firstName: 1 })
    //send res
    res.status(200).json({ message: 'assignable users fetched', payload: users })
  } catch (err) { next(err) }
})

// any logged-in user, their own assigned assets
assetApp.get('/my-assets', verifyToken('ADMIN', 'MANAGER', 'TECHNICIAN', 'EMPLOYEE', 'ASSET_MANAGER'), async (req, res, next) => {
  try {
    const assets = await AssetModel.find({ assignedTo: req.user.id, isDeleted: false }).populate('vendor', 'name')
    //send res
    res.status(200).json({ message: 'my assets fetched', payload: assets })
  } catch (err) { next(err) }
})

// list — Asset Manager/Admin/Technician (read-only for Technician)
assetApp.get('/assets', verifyToken(...READ_ROLES), async (req, res, next) => {
  try {
    const query = { isDeleted: false }
    const status = asText(req.query.status)
    const type = asText(req.query.type)
    const department = asText(req.query.department)
    const q = asText(req.query.q)
    if (status) query.status = status
    if (type) query.type = type
    if (department) query.department = department
    if (q) query.$text = { $search: q }
    const paging = getPagination(req.query)

    const [items, total] = await Promise.all([
      AssetModel.find(query)
        .populate('vendor', 'name')
        .populate('assignedTo', 'firstName lastName email')
        .populate('department', 'name')
        .sort({ createdAt: -1, _id: -1 })
        .skip(paging.skip)
        .limit(paging.limit),
      AssetModel.countDocuments(query),
    ])
    //send res
    res.status(200).json({ message: 'assets fetched', payload: toPage(items, total, paging) })
  } catch (err) { next(err) }
})

// numbers for the Asset Manager / Admin page: status mix, warranty window, costs, vendors.
// "/stats" has no :assetId segment, so nothing below can swallow it
assetApp.get('/stats', verifyToken(...MANAGE_ROLES), async (req, res, next) => {
  try {
    const [assets, vendors] = await Promise.all([
      AssetModel.find({ isDeleted: false }).select('status type assetClass vendor purchaseCost warrantyExpiry maintenance.cost').limit(ROW_CAP).lean(),
      VendorModel.find().select('name').lean(),
    ])
    //send res
    res.status(200).json({ message: 'asset stats fetched', payload: buildAssetStats({ assets, vendors }) })
  } catch (err) { next(err) }
})

// warranty-expiring report — registered before /:assetId so "warranty-expiring" is never swallowed as an id
assetApp.get('/assets/warranty-expiring', verifyToken(...READ_ROLES), async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 30
    const cutoff = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    const assets = await AssetModel.find({
      isDeleted: false,
      status: { $nin: NO_WARRANTY_ALERT_STATUSES },
      warrantyExpiry: { $ne: null, $lte: cutoff },
    }).populate('assignedTo', 'firstName lastName').sort({ warrantyExpiry: 1 })
    //send res
    res.status(200).json({ message: 'warranty-expiring assets fetched', payload: assets })
  } catch (err) { next(err) }
})

// create
assetApp.post('/assets', verifyToken(...MANAGE_ROLES), async (req, res, next) => {
  try {
    const { name, type, assetClass, serialNumber, licenseKey, vendor, purchaseDate, purchaseCost, warrantyExpiry, department, location } = req.body ?? {}
    if (!name || !type || !assetClass) {
      //send res
      return res.status(400).json({ message: 'name, type and assetClass are required' })
    }
    const publicId = await generateSequentialId(AssetModel, 'AST')
    // an empty select value ('') means "not chosen", so leave the reference unset instead of failing the id cast
    const asset = await AssetModel.create({
      publicId, name, type, assetClass, serialNumber, licenseKey, vendor: vendor || undefined, purchaseDate, purchaseCost, warrantyExpiry, department: department || undefined, location,
      status: 'PROCURED',
      lifecycleHistory: [{ toStatus: 'PROCURED', by: req.user.id, note: 'asset procured' }],
    })
    await logAudit({ req, action: 'ASSET_CREATED', entityType: 'ASSET', entity: asset, after: { name, status: 'PROCURED' } })
    //send res
    res.status(201).json({ message: 'asset created', payload: asset })
  } catch (err) { next(err) }
})

// detail
assetApp.get('/assets/:assetId', verifyToken(...READ_ROLES), async (req, res, next) => {
  try {
    const asset = await AssetModel.findOne({ ...idOrPublicIdFilter(req.params.assetId), isDeleted: false })
      .populate('vendor', 'name email phone')
      .populate('assignedTo', 'firstName lastName email')
      .populate('department', 'name')
      .populate('replaces', 'publicId name')
      .populate('replacedBy', 'publicId name')
    if (!asset) {
      //send res
      return res.status(404).json({ message: 'asset not found' })
    }
    //send res
    res.status(200).json({ message: 'asset fetched', payload: asset })
  } catch (err) { next(err) }
})

// edit core fields — Asset Manager/Admin only. Editing warrantyExpiry
// resets warrantyNotified so the warranty checker will notify again.
assetApp.patch('/assets/:assetId', verifyToken(...MANAGE_ROLES), async (req, res, next) => {
  try {
    const { name, assetClass, serialNumber, licenseKey, vendor, purchaseDate, purchaseCost, warrantyExpiry, department, location } = req.body ?? {}
    const asset = await AssetModel.findOne({ ...idOrPublicIdFilter(req.params.assetId), isDeleted: false })
    if (!asset) {
      //send res
      return res.status(404).json({ message: 'asset not found' })
    }
    if (name !== undefined) asset.name = name
    if (assetClass !== undefined) asset.assetClass = assetClass
    if (serialNumber !== undefined) asset.serialNumber = serialNumber
    if (licenseKey !== undefined) asset.licenseKey = licenseKey
    // '' clears the reference, anything else goes through the normal id cast
    if (vendor !== undefined) asset.vendor = vendor || null
    if (purchaseDate !== undefined) asset.purchaseDate = purchaseDate
    if (purchaseCost !== undefined) asset.purchaseCost = purchaseCost
    if (department !== undefined) asset.department = department || null
    if (location !== undefined) asset.location = location
    if (warrantyExpiry !== undefined) {
      asset.warrantyExpiry = warrantyExpiry
      asset.warrantyNotified = false
    }
    await asset.save()
    // which fields were sent (names only: the values can include a licence key)
    const fields = Object.entries({ name, assetClass, serialNumber, licenseKey, vendor, purchaseDate, purchaseCost, warrantyExpiry, department, location })
      .filter(([, value]) => value !== undefined).map(([key]) => key)
    await logAudit({ req, action: 'ASSET_UPDATED', entityType: 'ASSET', entity: asset, after: { fields } })
    //send res
    res.status(200).json({ message: 'asset updated', payload: asset })
  } catch (err) { next(err) }
})

// maintenance log — Asset Manager/Admin/Technician
assetApp.post('/assets/:assetId/maintenance', verifyToken(...READ_ROLES), async (req, res, next) => {
  try {
    const { type, vendor, cost, note, date } = req.body ?? {}
    if (!type) {
      //send res
      return res.status(400).json({ message: 'maintenance type is required' })
    }
    const asset = await AssetModel.findOne({ ...idOrPublicIdFilter(req.params.assetId), isDeleted: false })
    if (!asset) {
      //send res
      return res.status(404).json({ message: 'asset not found' })
    }
    asset.maintenance.push({ type, vendor, cost, note, date: date || new Date() })
    await asset.save()
    await logAudit({ req, action: 'ASSET_MAINTENANCE_ADDED', entityType: 'ASSET', entity: asset, after: { type } })
    //send res
    res.status(201).json({ message: 'maintenance entry added', payload: asset.maintenance[asset.maintenance.length - 1] })
  } catch (err) { next(err) }
})

// lifecycle history — same data as the detail route carries, exposed
// separately per the spec's route table
assetApp.get('/assets/:assetId/history', verifyToken(...READ_ROLES), async (req, res, next) => {
  try {
    const asset = await AssetModel.findOne({ ...idOrPublicIdFilter(req.params.assetId), isDeleted: false }).select('lifecycleHistory').populate('lifecycleHistory.by', 'firstName lastName role')
    if (!asset) {
      //send res
      return res.status(404).json({ message: 'asset not found' })
    }
    //send res
    res.status(200).json({ message: 'asset history fetched', payload: asset.lifecycleHistory })
  } catch (err) { next(err) }
})

// tickets referencing this asset — Asset Manager has no general ticket
// access, so this is deliberately public-fields-only. A technician only sees
// the tickets of their own team (the same scope as the ticket list); the Asset
// Manager and Admin see every team's, titles only.
assetApp.get('/assets/:assetId/tickets', verifyToken(...READ_ROLES), async (req, res, next) => {
  try {
    const asset = await AssetModel.findOne({ ...idOrPublicIdFilter(req.params.assetId), isDeleted: false }).select('_id')
    if (!asset) {
      //send res
      return res.status(404).json({ message: 'asset not found' })
    }
    const filter = { relatedAsset: asset._id, isDeleted: false }
    if (req.user.role === 'TECHNICIAN') filter.department = req.user.department ?? null // no team -> matches nothing
    const tickets = await TicketModel.find(filter)
      .select('publicId title status priority createdAt')
      .sort({ createdAt: -1 })
    //send res
    res.status(200).json({ message: 'related tickets fetched', payload: tickets })
  } catch (err) { next(err) }
})

// replace — its own two-asset operation, registered before the generic
// :action route below (same lesson as the ticket priority-route collision:
// specific literal paths must come first). Each write is atomic and
// version-guarded, and the pair runs in one transaction (runAtomically), so on
// Atlas either both assets change or neither does. Where transactions are not
// available (a standalone local mongod) the first write is undone by hand.
assetApp.patch('/assets/:assetId/replace', verifyToken(...MANAGE_ROLES), async (req, res, next) => {
  try {
    const { newAssetId, note, version } = req.body ?? {}
    if (!newAssetId || typeof newAssetId !== 'string') {
      //send res
      return res.status(400).json({ message: 'newAssetId is required' })
    }
    if (!isValidVersion(version)) {
      //send res
      return res.status(400).json({ message: VERSION_REQUIRED_MESSAGE })
    }
    const oldAsset = await AssetModel.findOne({ ...idOrPublicIdFilter(req.params.assetId), isDeleted: false })
    if (!oldAsset) {
      //send res
      return res.status(404).json({ message: 'asset not found' })
    }
    if (version !== oldAsset.version) {
      //send res
      return res.status(409).json({ message: 'asset was updated by someone else, please refresh' })
    }
    if (!['ASSIGNED', 'IN_REPAIR'].includes(oldAsset.status) || !oldAsset.assignedTo) {
      //send res
      return res.status(400).json({ message: 'only an assigned (or in-repair, previously assigned) asset can be replaced' })
    }
    const newAsset = await AssetModel.findOne({ ...idOrPublicIdFilter(newAssetId), isDeleted: false })
    if (!newAsset) {
      //send res
      return res.status(404).json({ message: 'replacement asset not found' })
    }
    if (newAsset.status !== 'IN_STOCK') {
      //send res
      return res.status(400).json({ message: 'the replacement asset must be IN_STOCK' })
    }

    const assignee = oldAsset.assignedTo
    const oldFromStatus = oldAsset.status // capture before writing — spec allows ASSIGNED *or* IN_REPAIR here
    const now = new Date()

    const outcome = await runAtomically(async (session) => {
      const first = await atomicTransition({
        Model: AssetModel, doc: oldAsset, action: 'replace', noun: 'asset', from: ['ASSIGNED', 'IN_REPAIR'], version, session,
        set: { status: 'REPLACED', replacedBy: newAsset._id },
        push: { lifecycleHistory: { fromStatus: oldFromStatus, toStatus: 'REPLACED', by: req.user.id, note, at: now } },
      })
      if (first.error) return { error: first.error }

      let second
      try {
        second = await atomicTransition({
          Model: AssetModel, doc: newAsset, action: 'be used as a replacement while', noun: 'asset', from: ['IN_STOCK'], version: newAsset.version, session,
          set: { status: 'ASSIGNED', assignedTo: assignee, replaces: oldAsset._id },
          push: { lifecycleHistory: { fromStatus: 'IN_STOCK', toStatus: 'ASSIGNED', by: req.user.id, note: note || `replacing ${oldAsset.publicId}`, at: now } },
        })
      } catch (innerErr) {
        second = { error: { status: 500, thrown: innerErr } }
      }
      if (second.error) {
        // inside a transaction the rollback undoes the first write; without one, undo it by hand
        if (!session) {
          await AssetModel.updateOne(
            { _id: oldAsset._id, version: first.doc.version },
            { $set: { status: oldFromStatus }, $unset: { replacedBy: '' }, $pop: { lifecycleHistory: 1 }, $inc: { version: -1 } },
          )
        }
        return { error: second.error }
      }
      return { first, second }
    })
    if (outcome.error) {
      if (outcome.error.thrown) throw outcome.error.thrown
      //send res
      return res.status(outcome.error.status).json({ message: outcome.error.message })
    }
    const { first, second } = outcome

    await logAudit({ req, action: 'ASSET_REPLACE', entityType: 'ASSET', entity: oldAsset, before: { status: oldFromStatus }, after: { replacedBy: newAsset.publicId } })
    await createNotification({ user: assignee, type: 'ASSET_ASSIGNED', message: `Your asset ${oldAsset.publicId} was replaced with ${newAsset.publicId}`, link: '/my-assets' })
    //send res
    res.status(200).json({ message: 'asset replaced', payload: { oldAsset: first.doc, newAsset: second.doc } })
  } catch (err) { next(err) }
})

// status transitions: activate / assign / return / repair / reinstate / restock / retire
assetApp.patch('/assets/:assetId/:action', verifyToken(...READ_ROLES), async (req, res, next) => {
  try {
    const { assetId, action } = req.params
    const { assignedTo, note, version } = req.body ?? {}

    const asset = await AssetModel.findOne({ ...idOrPublicIdFilter(assetId), isDeleted: false })
    if (!asset) {
      //send res
      return res.status(404).json({ message: 'asset not found' })
    }
    if (!isValidVersion(version)) {
      //send res
      return res.status(400).json({ message: VERSION_REQUIRED_MESSAGE })
    }

    const check = isAssetTransitionAllowed(action, asset.status, req.user.role, asset)
    if (!check.ok) {
      // a stale version beats "wrong status": the caller is looking at old data
      if (check.reason.startsWith('cannot ') && version !== asset.version) {
        //send res
        return res.status(409).json({ message: 'asset was updated by someone else, please refresh' })
      }
      //send res
      return res.status(check.reason.includes('authorized') ? 403 : 400).json({ message: check.reason })
    }
    if (check.assigneeRequired && (!assignedTo || typeof assignedTo !== 'string')) {
      //send res
      return res.status(400).json({ message: 'assignedTo is required' })
    }
    if (note !== undefined && typeof note !== 'string') {
      //send res
      return res.status(400).json({ message: 'note must be text' })
    }
    if (version !== asset.version) {
      //send res
      return res.status(409).json({ message: 'asset was updated by someone else, please refresh' })
    }

    if (check.assigneeRequired) {
      const user = await UserModel.findOne({ _id: assignedTo, isActive: true })
      if (!user) {
        //send res
        return res.status(400).json({ message: 'assignedTo must be an active user' })
      }
    }

    const set = { status: check.to }
    const unset = {}
    if (check.assigneeRequired) set.assignedTo = assignedTo
    if (check.clearsAssignee) unset.assignedTo = ''

    const result = await atomicTransition({
      Model: AssetModel, doc: asset, action, noun: 'asset', from: ASSET_TRANSITIONS[action].from, version,
      set, unset,
      push: { lifecycleHistory: { fromStatus: asset.status, toStatus: check.to, by: req.user.id, note, at: new Date() } },
    })
    if (result.error) {
      //send res
      return res.status(result.error.status).json({ message: result.error.message })
    }

    await logAudit({
      req, action: `ASSET_${action.toUpperCase()}`, entityType: 'ASSET', entity: result.doc,
      before: { status: asset.status, assignedTo: asset.assignedTo ? String(asset.assignedTo) : null, version },
      after: { status: result.doc.status, assignedTo: result.doc.assignedTo ? String(result.doc.assignedTo) : null, version: result.doc.version },
    })
    if (action === 'assign') {
      await createNotification({ user: assignedTo, type: 'ASSET_ASSIGNED', message: `Asset ${asset.publicId} (${asset.name}) was assigned to you`, link: '/my-assets' })
    }

    //send res
    res.status(200).json({ message: `asset ${action} succeeded`, payload: result.doc })
  } catch (err) { next(err) }
})
