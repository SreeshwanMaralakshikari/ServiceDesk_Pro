import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { UserPlus } from 'lucide-react'
import { axiosInstance } from '../axiosInstance.js'
import { styles } from '../styles/common.js'
import { getErrorMessage } from '../utils/errors.js'
import { AuthLayout } from './auth/AuthLayout.jsx'
import { PasswordInput } from './common/PasswordInput.jsx'

// same limits as the backend's rule for every new password (utils/passwordRule.js)
const MIN_PASSWORD = 12
const MAX_PASSWORD = 72

export const Register = () => {
  const [departments, setDepartments] = useState([])
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', department: '' })
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    axiosInstance.get('/meta-api/departments?kind=BUSINESS').then(({ data }) => setDepartments(data.payload)).catch((err) => toast.error(getErrorMessage(err, 'Could not load departments')))
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await axiosInstance.post('/auth/users', form)
      toast.success('Registered! Please login.')
      navigate('/login')
    } catch (err) {
      toast.error(getErrorMessage(err, 'Registration failed'))
    } finally {
      setLoading(false)
    }
  }

  const passwordLength = form.password.length
  const passwordOk = passwordLength >= MIN_PASSWORD && passwordLength <= MAX_PASSWORD

  return (
    <AuthLayout title="Create your account" subtitle="For employees who need to raise IT requests."
      footer={<>Already have an account? <Link to="/login" className="font-medium text-indigo-600 hover:underline">Sign in</Link></>}>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={styles.label} htmlFor="reg-first">First name</label>
            <input id="reg-first" className={styles.input} autoComplete="given-name" required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          </div>
          <div>
            <label className={styles.label} htmlFor="reg-last">Last name</label>
            <input id="reg-last" className={styles.input} autoComplete="family-name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          </div>
        </div>
        <div>
          <label className={styles.label} htmlFor="reg-email">Work email</label>
          <input id="reg-email" className={styles.input} type="email" autoComplete="email" required placeholder="you@company.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div>
          <label className={styles.label} htmlFor="reg-password">Password</label>
          <PasswordInput id="reg-password" autoComplete="new-password" required minLength={MIN_PASSWORD} maxLength={MAX_PASSWORD} aria-describedby="reg-password-hint"
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <p id="reg-password-hint" className={`text-xs mt-1 ${passwordLength === 0 ? 'text-slate-400' : passwordOk ? 'text-green-600' : 'text-amber-600'}`}>
            {MIN_PASSWORD}–{MAX_PASSWORD} characters{passwordLength > 0 ? ` (${passwordLength} so far)` : ''}
          </p>
        </div>
        <div>
          <label className={styles.label} htmlFor="reg-dept">Department</label>
          <select id="reg-dept" className={styles.select} required value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
            <option value="">Select…</option>
            {departments.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
          </select>
        </div>
        <button className={styles.btnPrimary + ' w-full py-2.5'} disabled={loading} type="submit">
          {loading
            ? <><span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden="true" />Creating…</>
            : <><UserPlus className="h-4 w-4" aria-hidden="true" />Create account</>}
        </button>
      </form>
    </AuthLayout>
  )
}
