import { useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import toast from 'react-hot-toast'
import { axiosInstance } from '../../axiosInstance.js'
import { useFetch } from '../../hooks/useFetch.js'
import { getErrorMessage } from '../../utils/errors.js'
import { runAction } from '../../utils/actions.js'
import { DataTable } from '../common/DataTable.jsx'
import { ConfirmModal } from '../common/ConfirmModal.jsx'
import { Modal, ModalFooter } from '../common/Modal.jsx'
import { Field, CheckboxField } from '../common/Field.jsx'
import { TagInput } from '../common/TagInput.jsx'
import { ActiveBadge, FlagBadge } from '../common/FlagBadge.jsx'
import { PriorityBadge } from '../common/Badges.jsx'
import { styles } from '../../styles/common.js'

const sameList = (a = [], b = []) => a.length === b.length && a.every((x, i) => x === b[i])

const CategoryFormModal = ({ category, teams, priorities, onClose, onSaved }) => {
  const editing = Boolean(category)
  const { register, handleSubmit, control, formState: { errors, isSubmitting } } = useForm({
    defaultValues: {
      name: category?.name ?? '', description: category?.description ?? '', department: category?.department?._id ?? '',
      ticketType: category?.ticketType ?? 'INCIDENT', defaultPriority: category?.defaultPriority ?? 'MEDIUM',
      requiresApproval: category?.requiresApproval ?? false, autoAssign: category?.autoAssign ?? false, skills: category?.skills ?? [],
    },
  })
  const [serverError, setServerError] = useState('')

  const submit = async (values) => {
    setServerError('')
    try {
      const wanted = { ...values, name: values.name.trim(), description: values.description.trim() }
      if (!editing) {
        await axiosInstance.post('/admin-api/categories', wanted)
      } else {
        const changes = {}
        for (const key of ['name', 'description', 'ticketType', 'defaultPriority', 'requiresApproval', 'autoAssign']) {
          if (wanted[key] !== (category[key] ?? '')) changes[key] = wanted[key]
        }
        if (wanted.department !== category.department?._id) changes.department = wanted.department
        if (!sameList(wanted.skills, category.skills)) changes.skills = wanted.skills
        if (Object.keys(changes).length === 0) return onClose()
        await axiosInstance.patch(`/admin-api/categories/${category._id}`, changes)
      }
      onSaved(editing ? 'Category updated' : 'Category created')
    } catch (err) {
      setServerError(getErrorMessage(err))
    }
  }

  return (
    <Modal title={editing ? `Edit ${category.name}` : 'New category'} onClose={onClose}>
      <form onSubmit={handleSubmit(submit)} noValidate>
        <Field label="Name" error={errors.name}><input className={styles.input} {...register('name', { required: 'Name is required', minLength: { value: 2, message: 'At least 2 characters' }, maxLength: { value: 80, message: 'At most 80 characters' } })} /></Field>
        <Field label="Description" error={errors.description}><input className={styles.input} {...register('description', { maxLength: { value: 300, message: 'At most 300 characters' } })} /></Field>
        <Field label="Handling team" error={errors.department} hint="Tickets in this category go to this IT support team.">
          <select className={styles.select} {...register('department', { required: 'Choose a team' })}>
            <option value="">Select…</option>
            {teams.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ticket type">
            <select className={styles.select} {...register('ticketType')}>
              <option value="INCIDENT">Incident</option>
              <option value="SERVICE_REQUEST">Service request</option>
            </select>
          </Field>
          <Field label="Default priority">
            <select className={styles.select} {...register('defaultPriority')}>
              {priorities.map((p) => <option key={p.priority} value={p.priority}>{p.label}</option>)}
            </select>
          </Field>
        </div>
        <CheckboxField label="Requires approval" hint="A manager must approve new tickets before work starts.">
          <input type="checkbox" className={styles.checkbox} {...register('requiresApproval')} />
        </CheckboxField>
        <CheckboxField label="Auto-assign" hint="New tickets go straight to the best-fit technician (least busy, best skill match).">
          <input type="checkbox" className={styles.checkbox} {...register('autoAssign')} />
        </CheckboxField>
        <Controller name="skills" control={control} render={({ field }) => <TagInput label="Skills that fit this category" value={field.value} onChange={field.onChange} />} />
        <ModalFooter error={serverError} submitting={isSubmitting} submitLabel={editing ? 'Save changes' : 'Create category'} onCancel={onClose} />
      </form>
    </Modal>
  )
}

export const CategoriesPage = () => {
  const [page, setPage] = useState(1)
  const [team, setTeam] = useState('')
  const [editing, setEditing] = useState(null)
  const [toggling, setToggling] = useState(null)
  const { data, loading, error, reload } = useFetch('/admin-api/categories', { page, limit: 15, department: team || undefined })
  const { data: deptData } = useFetch('/admin-api/departments', { limit: 50, kind: 'IT_SUPPORT', isActive: true })
  const { data: slaData } = useFetch('/admin-api/sla-policies', { limit: 50 })
  const teams = deptData?.items ?? []
  // employees can only pick active priorities above the staff-only level 0
  const priorities = (slaData?.items ?? []).filter((p) => p.isActive && p.level > 0)

  const confirmToggle = async () => {
    const category = toggling
    setToggling(null)
    const ok = await runAction(() => axiosInstance.patch(`/admin-api/categories/${category._id}`, { isActive: !category.isActive }), category.isActive ? 'Category deactivated' : 'Category activated')
    if (ok) reload()
  }

  const columns = [
    { key: 'name', header: 'Category', render: (c) => <div><p className="font-medium">{c.name}</p>{c.description && <p className="text-xs text-slate-400">{c.description}</p>}</div> },
    { key: 'department', header: 'Team', render: (c) => c.department?.name },
    { key: 'ticketType', header: 'Type', render: (c) => (c.ticketType === 'INCIDENT' ? 'Incident' : 'Request') },
    { key: 'defaultPriority', header: 'Priority', render: (c) => <PriorityBadge priority={c.defaultPriority} /> },
    { key: 'requiresApproval', header: 'Approval', render: (c) => <FlagBadge on={c.requiresApproval} onLabel="Required" offLabel="No" /> },
    { key: 'autoAssign', header: 'Auto-assign', render: (c) => <FlagBadge on={c.autoAssign} onLabel="On" offLabel="Off" /> },
    { key: 'skills', header: 'Skills', render: (c) => <div className="flex flex-wrap gap-1">{c.skills?.map((s) => <span key={s} className={styles.chip}>{s}</span>)}</div> },
    { key: 'isActive', header: 'Status', render: (c) => <ActiveBadge isActive={c.isActive} /> },
    { key: 'actions', header: '', render: (c) => (
      <div className="flex gap-3 justify-end whitespace-nowrap">
        <button className={styles.btnLink} onClick={() => setEditing(c)}>Edit</button>
        <button className={c.isActive ? styles.btnLinkDanger : styles.btnLink} onClick={() => setToggling(c)}>{c.isActive ? 'Deactivate' : 'Activate'}</button>
      </div>
    ) },
  ]

  return (
    <div className={styles.card}>
      <div className="flex items-center justify-between mb-4">
        <h2 className={styles.h2 + ' mb-0'}>Ticket categories</h2>
        <button className={styles.btnPrimary} onClick={() => setEditing('new')}>+ New category</button>
      </div>
      <div className="mb-4">
        <select className={styles.select + ' max-w-[14rem]'} value={team} onChange={(e) => { setPage(1); setTeam(e.target.value) }} aria-label="Filter by team">
          <option value="">All teams</option>
          {teams.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
        </select>
      </div>
      <DataTable columns={columns} rows={data?.items} loading={loading} error={error}
        page={data?.page} totalPages={data?.totalPages} total={data?.total} onPageChange={setPage} emptyTitle="No categories" />
      {editing && (
        <CategoryFormModal category={editing === 'new' ? null : editing} teams={teams} priorities={priorities} onClose={() => setEditing(null)}
          onSaved={(message) => { setEditing(null); reload(); toast.success(message) }} />
      )}
      <ConfirmModal open={Boolean(toggling)} danger={toggling?.isActive} title={toggling?.isActive ? 'Deactivate this category?' : 'Activate this category?'}
        message={toggling?.isActive ? 'It disappears from the new-ticket form. Not possible while open tickets use it.' : 'Employees can pick it again.'}
        confirmLabel={toggling?.isActive ? 'Deactivate' : 'Activate'} onConfirm={confirmToggle} onCancel={() => setToggling(null)} />
    </div>
  )
}
