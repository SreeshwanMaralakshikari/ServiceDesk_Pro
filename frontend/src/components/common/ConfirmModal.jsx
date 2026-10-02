import { styles } from '../../styles/common.js'

// small blocking dialog for destructive or hard-to-undo actions
export const ConfirmModal = ({ open, title, message, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel }) => {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 px-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className={styles.card + ' max-w-sm w-full'}>
        <h2 className={styles.h2}>{title}</h2>
        {message && <p className="text-sm text-slate-600 mb-4">{message}</p>}
        <div className="flex justify-end gap-2">
          <button className={styles.btnSecondary} onClick={onCancel}>Cancel</button>
          <button className={danger ? styles.btnDanger : styles.btnPrimary} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
