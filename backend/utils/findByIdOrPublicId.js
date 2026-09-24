import { isValidObjectId } from 'mongoose'

// builds a query that accepts either a Mongo _id or a public ID
// (e.g. "TKT-2026-00001") without ever handing an invalid string to the
// _id cast — that throws a CastError before $or gets a chance to fall
// back to publicId.
export const idOrPublicIdFilter = (idParam) => {
  if (isValidObjectId(idParam)) {
    return { $or: [{ _id: idParam }, { publicId: idParam }] }
  }
  return { publicId: idParam }
}
