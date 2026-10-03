import { useState } from 'react'

// created vs resolved per day. Two series, one axis, thin 2px lines, 8px markers on hover only,
// a legend (identity is never color alone: the legend swatches differ in dash too),
// a crosshair with a tooltip, and a table view lives in the ChartCard around it.
const W = 640
const H = 220
const PAD = { top: 12, right: 12, bottom: 26, left: 32 }

const niceMax = (n) => {
  if (n <= 5) return 5
  const pow = 10 ** Math.floor(Math.log10(n))
  return Math.ceil(n / pow) * pow
}

const shortDate = (iso) => {
  const [, m, d] = iso.split('-')
  return `${Number(d)}/${Number(m)}`
}

export const TrendChart = ({ points }) => {
  const [hover, setHover] = useState(null)
  if (!points || points.length === 0) return <p className="text-sm text-slate-400 py-2">No data for this period</p>

  const series = [
    { key: 'created', label: 'Created', color: 'var(--chart-1)', dash: '' },
    { key: 'resolved', label: 'Resolved', color: 'var(--chart-2)', dash: '6 3' },
  ]
  const max = niceMax(Math.max(...points.map((p) => Math.max(p.created, p.resolved)), 1))
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const x = (i) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW)
  const y = (v) => PAD.top + innerH - (v / max) * innerH
  const ticks = [0, max / 2, max].map((t) => Math.round(t * 10) / 10)
  const labelEvery = Math.max(1, Math.ceil(points.length / 8))

  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - box.left) / box.width) * W
    const idx = Math.round(((px - PAD.left) / innerW) * (points.length - 1))
    setHover(Math.min(points.length - 1, Math.max(0, idx)))
  }

  const hp = hover === null ? null : points[hover]
  return (
    <div>
      <div className="flex gap-4 text-xs text-slate-600 mb-2" aria-label="Legend">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <svg width="22" height="8" aria-hidden="true"><line x1="0" y1="4" x2="22" y2="4" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash} /></svg>
            {s.label}
          </span>
        ))}
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
          aria-label={`Tickets created and resolved per day, ${points.length} days`}
          onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth="1" />
              <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--chart-ink-3)">{t}</text>
            </g>
          ))}
          {points.map((p, i) => (i === points.length - 1 || (i % labelEvery === 0 && points.length - 1 - i >= labelEvery)) && (
            <text key={p.date} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--chart-ink-3)">{shortDate(p.date)}</text>
          ))}
          {series.map((s) => (
            <polyline key={s.key} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash} strokeLinejoin="round"
              points={points.map((p, i) => `${x(i)},${y(p[s.key])}`).join(' ')} />
          ))}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--chart-ink-3)" strokeWidth="1" />
              {series.map((s) => (
                <circle key={s.key} cx={x(hover)} cy={y(hp[s.key])} r="4" fill={s.color} stroke="var(--chart-surface)" strokeWidth="2" />
              ))}
            </g>
          )}
        </svg>
        {hp && (
          <div role="tooltip" className="absolute top-0 z-10 rounded-md bg-slate-900 text-white text-xs px-2 py-1.5 shadow pointer-events-none"
            style={{ left: `${Math.min(80, Math.max(2, (x(hover) / W) * 100))}%` }}>
            <p className="font-medium">{hp.date}</p>
            <p>Created {hp.created}</p>
            <p>Resolved {hp.resolved}</p>
          </div>
        )}
      </div>
    </div>
  )
}
