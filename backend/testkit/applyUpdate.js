// minimal MongoDB update-operator applier for the stubbed (no database)
// tests: $set / $unset with dotted paths, $push, $pop, $inc
const walk = (doc, path, create) => {
  const keys = path.split('.')
  let target = doc
  for (const key of keys.slice(0, -1)) {
    if (target[key] === undefined || target[key] === null) {
      if (!create) return [null, null]
      target[key] = {}
    }
    target = target[key]
  }
  return [target, keys[keys.length - 1]]
}

export const applyUpdate = (doc, update) => {
  for (const [path, value] of Object.entries(update.$set ?? {})) { const [t, k] = walk(doc, path, true); t[k] = value }
  for (const path of Object.keys(update.$unset ?? {})) { const [t, k] = walk(doc, path, false); if (t) delete t[k] }
  for (const [path, value] of Object.entries(update.$push ?? {})) { const [t, k] = walk(doc, path, true); t[k] = [...(t[k] ?? []), value] }
  for (const [path, n] of Object.entries(update.$pop ?? {})) { const [t, k] = walk(doc, path, false); if (t) (n === 1 ? t[k].pop() : t[k].shift()) }
  for (const [path, n] of Object.entries(update.$inc ?? {})) { const [t, k] = walk(doc, path, true); t[k] = (t[k] ?? 0) + n }
  return doc
}
