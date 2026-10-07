import { Inbox } from 'lucide-react'

// "nothing here" for any list or panel. `icon` is a lucide icon component,
// `action` an optional button or link (e.g. "+ New ticket")
export const EmptyState = ({ title = 'Nothing here yet', hint, icon: Icon = Inbox, action, compact = false }) => (
  <div className={`flex flex-col items-center text-center ${compact ? 'py-4' : 'py-10'}`}>
    <span className={`flex items-center justify-center rounded-full bg-slate-100 text-slate-400 ${compact ? 'h-9 w-9 mb-2' : 'h-12 w-12 mb-3'}`} aria-hidden="true">
      <Icon className={compact ? 'h-4 w-4' : 'h-6 w-6'} />
    </span>
    <p className="text-slate-700 font-medium">{title}</p>
    {hint && <p className="text-slate-500 text-sm mt-1 max-w-sm">{hint}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
)
