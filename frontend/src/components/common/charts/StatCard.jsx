import { styles } from '../../../styles/common.js'

// one headline number. `tone` only colours the label and icon, the number stays in ink.
// `icon` is a lucide icon component (a plain string still works too).
const TONES = {
  neutral: '',
  bad: 'text-red-700',
  warn: 'text-amber-700',
  good: 'text-green-700',
}

export const StatCard = ({ label, value, hint, tone = 'neutral', icon: Icon }) => (
  <div className={styles.card + ' !p-4'}>
    <p className={`text-sm flex items-center gap-1.5 ${TONES[tone] || 'text-slate-500'}`}>
      {Icon && (typeof Icon === 'string'
        ? <span aria-hidden="true">{Icon}</span>
        : <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />)}
      <span className={tone === 'neutral' ? 'text-slate-500' : ''}>{label}</span>
    </p>
    <p className="text-2xl font-semibold text-slate-900 mt-1 tabular-nums">{value}</p>
    {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
  </div>
)
