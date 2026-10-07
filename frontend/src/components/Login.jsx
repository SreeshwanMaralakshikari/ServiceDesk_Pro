import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { LogIn } from 'lucide-react'
import { useAuthStore } from '../store/authStore.js'
import { styles } from '../styles/common.js'
import { getErrorMessage } from '../utils/errors.js'
import { AuthLayout } from './auth/AuthLayout.jsx'
import { PasswordInput } from './common/PasswordInput.jsx'

export const Login = () => {
  const [form, setForm] = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const login = useAuthStore((s) => s.login)
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const user = await login(form.email, form.password)
      toast.success('Welcome back!')
      // the asset manager has no tickets page in the menu, so start on their own dashboard
      navigate(user?.role === 'ASSET_MANAGER' ? '/asset-stats' : '/tickets')
    } catch (err) {
      toast.error(getErrorMessage(err, 'Login failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to raise and follow your IT requests."
      footer={<>No account yet? <Link to="/register" className="font-medium text-indigo-600 hover:underline">Create one</Link></>}>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className={styles.label} htmlFor="login-email">Work email</label>
          <input id="login-email" className={styles.input} type="email" autoComplete="email" required placeholder="you@company.com"
            value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div>
          <label className={styles.label} htmlFor="login-password">Password</label>
          <PasswordInput id="login-password" autoComplete="current-password" required
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </div>
        <button className={styles.btnPrimary + ' w-full py-2.5'} disabled={loading} type="submit">
          {loading
            ? <><span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden="true" />Signing in…</>
            : <><LogIn className="h-4 w-4" aria-hidden="true" />Sign in</>}
        </button>
      </form>
    </AuthLayout>
  )
}
