import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { addBusinessHours, businessMsBetween, DEFAULT_BUSINESS_HOURS } from '../utils/businessHours.js'

// All dates below are given as plain UTC Date objects representing a
// specific IST wall-clock moment: IST = UTC + 5:30, so "Friday 17:30 IST"
// is written as the UTC instant that shifts to that wall-clock time.
const ist = (y, m, d, h, min = 0) => new Date(Date.UTC(y, m - 1, d, h - 5, min - 30))

describe('addBusinessHours', () => {
  test('created Friday 17:30 IST, +2h rolls into Monday morning', () => {
    // 2026-01-02 is a Friday
    const start = ist(2026, 1, 2, 17, 30)
    const due = addBusinessHours(start, 2, DEFAULT_BUSINESS_HOURS)
    // 30 min left in Friday's window (until 18:00) + 1.5h into Monday from 09:00 -> 10:30 IST Monday 2026-01-05
    const expected = ist(2026, 1, 5, 10, 30)
    assert.equal(due.getTime(), expected.getTime())
  })

  test('created on a Sunday rolls forward to Monday 09:00 IST before counting', () => {
    // 2026-01-04 is a Sunday
    const start = ist(2026, 1, 4, 12, 0)
    const due = addBusinessHours(start, 1, DEFAULT_BUSINESS_HOURS)
    const expected = ist(2026, 1, 5, 10, 0) // Monday 09:00 + 1h
    assert.equal(due.getTime(), expected.getTime())
  })

  test('created before 09:00 IST clamps forward to 09:00 the same business day', () => {
    // 2026-01-05 is a Monday
    const start = ist(2026, 1, 5, 6, 0)
    const due = addBusinessHours(start, 1, DEFAULT_BUSINESS_HOURS)
    const expected = ist(2026, 1, 5, 10, 0)
    assert.equal(due.getTime(), expected.getTime())
  })

  test('a multi-day span correctly skips the weekend entirely', () => {
    // Friday 09:00 + 27 business hours = exactly 3 full 9h days: Fri + Mon + Tue
    const start = ist(2026, 1, 2, 9, 0)
    const due = addBusinessHours(start, 27, DEFAULT_BUSINESS_HOURS)
    const expected = ist(2026, 1, 6, 18, 0) // Tuesday, end of business day — weekend skipped
    assert.equal(due.getTime(), expected.getTime())
  })

  test('businessHoursOnly:false policies are handled by the caller, not this function — 0 hours is a no-op', () => {
    const start = ist(2026, 1, 2, 17, 30)
    const due = addBusinessHours(start, 0, DEFAULT_BUSINESS_HOURS)
    assert.equal(due.getTime(), start.getTime())
  })
})

describe('businessMsBetween', () => {
  test('a pause spanning a weekend counts only the business-hours portion', () => {
    // paused Friday 17:00 IST, resumed Monday 10:00 IST
    const pausedAt = ist(2026, 1, 2, 17, 0)
    const resumedAt = ist(2026, 1, 5, 10, 0)
    const ms = businessMsBetween(pausedAt, resumedAt, DEFAULT_BUSINESS_HOURS)
    // Friday 17:00-18:00 (1h) + Monday 09:00-10:00 (1h) = 2 business hours; weekend contributes 0
    assert.equal(ms, 2 * 3600 * 1000)
  })

  test('a same-day pause within business hours counts exactly the wall-clock gap', () => {
    const pausedAt = ist(2026, 1, 5, 11, 0)
    const resumedAt = ist(2026, 1, 5, 13, 30)
    const ms = businessMsBetween(pausedAt, resumedAt, DEFAULT_BUSINESS_HOURS)
    assert.equal(ms, 2.5 * 3600 * 1000)
  })

  test('end before start returns 0', () => {
    const a = ist(2026, 1, 5, 13, 0)
    const b = ist(2026, 1, 5, 11, 0)
    assert.equal(businessMsBetween(a, b, DEFAULT_BUSINESS_HOURS), 0)
  })
})
