import exp from 'express'
import { AssetModel } from '../models/AssetModel.js'
import { UserModel } from '../models/UserModel.js'
import { TicketModel } from '../models/TicketModel.js'
import { verifyToken } from '../middlewares/verifyToken.js'
import { generateSequentialId } from '../utils/generateSequentialId.js'
import { idOrPublicIdFilter } from '../utils/findByIdOrPublicId.js'
import { isAssetTransitionAllowed } from '../utils/assetTransitions.js'
import { createNotification } from '../utils/createNotification.js'

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
    const { status, type, department, q, page = 1, limit = 20 } = req.query
    const query = { isDeleted: false }
    if (status) query.status = status
    if (type) query.type = type
    if (department) query.department = department
    if (q) query.$text = { $search: q }

    const skip = (Number(page) - 1) * Number(limit)
    const [items, total] = await Promise.all([
      AssetModel.find(query)
        .populate('vendor', 'name')
        .populate('assignedTo', 'firstName lastName email')
        .populate('department', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      AssetModel.countDocuments(query),
    ])
    //send res
    res.status(200).json({ message: 'assets fetched', payload: { items, total, page: Number(page), totalPages: Math.ceil(total / limit) } })
  } catch (err) { next(err) }
})

// warranty-expiring report — registered before /:assetId so "warranty-expiring" is never swallowed as an id
assetApp.get('/assets/warranty-expiring', verifyToken(...READ_ROLES), async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 30
    const cutoff = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    const assets = await AssetModel.find({
      isDeleted: false,
      status: { $ne: 'RETIRED' },
      warrantyExpiry: { $ne: null, $lte: cutoff },
    }).populate('assignedTo', 'firstName lastName').sort({ warrantyExpiry: 1 })
    //send res
    res.status(200).json({ message: 'warranty-expiring assets fetched', payload: assets })
  } catch (err) { next(err) }
})

// create
assetApp.post('/assets', verifyToken(...MANAGE_ROLES), async (req, res, next) => {
  try {
    const { name, type, assetClass, serialNumber, licenseKey, vendor, purchaseDate, purchaseCost, warrantyExpiry, department, location } = req.body
    if (!name || !type || !assetClass) {
      //send res
      return res.status(400).json({ message: 'name, type and assetClass are required' })
    }
    const publicId = await generateSequentialId(AssetModel, 'AST')
    const asset = await AssetModel.create({
      publicId, name, type, assetClass, serialNumber, licenseKey, vendor, purchaseDate, purchaseCost, warrantyExpiry, department, location,
      status: 'PROCURED',
      lifecycleHistory: [{ toStatus: 'PROCURED', by: req.user.id, note: 'asset procured' }],
    })
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
    const { name, assetClass, serialNumber, licenseKey, vendor, purchaseDate, purchaseCost, warrantyExpiry, department, location } = req.body
    const asset = await AssetModel.findOne({ ...idOrPublicIdFilter(req.params.assetId), isDeleted: false })
    if (!asset) {
      //send res
      return res.status(404).json({ message: 'asset not found' })
    }
    if (name !== undefined) asset.name = name
    if (assetClass !== undefined) asset.assetClass = assetClass
    if (serialNumber !== undefined) asset.serialNumber = serialNumber
    if (licenseKey !== undefined) asset.licenseKey = licenseKey
    if (vendor !== undefined) asset.vendor = vendor
    if (purchaseDate !== undefined) asset.purchaseDate = purchaseDate
    if (purchaseCost !== undefined) asset.purchaseCost = purchaseCost
    if (department !== undefined) asset.department = department
    if (location !== undefined) asset.location = location
    if (warrantyExpiry !== undefined) {
      asset.warrantyExpiry = warrantyExpiry
      asset.warrantyNotified = false
    }
    await asset.save()
    //send res
    res.status(200).json({ message: 'asset updated', payload: asset })
  } catch (err) { next(err) }
})

