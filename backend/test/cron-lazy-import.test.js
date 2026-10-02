// Regression test for a real bug found during error-checking: server.js
// statically imported jobs/slaChecker.js and jobs/warrantyChecker.js, and
// both of those statically imported 'node-cron' at the top of the file. A
// static ES module import is resolved before ANY of that module's code runs,
// so on a machine where `npm install` hasn't pulled in node-cron, simply
// running `node server.js` crashed with ERR_MODULE_NOT_FOUND before binding
// to a port — every route, not just the cron jobs, was unreachable.
//
// This test simulates node-cron being genuinely UNRESOLVABLE — unlike the
// other integration tests' loader hook, which provides a working fake so the
// cron *schedules* without hitting the network, this one makes resolution
// itself fail, the same error Node throws when a package truly isn't
// installed. `node --test` runs each test file in its own process, so this
// hook can't affect (or be affected by) the different node-cron hook the
// other integration test files register.
process.env.JWT_SECRET = 'x'
process.env.MONGO_URI = 'mongodb://unused'
process.env.CLIENT_URL = 'http://x'
process.env.SEED_ON_START = 'false'
process.env.PORT = '0'

import { createRequire, register } from 'node:module'
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// mongoose must be require()'d and patched at module TOP LEVEL, before
// anything else in this file (including the earlier tests below, which
// import jobs/slaChecker.js -> models/TicketModel.js -> mongoose) triggers
// the CJS-to-ESM wrapping of the 'mongoose' package. That wrapping appears to
// snapshot named exports like `connect` once; patching mongoose.connect
// AFTER something has already imported from it via `import ... from
// 'mongoose'` was observed NOT to take effect on later `import { connect }`
// statements (server.js's own) — moving the patch here, before any import()
// call anywhere in this file, fixed it. See the same ordering in
// kb.integration.test.js / ai.integration.test.js.
const require = createRequire(import.meta.url)
const mongoose = require('mongoose')
mongoose.connect = async () => mongoose
Object.getPrototypeOf(mongoose).connect = async () => mongoose

register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(specifier, context, next) {
    if (specifier === 'node-cron') {
      const err = new Error("Cannot find package 'node-cron' imported from jobs/")
      err.code = 'ERR_MODULE_NOT_FOUND'
      throw err
    }
    return next(specifier, context)
  }
`))

const captureLogs = async (fn) => {
  const logs = []
  const realLog = console.log
  console.log = (...args) => logs.push(args.join(' '))
  try {
    await fn()
  } finally {
    console.log = realLog
  }
  return logs
}

describe('graceful degradation when node-cron cannot be resolved at all', () => {
  test('startSlaChecker resolves (never throws) and logs that the cron is disabled', async () => {
    const { startSlaChecker } = await import('../jobs/slaChecker.js')
    const logs = await captureLogs(() => assert.doesNotReject(startSlaChecker()))
    assert.ok(logs.some((l) => l.includes('SLA checker disabled') && l.includes('node-cron is not installed')), logs.join('\n'))
  })

  test('startWarrantyChecker resolves (never throws) and logs that the cron is disabled', async () => {
    const { startWarrantyChecker } = await import('../jobs/warrantyChecker.js')
    const logs = await captureLogs(() => assert.doesNotReject(startWarrantyChecker()))
    assert.ok(logs.some((l) => l.includes('Warranty checker disabled') && l.includes('node-cron is not installed')), logs.join('\n'))
  })

  test('the real server.js still boots and starts listening — this exact scenario used to crash it', async () => {
    const express = require('express')
    let serverRef
    const realListen = express.application.listen
    express.application.listen = function (_port, cb) { serverRef = realListen.call(this, 0, cb); return serverRef }

    await assert.doesNotReject(import('../server.js'))
    for (let i = 0; i < 100 && !serverRef?.listening; i++) await new Promise((r) => setTimeout(r, 20))
    assert.ok(serverRef?.listening, 'server.js did not start listening')
    serverRef.close()
  })
})
