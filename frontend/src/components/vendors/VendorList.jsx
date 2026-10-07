import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Truck } from 'lucide-react'
import { axiosInstance } from '../../axiosInstance.js'
import { styles } from '../../styles/common.js'
import { getErrorMessage } from '../../utils/errors.js'
import { DataTable } from '../common/DataTable.jsx'
import { ActiveBadge } from '../common/FlagBadge.jsx'

export const VendorList = () => {
  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ name: '', contactPerson: '', email: '', phone: '', servicesProvided: '' })
  const [creating, setCreating] = useState(false)

  const load = () => {
    axiosInstance.get('/vendor-api/vendors')
      .then(({ data }) => setVendors(data.payload))
      .catch((err) => toast.error(getErrorMessage(err, 'Failed to load vendors')))
      .finally(() => setLoading(false))
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
      toast.error(getErrorMessage(err, 'Failed to add vendor'))
    } finally {
      setCreating(false)
    }
  }

  const toggleActive = async (vendor) => {
    try {
      await axiosInstance.patch(`/vendor-api/vendors/${vendor._id}`, { isActive: !vendor.isActive })
      load()
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to update vendor'))
    }
  }

  const columns = [
    { key: 'name', header: 'Name', render: (v) => <span className="font-medium text-slate-800">{v.name}</span> },
    { key: 'contact', header: 'Contact', className: 'hidden sm:table-cell', render: (v) => <span className="text-slate-500">{v.contactPerson}{v.email ? ` · ${v.email}` : ''}</span> },
    { key: 'servicesProvided', header: 'Services', className: 'hidden md:table-cell', render: (v) => <span className="text-slate-500">{v.servicesProvided}</span> },
    { key: 'isActive', header: 'Status', render: (v) => <ActiveBadge isActive={v.isActive} /> },
    { key: 'actions', header: '', render: (v) => (
      <div className="flex justify-end">
        <button className={v.isActive ? styles.btnLinkDanger : styles.btnLink} onClick={() => toggleActive(v)}>{v.isActive ? 'Deactivate' : 'Reactivate'}</button>
      </div>
    ) },
  ]

  return (
    <div className={styles.container}>
      <h1 className={styles.h1}>Vendors</h1>

      <div className={`${styles.card} mb-6`}>
        <h2 className={styles.h2}>Add vendor</h2>
        <form onSubmit={createVendor} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input className={styles.input} placeholder="Name" aria-label="Vendor name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className={styles.input} placeholder="Contact person" value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} />
          <input className={styles.input} placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input className={styles.input} placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <input className={styles.input + ' sm:col-span-2'} placeholder="Services provided" value={form.servicesProvided} onChange={(e) => setForm({ ...form, servicesProvided: e.target.value })} />
          <button className={styles.btnPrimary + ' sm:col-span-2'} disabled={creating} type="submit"><Plus className="h-4 w-4" aria-hidden="true" />{creating ? 'Adding…' : 'Add vendor'}</button>
        </form>
      </div>

      <div className={styles.card}>
        <DataTable columns={columns} rows={vendors} loading={loading}
          emptyTitle="No vendors yet" emptyHint="Add the companies you buy equipment and services from." emptyIcon={Truck} />
      </div>
    </div>
  )
}
