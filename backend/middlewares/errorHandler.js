// one place that turns thrown errors into JSON responses
// client mistakes -> 4xx with a short message; anything else -> 500 without details
const fail = (res, status, error) => {
  //send res
  return res.status(status).json({ message: 'error occurred', error })
}

export const errorHandler = (err, req, res, next) => {
  // headers already sent: let express close the connection
  if (res.headersSent) return next(err)

  // body-parser: bad JSON / too-large body are client mistakes
  if (err.type === 'entity.parse.failed') return fail(res, 400, 'invalid JSON body')
  if (err.type === 'entity.too.large') return fail(res, 413, 'request body too large')

  // mongoose: unknown fields (strict mode), validation and cast problems
  if (err.name === 'StrictModeError') return fail(res, 400, 'request contains a field that is not allowed')
  if (err.name === 'ValidationError') return fail(res, 400, err.message)
  if (err.name === 'CastError') return fail(res, 400, 'invalid id')

  // duplicate key: say which field, never echo the value
  const errCode = err.code ?? err.cause?.code
  if (errCode === 11000) {
    const keyValue = err.keyValue ?? err.cause?.keyValue
    const field = keyValue ? Object.keys(keyValue)[0] : null
    return fail(res, 409, field ? `${field} already exists` : 'duplicate key error')
  }

  // errors that carry their own 4xx status (e.g. thrown on purpose)
  const status = Number.isInteger(err.status) ? err.status : err.statusCode
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return fail(res, status, err.expose === false ? 'request failed' : err.message || 'request failed')
  }

  // everything else is a server fault: log it, keep the response generic
  console.error(err)
  return fail(res, 500, 'server side error')
}
