// The one write path for every status change (tickets, assets, KB articles).
// The update only matches while the document is still in an allowed status AND
// still at the version the client last saw, so two simultaneous requests can
// never both win:
//   findOneAndUpdate({ _id, status: { $in: from }, version }, { ..., $inc: { version: 1 } })
// A null result is re-read to explain why: 404 gone, 409 someone else changed
// it, 400 the status does not allow the action.
//
// Pass `session` to run the write inside a transaction (see runAtomically.js).
//
// Returns { doc } on success or { error: { status, message } }.
export const atomicTransition = async ({ Model, doc, action, noun, from, version, set = {}, unset = {}, push = {}, inc = {}, session }) => {
  const sessionOpt = session ? { session } : {}
  const update = { $inc: { version: 1, ...inc } }
  if (Object.keys(set).length) update.$set = set
  if (Object.keys(unset).length) update.$unset = unset
  if (Object.keys(push).length) update.$push = push

  const updated = await Model.findOneAndUpdate(
    { _id: doc._id, isDeleted: false, status: { $in: from }, version },
    update,
    { returnDocument: 'after', runValidators: true, ...sessionOpt },
  )
  if (updated) return { doc: updated }

  const current = await Model.findOne({ _id: doc._id }, null, sessionOpt).select('status version isDeleted')
  if (!current || current.isDeleted) return { error: { status: 404, message: `${noun} not found` } }
  // a stale version wins over a status mismatch: the caller is looking at old
  // data either way, and 409 tells the client to refresh
  if (current.version !== version) return { error: { status: 409, message: `${noun} was updated by someone else, please refresh` } }
  if (!from.includes(current.status)) return { error: { status: 400, message: `cannot ${action} a ${current.status} ${noun}` } }
  return { error: { status: 409, message: `${noun} was updated by someone else, please refresh` } }
}

// the version a client must send on every transition
export const isValidVersion = (version) => Number.isInteger(version) && version >= 0
export const VERSION_REQUIRED_MESSAGE = 'version is required (send the version from your last fetch)'
