process.env.JWT_SECRET = 'test-secret'
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parseModelJson, hashInput } from '../utils/aiJson.js'

describe('parseModelJson', () => {
  test('plain JSON', () => assert.deepEqual(parseModelJson('{"a":1}'), { a: 1 }))
  test('```json fenced and bare ``` fenced', () => {
    assert.deepEqual(parseModelJson('```json\n{"a":1}\n```'), { a: 1 })
    assert.deepEqual(parseModelJson('```\n{"a":[1,2]}\n```'), { a: [1, 2] })
    assert.deepEqual(parseModelJson('  ```JSON {"a":1} ```  '), { a: 1 })
  })
  test('a sentence around the object is ignored', () => {
    assert.deepEqual(parseModelJson('Sure! Here you go: {"a":{"b":2}} Hope that helps.'), { a: { b: 2 } })
  })
  test('no JSON at all, broken JSON, or non-text -> throws', () => {
    assert.throws(() => parseModelJson('no json here'), /not valid JSON/)
    assert.throws(() => parseModelJson('{"a":'), /JSON/)
    assert.throws(() => parseModelJson(undefined), /not text/)
    assert.throws(() => parseModelJson(42), /not text/)
  })
})

describe('hashInput', () => {
  test('case and whitespace do not change the hash, content does', () => {
    assert.equal(hashInput('m', 'Wifi   is DOWN'), hashInput('m', ' wifi is down '))
    assert.notEqual(hashInput('m', 'wifi is down'), hashInput('m', 'wifi is up'))
  })
  test('the model (or anything else passed) is part of the hash and parts cannot blur together', () => {
    assert.notEqual(hashInput('a', 'x'), hashInput('b', 'x'))
    assert.notEqual(hashInput('ab', 'c'), hashInput('a', 'bc'))
    assert.match(hashInput('a'), /^[0-9a-f]{64}$/)
  })
})
