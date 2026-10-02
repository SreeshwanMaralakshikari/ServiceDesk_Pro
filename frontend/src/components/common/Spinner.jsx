export const Spinner = ({ label = 'Loading…' }) => (
  <div className="flex items-center gap-2 text-slate-500 text-sm py-4" role="status">
    <span className="inline-block h-4 w-4 rounded-full border-2 border-slate-300 border-t-indigo-600 animate-spin" />
    {label}
  </div>
)
