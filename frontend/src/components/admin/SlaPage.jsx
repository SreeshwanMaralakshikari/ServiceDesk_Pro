import { useState } from 'react'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import { axiosInstance } from '../../axiosInstance.js'
import { useFetch } from '../../hooks/useFetch.js'
import { getErrorMessage } from '../../utils/errors.js'
import { runAction } from '../../utils/actions.js'
import { DataTable } from '../common/DataTable.jsx'
import { ConfirmModal } from '../common/ConfirmModal.jsx'
import { Modal, ModalFooter } from '../common/Modal.jsx'
import { Field, CheckboxField } from '../common/Field.jsx'
import { ActiveBadge, FlagBadge } from '../common/FlagBadge.jsx'
import { styles } from '../../styles/common.js'
import { Plus, Timer } from 'lucide-react'

const hoursRule = { required: 'Required', valueAsNumber: true, validate: (v) => (Number.isFinite(v) && v > 0 && v <= 8760) || 'A number above 0 and at most 8760' }

const PolicyFormModal = ({ policy, onClose, onSaved }) => {
  const editing = Boolean(policy)
  const { register, handleSubmit, getValues, formState: { errors, isSubmitting } } = useForm({
    defaultValues: {
      priority: policy?.priority ?? '', label: policy?.label ?? '', level: policy?.level ?? 4, color: policy?.color ?? '#6b7280',
      responseTimeHours: policy?.responseTimeHours ?? 4, resolutionTimeHours: policy?.resolutionTimeHours ?? 24, businessHoursOnly: policy?.businessHoursOnly ?? true,
    },
  })
  const [serverError, setServerError] = useState('')

  const submit = async (values) => {
    setServerError('')
    try {
      if (!editing) {
        await axiosInstance.post('/admin-api/sla-policies', { ...values, priority: values.priority.trim(), label: values.label.trim() })
      } else {
        const changes = {}
        for (const key of ['label', 'color', 'responseTimeHours', 'resolutionTimeHours', 'businessHoursOnly']) {
          if (values[key] !== policy[key]) changes[key] = key === 'label' ? values.label.trim() : values[key]
        }
        if (Object.keys(changes).length === 0) return onClose()
        await axiosInstance.patch(`/admin-api/sla-policies/${policy._id}`, changes)
      }
      onSaved(editing ? 'Priority updated' : 'Priority created')
    } catch (err) {
      setServerError(getErrorMessage(err))
    }
  }

  return (
    <Modal title={editing ? `Edit ${policy.label}` : 'New priority'} onClose={onClose}>
      <form onSubmit={handleSubmit(submit)} noValidate>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code" error={errors.priority} hint={editing ? 'The code cannot be changed.' : 'Capital letters, e.g. URGENT'}>
            <input className={styles.input} disabled={editing} {...register('priority', { required: !editing && 'Code is required', pattern: !editing && { value: /^[A-Za-z][A-Za-z0-9_]{1,19}$/, message: '2-20 letters, digits or _' } })} />
          </Field>
          <Field label="Label" error={errors.label}><input className={styles.input} {...register('label', { required: 'Label is required', maxLength: { value: 30, message: 'At most 30 characters' } })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Urgency level" error={errors.level} hint={editing ? 'The level cannot be changed.' : '0 = staff only, higher = more urgent'}>
            <input className={styles.input} type="number" step="1" disabled={editing} {...register('level', { valueAsNumber: true, validate: (v) => (Number.isInteger(v) && v >= 0 && v <= 10) || 'A whole number from 0 to 10' })} />
          </Field>
          <Field label="Colour" error={errors.color}><input className={styles.input + ' h-10 p-1'} type="color" {...register('color')} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First response (hours)" error={errors.responseTimeHours}><input className={styles.input} type="number" step="any" {...register('responseTimeHours', hoursRule)} /></Field>
          <Field label="Resolution (hours)" error={errors.resolutionTimeHours}>
            <input className={styles.input} type="number" step="any" {...register('resolutionTimeHours', { ...hoursRule, validate: (v) => (Number.isFinite(v) && v >= getValues('responseTimeHours')) || 'Cannot be shorter than the first response' })} />
          </Field>
        </div>
        <CheckboxField label="Count business hours only" hint="Off = plain wall-clock time (handy for demos).">
          <input type="checkbox" className={styles.checkbox} {...register('businessHoursOnly')} />
        </CheckboxField>
        {editing && <p className="text-xs text-slate-400">New hours apply to tickets whose clock starts after the change; existing due dates stay as they are.</p>}
        <ModalFooter error={serverError} submitting={isSubmitting} submitLabel={editing ? 'Save changes' : 'Create priority'} onCancel={onClose} />
      </form>
    </Modal>
  )
}

export const SlaPage = () => {
  const [editing, setEditing] = useState(null)
  const [toggling, setToggling] = useState(null)
  const { data, loading, error, reload } = useFetch('/admin-api/sla-policies', { limit: 50 })

  const confirmToggle = async () => {
    const policy = toggling
    setToggling(null)
    const ok = await runAction(() => axiosInstance.patch(`/admin-api/sla-policies/${policy._id}`, { isActive: !policy.isActive }), policy.isActive ? 'Priority deactivated' : 'Priority activated')
    if (ok) reload()
  }

  const columns = [
    { key: 'priority', header: 'Code', render: (p) => <span className="font-mono text-xs">{p.priority}</span> },
    { key: 'label', header: 'Label', render: (p) => <span className="inline-flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: p.color }} />{p.label}</span> },
    { key: 'level', header: 'Level', render: (p) => (p.level === 0 ? '0 (staff only)' : p.level) },
    { key: 'responseTimeHours', header: 'Response', render: (p) => `${p.responseTimeHours} h` },
    { key: 'resolutionTimeHours', header: 'Resolution', render: (p) => `${p.resolutionTimeHours} h` },
    { key: 'businessHoursOnly', header: 'Clock', render: (p) => <FlagBadge on={p.businessHoursOnly} onLabel="Business hours" offLabel="Wall-clock" /> },
    { key: 'isActive', header: 'Status', render: (p) => <ActiveBadge isActive={p.isActive} /> },
    { key: 'actions', header: '', render: (p) => (
      <div className="flex gap-3 justify-end whitespace-nowrap">
        <button className={styles.btnLink} onClick={() => setEditing(p)}>Edit</button>
        <button className={p.isActive ? styles.btnLinkDanger : styles.btnLink} onClick={() => setToggling(p)}>{p.isActive ? 'Deactivate' : 'Activate'}</button>
      </div>
    ) },
  ]

  return (
    <div className={styles.card}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className={styles.h2 + ' mb-0'}>Priorities and SLA targets</h2>
        <button className={styles.btnPrimary} onClick={() => setEditing('new')}><Plus className="h-4 w-4" aria-hidden="true" />New priority</button>
      </div>
      <DataTable columns={columns} rows={data?.items} loading={loading} error={error} onRetry={reload} emptyTitle="No priorities" emptyIcon={Timer} />
      {editing && (
        <PolicyFormModal policy={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
          onSaved={(message) => { setEditing(null); reload(); toast.success(message) }} />
      )}
      <ConfirmModal open={Boolean(toggling)} danger={toggling?.isActive} title={toggling?.isActive ? 'Deactivate this priority?' : 'Activate this priority?'}
        message={toggling?.isActive ? 'Not possible while open tickets use it, while a category defaults to it, or if it is the last priority employees can choose.' : 'Employees can pick it again.'}
        confirmLabel={toggling?.isActive ? 'Deactivate' : 'Activate'} onConfirm={confirmToggle} onCancel={() => setToggling(null)} />
    </div>
  )
}
