import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/authStore.js'
import { styles } from '../styles/common.js'

export const Login = () => {
  const [form, setForm] = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const login = useAuthStore((s) => s.login)
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await login(form.email, form.password)
      toast.success('Welcome back!')
      navigate('/tickets')
    } catch (err) {
      toast.error(err.response?.data?.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.container}>
      <div className={`${styles.card} max-w-md mx-auto`}>
        <h1 className={styles.h1}>Login</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={styles.label}>Email</label>
            <input className={styles.input} type="email" required
              value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label className={styles.label}>Password</label>
            <input className={styles.input} type="password" required
              value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <button className={styles.btnPrimary} disabled={loading} type="submit">
            {loading ? 'Logging in…' : 'Login'}
          </button>
        </form>
        <p className="text-sm text-slate-500 mt-4">
          No account? <Link to="/register" className="text-indigo-600">Register</Link>
        </p>
        <p className="text-xs text-slate-400 mt-2">
          Demo: admin@sdp.test / manager@sdp.test / tech@sdp.test / employee@sdp.test — password: Passw0rd!
        </p>
      </div>
    </div>
  )
}
