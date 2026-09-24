// simple counter-based public ID generator, e.g. TKT-2026-00001
// (toolkit-noted risk: can collide under heavy concurrency; keep the
// unique index on publicId and retry once on a duplicate-key error)
export const generateSequentialId = async (Model, prefix) => {
  const year = new Date().getFullYear()
  const count = await Model.countDocuments({ publicId: new RegExp(`^${prefix}-${year}-`) })
  const next = String(count + 1).padStart(5, '0')
  return `${prefix}-${year}-${next}`
}
