import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { transactionsUnsupported } from '../utils/runAtomically.js'

describe('transactionsUnsupported', () => {
  test('recognises what a standalone mongod really answers (wrapped by the driver)', () => {
    const inner = Object.assign(new Error('Transaction numbers are only allowed on a replica set member or mongos'), { code: 20, codeName: 'IllegalOperation' })
    const outer = Object.assign(new Error('This MongoDB deployment does not support retryable writes. Please add retryWrites=false to your connection string.'), { originalError: inner, errorResponse: { message: 'x', originalError: inner } })
    assert.equal(transactionsUnsupported(outer), true)
    assert.equal(transactionsUnsupported(Object.assign(new Error('wrapped'), { originalError: inner })), true, 'found through originalError alone')
  })
  test('recognises the plain forms and FerretDB', () => {
    assert.equal(transactionsUnsupported(Object.assign(new Error('x'), { code: 20 })), true)
    assert.equal(transactionsUnsupported(new Error('Transaction numbers are only allowed on a replica set member or mongos')), true)
    assert.equal(transactionsUnsupported(new Error('findAndModify: unknown field "autocommit"')), true)
  })
  test('real failures are not mistaken for "no transactions"', () => {
    for (const err of [new Error('boom'), Object.assign(new Error('E11000 duplicate key'), { code: 11000 }), Object.assign(new Error('write conflict'), { code: 112 }), null, undefined]) {
      assert.equal(transactionsUnsupported(err), false)
    }
  })
})
