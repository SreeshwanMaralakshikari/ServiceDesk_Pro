// public id year: read on the app's own (IST) clock, not the server's (UTC on Render)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { yearInAppZone } from '../utils/generateSequentialId.js'

test('yearInAppZone: 1 Jan 00:30 IST is still 31 Dec 19:00 UTC, but belongs to the new year', () => {
  assert.equal(yearInAppZone(new Date('2026-12-31T19:00:00Z')), 2027)
})

test('yearInAppZone: just before IST midnight stays in the old year', () => {
  assert.equal(yearInAppZone(new Date('2026-12-31T18:29:59Z')), 2026)
})

test('yearInAppZone: an ordinary mid-year date is unchanged, and no argument means now', () => {
  assert.equal(yearInAppZone(new Date('2026-06-15T10:00:00Z')), 2026)
  assert.equal(typeof yearInAppZone(), 'number')
})
