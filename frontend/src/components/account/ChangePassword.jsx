import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { axiosInstance } from '../../axiosInstance.js'
import { useAuthStore } from '../../store/authStore.js'
import { styles } from '../../styles/common.js'
import { getErrorMessage } from '../../utils/errors.js'

const MIN_LENGTH = 12 // keep in step with the backend rule (CommonAPI MIN_NEW_PASSWORD_LENGTH)

export const ChangePassword = () => {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' })
  const [saving, setSaving] = useState(false)
  const navigate = useNavigate()

  const submit = async (e) => {
    e.preventDefault()
    if (form.newPassword.length < MIN_LENGTH) return toast.error(`New password must be at least ${MIN_LENGTH} characters`)
    if (form.newPassword !== form.confirm) return toast.error('The two new passwords do not match')
    if (form.newPassword === form.currentPassword) return toast.error('Choose a password different from the current one')
    setSaving(true)
    try {
      await axiosInstance.put('/auth/password', { currentPassword: form.currentPassword, newPassword: form.newPassword })
      // the server clears the cookie, so the session is over here too
      useAuthStore.setState({ user: null, isAuthenticated: false })
      toast.success('Password changed — please log in again')
      navigate('/login')
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to change password'))
    } finally {
      setSaving(false)
    }
  }

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  return (
    <div className={styles.container}>
      <div className={styles.card + ' max-w-md mx-auto'}>
        <h1 className={styles.h1}>Change password</h1>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className={styles.label} htmlFor="currentPassword">Current password</label>
            <input id="currentPassword" type="password" autoComplete="current-password" className={styles.input} required value={form.currentPassword} onChange={set('currentPassword')} />
          </div>
          <div>
            <label className={styles.label} htmlFor="newPassword">New password</label>
            <input id="newPassword" type="password" autoComplete="new-password" className={styles.input} required minLength={MIN_LENGTH} maxLength={72} value={form.newPassword} onChange={set('newPassword')} />
            <p className="text-xs text-slate-400 mt-1">{MIN_LENGTH}–72 characters.</p>
          </div>
          <div>
            <label className={styles.label} htmlFor="confirm">Repeat new password</label>
            <input id="confirm" type="password" autoComplete="new-password" className={styles.input} required value={form.confirm} onChange={set('confirm')} />
          </div>
          <button className={styles.btnPrimary} disabled={saving} type="submit">{saving ? 'Saving…' : 'Change password'}</button>
        </form>
      </div>
    </div>
  )
}
