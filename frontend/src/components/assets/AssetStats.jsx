import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useFetch } from '../../hooks/useFetch.js'
import { Spinner } from '../common/Spinner.jsx'
import { StatCard, ChartCard, SimpleTable, BarList } from '../common/charts/index.js'
import { styles } from '../../styles/common.js'
import { getErrorMessage } from '../../utils/errors.js'
import { downloadCsv } from '../reports/downloadCsv.js'

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`

export const AssetStats = () => {
  const { data, loading, error } = useFetch('/asset-api/stats')
  const [busy, setBusy] = useState(false)

  const exportCsv = async () => {
    setBusy(true)
    try {
      const { rows } = await downloadCsv('/report-api/assets.csv', {}, 'assets.csv')
      toast.success(`Downloaded ${rows} assets`)
    } catch (err) {
      toast.error(getErrorMessage(err, 'Download failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.containerWide}>
      <div className="flex items-center justify-between mb-4">
        <h1 className={styles.h1 + ' mb-0'}>Asset overview</h1>
        <div className="flex gap-2">
          <Link to="/assets" className={styles.btnSecondary}>Asset list</Link>
          <button className={styles.btnPrimary} onClick={exportCsv} disabled={busy}>{busy ? 'Preparing…' : 'Download CSV'}</button>
        </div>
      </div>
      {loading && <Spinner />}
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Total assets" value={data.total} />
            <StatCard label="Warranty ending soon" icon="◔" tone={data.warranty.expiringSoon ? 'warn' : 'neutral'} value={data.warranty.expiringSoon} hint={`within ${data.warranty.windowDays} days`} />
            <StatCard label="Warranty expired" icon="⚠" tone={data.warranty.expired ? 'bad' : 'neutral'} value={data.warranty.expired} hint="not retired" />
            <StatCard label="Purchase value" value={money(data.cost.purchaseTotal)} hint={`maintenance ${money(data.cost.maintenanceTotal)} (${data.cost.maintenanceEntries} entries)`} />
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <ChartCard title="By status"
              chart={<BarList items={data.byStatus.map((s) => ({ label: s.status.replace('_', ' '), value: s.count, hint: `${s.count} ${s.status}` }))} />}
              table={<SimpleTable columns={[{ key: 'status', header: 'Status' }, { key: 'count', header: 'Assets', align: 'right' }]} rows={data.byStatus} />} />
            <ChartCard title="By class"
              chart={<BarList items={data.byClass.map((c) => ({ label: c.assetClass, value: c.count, hint: `${c.count} ${c.assetClass}` }))} />}
              table={<SimpleTable columns={[{ key: 'assetClass', header: 'Class' }, { key: 'count', header: 'Assets', align: 'right' }]} rows={data.byClass} />} />
          </div>
          <section className={styles.card}>
            <h2 className={styles.h2}>By vendor</h2>
            <SimpleTable
              columns={[
                { key: 'name', header: 'Vendor' },
                { key: 'count', header: 'Assets', align: 'right' },
                { key: 'purchaseTotal', header: 'Purchase value', align: 'right', render: (r) => money(r.purchaseTotal) },
                { key: 'maintenanceTotal', header: 'Maintenance', align: 'right', render: (r) => money(r.maintenanceTotal) },
              ]}
              rows={data.byVendor} />
            {data.byVendor.length === 0 && <p className="text-sm text-slate-400 py-2">No assets with a vendor yet</p>}
          </section>
        </div>
      )}
    </div>
  )
}
