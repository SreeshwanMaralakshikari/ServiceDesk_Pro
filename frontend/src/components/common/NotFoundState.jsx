import { Link } from 'react-router-dom'
import { ArrowLeft, SearchX } from 'lucide-react'
import { styles } from '../../styles/common.js'

// a detail page whose record could not be loaded (wrong ID, no access, deleted)
export const NotFoundState = ({ title = 'Not found', hint, backTo, backLabel = 'Back' }) => (
  <div className={styles.container}>
    <div className={styles.card + ' flex flex-col items-center text-center py-12'}>
      <span className="flex items-center justify-center h-12 w-12 mb-3 rounded-full bg-slate-100 text-slate-400" aria-hidden="true">
        <SearchX className="h-6 w-6" />
      </span>
      <p className="text-slate-800 font-semibold">{title}</p>
      {hint && <p className="text-slate-500 text-sm mt-1 max-w-sm">{hint}</p>}
      {backTo && (
        <Link to={backTo} className={styles.btnSecondary + ' mt-5'}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {backLabel}
        </Link>
      )}
    </div>
  </div>
)
