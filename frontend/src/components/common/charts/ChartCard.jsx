import { useState } from 'react'
import { styles } from '../../../styles/common.js'

// a titled card with a Chart / Table switch, so every chart has a text version
export const ChartCard = ({ title, subtitle, chart, table, className = '' }) => {
  const [view, setView] = useState('chart')
  return (
    <div className={`${styles.card} ${className}`}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <h2 className="text-base font-semibold text-slate-800">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
        <div className="flex rounded-md border border-slate-300 overflow-hidden text-xs shrink-0" role="group" aria-label={`${title} view`}>
          {['chart', 'table'].map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
              className={`px-2 py-1 capitalize ${view === v ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{v}</button>
          ))}
        </div>
      </div>
      {view === 'chart' ? chart : table}
    </div>
  )
}

// the plain table used for the table view
export const SimpleTable = ({ columns, rows }) => (
  <table className="w-full text-sm text-left">
    <thead>
      <tr className="border-b border-slate-200 text-slate-500 text-xs uppercase tracking-wide">
        {columns.map((c) => <th key={c.key} className={`py-1.5 pr-3 ${c.align === 'right' ? 'text-right' : ''}`}>{c.header}</th>)}
      </tr>
    </thead>
    <tbody>
      {rows.map((r, i) => (
        <tr key={i} className="border-b border-slate-100">
          {columns.map((c) => <td key={c.key} className={`py-1.5 pr-3 ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>{c.render ? c.render(r) : r[c.key]}</td>)}
        </tr>
      ))}
    </tbody>
  </table>
)
