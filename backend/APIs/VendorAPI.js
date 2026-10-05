import exp from 'express'
import { VendorModel } from '../models/VendorModel.js'
import { AssetModel } from '../models/AssetModel.js'
import { verifyToken } from '../middlewares/verifyToken.js'
import { logAudit } from '../utils/logAudit.js'

export const vendorApp = exp.Router()
vendorApp.use(verifyToken('ASSET_MANAGER', 'ADMIN'))

vendorApp.get('/vendors', async (req, res, next) => {
  try {
    const vendors = await VendorModel.find().sort({ name: 1 })
    //send res
    res.status(200).json({ message: 'vendors fetched', payload: vendors })
  } catch (err) { next(err) }
})

vendorApp.post('/vendors', async (req, res, next) => {
  try {
    const { name, contactPerson, email, phone, address, servicesProvided } = req.body ?? {}
    if (!name) {
      //send res
      return res.status(400).json({ message: 'name is required' })
    }
    const vendor = await VendorModel.create({ name, contactPerson, email, phone, address, servicesProvided })
    // vendors have no public id, so the audit entry is named by the vendor's name
    await logAudit({ req, action: 'VENDOR_CREATED', entityType: 'VENDOR', entity: vendor, entityRef: vendor.name, after: { name: vendor.name } })
    //send res
    res.status(201).json({ message: 'vendor created', payload: vendor })
  } catch (err) { next(err) }
})

vendorApp.patch('/vendors/:vendorId', async (req, res, next) => {
  try {
    const { name, contactPerson, email, phone, address, servicesProvided, isActive } = req.body ?? {}
    // only a real boolean counts: the string "false" would be cast to false by the update and skip the guard below
    if (isActive !== undefined && typeof isActive !== 'boolean') {
      //send res
      return res.status(400).json({ message: 'isActive must be true or false' })
    }
    if (isActive === false) {
      const inUse = await AssetModel.exists({ vendor: req.params.vendorId, isDeleted: false, status: { $ne: 'RETIRED' } })
      if (inUse) {
        //send res
        return res.status(409).json({ message: 'cannot deactivate a vendor still linked to active assets' })
      }
    }
    const vendor = await VendorModel.findByIdAndUpdate(
      req.params.vendorId,
      { name, contactPerson, email, phone, address, servicesProvided, isActive },
      { returnDocument: 'after', runValidators: true }
    )
    if (!vendor) {
      //send res
      return res.status(404).json({ message: 'vendor not found' })
    }
    const action = isActive === undefined ? 'VENDOR_UPDATED' : isActive ? 'VENDOR_ACTIVATED' : 'VENDOR_DEACTIVATED'
    await logAudit({ req, action, entityType: 'VENDOR', entity: vendor, entityRef: vendor.name, after: { name: vendor.name, isActive: vendor.isActive } })
    //send res
    res.status(200).json({ message: 'vendor updated', payload: vendor })
  } catch (err) { next(err) }
})
