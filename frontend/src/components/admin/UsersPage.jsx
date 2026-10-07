import { useEffect, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import toast from 'react-hot-toast'
import { axiosInstance } from '../../axiosInstance.js'
import { useFetch } from '../../hooks/useFetch.js'
import { useAuthStore } from '../../store/authStore.js'
import { getErrorMessage } from '../../utils/errors.js'
import { runAction } from '../../utils/actions.js'
import { DataTable } from '../common/DataTable.jsx'
import { ConfirmModal } from '../common/ConfirmModal.jsx'
import { Modal, ModalFooter } from '../common/Modal.jsx'
import { Field } from '../common/Field.jsx'
import { TagInput } from '../common/TagInput.jsx'
import { ActiveBadge } from '../common/FlagBadge.jsx'
import { styles } from '../../styles/common.js'
import { RoleBadge } from '../common/Badges.jsx'
import { roleLabel } from '../../utils/labels.js'
import { Plus, Search, Users } from 'lucide-react'

const ROLES = ['ADMIN', 'MANAGER', 'TECHNICIAN', 'EMPLOYEE', 'ASSET_MANAGER']
// which kind of department each role belongs to (no entry = no department)
const DEPARTMENT_KIND = { EMPLOYEE: 'BUSINESS', TECHNICIAN: 'IT_SUPPORT', MANAGER: 'IT_SUPPORT' }
const PAGE_SIZE = 15

const sameList = (a = [], b = []) => a.length === b.length && a.every((x, i) => x === b[i])

const UserFormModal = ({ user, departments, isSelf, onClose, onSaved }) => {
  const editing = Boolean(user)
  const { register, handleSubmit, control, watch, setValue, formState: { errors, isSubmitting } } = useForm({
    defaultValues: {
      firstName: user?.firstName ?? '', lastName: user?.lastName ?? '', email: user?.email ?? '', password: '',
      role: user?.role ?? 'EMPLOYEE', department: user?.department?._id ?? '', skills: user?.skills ?? [],
    },
  })
  const [serverError, setServerError] = useState('')
  const role = watch('role')
  const kind = DEPARTMENT_KIND[role]
  const options = kind ? departments.filter((d) => d.kind === kind) : []
  const department = watch('department')

  // switching role must not leave a department of the wrong kind selected
  useEffect(() => {
    if (department && !options.some((d) => d._id === department)) setValue('department', '')
  }, [role]) // only when the role changes, not on every keystroke

  const submit = async (values) => {
    setServerError('')
    try {
      const wanted = { firstName: values.firstName.trim(), lastName: values.lastName.trim(), role: values.role, department: kind ? values.department : null, skills: values.role === 'TECHNICIAN' ? values.skills : undefined }
      if (!editing) {
        await axiosInstance.post('/admin-api/users', { ...wanted, email: values.email.trim(), password: values.password, department: wanted.department ?? undefined })
      } else {
        const changes = {}
        if (wanted.firstName !== user.firstName) changes.firstName = wanted.firstName
        if (wanted.lastName !== (user.lastName ?? '')) changes.lastName = wanted.lastName
        if (wanted.role !== user.role) changes.role = wanted.role
        if ((wanted.department ?? null) !== (user.department?._id ?? null)) changes.department = wanted.department
        if (wanted.skills !== undefined && !sameList(wanted.skills, user.skills)) changes.skills = wanted.skills
        if (Object.keys(changes).length === 0) return onClose()
        await axiosInstance.patch(`/admin-api/users/${user._id}`, changes)
      }
      onSaved(editing ? 'User updated' : 'User created')
    } catch (err) {
      setServerError(getErrorMessage(err))
    }
  }

  return (
    <Modal title={editing ? `Edit ${user.firstName}` : 'New user'} onClose={onClose}>
      <form onSubmit={handleSubmit(submit)} noValidate>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" error={errors.firstName}><input className={styles.input} {...register('firstName', { required: 'First name is required', maxLength: { value: 50, message: 'At most 50 characters' } })} /></Field>
          <Field label="Last name" error={errors.lastName}><input className={styles.input} {...register('lastName', { maxLength: { value: 50, message: 'At most 50 characters' } })} /></Field>
        </div>
        <Field label="Email" error={errors.email}>
          <input className={styles.input} type="email" disabled={editing} {...register('email', { required: !editing && 'Email is required' })} />
        </Field>
        {!editing && (
          <Field label="Initial password" error={errors.password} hint="12-72 characters. The user can change it after logging in.">
            <input className={styles.input} type="password" autoComplete="new-password" {...register('password', { required: 'Password is required', minLength: { value: 12, message: 'At least 12 characters' }, maxLength: { value: 72, message: 'At most 72 characters' } })} />
          </Field>
        )}
        <Field label="Role" hint={isSelf ? 'You cannot change your own role.' : undefined}>
          <select className={styles.select} disabled={isSelf} {...register('role')}>
            {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </select>
        </Field>
        {kind ? (
          <Field label={kind === 'BUSINESS' ? 'Department' : 'Support team'} error={errors.department}>
            <select className={styles.select} {...register('department', { required: 'Choose one' })}>
              <option value="">Select…</option>
              {options.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
            </select>
          </Field>
        ) : <p className="text-xs text-slate-400 mb-3">This role does not belong to a department.</p>}
        {role === 'TECHNICIAN' && (
          <Controller name="skills" control={control} render={({ field }) => <TagInput label="Skills" value={field.value} onChange={field.onChange} />} />
        )}
        <ModalFooter error={serverError} submitting={isSubmitting} submitLabel={editing ? 'Save changes' : 'Create user'} onCancel={onClose} />
      </form>
    </Modal>
  )
}

export const UsersPage = () => {
  const me = useAuthStore((s) => s.user)
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState({ q: '', role: '', department: '', isActive: '' })
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null) // null | 'new' | a user
  const [toggling, setToggling] = useState(null)

  const { data, loading, error, reload } = useFetch('/admin-api/users', {
    page, limit: PAGE_SIZE, q: filters.q || undefined, role: filters.role || undefined,
    department: filters.department || undefined, isActive: filters.isActive || undefined,
  })
  const { data: deptData } = useFetch('/admin-api/departments', { limit: 50, isActive: true })
  const departments = deptData?.items ?? []

  const setFilter = (key, value) => { setPage(1); setFilters((f) => ({ ...f, [key]: value })) }
  const applySearch = (e) => { e.preventDefault(); setFilter('q', search.trim()) }

  const confirmToggle = async () => {
    const user = toggling
    setToggling(null)
    const ok = await runAction(() => axiosInstance.patch(`/admin-api/users/${user._id}/status`, { isActive: !user.isActive }), user.isActive ? 'User deactivated' : 'User activated')
    if (ok) reload()
  }

  const columns = [
    { key: 'name', header: 'Name', render: (u) => <div><p className="font-medium">{u.firstName} {u.lastName}</p><p className="text-xs text-slate-400">{u.email}</p></div> },
    { key: 'role', header: 'Role', render: (u) => <RoleBadge role={u.role} /> },
    { key: 'department', header: 'Team', className: 'hidden md:table-cell', render: (u) => u.department?.name ?? <span className="text-slate-300">—</span> },
    { key: 'skills', header: 'Skills', className: 'hidden lg:table-cell', render: (u) => (u.role === 'TECHNICIAN'
      ? <div className="flex flex-wrap gap-1">{u.skills?.length ? u.skills.map((s) => <span key={s} className={styles.chip}>{s}</span>) : <span className="text-slate-300">none</span>}</div>
      : null) },
    { key: 'load', header: 'Open', className: 'hidden sm:table-cell', render: (u) => (u.role === 'TECHNICIAN' ? u.openTickets : null) },
    { key: 'isActive', header: 'Status', render: (u) => <ActiveBadge isActive={u.isActive} /> },
    { key: 'actions', header: '', render: (u) => (
      <div className="flex gap-3 justify-end whitespace-nowrap">
        <button className={styles.btnLink} onClick={() => setEditing(u)}>Edit</button>
        <button className={u.isActive ? styles.btnLinkDanger : styles.btnLink} disabled={u._id === me?._id} title={u._id === me?._id ? 'You cannot change your own status' : undefined} onClick={() => setToggling(u)}>{u.isActive ? 'Deactivate' : 'Activate'}</button>
      </div>
    ) },
  ]

  return (
    <div className={styles.card}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className={styles.h2 + ' mb-0'}>Users</h2>
        <button className={styles.btnPrimary} onClick={() => setEditing('new')}><Plus className="h-4 w-4" aria-hidden="true" />New user</button>
      </div>
      <form onSubmit={applySearch} className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden="true" />
          <input className={styles.input + ' pl-9'} placeholder="Search name or email…" aria-label="Search users" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className={styles.select + ' max-w-[11rem]'} value={filters.role} onChange={(e) => setFilter('role', e.target.value)} aria-label="Filter by role">
          <option value="">All roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
        </select>
        <select className={styles.select + ' max-w-[12rem]'} value={filters.department} onChange={(e) => setFilter('department', e.target.value)} aria-label="Filter by team">
          <option value="">All teams</option>
          {departments.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
        </select>
        <select className={styles.select + ' max-w-[9rem]'} value={filters.isActive} onChange={(e) => setFilter('isActive', e.target.value)} aria-label="Filter by status">
          <option value="">Any status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
        <button className={styles.btnSecondary} type="submit">Search</button>
      </form>
      <DataTable columns={columns} rows={data?.items} loading={loading} error={error} onRetry={reload}
        page={data?.page} totalPages={data?.totalPages} total={data?.total} onPageChange={setPage}
        emptyTitle="No users found" emptyHint="Try clearing the filters." emptyIcon={Users} />

      {editing && (
        <UserFormModal user={editing === 'new' ? null : editing} departments={departments} isSelf={editing !== 'new' && editing._id === me?._id}
          onClose={() => setEditing(null)} onSaved={(message) => { setEditing(null); reload(); toast.success(message) }} />
      )}
      <ConfirmModal open={Boolean(toggling)} danger={toggling?.isActive} title={toggling?.isActive ? 'Deactivate this user?' : 'Activate this user?'}
        message={toggling?.isActive ? `${toggling?.firstName} will be signed out on their next request and can no longer log in.` : `${toggling?.firstName} will be able to log in again.`}
        confirmLabel={toggling?.isActive ? 'Deactivate' : 'Activate'} onConfirm={confirmToggle} onCancel={() => setToggling(null)} />
    </div>
  )
}
