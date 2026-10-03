// run several writes as one all-or-nothing unit
//
// MongoDB transactions need a replica set (Atlas always is one). A standalone
// mongod, FerretDB and some test servers cannot run them, so there the work
// runs without a session and the caller undoes its own earlier writes when a
// later one fails. work(session) receives the session, or null in that case.
//
// The work function returns { error } for a business failure (nothing is kept,
// the transaction is rolled back) or anything else for success.
import mongoose from 'mongoose'

class Rollback extends Error {
  constructor(result) {
    super('rollback')
    this.result = result
  }
}

// the ways a server says "I cannot do transactions". A standalone mongod answers IllegalOperation (code 20,
// "Transaction numbers are only allowed on a replica set member or mongos"), and the driver then wraps it in
// "This MongoDB deployment does not support retryable writes" with the first error kept inside originalError,
// so the code and the text are looked for at every level
export const transactionsUnsupported = (err) => {
  const levels = [err, err?.cause, err?.originalError, err?.errorResponse, err?.errorResponse?.originalError, err?.originalError?.errorResponse]
  return levels.some((e) => {
    if (!e) return false
    const code = e.code
    const message = String(e.message ?? e.errmsg ?? '')
    return code === 20 || code === 263 // IllegalOperation / OperationNotSupportedInTransaction
      || /Transaction numbers are only allowed on a replica set/i.test(message)
      || /does not support retryable writes/i.test(message)
      || /unknown field "?(autocommit|txnNumber|startTransaction|lsid)"?/i.test(message) // FerretDB
      || (/not supported|not implemented|unsupported/i.test(message) && /transaction|session/i.test(message))
  })
}

export const runAtomically = async (work) => {
  let session = null
  try {
    session = await mongoose.startSession()
  } catch {
    session = null
  }
  if (session) {
    try {
      let result
      await session.withTransaction(async () => {
        result = await work(session)
        if (result?.error) throw new Rollback(result)
      })
      return result
    } catch (err) {
      if (err instanceof Rollback) return err.result
      if (!transactionsUnsupported(err)) throw err
      // no transaction support here: fall through to the plain path below
    } finally {
      await session.endSession()
    }
  }
  return work(null)
}
