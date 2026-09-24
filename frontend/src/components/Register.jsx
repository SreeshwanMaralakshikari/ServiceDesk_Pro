import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { axiosInstance } from '../axiosInstance.js'
import { styles } from '../styles/common.js'

export const Register = () => {
  const [departments, setDepartments] = useState([])
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', department: '' })
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    axiosInstance.get('/meta-api/departments?kind=BUSINESS').then(({ data }) => setDepartments(data.payload))
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await axiosInstance.post('/auth/users', form)
      toast.success('Registered! Please login.')
      navigate('/login')
    } catch (err) {
      toast.error(err.response?.data?.message || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.container}>
      <div className={`${styles.card} max-w-md mx-auto`}>
        <h1 className={styles.h1}>Register</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={styles.label}>First name</label>
            <input className={styles.input} required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          </div>
          <div>
            <label className={styles.label}>Last name</label>
            <input className={styles.input} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          </div>
          <div>
            <label className={styles.label}>Email</label>
            <input className={styles.input} type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label className={styles.label}>Password</label>
            <input className={styles.input} type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <div>
            <label className={styles.label}>Department</label>
            <select className={styles.select} required value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
              <option value="">Select…</option>
              {departments.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
            </select>
          </div>
          <button className={styles.btnPrimary} disabled={loading} type="submit">
            {loading ? 'Creating…' : 'Create account'}
          </button>
        </form>
        <p className="text-sm text-slate-500 mt-4">
          Already have an account? <Link to="/login" className="text-indigo-600">Login</Link>
        </p>
      </div>
    </div>
  )
}
