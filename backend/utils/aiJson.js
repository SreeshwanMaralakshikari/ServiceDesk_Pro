import { createHash } from 'node:crypto'

// Models like to wrap JSON in ```json fences or add a sentence around it, even when told
// not to. Pull the JSON object out instead of failing on it. Throws if there is none.
export const parseModelJson = (raw) => {
  if (typeof raw !== 'string') throw new Error('AI response was not text')
  let text = raw.trim()
  const fenced = text.match(/^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/)
  if (fenced) text = fenced[1].trim()
  try {
    return JSON.parse(text)
  } catch {
    // last resort: the outermost {...} in the text
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end > start) return JSON.parse(text.slice(start, end + 1))
    throw new Error('AI response was not valid JSON')
  }
}

// same question, same hash: lower-cased, whitespace collapsed, plus anything else that
// changes the answer (the model, the category list...) passed in `parts`
export const hashInput = (...parts) =>
  createHash('sha256')
    .update(parts.map((p) => String(p ?? '').toLowerCase().replace(/\s+/g, ' ').trim()).join('\u0001'))
    .digest('hex')
