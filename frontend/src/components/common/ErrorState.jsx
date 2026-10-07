import { AlertTriangle, RotateCw } from 'lucide-react'
import { styles } from '../../styles/common.js'

// a failed load, with a retry button when the caller can reload
export const ErrorState = ({ message = 'Something went wrong', onRetry, compact = false }) => (
  <div className={`flex flex-col items-center text-center ${compact ? 'py-4' : 'py-10'}`} role="alert">
    <span className="flex items-center justify-center h-12 w-12 mb-3 rounded-full bg-red-50 text-red-500" aria-hidden="true">
      <AlertTriangle className="h-6 w-6" />
    </span>
    <p className="text-slate-700 font-medium">Could not load this</p>
    <p className="text-red-600 text-sm mt-1 max-w-md">{message}</p>
    {onRetry && (
      <button type="button" className={styles.btnSecondary + ' mt-4'} onClick={onRetry}>
        <RotateCw className="h-4 w-4" aria-hidden="true" /> Try again
      </button>
    )}
  </div>
)
