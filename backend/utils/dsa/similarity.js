import { topK } from './MinHeap.js'

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are', 'was', 'were', 'be', 'it', 'this', 'that', 'my', 'me', 'i', 'we', 'our', 'you', 'your', 'not', 'no', 'cannot', 'cant', 'can', 'has', 'have', 'had', 'from', 'at', 'by', 'as', 'but', 'please', 'help', 'issue', 'problem', 'when', 'after', 'since', 'again', 'still', 'just', 'now', 'get', 'getting', 'gets', 'its', 'if', 'so', 'do', 'does', 'did'])

// light stemming: plural s and a few common endings, only on longer words
const stem = (w) => {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3)
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2)
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y'
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

// text -> Set of lowercase stemmed tokens without stop words
export const tokenize = (text) => {
  const out = new Set()
  for (const raw of String(text || '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || STOP.has(raw)) continue
    out.add(stem(raw))
  }
  return out
}

// |A and B| / |A or B|, 0 when both are empty
export const jaccard = (a, b) => {
  if (a.size === 0 && b.size === 0) return 0
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  let shared = 0
  for (const t of small) if (large.has(t)) shared++
  return shared / (a.size + b.size - shared)
}

// candidates: [{ _id, title, description, ... , resolution? }], best matches first
export const findSimilar = (target, candidates, { threshold = 0.2, limit = 5 } = {}) => {
  const textOf = (t) => `${t.title || ''} ${t.title || ''} ${t.description || ''} ${t.resolution?.summary || ''}`
  const targetTokens = tokenize(textOf(target))
  const scored = []
  for (const c of candidates) {
    if (String(c._id) === String(target._id)) continue
    const score = jaccard(targetTokens, tokenize(textOf(c)))
    if (score >= threshold) scored.push({ ticket: c, score })
  }
  return topK(scored, limit, (a, b) => b.score - a.score || (String(a.ticket._id) < String(b.ticket._id) ? -1 : 1))
}
