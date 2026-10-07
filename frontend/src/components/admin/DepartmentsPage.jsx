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
import { Field } from '../common/Field.jsx'
import { ActiveBadge } from '../common/FlagBadge.jsx'
import { styles } from '../../styles/common.js'
import { Building2, Plus } from 'lucide-react'

const KIND_LABEL = { BUSINESS: 'Business', IT_SUPPORT: 'IT support' }

const DepartmentFormModal = ({ department, onClose, onSaved }) => {
  const editing = Boolean(department)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    defaultValues: { name: department?.name ?? '', code: department?.code ?? '', kind: department?.kind ?? 'BUSINESS', manager: department?.manager?._id ?? '' },
  })
  const [serverError, setServerError] = useState('')
  // only people already in this team can manage it
  const { data: managers } = useFetch(editing && department.kind === 'IT_SUPPORT' ? '/admin-api/users' : null, { role: 'MANAGER', department: department?._id, isActive: true, limit: 50 })

  const submit = async (values) => {
    setServerError('')
    try {
      if (!editing) {
        await axiosInstance.post('/admin-api/departments', { name: values.name.trim(), code: values.code.trim(), kind: values.kind })
      } else {
        const changes = {}
        if (values.name.trim() !== department.name) changes.name = values.name.trim()
        if (values.code.trim().toUpperCase() !== department.code) changes.code = values.code.trim()
        if (department.kind === 'IT_SUPPORT' && values.manager !== (department.manager?._id ?? '')) changes.manager = values.manager || null
        if (Object.keys(changes).length === 0) return onClose()
        await axiosInstance.patch(`/admin-api/departments/${department._id}`, changes)
      }
      onSaved(editing ? 'Department updated' : 'Department created')
    } catch (err) {
      setServerError(getErrorMessage(err))
    }
  }

  return (
    <Modal title={editing ? `Edit ${department.name}` : 'New department'} onClose={onClose}>
      <form onSubmit={handleSubmit(submit)} noValidate>
        <Field label="Name" error={errors.name}><input className={styles.input} {...register('name', { required: 'Name is required', minLength: { value: 2, message: 'At least 2 characters' }, maxLength: { value: 60, message: 'At most 60 characters' } })} /></Field>
        <Field label="Code" error={errors.code} hint="2-8 letters or digits, e.g. HR">
          <input className={styles.input} {...register('code', { required: 'Code is required', pattern: { value: /^[A-Za-z0-9]{2,8}$/, message: '2-8 letters or digits' } })} />
        </Field>
        <Field label="Kind" hint={editing ? 'The kind cannot be changed.' : 'Business departments hold employees; IT support teams handle tickets.'}>
          <select className={styles.select} disabled={editing} {...register('kind')}>
            <option value="BUSINESS">Business department</option>
            <option value="IT_SUPPORT">IT support team</option>
          </select>
        </Field>
        {editing && department.kind === 'IT_SUPPORT' && (
          <Field label="Team manager" hint="Only active managers of this team are listed.">
            <select className={styles.select} {...register('manager')}>
              <option value="">No manager</option>
              {(managers?.items ?? []).map((m) => <option key={m._id} value={m._id}>{m.firstName} {m.lastName}</option>)}
            </select>
          </Field>
        )}
        <ModalFooter error={serverError} submitting={isSubmitting} submitLabel={editing ? 'Save changes' : 'Create department'} onCancel={onClose} />
      </form>
    </Modal>
  )
}

export const DepartmentsPage = () => {
  const [page, setPage] = useState(1)
  const [kind, setKind] = useState('')
  const [editing, setEditing] = useState(null)
  const [toggling, setToggling] = useState(null)
  const { data, loading, error, reload } = useFetch('/admin-api/departments', { page, limit: 15, kind: kind || undefined })

  const confirmToggle = async () => {
    const department = toggling
    setToggling(null)
    const ok = await runAction(() => axiosInstance.patch(`/admin-api/departments/${department._id}`, { isActive: !department.isActive }), department.isActive ? 'Department deactivated' : 'Department activated')
    if (ok) reload()
  }

  const columns = [
    { key: 'name', header: 'Name', render: (d) => <span className="font-medium">{d.name}</span> },
    { key: 'code', header: 'Code', render: (d) => <span className="font-mono text-xs">{d.code}</span> },
    { key: 'kind', header: 'Kind', render: (d) => KIND_LABEL[d.kind] },
    { key: 'manager', header: 'Manager', className: 'hidden md:table-cell', render: (d) => (d.manager ? `${d.manager.firstName} ${d.manager.lastName}` : <span className="text-slate-300">—</span>) },
    { key: 'activeUsers', header: 'Users' },
    { key: 'activeCategories', header: 'Categories', className: 'hidden sm:table-cell', render: (d) => (d.kind === 'IT_SUPPORT' ? d.activeCategories : <span className="text-slate-300">—</span>) },
    { key: 'isActive', header: 'Status', render: (d) => <ActiveBadge isActive={d.isActive} /> },
    { key: 'actions', header: '', render: (d) => (
      <div className="flex gap-3 justify-end whitespace-nowrap">
        <button className={styles.btnLink} onClick={() => setEditing(d)}>Edit</button>
        <button className={d.isActive ? styles.btnLinkDanger : styles.btnLink} onClick={() => setToggling(d)}>{d.isActive ? 'Deactivate' : 'Activate'}</button>
      </div>
    ) },
  ]

  return (
    <div className={styles.card}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className={styles.h2 + ' mb-0'}>Departments and support teams</h2>
        <button className={styles.btnPrimary} onClick={() => setEditing('new')}><Plus className="h-4 w-4" aria-hidden="true" />New department</button>
      </div>
      <div className="mb-4">
        <select className={styles.select + ' max-w-[12rem]'} value={kind} onChange={(e) => { setPage(1); setKind(e.target.value) }} aria-label="Filter by kind">
          <option value="">All kinds</option>
          <option value="BUSINESS">Business</option>
          <option value="IT_SUPPORT">IT support</option>
        </select>
      </div>
      <DataTable columns={columns} rows={data?.items} loading={loading} error={error} onRetry={reload}
        page={data?.page} totalPages={data?.totalPages} total={data?.total} onPageChange={setPage} emptyTitle="No departments" emptyIcon={Building2} />
      {editing && (
        <DepartmentFormModal department={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
          onSaved={(message) => { setEditing(null); reload(); toast.success(message) }} />
      )}
      <ConfirmModal open={Boolean(toggling)} danger={toggling?.isActive} title={toggling?.isActive ? 'Deactivate this department?' : 'Activate this department?'}
        message={toggling?.isActive ? 'Only possible when nobody active, no category and no open ticket uses it.' : 'It will appear in the registration form and team lists again.'}
        confirmLabel={toggling?.isActive ? 'Deactivate' : 'Activate'} onConfirm={confirmToggle} onCancel={() => setToggling(null)} />
    </div>
  )
}