// maintenance log — Asset Manager/Admin/Technician
assetApp.post('/assets/:assetId/maintenance', verifyToken(...READ_ROLES), async (req, res, next) => {
  try {
    const { type, vendor, cost, note, date } = req.body
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
// access, so this is deliberately public-fields-only
assetApp.get('/assets/:assetId/tickets', verifyToken(...READ_ROLES), async (req, res, next) => {
  try {
    const asset = await AssetModel.findOne({ ...idOrPublicIdFilter(req.params.assetId), isDeleted: false }).select('_id')
    if (!asset) {
      //send res
      return res.status(404).json({ message: 'asset not found' })
    }
    const tickets = await TicketModel.find({ relatedAsset: asset._id, isDeleted: false })
      .select('publicId title status priority createdAt')
      .sort({ createdAt: -1 })
    //send res
    res.status(200).json({ message: 'related tickets fetched', payload: tickets })
  } catch (err) { next(err) }
})

// replace — its own two-asset operation, registered before the generic
// :action route below (same lesson as the ticket priority-route collision
// in Phase 3: specific literal paths must come first)
assetApp.patch('/assets/:assetId/replace', verifyToken(...MANAGE_ROLES), async (req, res, next) => {
  try {
    const { newAssetId, note } = req.body
    if (!newAssetId) {
      //send res
      return res.status(400).json({ message: 'newAssetId is required' })
    }
    const oldAsset = await AssetModel.findOne({ ...idOrPublicIdFilter(req.params.assetId), isDeleted: false })
    if (!oldAsset) {
      //send res
      return res.status(404).json({ message: 'asset not found' })
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
    const oldFromStatus = oldAsset.status // capture before mutating — spec allows ASSIGNED *or* IN_REPAIR here
    // do both writes, and if the second fails, undo the first — kept as one
    // logical operation per the plan, without a Mongo transaction (none
    // available on the free-tier replica-set-less setup)
    oldAsset.status = 'REPLACED'
    oldAsset.replacedBy = newAsset._id
    oldAsset.version += 1
    oldAsset.lifecycleHistory.push({ fromStatus: oldFromStatus, toStatus: 'REPLACED', by: req.user.id, note })
    await oldAsset.save()

    try {
      newAsset.status = 'ASSIGNED'
      newAsset.assignedTo = assignee
      newAsset.replaces = oldAsset._id
      newAsset.version += 1
      newAsset.lifecycleHistory.push({ fromStatus: 'IN_STOCK', toStatus: 'ASSIGNED', by: req.user.id, note: note || `replacing ${oldAsset.publicId}` })
      await newAsset.save()
    } catch (innerErr) {
      // undo the first write so we never end up with an orphaned REPLACED asset
      oldAsset.status = oldFromStatus
      oldAsset.version -= 1 // revert the bump too, so a retry with the original version doesn't spuriously 409
      oldAsset.replacedBy = undefined
      oldAsset.lifecycleHistory.pop()
      await oldAsset.save()
      throw innerErr
    }

    await createNotification({ user: assignee, type: 'GENERAL', message: `Your asset ${oldAsset.publicId} was replaced with ${newAsset.publicId}`, link: '/my-assets' })
    //send res
    res.status(200).json({ message: 'asset replaced', payload: { oldAsset, newAsset } })
  } catch (err) { next(err) }
})

// status transitions: activate / assign / return / repair / reinstate / restock / retire
assetApp.patch('/assets/:assetId/:action', verifyToken(...READ_ROLES), async (req, res, next) => {
  try {
    const { assetId, action } = req.params
    const { assignedTo, note, version } = req.body

    const asset = await AssetModel.findOne({ ...idOrPublicIdFilter(assetId), isDeleted: false })
    if (!asset) {
      //send res
      return res.status(404).json({ message: 'asset not found' })
    }

    const check = isAssetTransitionAllowed(action, asset.status, req.user.role, asset)
    if (!check.ok) {
      //send res
      return res.status(check.reason.includes('authorized') ? 403 : 400).json({ message: check.reason })
    }
    if (check.assigneeRequired && !assignedTo) {
      //send res
      return res.status(400).json({ message: 'assignedTo is required' })
    }
    if (typeof version === 'number' && version !== asset.version) {
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

    const from = asset.status
    asset.status = check.to
    asset.version += 1
    asset.lifecycleHistory.push({ fromStatus: from, toStatus: check.to, by: req.user.id, note })

    if (check.assigneeRequired) asset.assignedTo = assignedTo
    if (check.clearsAssignee) asset.assignedTo = undefined

    await asset.save()

    if (action === 'assign') {
      await createNotification({ user: assignedTo, type: 'GENERAL', message: `Asset ${asset.publicId} (${asset.name}) was assigned to you`, link: '/my-assets' })
    }

    //send res
    res.status(200).json({ message: `asset ${action} succeeded`, payload: asset })
  } catch (err) { next(err) }
})
