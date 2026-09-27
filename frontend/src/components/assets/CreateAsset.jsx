import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { axiosInstance } from '../../axiosInstance.js'
import { styles } from '../../styles/common.js'

export const CreateAsset = () => {
  const [vendors, setVendors] = useState([])
  const [form, setForm] = useState({
    name: '', type: 'HARDWARE', assetClass: '', serialNumber: '', licenseKey: '',
    vendor: '', purchaseDate: '', purchaseCost: '', warrantyExpiry: '', location: '',
  })
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    axiosInstance.get('/vendor-api/vendors').then(({ data }) => setVendors(data.payload)).catch(() => {})
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const { data } = await axiosInstance.post('/asset-api/assets', form)
      toast.success(`Asset ${data.payload.publicId} created`)
      navigate(`/assets/${data.payload.publicId}`)
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create asset')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.container}>
      <div className={`${styles.card} max-w-lg mx-auto`}>
        <h1 className={styles.h1}>New asset</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={styles.label}>Name</label>
            <input className={styles.input} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={styles.label}>Type</label>
              <select className={styles.select} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="HARDWARE">Hardware</option>
                <option value="SOFTWARE">Software</option>
              </select>
            </div>
            <div>
              <label className={styles.label}>Class</label>
              <input className={styles.input} placeholder="Laptop, Monitor, License…" required value={form.assetClass} onChange={(e) => setForm({ ...form, assetClass: e.target.value })} />
            </div>
          </div>
          {form.type === 'HARDWARE' ? (
            <div>
              <label className={styles.label}>Serial number</label>
              <input className={styles.input} value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} />
            </div>
          ) : (
            <div>
              <label className={styles.label}>License key</label>
              <input className={styles.input} value={form.licenseKey} onChange={(e) => setForm({ ...form, licenseKey: e.target.value })} />
            </div>
          )}
          <div>
            <label className={styles.label}>Vendor</label>
            <select className={styles.select} value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })}>
              <option value="">None</option>
              {vendors.map((v) => <option key={v._id} value={v._id}>{v.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={styles.label}>Purchase date</label>
              <input className={styles.input} type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} />
            </div>
            <div>
              <label className={styles.label}>Cost</label>
              <input className={styles.input} type="number" min="0" value={form.purchaseCost} onChange={(e) => setForm({ ...form, purchaseCost: e.target.value })} />
            </div>
          </div>
          <div>
            <label className={styles.label}>Warranty expiry</label>
            <input className={styles.input} type="date" value={form.warrantyExpiry} onChange={(e) => setForm({ ...form, warrantyExpiry: e.target.value })} />
          </div>
          <div>
            <label className={styles.label}>Location</label>
            <input className={styles.input} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          </div>
          <button className={styles.btnPrimary} disabled={loading} type="submit">
            {loading ? 'Creating…' : 'Create asset'}
          </button>
        </form>
      </div>
    </div>
  )
}
