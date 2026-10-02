import { styles } from '../../styles/common.js'

// label + control + validation message; the label wraps the control, so
// clicking the text focuses it and screen readers announce it
export const Field = ({ label, error, hint, children }) => (
  <label className="block mb-3">
    <span className={styles.label}>{label}</span>
    {children}
    {hint && <span className="block text-xs text-slate-400 mt-1">{hint}</span>}
    {error && <span className={styles.fieldError} role="alert">{error.message ?? error}</span>}
  </label>
)

export const CheckboxField = ({ label, hint, children }) => (
  <label className="flex items-start gap-2 mb-3 text-sm text-slate-700">
    {children}
    <span>
      {label}
      {hint && <span className="block text-xs text-slate-400">{hint}</span>}
    </span>
  </label>
)
