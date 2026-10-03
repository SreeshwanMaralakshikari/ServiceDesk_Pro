import { useState } from 'react'

// horizontal bars: one row per category, label left, value right.
// items: [{ label, value, hint? }]. One series, so one color and no legend (the card title names it).
export const BarList = ({ items, color = 'var(--chart-1)', empty = 'Nothing to show yet' }) => {
  const [active, setActive] = useState(null)
  if (!items || items.length === 0 || items.every((i) => !i.value)) return <p className="text-sm text-slate-400 py-2">{empty}</p>
  const max = Math.max(...items.map((i) => i.value), 1)
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={item.label} className="relative" onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}
          onFocus={() => setActive(i)} onBlur={() => setActive(null)} tabIndex={0}>
          <div className="flex items-center justify-between text-sm mb-0.5">
            <span className="text-slate-700 truncate pr-2">{item.label}</span>
            <span className="text-slate-900 tabular-nums">{item.value}</span>
          </div>
          <div className="h-2 rounded-r bg-slate-100" aria-hidden="true">
            <div className="h-2" style={{ width: `${(item.value / max) * 100}%`, background: color, borderRadius: '0 4px 4px 0', minWidth: item.value ? 2 : 0 }} />
          </div>
          {active === i && item.hint && (
            <div role="tooltip" className="absolute right-0 -top-7 z-10 rounded-md bg-slate-900 text-white text-xs px-2 py-1 shadow whitespace-nowrap">{item.hint}</div>
          )}
        </li>
      ))}
    </ul>
  )
}
