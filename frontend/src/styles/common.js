// all reusable Tailwind class strings live here (toolkit convention)
export const styles = {
  page: 'min-h-screen bg-slate-50 text-slate-900',
  container: 'max-w-5xl mx-auto px-4 py-8',
  card: 'bg-white rounded-xl shadow-sm border border-slate-200 p-6',
  h1: 'text-2xl font-semibold text-slate-900 mb-4',
  h2: 'text-lg font-semibold text-slate-800 mb-2',
  label: 'block text-sm font-medium text-slate-700 mb-1',
  input: 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
  select: 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500',
  textarea: 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-28',
  btnPrimary: 'inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition disabled:opacity-50',
  btnSecondary: 'inline-flex items-center justify-center rounded-lg bg-white border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition',
  btnDanger: 'inline-flex items-center justify-center rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition',
  table: 'w-full text-sm text-left',
  tableHeadRow: 'border-b border-slate-200 text-slate-500 uppercase text-xs tracking-wide',
  tableRow: 'border-b border-slate-100 hover:bg-slate-50 cursor-pointer',
  badge: 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
  navLink: 'text-sm font-medium text-slate-600 hover:text-indigo-600 transition',
  navLinkActive: 'text-sm font-medium text-indigo-600',
}

export const statusColors = {
  OPEN: 'bg-blue-100 text-blue-700',
  ASSIGNED: 'bg-purple-100 text-purple-700',
  IN_PROGRESS: 'bg-amber-100 text-amber-700',
  RESOLVED: 'bg-teal-100 text-teal-700',
  CLOSED: 'bg-slate-200 text-slate-600',
  REOPENED: 'bg-orange-100 text-orange-700',
  CANCELLED: 'bg-slate-100 text-slate-400',
}

export const priorityColors = {
  LOW: 'bg-slate-100 text-slate-600',
  MEDIUM: 'bg-blue-100 text-blue-700',
  HIGH: 'bg-amber-100 text-amber-700',
  CRITICAL: 'bg-red-100 text-red-700',
}
