// all reusable Tailwind class strings live here (toolkit convention)
export const styles = {
  page: 'min-h-screen bg-slate-50 text-slate-900',
  container: 'max-w-5xl mx-auto px-4 py-8',
  containerWide: 'max-w-6xl mx-auto px-4 py-8',
  card: 'bg-white rounded-xl shadow-sm border border-slate-200 p-6',
  h1: 'text-2xl font-semibold text-slate-900 mb-4',
  h2: 'text-lg font-semibold text-slate-800 mb-2',
  label: 'block text-sm font-medium text-slate-700 mb-1',
  input: 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
  select: 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500',
  textarea: 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-28',
  btnPrimary: 'whitespace-nowrap inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition disabled:opacity-50',
  btnSecondary: 'whitespace-nowrap inline-flex items-center justify-center rounded-lg bg-white border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition',
  btnDanger: 'inline-flex items-center justify-center rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition',
  table: 'w-full text-sm text-left',
  tableHeadRow: 'border-b border-slate-200 text-slate-500 uppercase text-xs tracking-wide',
  tableRow: 'border-b border-slate-100 hover:bg-slate-50 cursor-pointer',
  badge: 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
  navLink: 'whitespace-nowrap text-sm font-medium text-slate-600 hover:text-indigo-600 transition',
  navLinkActive: 'whitespace-nowrap text-sm font-medium text-indigo-600',
  tab: 'px-3 py-2 text-sm font-medium text-slate-500 border-b-2 border-transparent hover:text-indigo-600',
  tabActive: 'px-3 py-2 text-sm font-medium text-indigo-600 border-b-2 border-indigo-600',
  chip: 'inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600',
  fieldError: 'block text-xs text-red-600 mt-1',
  checkbox: 'h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500',
  btnLink: 'text-sm text-indigo-600 hover:underline disabled:opacity-40 disabled:no-underline',
  btnLinkDanger: 'text-sm text-red-600 hover:underline disabled:opacity-40 disabled:no-underline',
}

export const statusColors = {
  PENDING_APPROVAL: 'bg-yellow-100 text-yellow-700',
  OPEN: 'bg-blue-100 text-blue-700',
  ASSIGNED: 'bg-purple-100 text-purple-700',
  IN_PROGRESS: 'bg-amber-100 text-amber-700',
  ON_HOLD: 'bg-orange-100 text-orange-700',
  RESOLVED: 'bg-teal-100 text-teal-700',
  CLOSED: 'bg-slate-200 text-slate-600',
  REOPENED: 'bg-orange-100 text-orange-700',
  REJECTED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-400',
}

export const priorityColors = {
  LOW: 'bg-slate-100 text-slate-600',
  MEDIUM: 'bg-blue-100 text-blue-700',
  HIGH: 'bg-amber-100 text-amber-700',
  CRITICAL: 'bg-red-100 text-red-700',
}

export const assetStatusColors = {
  PROCURED: 'bg-slate-100 text-slate-600',
  IN_STOCK: 'bg-blue-100 text-blue-700',
  ASSIGNED: 'bg-green-100 text-green-700',
  IN_REPAIR: 'bg-amber-100 text-amber-700',
  REPLACED: 'bg-purple-100 text-purple-700',
  RETIRED: 'bg-slate-200 text-slate-500',
}

export const kbStatusColors = {
  DRAFT: 'bg-yellow-100 text-yellow-700',
  PUBLISHED: 'bg-green-100 text-green-700',
  ARCHIVED: 'bg-slate-200 text-slate-500',
}

export const roleColors = {
  ADMIN: 'bg-red-100 text-red-700',
  MANAGER: 'bg-purple-100 text-purple-700',
  TECHNICIAN: 'bg-blue-100 text-blue-700',
  EMPLOYEE: 'bg-slate-100 text-slate-600',
  ASSET_MANAGER: 'bg-teal-100 text-teal-700',
}

// one pair of tokens for every Boolean flag shown as a badge (isActive,
// requiresApproval, autoAssign, businessHoursOnly)
export const flagColors = {
  on: 'bg-green-100 text-green-700',
  off: 'bg-slate-100 text-slate-500',
}
