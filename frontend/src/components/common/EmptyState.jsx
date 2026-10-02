export const EmptyState = ({ title = 'Nothing here yet', hint }) => (
  <div className="text-center py-8">
    <p className="text-slate-600 font-medium">{title}</p>
    {hint && <p className="text-slate-400 text-sm mt-1">{hint}</p>}
  </div>
)
