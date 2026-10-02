process.env.JWT_SECRET = 'test-secret'
process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://unused'
process.env.CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173'

import { test, describe, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { groqClient, DEFAULT_MODEL, resolveModel } from '../config/groq.js'
import { guessCategory, guessPriority } from '../utils/aiFallback.js'

describe('groqClient', () => {
  const realFetch = global.fetch
  const realKey = process.env.GROQ_API_KEY
  const realModel = process.env.GROQ_MODEL
  after(() => { global.fetch = realFetch; process.env.GROQ_API_KEY = realKey; process.env.GROQ_MODEL = realModel })

  test('isConfigured reflects GROQ_API_KEY', () => {
    delete process.env.GROQ_API_KEY
    assert.equal(groqClient.isConfigured(), false)
    process.env.GROQ_API_KEY = 'test-key'
    assert.equal(groqClient.isConfigured(), true)
  })

  test('chatCompletion throws (never calls fetch) when not configured', async () => {
    delete process.env.GROQ_API_KEY
    let called = false
    global.fetch = async () => { called = true; throw new Error('should not be called') }
    await assert.rejects(groqClient.chatCompletion({ system: 's', user: 'u' }), /not configured/)
    assert.equal(called, false)
  })

  describe('with a key configured', () => {
    beforeEach(() => { process.env.GROQ_API_KEY = 'test-key'; delete process.env.GROQ_MODEL; delete process.env.AI_MODEL })

    test('happy path: posts the right URL/headers/body shape and returns message content', async () => {
      let captured
      global.fetch = async (url, opts) => {
        captured = { url, opts }
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) }
      }
      const out = await groqClient.chatCompletion({ system: 'sys', user: 'usr', maxTokens: 50, temperature: 0.1 })
      assert.equal(out, '{"ok":true}')
      assert.equal(captured.url, 'https://api.groq.com/openai/v1/chat/completions')
      assert.equal(captured.opts.method, 'POST')
      assert.equal(captured.opts.headers['Authorization'], 'Bearer test-key')
      assert.equal(captured.opts.headers['Content-Type'], 'application/json')
      const body = JSON.parse(captured.opts.body)
      assert.equal(body.model, DEFAULT_MODEL)
      assert.deepEqual(body.messages, [{ role: 'system', content: 'sys' }, { role: 'user', content: 'usr' }])
      assert.equal(body.max_tokens, 450, 'gpt-oss models get headroom for their reasoning tokens')
      assert.equal(body.reasoning_effort, 'low')
      assert.equal(body.temperature, 0.1)
      // the key never leaks into the request body
      assert.ok(!captured.opts.body.includes('test-key'))
    })

    test('GROQ_MODEL env override is used when set', async () => {
      process.env.GROQ_MODEL = 'some-other-model'
      let body
      global.fetch = async (url, opts) => { body = JSON.parse(opts.body); return { ok: true, json: async () => ({ choices: [{ message: { content: 'x' } }] }) } }
      await groqClient.chatCompletion({ system: 's', user: 'u' })
      assert.equal(body.model, 'some-other-model')
    })

    test('AI_MODEL wins over the older GROQ_MODEL alias; a non-gpt-oss model gets no reasoning options or extra tokens', async () => {
      process.env.GROQ_MODEL = 'old-alias'; process.env.AI_MODEL = 'llama-something'
      let body
      global.fetch = async (url, opts) => { body = JSON.parse(opts.body); return { ok: true, json: async () => ({ choices: [{ message: { content: 'x' } }] }) } }
      await groqClient.chatCompletion({ system: 's', user: 'u', maxTokens: 123 })
      assert.equal(body.model, 'llama-something')
      assert.equal(body.max_tokens, 123)
      assert.equal(body.reasoning_effort, undefined)
      delete process.env.AI_MODEL
    })

    test('the default model is the current one, not the retired llama-3.1-8b-instant', () => {
      assert.equal(DEFAULT_MODEL, 'openai/gpt-oss-20b')
    })

    test('non-2xx response -> rejects with the status code, not a raw fetch error', async () => {
      global.fetch = async () => ({ ok: false, status: 401 })
      await assert.rejects(groqClient.chatCompletion({ system: 's', user: 'u' }), /HTTP 401/)
    })

    test('empty / missing content -> rejects rather than returning undefined', async () => {
      global.fetch = async () => ({ ok: true, json: async () => ({ choices: [] }) })
      await assert.rejects(groqClient.chatCompletion({ system: 's', user: 'u' }), /empty response/)
      global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 123 } }] }) })
      await assert.rejects(groqClient.chatCompletion({ system: 's', user: 'u' }), /empty response/)
    })

    test('fetch throwing (network error) propagates as a rejection, not an unhandled crash', async () => {
      global.fetch = async () => { throw new Error('getaddrinfo ENOTFOUND api.groq.com') }
      await assert.rejects(groqClient.chatCompletion({ system: 's', user: 'u' }), /ENOTFOUND/)
    })

    test('timeout: an abort surfaces as a clear timeout message, and the timer is cleared (no dangling handle)', async () => {
      global.fetch = async (url, opts) => new Promise((resolve, reject) => {
        opts.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e) })
      })
      const before = Date.now()
      await assert.rejects(groqClient.chatCompletion({ system: 's', user: 'u' }), /timed out/)
      assert.ok(Date.now() - before < 9000) // doesn't hang past the internal timeout
    })
  })
})

