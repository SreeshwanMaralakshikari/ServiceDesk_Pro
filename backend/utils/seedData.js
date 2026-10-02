import { config } from 'dotenv'
import bcrypt from 'bcryptjs'
import { UserModel } from '../models/UserModel.js'
import { DepartmentModel } from '../models/DepartmentModel.js'
import { CategoryModel } from '../models/CategoryModel.js'
import { SLAPolicyModel } from '../models/SLAPolicyModel.js'
import { VendorModel } from '../models/VendorModel.js'
import { AssetModel } from '../models/AssetModel.js'
import { KnowledgeArticleModel } from '../models/KnowledgeArticleModel.js'
import { generateSequentialId } from './generateSequentialId.js'

config()

// idempotent, and separate from seedIfEmpty on purpose: the KB arrived after
// the first deploy, so a database that already has users must still be topped
// up with articles (seedIfEmpty returns early for those). Only runs when the
// KB collection is completely empty, so it never duplicates or overwrites.
const seedKnowledgeBase = async () => {
  if ((await KnowledgeArticleModel.countDocuments()) > 0) return
  console.log('seeding knowledge base articles...')

  const [tech, manager, admin] = await Promise.all(
    ['tech@sdp.test', 'manager@sdp.test', 'admin@sdp.test'].map((email) => UserModel.findOne({ email })),
  )
  const catByName = async (name) => CategoryModel.findOne({ name })
  const [hardwareCat, softwareCat, networkCat, newHwCat] = await Promise.all(
    ['Hardware', 'Software', 'Network', 'New Hardware Request'].map(catByName),
  )
  if (![tech, manager, admin, hardwareCat, softwareCat, networkCat, newHwCat].every(Boolean)) {
    console.log('KB seed skipped: expected demo users/categories not found (were they renamed or removed?)')
    return
  }
  const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000)

  // created one at a time (not insertMany) — generateSequentialId counts
  // existing docs to pick the next number, so batching these would hand
  // out the same publicId to several articles at once
  const articleSeeds = [
    {
      title: 'How to Fix a Laptop That Won\'t Power On',
      summary: 'Quick checks to try before logging a hardware ticket for a laptop that won\'t turn on.',
      content: 'If your laptop won\'t power on, work through these steps in order before raising a ticket:\n\n1. Hold the power button for 15 seconds to drain residual charge, then release and try again.\n2. Plug directly into a wall outlet (not a hub or extension) and confirm the charging light comes on.\n3. Try a different charger from a colleague\'s identical model, if one is available.\n4. If the charging light is on but the screen stays black, connect an external monitor to rule out a display failure.\n\nIf none of this helps, log a Hardware ticket with the laptop\'s asset tag and what you tried — this saves the technician a round trip.',
      category: hardwareCat._id, tags: ['laptop', 'power', 'hardware'],
      author: tech._id, status: 'PUBLISHED', publishedAtDays: 60, views: 142,
    },
    {
      title: 'Resetting Your Corporate Wi-Fi Password',
      summary: 'Step-by-step guide to resetting your Wi-Fi credentials from the self-service portal.',
      content: 'Your corporate Wi-Fi password is tied to your directory account and can be reset without IT help:\n\n1. Go to the self-service portal at portal.company.internal and sign in.\n2. Select "Reset Network Password" under the Account tab.\n3. Choose a new password meeting the 12-character complexity policy.\n4. On your laptop, forget the "CorpNet" network and reconnect using the new password.\n\nChanges can take up to 5 minutes to sync to all access points. If you still can\'t connect after that, raise a Network ticket.',
      category: networkCat._id, tags: ['wifi', 'network', 'password'],
      author: tech._id, status: 'PUBLISHED', publishedAtDays: 45, views: 210,
    },
    {
      title: 'Installing Printer Drivers on Windows 11',
      summary: 'How to install the correct shared-printer driver on a Windows 11 workstation.',
      content: 'To add a shared office printer on Windows 11:\n\n1. Open Settings > Bluetooth & devices > Printers & scanners.\n2. Click "Add device" and select the printer matching your floor (e.g. "3F-Color-HP").\n3. Windows will fetch the driver automatically from the print server — this can take a minute on first install.\n4. Print a test page to confirm.\n\nIf the printer doesn\'t appear in the list, confirm you\'re connected to the CorpNet Wi-Fi or wired network (personal hotspots can\'t reach the print server).',
      category: hardwareCat._id, tags: ['printer', 'drivers', 'windows'],
      author: tech._id, status: 'PUBLISHED', publishedAtDays: 50, views: 98,
    },
    {
      title: 'Troubleshooting Slow Internet on Office Wi-Fi',
      summary: 'Common causes of slow Wi-Fi in the office and how to narrow down the cause before escalating.',
      content: 'Before logging a "slow internet" ticket, try to narrow down the cause:\n\n1. Run a speed test at speedtest.company.internal and note the result.\n2. Check whether the slowdown affects only your device or everyone nearby — ask a colleague to test too.\n3. Move closer to an access point; some floor edges have known weak coverage.\n4. Restart the Wi-Fi adapter (disable/re-enable) rather than the whole laptop first.\n\nInclude your speed test result, floor, and whether others are affected when you raise the ticket — it lets the Network team tell a local access-point issue from a wider outage immediately.',
      category: networkCat._id, tags: ['wifi', 'network', 'performance'],
      author: manager._id, status: 'PUBLISHED', publishedAtDays: 30, views: 76,
    },
    {
      title: 'How to Request New Hardware',
      summary: 'What information to include when requesting a new laptop, monitor, or peripheral.',
      content: 'New hardware requests go through the "New Hardware Request" ticket category and require manager approval before they\'re actioned. To avoid back-and-forth:\n\n1. State the exact item (e.g. "24-inch monitor", not just "monitor").\n2. Include a business justification — your manager has to approve or reject the request, and a clear reason makes that a quick decision.\n3. Note any deadline (e.g. a start date for a new employee).\n\nUntil it is approved the ticket stays in Pending Approval and no SLA clock is running. Once your manager approves it, the request joins the normal queue and a technician picks it up — you can follow its progress on the ticket page. If it is rejected, the manager\'s note explains why.',
      category: newHwCat._id, tags: ['hardware', 'request', 'procurement'],
      author: manager._id, status: 'PUBLISHED', publishedAtDays: 40, views: 133,
    },
    {
      title: 'Recovering Deleted Files from OneDrive',
      summary: 'How to restore accidentally deleted files from OneDrive\'s recycle bin, and what to do if it\'s already empty.',
      content: 'OneDrive keeps deleted files in a recycle bin for 30 days:\n\n1. Go to onedrive.company.internal and sign in.\n2. Click "Recycle bin" in the left sidebar.\n3. Select the file(s) and click "Restore".\n\nIf the file isn\'t in the recycle bin (deleted more than 30 days ago, or the bin was emptied), IT can attempt a restore from a nightly backup for up to 90 days — log a Software ticket with the exact file path and approximate deletion date.',
      category: softwareCat._id, tags: ['onedrive', 'backup', 'files'],
      author: tech._id, status: 'PUBLISHED', publishedAtDays: 20, views: 64,
    },
    {
      title: 'Setting Up Multi-Factor Authentication (MFA)',
      summary: 'How to enroll your phone for MFA and what to do if you lose access to your enrolled device.',
      content: 'MFA is required on all company accounts:\n\n1. Install the Authenticator app on your phone.\n2. Sign in to portal.company.internal and select "Set up MFA" under Security.\n3. Scan the QR code with the app and enter the 6-digit code to confirm.\n4. Save the printed backup codes somewhere safe — you\'ll need one if you lose your phone.\n\nIf you\'re locked out with no backup codes, your manager must confirm your identity before IT can issue a temporary bypass — this is a manual, same-day process for security reasons, not instant.',
      category: softwareCat._id, tags: ['mfa', 'security', 'login'],
      author: admin._id, status: 'PUBLISHED', publishedAtDays: 90, views: 301,
    },
    {
      title: 'VPN Connection Issues: Common Fixes',
      summary: 'The most common reasons the corporate VPN client fails to connect, in order of likelihood.',
      content: 'If the VPN client won\'t connect, check these in order:\n\n1. Confirm you\'re on the latest client version — Help > About in the app. Old versions are blocked after a security update.\n2. Restart the VPN client (not just reconnect) — it sometimes gets stuck holding a stale session token.\n3. Confirm your MFA app has the correct time set; a clock more than a minute off causes silent auth failures.\n4. If you\'re on hotel or airport Wi-Fi, some networks block the VPN port outright — try mobile hotspot as a test.\n\nStill stuck? Log a Network ticket with the client version and the exact error code shown.',
      category: networkCat._id, tags: ['vpn', 'network', 'remote'],
      author: tech._id, status: 'PUBLISHED', publishedAtDays: 15, views: 187,
    },
    {
      title: 'Freeing Up Disk Space on Windows',
      summary: 'Safe ways to reclaim disk space on a company laptop without deleting anything important.',
      content: 'If you\'re getting low-disk-space warnings:\n\n1. Run Storage Sense (Settings > System > Storage) to clear temp files and old Recycle Bin contents automatically.\n2. Uninstall large apps you don\'t use — check Settings > Apps sorted by size.\n3. Move large personal files (photos, videos) to OneDrive and enable "Files On-Demand" so they stay in the cloud until opened.\n4. Clear your browser cache if you have several GB of it built up.\n\nAvoid manually deleting anything in Program Files or Windows folders — if space is still tight after the above, log a Hardware ticket; a storage upgrade may be warranted.',
      category: hardwareCat._id, tags: ['windows', 'storage', 'performance'],
      author: tech._id, status: 'PUBLISHED', publishedAtDays: 10, views: 55,
    },
    {
      title: 'Outlook Not Syncing: Step-by-Step Fix',
      summary: 'How to fix Outlook stuck on "Trying to connect" or not receiving new mail.',
      content: 'If Outlook shows "Trying to connect" or has stopped receiving mail:\n\n1. Check the bottom status bar for the exact error — "disconnected" vs "needs password" point to different fixes.\n2. Restart Outlook fully (not just the window — check Task Manager for a lingering process).\n3. Run Outlook in Safe Mode (hold Ctrl while launching) to rule out a misbehaving add-in.\n4. If prompted for a password repeatedly, your cached credentials may be stale — remove the account under Windows Credential Manager and let Outlook re-prompt.\n\nIf mail is missing but the connection looks fine, check whether a rule is silently filing it — Rules and Alerts under the File menu.',
      category: softwareCat._id, tags: ['outlook', 'email', 'sync'],
      author: manager._id, status: 'PUBLISHED', publishedAtDays: 5, views: 41,
    },
    {
      title: 'Replacing a Faulty Monitor Cable',
      summary: 'Draft: identifying and swapping a failing HDMI/DisplayPort cable before assuming the monitor itself is broken.',
      content: 'Draft notes — flickering or intermittent monitor signal is more often the cable than the monitor:\n\n1. Swap the cable with a known-good one first, before requesting a replacement monitor.\n2. Check both ends are fully seated — a half-inserted DisplayPort connector will "mostly" work and then drop out under load.\n3. If using a dock, test plugging directly into the laptop to rule out a failing dock port.\n\nTODO: add photos of the correct cable types stocked by the Service Desk, and note the asset-tag process for logging a cable swap.',
      category: hardwareCat._id, tags: ['monitor', 'cable', 'hardware'],
      author: tech._id, status: 'DRAFT',
    },
    {
      title: 'Setting Up a New Employee\'s Workstation',
      summary: 'Draft: checklist for provisioning a new hire\'s laptop, accounts, and desk hardware before their start date.',
      content: 'Draft checklist for new-hire provisioning, to be finalized with HR\'s onboarding calendar:\n\n1. Raise a New Hardware Request ticket at least 5 business days before the start date.\n2. Confirm department and manager for asset assignment and department-based ticket routing.\n3. Pre-stage accounts: email, MFA enrollment link, VPN profile.\n4. Desk setup: monitor, dock, peripherals collected from Asset Manager stock.\n\nTODO: link to the HR onboarding portal once it is finalized, and confirm whether software licensing (KB: MFA setup) should be linked here or kept separate.',
      category: newHwCat._id, tags: ['onboarding', 'provisioning', 'new-hire'],
      author: manager._id, status: 'DRAFT',
    },
    {
      title: 'Legacy VPN Client Setup (Old Client)',
      summary: 'Archived: setup instructions for the retired VPN client, kept for reference only. See "VPN Connection Issues" instead.',
      content: 'This article describes the legacy VPN client that was retired company-wide. It is kept for historical reference only — do not follow these steps for a current setup; see "VPN Connection Issues: Common Fixes" for the supported client.\n\n(Original instructions omitted from this archived copy.)',
      category: networkCat._id, tags: ['vpn', 'legacy', 'archived'],
      author: admin._id, status: 'ARCHIVED', publishedAtDays: 300, archivedAtDays: 60, views: 12,
    },
  ]

  for (const seed of articleSeeds) {
    const publicId = await generateSequentialId(KnowledgeArticleModel, 'KB')
    const history = [{ toStatus: 'DRAFT', by: seed.author, note: 'article created' }]
    const doc = {
      publicId, title: seed.title, summary: seed.summary, content: seed.content,
      category: seed.category, tags: seed.tags, author: seed.author, status: seed.status,
      viewCount: seed.views || 0,
    }
    if (seed.status === 'PUBLISHED' || seed.status === 'ARCHIVED') {
      doc.publishedAt = daysAgo(seed.publishedAtDays)
      history.push({ fromStatus: 'DRAFT', toStatus: 'PUBLISHED', by: seed.author, at: doc.publishedAt })
    }
    if (seed.status === 'ARCHIVED') {
      doc.archivedAt = daysAgo(seed.archivedAtDays)
      history.push({ fromStatus: 'PUBLISHED', toStatus: 'ARCHIVED', by: seed.author, note: 'superseded', at: doc.archivedAt })
    }
    doc.history = history
    await KnowledgeArticleModel.create(doc)
  }
  console.log('knowledge base seeded')
}

