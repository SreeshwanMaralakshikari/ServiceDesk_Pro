import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { durationToMs, tokenIsStale } from '../utils/sessionRules.js'

describe('durationToMs (cookie lifetime follows JWT_EXPIRES_IN)', () => {
  test('reads the formats jsonwebtoken accepts', () => {
    assert.equal(durationToMs('1d'), 86400000)
    assert.equal(durationToMs('12h'), 43200000)
    assert.equal(durationToMs('30m'), 1800000)
    assert.equal(durationToMs('45s'), 45000)
    assert.equal(durationToMs('1w'), 604800000)
    assert.equal(durationToMs('3600'), 3600000, 'a bare number is seconds')
    assert.equal(durationToMs(7200), 7200000)
    assert.equal(durationToMs(' 2H '), 7200000)
  })
  test('falls back to one day for anything unreadable or not positive', () => {
    for (const v of [undefined, null, '', 'abc', '-5', '0', '1.5h', '1 day', {}]) assert.equal(durationToMs(v), 86400000, String(v))
  })
})

describe('tokenIsStale (password change signs out older sessions)', () => {
  const changed = new Date('2026-10-03T10:00:30.500Z')
  const sec = (iso) => Math.floor(new Date(iso).getTime() / 1000)
  test('never changed -> never stale', () => {
    assert.equal(tokenIsStale(sec('2020-01-01T00:00:00Z'), undefined), false)
    assert.equal(tokenIsStale(undefined, null), false)
  })
  test('issued before the change is stale, same second or later is valid', () => {
    assert.equal(tokenIsStale(sec('2026-10-03T10:00:29Z'), changed), true)
    assert.equal(tokenIsStale(sec('2026-10-03T10:00:30Z'), changed), false, 'same second')
    assert.equal(tokenIsStale(sec('2026-10-03T10:05:00Z'), changed), false)
  })
  test('a token without a usable issue time is stale once the password has changed', () => {
    assert.equal(tokenIsStale(undefined, changed), true)
    assert.equal(tokenIsStale(NaN, changed), true)
  })
  test('an unreadable change date is ignored rather than locking everyone out', () => {
    assert.equal(tokenIsStale(1, 'not a date'), false)
  })
})
