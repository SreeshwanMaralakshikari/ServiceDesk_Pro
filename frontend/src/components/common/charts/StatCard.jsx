import { styles } from '../../../styles/common.js'

// one headline number. `tone` only colors the small label chip, the number stays in ink.
const TONES = {
  neutral: '',
  bad: 'text-red-700',
  warn: 'text-amber-700',
  good: 'text-green-700',
}

export const StatCard = ({ label, value, hint, tone = 'neutral', icon }) => (
  <div className={styles.card + ' !p-4'}>
    <p className={`text-sm flex items-center gap-1 ${TONES[tone] || 'text-slate-500'}`}>
      {icon && <span aria-hidden="true">{icon}</span>}
      <span className={tone === 'neutral' ? 'text-slate-500' : ''}>{label}</span>
    </p>
    <p className="text-2xl font-semibold text-slate-900 mt-1">{value}</p>
    {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
  </div>
)
