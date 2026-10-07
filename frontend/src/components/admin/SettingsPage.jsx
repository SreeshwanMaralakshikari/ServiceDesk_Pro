import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import { axiosInstance } from '../../axiosInstance.js'
import { useFetch } from '../../hooks/useFetch.js'
import { getErrorMessage } from '../../utils/errors.js'
import { PageSkeleton } from '../common/Skeleton.jsx'
import { ErrorState } from '../common/ErrorState.jsx'
import { Field } from '../common/Field.jsx'
import { styles } from '../../styles/common.js'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const SettingsPage = () => {
  const { data, loading, error, reload } = useFetch('/admin-api/org-settings')
  const { register, handleSubmit, reset, getValues, formState: { errors, isSubmitting } } = useForm({
    defaultValues: { orgName: '', days: [], start: '09:00', end: '18:00' },
  })
  const [serverError, setServerError] = useState('')

  useEffect(() => {
    if (data) reset({ orgName: data.orgName, days: data.businessHours.days.map(String), start: data.businessHours.start, end: data.businessHours.end })
  }, [data, reset])

  if (loading && !data) return <PageSkeleton />
  if (error) return <div className={styles.card}><ErrorState message={error} onRetry={reload} /></div>

  const submit = async (values) => {
    setServerError('')
    try {
      await axiosInstance.put('/admin-api/org-settings', {
        orgName: values.orgName.trim(),
        businessHours: { days: values.days.map(Number), start: values.start, end: values.end },
      })
      toast.success('Settings saved')
      reload()
    } catch (err) {
      setServerError(getErrorMessage(err))
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)} className={styles.card + ' max-w-xl'} noValidate>
      <h2 className={styles.h2}>Organisation and business hours</h2>
      <p className="text-sm text-slate-500 mb-4">SLA clocks only count time inside these hours (India Standard Time, UTC+05:30). New hours apply to tickets whose clock starts after you save; existing due dates are not recalculated.</p>
      <Field label="Organisation name" error={errors.orgName}><input className={styles.input} {...register('orgName', { required: 'Name is required', maxLength: { value: 80, message: 'At most 80 characters' } })} /></Field>
      <fieldset className="mb-3">
        <legend className={styles.label}>Working days</legend>
        <div className="flex flex-wrap gap-3">
          {DAYS.map((day, i) => (
            <label key={day} className="flex items-center gap-1 text-sm text-slate-700">
              <input type="checkbox" className={styles.checkbox} value={String(i)} {...register('days', { validate: (v) => (Array.isArray(v) && v.length > 0) || 'Pick at least one day' })} />
              {day}
            </label>
          ))}
        </div>
        {errors.days && <span className={styles.fieldError} role="alert">{errors.days.message}</span>}
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Opens" error={errors.start}><input className={styles.input} type="time" {...register('start', { required: 'Required' })} /></Field>
        <Field label="Closes" error={errors.end}>
          <input className={styles.input} type="time" {...register('end', { required: 'Required', validate: (v) => v > getValues('start') || 'Must be after opening time' })} />
        </Field>
      </div>
      {serverError && <p className="text-sm text-red-600 mb-2" role="alert">{serverError}</p>}
      <button type="submit" className={styles.btnPrimary} disabled={isSubmitting}>{isSubmitting ? 'Saving…' : 'Save settings'}</button>
    </form>
  )
}
