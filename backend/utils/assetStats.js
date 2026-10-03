import { fullName } from './dashboardStats.js'

// asset numbers for the Asset Manager / Admin page. Pure, like dashboardStats.js.
export const ASSET_STATUS_ORDER = ['PROCURED', 'IN_STOCK', 'ASSIGNED', 'IN_REPAIR', 'REPLACED', 'RETIRED']
export const WARRANTY_WINDOW_DAYS = 30

const DAY = 24 * 60 * 60 * 1000
const sum = (values) => values.reduce((a, b) => a + (Number(b) || 0), 0)

// assets: lean rows { status, type, assetClass, vendor, purchaseCost, warrantyExpiry, maintenance: [{ cost }] }
// The warranty rule matches the warranty-expiring report and the daily check: everything that is
// not RETIRED and whose warranty ends within the window (expired ones included) is counted.
export const buildAssetStats = ({ assets, vendors = [], now = new Date(), warrantyDays = WARRANTY_WINDOW_DAYS }) => {
  const cutoff = new Date(now.getTime() + warrantyDays * DAY)
  const statusCounts = new Map()
  const classCounts = new Map()
  const vendorRows = new Map()
  const vendorName = new Map(vendors.map((v) => [String(v._id), v.name]))
  let expiringSoon = 0
  let expired = 0

  for (const asset of assets) {
    statusCounts.set(asset.status, (statusCounts.get(asset.status) ?? 0) + 1)
    classCounts.set(asset.assetClass, (classCounts.get(asset.assetClass) ?? 0) + 1)
    if (asset.status !== 'RETIRED' && asset.warrantyExpiry) {
      if (asset.warrantyExpiry < now) expired++
      else if (asset.warrantyExpiry <= cutoff) expiringSoon++
    }
    if (asset.vendor) {
      const id = String(asset.vendor)
      const row = vendorRows.get(id) ?? { vendorId: id, name: vendorName.get(id) ?? 'Unknown', count: 0, purchaseTotal: 0, maintenanceTotal: 0 }
      row.count++
      row.purchaseTotal += Number(asset.purchaseCost) || 0
      row.maintenanceTotal += sum((asset.maintenance ?? []).map((m) => m.cost))
      vendorRows.set(id, row)
    }
  }

  return {
    generatedAt: now,
    total: assets.length,
    byStatus: ASSET_STATUS_ORDER.filter((s) => statusCounts.has(s)).map((status) => ({ status, count: statusCounts.get(status) })),
    byType: ['HARDWARE', 'SOFTWARE'].map((type) => ({ type, count: assets.filter((a) => a.type === type).length })),
    byClass: [...classCounts.entries()].map(([assetClass, count]) => ({ assetClass, count })).sort((a, b) => b.count - a.count || a.assetClass.localeCompare(b.assetClass)),
    warranty: { windowDays: warrantyDays, expiringSoon, expired },
    cost: {
      purchaseTotal: sum(assets.map((a) => a.purchaseCost)),
      maintenanceTotal: sum(assets.flatMap((a) => (a.maintenance ?? []).map((m) => m.cost))),
      maintenanceEntries: assets.reduce((n, a) => n + (a.maintenance?.length ?? 0), 0),
    },
    byVendor: [...vendorRows.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  }
}

// one flat row per asset for the CSV export. `vendor` and `assignedTo` come populated.
export const toAssetReportRow = (asset) => ({
  publicId: asset.publicId,
  name: asset.name,
  type: asset.type,
  assetClass: asset.assetClass,
  status: asset.status,
  serialOrLicense: asset.serialNumber || asset.licenseKey || '',
  vendor: asset.vendor?.name ?? '',
  assignedTo: asset.assignedTo ? fullName(asset.assignedTo) : '',
  purchaseDate: asset.purchaseDate ? asset.purchaseDate.toISOString().slice(0, 10) : '',
  purchaseCost: asset.purchaseCost ?? '',
  warrantyExpiry: asset.warrantyExpiry ? asset.warrantyExpiry.toISOString().slice(0, 10) : '',
  maintenanceCost: sum((asset.maintenance ?? []).map((m) => m.cost)),
})

export const ASSET_REPORT_COLUMNS = [
  { key: 'publicId', header: 'Asset ID' },
  { key: 'name', header: 'Name' },
  { key: 'type', header: 'Type' },
  { key: 'assetClass', header: 'Class' },
  { key: 'status', header: 'Status' },
  { key: 'serialOrLicense', header: 'Serial / license' },
  { key: 'vendor', header: 'Vendor' },
  { key: 'assignedTo', header: 'Assigned to' },
  { key: 'purchaseDate', header: 'Purchase date' },
  { key: 'purchaseCost', header: 'Purchase cost' },
  { key: 'warrantyExpiry', header: 'Warranty expiry' },
  { key: 'maintenanceCost', header: 'Maintenance cost' },
]
