// error handler maps thrown errors to the right status without leaking details
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { errorHandler } from '../middlewares/errorHandler.js'

const run = (err, headersSent = false) => {
  const out = { status: null, body: null, nextCalled: false }
  const res = {
    headersSent,
    status(code) { out.status = code; return this },
    json(body) { out.body = body; return this },
  }
  const origError = console.error
  let logged = 0
  console.error = () => { logged += 1 }
  try { errorHandler(err, {}, res, () => { out.nextCalled = true }) } finally { console.error = origError }
  return { ...out, logged }
}
const named = (name, extra = {}) => Object.assign(new Error('boom'), { name }, extra)

describe('errorHandler', () => {
  test('malformed JSON and oversize body are client errors', () => {
    assert.equal(run(named('SyntaxError', { type: 'entity.parse.failed' })).status, 400)
    assert.equal(run(named('PayloadTooLargeError', { type: 'entity.too.large' })).status, 413)
  })
  test('mongoose strict, validation and cast errors are 400 and are not logged as faults', () => {
    for (const name of ['StrictModeError', 'ValidationError', 'CastError']) {
      const r = run(named(name))
      assert.equal(r.status, 400, name)
      assert.equal(r.logged, 0, name)
    }
  })
  test('duplicate key is 409 and never echoes the value', () => {
    const r = run(named('MongoServerError', { code: 11000, keyValue: { email: 'secret@example.com' } }))
    assert.equal(r.status, 409)
    assert.equal(r.body.error, 'email already exists')
    assert.ok(!JSON.stringify(r.body).includes('secret@example.com'))
    assert.equal(run(named('MongoServerError', { code: 11000 })).body.error, 'duplicate key error')
  })
  test('honours a 4xx err.status, ignores a 5xx or non-integer one', () => {
    assert.equal(run(named('HttpError', { status: 415 })).status, 415)
    assert.equal(run(named('HttpError', { status: 503 })).status, 500)
    assert.equal(run(named('HttpError', { status: 'teapot' })).status, 500)
  })
  test('unknown errors are 500, generic text, and logged', () => {
    const r = run(new Error('db password is hunter2'))
    assert.equal(r.status, 500)
    assert.equal(r.body.error, 'server side error')
    assert.equal(r.logged, 1)
  })
  test('hands over to express when headers are already sent', () => {
    const r = run(new Error('late'), true)
    assert.equal(r.nextCalled, true)
    assert.equal(r.status, null)
  })
})
