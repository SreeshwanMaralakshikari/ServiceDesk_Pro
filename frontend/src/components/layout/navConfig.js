import {
  BarChart3, BookOpen, Boxes, ClipboardCheck, FileBarChart, Gauge, House, LayoutDashboard,
  Laptop, ListChecks, ShieldCheck, Ticket, Truck,
} from 'lucide-react'

// The one list of where each role can go. The sidebar and the home page both
// read it, so a link can never appear for a role whose route would refuse it.
// `roles` must match the ProtectedRoutes blocks in App.jsx (the backend still
// has the final say on every request).
const ALL = ['ADMIN', 'MANAGER', 'TECHNICIAN', 'EMPLOYEE', 'ASSET_MANAGER']

export const NAV_SECTIONS = [
  {
    title: null,
    items: [
      { to: '/', end: true, label: 'Home', icon: House, roles: ALL },
    ],
  },
  {
    title: 'Work',
    items: [
      {
        to: '/tickets', label: (role) => (role === 'EMPLOYEE' ? 'My tickets' : 'Tickets'), icon: Ticket,
        roles: ['ADMIN', 'MANAGER', 'TECHNICIAN', 'EMPLOYEE'],
        description: (role) => (role === 'EMPLOYEE' ? 'Follow up on the issues you raised' : 'Every ticket your team can see'),
      },
      { to: '/my-queue', label: 'My queue', icon: ListChecks, roles: ['TECHNICIAN'], description: 'Your work, most urgent first' },
      { to: '/approvals', label: 'Approvals', icon: ClipboardCheck, roles: ['MANAGER', 'ADMIN'], description: 'Requests waiting for your OK' },
    ],
  },
  {
    title: 'Insights',
    items: [
      { to: '/tech/dashboard', label: 'My dashboard', icon: Gauge, roles: ['TECHNICIAN'], description: 'Your SLA, workload and ratings' },
      { to: '/manager/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['MANAGER', 'ADMIN'], description: 'SLA compliance, backlog and workload' },
      { to: '/reports', label: 'Reports', icon: FileBarChart, roles: ['MANAGER', 'ADMIN'], description: 'Filter tickets and export to CSV' },
    ],
  },
  {
    title: 'Knowledge',
    items: [
      { to: '/kb', label: 'Knowledge base', icon: BookOpen, roles: ALL, description: 'How-to guides and known fixes' },
    ],
  },
  {
    title: 'Assets',
    items: [
      { to: '/my-assets', label: 'My assets', icon: Laptop, roles: ALL, description: 'Equipment assigned to you' },
      { to: '/assets', label: 'All assets', icon: Boxes, roles: ['ASSET_MANAGER', 'ADMIN', 'TECHNICIAN'], description: 'Inventory and lifecycle' },
      { to: '/asset-stats', label: 'Asset stats', icon: BarChart3, roles: ['ASSET_MANAGER', 'ADMIN'], description: 'Value, warranties and vendors' },
      { to: '/vendors', label: 'Vendors', icon: Truck, roles: ['ASSET_MANAGER', 'ADMIN'], description: 'Suppliers and service partners' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/admin', label: 'Admin', icon: ShieldCheck, roles: ['ADMIN'], description: 'Users, teams, categories and SLAs' },
    ],
  },
]

const resolve = (value, role) => (typeof value === 'function' ? value(role) : value)

// the sections this role sees, with labels and descriptions resolved; empty sections dropped
export const navFor = (role) => NAV_SECTIONS
  .map((section) => ({
    ...section,
    items: section.items
      .filter((item) => item.roles.includes(role))
      .map((item) => ({ ...item, label: resolve(item.label, role), description: resolve(item.description, role) })),
  }))
  .filter((section) => section.items.length > 0)

// the same items as one flat list (the home page's shortcut grid)
export const navItemsFor = (role) => navFor(role).flatMap((section) => section.items)

// who may create tickets (same roles as the tickets/new route and POST /tickets)
export const canCreateTicket = (role) => role === 'EMPLOYEE' || role === 'ADMIN'

// where "my dashboard" is for each role (null: no dashboard page)
export const dashboardFor = (role) => ({ MANAGER: '/manager/dashboard', ADMIN: '/manager/dashboard', TECHNICIAN: '/tech/dashboard', ASSET_MANAGER: '/asset-stats' })[role] ?? null
