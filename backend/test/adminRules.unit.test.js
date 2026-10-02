// Pure admin input rules: no database, no HTTP.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeSkills, cleanText, validateBusinessHours, validateSlaHours, validateColor,
  normalizePriorityCode, normalizeDepartmentCode,
} from '../utils/adminRules.js'
import { passwordProblem } from '../utils/passwordRule.js'
import { escapeRegex, isObjectIdString, asBool } from '../utils/queryParams.js'

describe('skills', () => {
  test('lowercases, trims, collapses spaces and removes duplicates', () => {
    assert.deepEqual(normalizeSkills([' VPN ', 'vpn', 'Wi  Fi', 'C++']).skills, ['vpn', 'wi fi', 'c++'])
  })
  test('rejects non-lists, non-text entries, blanks, odd characters, long tags and too many tags', () => {
    for (const bad of ['vpn', null, { 0: 'a' }, [1], [''], ['  '], ['<script>'], ['.net'], ['x'.repeat(31)], [['a']]]) {
      assert.ok(normalizeSkills(bad).error, JSON.stringify(bad))
    }
    assert.ok(normalizeSkills(Array.from({ length: 16 }, (_, i) => `s${i}`)).error)
    assert.equal(normalizeSkills(Array.from({ length: 15 }, (_, i) => `s${i}`)).skills.length, 15)
    assert.deepEqual(normalizeSkills([]).skills, [])
  })
})

describe('cleanText', () => {
  test('trims and enforces the range', () => {
    assert.equal(cleanText('  Hello ', 'x', { min: 1, max: 10 }).value, 'Hello')
    assert.ok(cleanText('', 'x', { min: 1 }).error)
    assert.ok(cleanText('a'.repeat(11), 'x', { max: 10 }).error)
    assert.ok(cleanText(5, 'x').error)
    assert.ok(cleanText({ $ne: 1 }, 'x').error)
    assert.ok(cleanText(undefined, 'x').error)
    assert.equal(cleanText(undefined, 'x', { required: false }).value, undefined)
    assert.equal(cleanText('', 'x', { min: 0, required: false }).value, '')
  })
})

describe('business hours', () => {
  const current = { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' }
  test('accepts a valid change and sorts/dedupes the days', () => {
    assert.deepEqual(validateBusinessHours({ days: [5, 1, 1, 3], start: '08:30', end: '17:45' }, current).value, { days: [1, 3, 5], start: '08:30', end: '17:45' })
    assert.deepEqual(validateBusinessHours({}, current).value, current)
  })
  test('rejects what would break the SLA clock', () => {
    for (const bad of [
      { days: [] }, { days: [7] }, { days: [-1] }, { days: [1.5] }, { days: 'mon' }, { days: ['1'] },
      { start: '9:00' }, { start: '25:00' }, { end: '18:60' }, { start: 900 },
      { start: '18:00' }, { end: '09:00' }, { start: '10:00', end: '10:00' },
    ]) {
      assert.ok(validateBusinessHours(bad, current).error, JSON.stringify(bad))
    }
    assert.ok(validateBusinessHours(null, current).error)
    assert.ok(validateBusinessHours([1], current).error)
  })
  test('does not change the stored object it was given', () => {
    validateBusinessHours({ days: [6] }, current)
    assert.deepEqual(current.days, [1, 2, 3, 4, 5])
  })
})

describe('sla hours and codes', () => {
  test('hours must be positive finite numbers and resolution >= response', () => {
    assert.ok(validateSlaHours(1, 4).value)
    assert.ok(validateSlaHours(4, 4).value)
    for (const [a, b] of [[0, 4], [-1, 4], [1, 0], [5, 4], ['1', 4], [1, '4'], [NaN, 4], [1, Infinity], [1, 9000], [null, 4]]) {
      assert.ok(validateSlaHours(a, b).error, `${a} ${b}`)
    }
  })
  test('color, priority code, department code', () => {
    assert.ok(validateColor('#aabbcc').value)
    for (const bad of ['red', '#abc', '#gggggg', 5, null]) assert.ok(validateColor(bad).error)
    assert.equal(normalizePriorityCode(' urgent_1 ').value, 'URGENT_1')
    for (const bad of ['1ABC', 'A', 'has space', 'x'.repeat(21), 5, '']) assert.ok(normalizePriorityCode(bad).error, String(bad))
    assert.equal(normalizeDepartmentCode(' hr ').value, 'HR')
    for (const bad of ['H', 'toolongcode', 'a b', 5, '']) assert.ok(normalizeDepartmentCode(bad).error, String(bad))
  })
})

describe('password rule and query helpers', () => {
  test('12-72 characters, text only', () => {
    assert.equal(passwordProblem('a'.repeat(12)), null)
    assert.equal(passwordProblem('a'.repeat(72)), null)
    for (const bad of ['a'.repeat(11), 'a'.repeat(73), '', 12345678901234, null, undefined, ['a'.repeat(12)]]) assert.ok(passwordProblem(bad), String(bad))
  })
  test('escapeRegex neutralises pattern characters; id and bool parsing is strict', () => {
    const rx = new RegExp(escapeRegex('a.b*(c)[d]+?$^|\\'), 'i')
    assert.ok(rx.test('a.b*(c)[d]+?$^|\\'))
    assert.ok(!rx.test('axb'))
    assert.equal(isObjectIdString('64b000000000000000000000'), true)
    for (const bad of ['abc', '64b00000000000000000000g', 5, null, ['64b000000000000000000000']]) assert.equal(isObjectIdString(bad), false)
    assert.equal(asBool('true'), true); assert.equal(asBool('false'), false)
    for (const bad of ['yes', '', undefined, ['true']]) assert.equal(asBool(bad), undefined)
  })
})