// Non-fatal on purpose: seedIfEmpty runs inside server.js's connectDB() try
// block, where ANY thrown error means "retry the DB connection, then
// process.exit(1)". Demo articles failing to seed must never take the whole
// API down, so log it and let the server start.
export const seedKnowledgeBaseIfEmpty = async () => {
  try {
    await seedKnowledgeBase()
  } catch (err) {
    console.log('KB seed failed (non-fatal, server will still start):', err.message)
  }
}

// find-or-create by a natural key. Never updates an existing document, so
// re-running the seed can't overwrite anything an admin changed (and can't
// reset a password that was rotated on the live database).
const ensure = async (Model, filter, doc) => {
  const existing = await Model.findOne(filter)
  if (existing) return existing
  return Model.create(doc)
}

const ensurePriorities = async () => {
  const rows = [
    { priority: 'LOW', label: 'Low', level: 1, color: '#6b7280', responseTimeHours: 24, resolutionTimeHours: 72, businessHoursOnly: true },
    { priority: 'MEDIUM', label: 'Medium', level: 2, color: '#3b82f6', responseTimeHours: 8, resolutionTimeHours: 24, businessHoursOnly: true },
    { priority: 'HIGH', label: 'High', level: 3, color: '#f59e0b', responseTimeHours: 4, resolutionTimeHours: 8, businessHoursOnly: true },
    { priority: 'CRITICAL', label: 'Critical', level: 4, color: '#ef4444', responseTimeHours: 1, resolutionTimeHours: 4, businessHoursOnly: true },
    // demo/test priority: plain wall-clock, minutes not hours, so you can
    // watch a ticket go on-track -> at-risk -> breached in real time.
    // level 0 means only an ADMIN may pick it (see TicketAPI create/priority).
    { priority: 'TEST', label: 'Test (fast demo)', level: 0, color: '#a855f7', responseTimeHours: 0.02, resolutionTimeHours: 0.05, businessHoursOnly: false },
  ]
  for (const row of rows) await ensure(SLAPolicyModel, { priority: row.priority }, row)
}

