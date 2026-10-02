import { useEffect } from 'react'
import { styles } from '../../styles/common.js'

// generic dialog for forms; Escape and the × close it
export const Modal = ({ title, onClose, children }) => {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 px-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className={styles.card + ' w-full max-w-lg max-h-[90vh] overflow-y-auto'}>
        <div className="flex items-center justify-between mb-3">
          <h2 className={styles.h2 + ' mb-0'}>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// submit/cancel row; `error` is the server's message (409s explain themselves)
export const ModalFooter = ({ error, submitting, submitLabel = 'Save', onCancel }) => (
  <div className="mt-4">
    {error && <p className="text-sm text-red-600 mb-2" role="alert">{error}</p>}
    <div className="flex justify-end gap-2">
      <button type="button" className={styles.btnSecondary} onClick={onCancel}>Cancel</button>
      <button type="submit" className={styles.btnPrimary} disabled={submitting}>{submitting ? 'Saving…' : submitLabel}</button>
    </div>
  </div>
)
