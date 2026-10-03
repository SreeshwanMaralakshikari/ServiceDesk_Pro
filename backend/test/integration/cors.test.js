// the Vite dev origins are only allowed outside production
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import { bootApp } from '../../testkit/boot.js'

describe('CORS origins (production build of the app)', () => {
  let ctx
  before(async () => { ctx = await bootApp({ NODE_ENV: 'production', CLIENT_URL: 'https://app.example.test' }, { fixtures: false }) })
  after(() => ctx.stop())

  const allowed = async (origin) => (await request(ctx.app).get('/health').set('Origin', origin)).headers['access-control-allow-origin']

  test('the real client origin is allowed', async () => {
    assert.equal(await allowed('https://app.example.test'), 'https://app.example.test')
  })
  test('localhost dev origins are not allowed in production', async () => {
    assert.equal(await allowed('http://localhost:5173'), undefined)
    assert.equal(await allowed('http://localhost:5174'), undefined)
  })
  test('an unknown origin is not allowed', async () => {
    assert.equal(await allowed('https://evil.example'), undefined)
  })
})