// the real admin for a production database. Created only when
// SEED_ADMIN_PASSWORD is set, and never touched afterwards (change the
// password through PUT /api/auth/password, not by re-seeding).
const ensureProductionAdmin = async () => {
  const pw = process.env.SEED_ADMIN_PASSWORD
  if (!pw) {
    console.log('no SEED_ADMIN_PASSWORD set — skipping the production admin')
    return
  }
  if (pw.length < 12) {
    console.log('SEED_ADMIN_PASSWORD must be at least 12 characters — skipping the production admin')
    return
  }
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@sdp.test').toLowerCase()
  const existing = await UserModel.findOne({ email })
  if (existing) {
    console.log('production admin already exists — left unchanged')
    return
  }
  await UserModel.create({ firstName: 'System', lastName: 'Admin', email, password: bcrypt.hashSync(pw, 10), role: 'ADMIN' })
  console.log('production admin created')
}

// idempotent top-up: every collection is ensured on its own natural key, so
// it is safe to run on an empty database, a half-seeded one, or the live one.
// (name kept because server.js and `npm run seed` import it.)
export const seedIfEmpty = async () => {
  const isProduction = process.env.NODE_ENV === 'production'
  console.log('ensuring seed data...')

  const deptRows = [
    { name: 'Human Resources', code: 'HR', kind: 'BUSINESS' },
    { name: 'Engineering', code: 'ENG', kind: 'BUSINESS' },
    { name: 'Service Desk', code: 'SVD', kind: 'IT_SUPPORT' },
    { name: 'Infrastructure', code: 'INF', kind: 'IT_SUPPORT' },
  ]
  const depts = {}
  for (const row of deptRows) depts[row.code] = await ensure(DepartmentModel, { code: row.code }, row)

  await ensurePriorities()

  const catRows = [
    { name: 'Hardware', department: depts.SVD._id, ticketType: 'INCIDENT', defaultPriority: 'MEDIUM', autoAssign: true, skills: ['hardware', 'laptop', 'printer', 'monitor'] },
    { name: 'Software', department: depts.SVD._id, ticketType: 'INCIDENT', defaultPriority: 'MEDIUM', autoAssign: true, skills: ['software', 'outlook', 'office'] },
    { name: 'Network', department: depts.INF._id, ticketType: 'INCIDENT', defaultPriority: 'HIGH', skills: ['network', 'wifi', 'vpn'] },
    { name: 'New Hardware Request', department: depts.SVD._id, ticketType: 'SERVICE_REQUEST', defaultPriority: 'LOW', requiresApproval: true },
  ]
  for (const row of catRows) await ensure(CategoryModel, { name: row.name }, row)

  // demo accounts share a well-known password, so they never exist on a
  // production database; there the admin comes from SEED_ADMIN_PASSWORD only
  if (isProduction) {
    console.log('NODE_ENV=production — demo accounts, vendors and assets skipped')
    await ensureProductionAdmin()
    await seedKnowledgeBaseIfEmpty()
    console.log('seed complete')
    return
  }

  const password = bcrypt.hashSync('Passw0rd!', 10)
  const user = (u) => ensure(UserModel, { email: u.email }, { ...u, password })
  const admin = await user({ firstName: 'Ava', lastName: 'Admin', email: 'admin@sdp.test', role: 'ADMIN' })
  const manager = await user({ firstName: 'Mia', lastName: 'Manager', email: 'manager@sdp.test', role: 'MANAGER', department: depts.SVD._id })
  const tech = await user({ firstName: 'Theo', lastName: 'Tech', email: 'tech@sdp.test', role: 'TECHNICIAN', department: depts.SVD._id })
  const employee = await user({ firstName: 'Eli', lastName: 'Employee', email: 'employee@sdp.test', role: 'EMPLOYEE', department: depts.ENG._id })
  const assetMgr = await user({ firstName: 'Amy', lastName: 'Assets', email: 'assets@sdp.test', role: 'ASSET_MANAGER' })
  await ensureProductionAdmin() // a developer can also set SEED_ADMIN_PASSWORD locally

  // DSA demo data: more technicians with skills, so auto-assign and the suggested
  // technician have something to rank. New rows get their skills from the lists above and
  // below; rows that already exist (an older database) are configured once, while the
  // field was never stored, and never overwritten after that.
  await user({ firstName: 'Tara', lastName: 'Tech', email: 'tara@sdp.test', role: 'TECHNICIAN', department: depts.SVD._id, skills: ['software', 'outlook', 'office', 'vpn'] })
  await user({ firstName: 'Ravi', lastName: 'Tech', email: 'ravi@sdp.test', role: 'TECHNICIAN', department: depts.SVD._id, skills: ['hardware', 'laptop', 'monitor'] })
  await user({ firstName: 'Noor', lastName: 'Network', email: 'noor@sdp.test', role: 'TECHNICIAN', department: depts.INF._id, skills: ['network', 'wifi', 'vpn', 'firewall'] })
  await UserModel.updateOne({ _id: tech._id, skills: { $exists: false } }, { $set: { skills: ['hardware', 'laptop', 'printer'] } })
  const dsaCategories = [
    { name: 'Hardware', autoAssign: true, skills: ['hardware', 'laptop', 'printer', 'monitor'] },
    { name: 'Software', autoAssign: true, skills: ['software', 'outlook', 'office'] },
    { name: 'Network', autoAssign: false, skills: ['network', 'wifi', 'vpn'] },
  ]
  for (const row of dsaCategories) {
    await CategoryModel.updateOne({ name: row.name, autoAssign: { $exists: false } }, { $set: { autoAssign: row.autoAssign, skills: row.skills } })
  }

  // only set the department manager when none is set yet
  if (!depts.SVD.manager) await DepartmentModel.findByIdAndUpdate(depts.SVD._id, { manager: manager._id })

  const vendorRows = [
    { name: 'Dell Technologies', contactPerson: 'Raj Mehta', email: 'raj@dellsupport.example', phone: '+91-98765-00001', servicesProvided: 'Laptop & desktop hardware' },
    { name: 'Microsoft', contactPerson: 'Priya Nair', email: 'priya@msftlicensing.example', phone: '+91-98765-00002', servicesProvided: 'Software licensing' },
    { name: 'Netgear Solutions', contactPerson: 'Sam Iyer', email: 'sam@netgearsol.example', phone: '+91-98765-00003', servicesProvided: 'Networking equipment' },
  ]
  const vendors = {}
  for (const row of vendorRows) vendors[row.name] = await ensure(VendorModel, { name: row.name }, row)

  const daysFromNow = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000)
  const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000)

  // assets are keyed on serialNumber / licenseKey; publicId is only
  // generated when the asset really is new (it counts existing docs)
  const ensureAsset = async (key, doc) => {
    const existing = await AssetModel.findOne(key)
    if (existing) return existing
    const publicId = await generateSequentialId(AssetModel, 'AST')
    return AssetModel.create({ publicId, ...key, ...doc })
  }

  await ensureAsset({ serialNumber: 'DL5440-0001' }, {
    name: 'Dell Latitude 5440', type: 'HARDWARE', assetClass: 'Laptop',
    vendor: vendors['Dell Technologies']._id, purchaseDate: daysAgo(400), purchaseCost: 78000,
    warrantyExpiry: daysFromNow(20), // deliberately inside the 30-day warranty window, to demo that report
    status: 'ASSIGNED', assignedTo: employee._id, department: depts.ENG._id,
    lifecycleHistory: [
      { toStatus: 'PROCURED', by: admin._id, note: 'seed data' },
      { fromStatus: 'PROCURED', toStatus: 'IN_STOCK', by: assetMgr._id },
      { fromStatus: 'IN_STOCK', toStatus: 'ASSIGNED', by: assetMgr._id, note: 'assigned to Eli Employee' },
    ],
  })
  await ensureAsset({ serialNumber: 'DM24-0007' }, {
    name: 'Dell 24" Monitor', type: 'HARDWARE', assetClass: 'Monitor',
    vendor: vendors['Dell Technologies']._id, purchaseDate: daysAgo(200), purchaseCost: 12000,
    warrantyExpiry: daysFromNow(365), status: 'IN_STOCK', department: depts.ENG._id,
    lifecycleHistory: [{ toStatus: 'PROCURED', by: admin._id }, { fromStatus: 'PROCURED', toStatus: 'IN_STOCK', by: assetMgr._id }],
  })
  await ensureAsset({ licenseKey: 'M365-XXXX-YYYY-0001' }, {
    name: 'Microsoft 365 E3', type: 'SOFTWARE', assetClass: 'License',
    vendor: vendors.Microsoft._id, purchaseDate: daysAgo(100), purchaseCost: 15000,
    warrantyExpiry: daysFromNow(5), // also inside the warranty window
    status: 'ASSIGNED', assignedTo: tech._id, department: depts.SVD._id,
    lifecycleHistory: [{ toStatus: 'PROCURED', by: admin._id }, { fromStatus: 'PROCURED', toStatus: 'IN_STOCK', by: assetMgr._id }, { fromStatus: 'IN_STOCK', toStatus: 'ASSIGNED', by: assetMgr._id }],
  })
  await ensureAsset({ serialNumber: 'NG-SW-0003' }, {
    name: 'Netgear Rack Switch', type: 'HARDWARE', assetClass: 'Networking',
    vendor: vendors['Netgear Solutions']._id, purchaseDate: daysAgo(600), purchaseCost: 45000,
    warrantyExpiry: daysAgo(10), // already expired, to demo an overdue entry
    status: 'IN_REPAIR', department: depts.INF._id,
    lifecycleHistory: [{ toStatus: 'PROCURED', by: admin._id }, { fromStatus: 'PROCURED', toStatus: 'IN_STOCK', by: assetMgr._id }, { fromStatus: 'IN_STOCK', toStatus: 'IN_REPAIR', by: tech._id, note: 'intermittent port failure' }],
  })

  await seedKnowledgeBaseIfEmpty()

  console.log('seed complete. demo logins (password: Passw0rd!):')
  console.log('  admin@sdp.test / manager@sdp.test / tech@sdp.test / employee@sdp.test / assets@sdp.test')
}

// allow `npm run seed` to run this directly
if (process.argv[1] && process.argv[1].endsWith('seedData.js')) {
  const { connect } = await import('mongoose')
  await connect(process.env.MONGO_URI)
  await seedIfEmpty()
  process.exit(0)
}
