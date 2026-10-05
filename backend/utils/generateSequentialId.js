// public IDs such as TKT-2026-00001, one counter per PREFIX-YEAR
//
// The number comes from an atomic $inc on a counter row, so two simultaneous
// requests can never get the same number, and deleting a record never makes a
// number come back (the old version counted existing rows, which did both).
//
// Migration is automatic: the first time a counter is needed it starts from
// the highest number already used by that prefix and year, so existing data
// keeps counting without gaps or repeats. The unique index on publicId stays as
// a safety net.
import { CounterModel } from '../models/CounterModel.js'
import { APP_UTC_OFFSET_MINUTES } from './timezone.js'

const PAD = 5

// highest number already in use for this prefix and year (0 when none)
const highestUsed = async (Model, prefix, year) => {
  const lead = `${prefix}-${year}-`
  const rows = await Model.find({ publicId: new RegExp(`^${lead}\\d+$`) }).select('publicId').lean()
  let max = 0
  for (const row of rows) {
    const n = Number.parseInt(row.publicId.slice(lead.length), 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return max
}

const bump = (key) => CounterModel.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { returnDocument: 'after' })

// the year as the app's own clock (IST) reads it, not the server's: Render runs in UTC, which is still
// last year for the first 5h30 of 1 January in India
export const yearInAppZone = (date = new Date()) => new Date(date.getTime() + APP_UTC_OFFSET_MINUTES * 60 * 1000).getUTCFullYear()

export const generateSequentialId = async (Model, prefix) => {
  const year = yearInAppZone()
  const key = `${prefix}-${year}`

  let counter = await bump(key)
  if (!counter) {
    // first use of this counter: start it at the highest number in the data
    // $setOnInsert means a second request that gets here at the same time cannot overwrite the first
    const start = await highestUsed(Model, prefix, year)
    try {
      await CounterModel.updateOne({ _id: key }, { $setOnInsert: { seq: start } }, { upsert: true })
    } catch (err) {
      // the other request created it first: that is fine, carry on and bump it
      if ((err.code ?? err.cause?.code) !== 11000) throw err
    }
    counter = await bump(key)
  }
  return `${key}-${String(counter.seq).padStart(PAD, '0')}`
}
