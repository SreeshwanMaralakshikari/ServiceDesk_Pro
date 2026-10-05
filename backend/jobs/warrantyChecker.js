import { AssetModel } from '../models/AssetModel.js'
import { UserModel } from '../models/UserModel.js'
import { notifyMany } from '../utils/createNotification.js'
import { cronStatus } from './status.js'
import { NO_WARRANTY_ALERT_STATUSES } from '../utils/assetStats.js'

const WARRANTY_WINDOW_DAYS = 30

// notifies once per asset (guarded by warrantyNotified, cleared whenever
// warrantyExpiry is edited — see AssetAPI.js's PATCH /assets/:assetId)
export const runWarrantyCheck = async () => {
  const cutoff = new Date(Date.now() + WARRANTY_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const assets = await AssetModel.find({
    isDeleted: false,
    status: { $nin: NO_WARRANTY_ALERT_STATUSES },
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
        message: `Asset ${asset.publicId} (${asset.name}) warranty ${asset.warrantyExpiry < new Date() ? 'expired' : 'expires'} ${asset.warrantyExpiry.toDateString()}`,
        link: `/assets/${asset.publicId}`,
      })
    }
  }
  return assets.length
}

// node-cron is imported lazily here, not as a top-level `import` — see the
// matching comment in jobs/slaChecker.js for why: a top-level import would
// crash the ENTIRE server at startup if the package isn't installed yet,
// not just disable this one background job.
export const startWarrantyChecker = async () => {
  let cron
  try {
    cron = (await import('node-cron')).default
  } catch {
    cronStatus.warranty = 'disabled'
    console.log('Warranty checker disabled: node-cron is not installed (run `npm install` in backend/).')
    return
  }
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
  cronStatus.warranty = 'running'
  console.log('Warranty checker scheduled (daily at 09:00)')
}
