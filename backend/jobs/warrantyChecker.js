import cron from 'node-cron'
import { AssetModel } from '../models/AssetModel.js'
import { UserModel } from '../models/UserModel.js'
import { notifyMany } from '../utils/createNotification.js'

const WARRANTY_WINDOW_DAYS = 30

// notifies once per asset (guarded by warrantyNotified, cleared whenever
// warrantyExpiry is edited — see AssetAPI.js's PATCH /assets/:assetId)
export const runWarrantyCheck = async () => {
  const cutoff = new Date(Date.now() + WARRANTY_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const assets = await AssetModel.find({
    isDeleted: false,
    status: { $ne: 'RETIRED' },
    warrantyNotified: false,
    warrantyExpiry: { $ne: null, $lte: cutoff },
  })
  if (!assets.length) return 0

  const recipients = await UserModel.find({ role: { $in: ['ASSET_MANAGER', 'ADMIN'] }, isActive: true }).select('_id')
  const recipientIds = recipients.map((r) => r._id)

  for (const asset of assets) {
    const result = await AssetModel.updateOne({ _id: asset._id, warrantyNotified: false }, { $set: { warrantyNotified: true } })
    if (result.modifiedCount) {
      await notifyMany(recipientIds, {
        type: 'WARRANTY_EXPIRING',
        message: `Asset ${asset.publicId} (${asset.name}) warranty expires ${asset.warrantyExpiry.toDateString()}`,
        link: `/assets/${asset.publicId}`,
      })
    }
  }
  return assets.length
}

export const startWarrantyChecker = () => {
  // once a day at 09:00 server time — server clock, not IST business hours;
  // this is a background notification job, not an SLA deadline
  cron.schedule('0 9 * * *', async () => {
    try {
      const count = await runWarrantyCheck()
      if (count) console.log(`Warranty checker: notified on ${count} asset(s)`)
    } catch (err) {
      console.log('Warranty checker failed:', err.message)
    }
  })
  console.log('Warranty checker scheduled (daily at 09:00)')
}
