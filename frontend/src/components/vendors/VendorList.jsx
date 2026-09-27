import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { axiosInstance } from '../../axiosInstance.js'
import { styles } from '../../styles/common.js'

export const VendorList = () => {
  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ name: '', contactPerson: '', email: '', phone: '', servicesProvided: '' })
  const [creating, setCreating] = useState(false)

  const load = () => {
    axiosInstance.get('/vendor-api/vendors').then(({ data }) => setVendors(data.payload)).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const createVendor = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return toast.error('Name is required')
    setCreating(true)
    try {
      await axiosInstance.post('/vendor-api/vendors', form)
      toast.success('Vendor added')
      setForm({ name: '', contactPerson: '', email: '', phone: '', servicesProvided: '' })
      load()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to add vendor')
    } finally {
      setCreating(false)
    }
  }

  const toggleActive = async (vendor) => {
    try {
      await axiosInstance.patch(`/vendor-api/vendors/${vendor._id}`, { isActive: !vendor.isActive })
      load()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update vendor')
    }
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.h1}>Vendors</h1>

      <div className={`${styles.card} mb-6`}>
        <h2 className={styles.h2}>Add vendor</h2>
        <form onSubmit={createVendor} className="grid grid-cols-2 gap-3">
          <input className={styles.input} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className={styles.input} placeholder="Contact person" value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} />
          <input className={styles.input} placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input className={styles.input} placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <input className={styles.input + ' col-span-2'} placeholder="Services provided" value={form.servicesProvided} onChange={(e) => setForm({ ...form, servicesProvided: e.target.value })} />
          <button className={styles.btnPrimary + ' col-span-2'} disabled={creating} type="submit">{creating ? 'Adding…' : 'Add vendor'}</button>
        </form>
      </div>

      <div className={styles.card}>
        {loading && <p className="text-slate-500">Loading…</p>}
        {!loading && vendors.length === 0 && <p className="text-slate-500">No vendors yet.</p>}
        {!loading && vendors.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr className={styles.tableHeadRow}>
                <th className="py-2">Name</th>
                <th className="py-2">Contact</th>
                <th className="py-2">Services</th>
                <th className="py-2">Status</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => (
                <tr key={v._id} className="border-b border-slate-100">
                  <td className="py-2">{v.name}</td>
                  <td className="py-2 text-sm text-slate-500">{v.contactPerson}{v.email ? ` · ${v.email}` : ''}</td>
                  <td className="py-2 text-sm text-slate-500">{v.servicesProvided}</td>
                  <td className="py-2"><span className={`${styles.badge} ${v.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'}`}>{v.isActive ? 'Active' : 'Inactive'}</span></td>
                  <td className="py-2"><button className={styles.btnSecondary} onClick={() => toggleActive(v)}>{v.isActive ? 'Deactivate' : 'Reactivate'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