describe('resolveModel', () => {
  const realModel = process.env.GROQ_MODEL
  after(() => { process.env.GROQ_MODEL = realModel })
  test('falls back to DEFAULT_MODEL when GROQ_MODEL is unset, otherwise honours the override', () => {
    delete process.env.GROQ_MODEL
    assert.equal(resolveModel(), DEFAULT_MODEL)
    process.env.GROQ_MODEL = 'custom-model'
    assert.equal(resolveModel(), 'custom-model')
  })
  test('chatCompletion actually sends what resolveModel() resolves to', async () => {
    process.env.GROQ_API_KEY = 'k'
    process.env.GROQ_MODEL = 'custom-model-2'
    let body
    global.fetch = async (url, opts) => { body = JSON.parse(opts.body); return { ok: true, json: async () => ({ choices: [{ message: { content: 'x' } }] }) } }
    await groqClient.chatCompletion({ system: 's', user: 'u' })
    assert.equal(body.model, resolveModel())
    assert.equal(body.model, 'custom-model-2')
  })
})

describe('offline fallback heuristics', () => {
  const categories = [{ _id: 'c1', name: 'Hardware' }, { _id: 'c2', name: 'Network' }, { _id: 'c3', name: 'Software' }]

  test('guessCategory picks the category with the most word overlap', () => {
    assert.equal(guessCategory('my wifi network keeps dropping', categories)?.name, 'Network')
    assert.equal(guessCategory('laptop hardware is broken', categories)?.name, 'Hardware')
  })
  test('guessCategory returns null (no guess) when nothing overlaps at all', () => {
    assert.equal(guessCategory('completely unrelated request about parking', categories), null)
  })
  test('guessCategory is case-insensitive and ignores punctuation', () => {
    assert.equal(guessCategory('NETWORK!! outage, network down', categories)?.name, 'Network')
  })
  test('guessCategory handles empty/undefined text without throwing', () => {
    assert.equal(guessCategory('', categories), null)
    assert.equal(guessCategory(undefined, categories), null)
    assert.equal(guessCategory('wifi', []), null)
  })

  test('guessPriority flags urgent language as HIGH, otherwise MEDIUM', () => {
    assert.equal(guessPriority('this is urgent, please help'), 'HIGH')
    assert.equal(guessPriority('the printer is down'), 'HIGH')
    assert.equal(guessPriority('CRITICAL outage'), 'HIGH') // case-insensitive
    assert.equal(guessPriority('can I get a new monitor sometime'), 'MEDIUM')
    assert.equal(guessPriority(''), 'MEDIUM')
    assert.equal(guessPriority(undefined), 'MEDIUM')
  })
  test('guessPriority only ever returns a code from the list it was given', () => {
    assert.equal(guessPriority('urgent!!', ['P1', 'P2']), 'P2') // no HIGH/CRITICAL available -> last (most severe) one
    assert.equal(guessPriority('routine request', ['P1', 'P2']), 'P1') // no MEDIUM available -> first one
    assert.equal(guessPriority('urgent', ['LOW', 'HIGH']), 'HIGH')
    assert.equal(guessPriority('urgent', ['LOW', 'CRITICAL']), 'CRITICAL')
    assert.equal(guessPriority('routine', []), null)
  })
})
