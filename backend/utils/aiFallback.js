// Deterministic, offline heuristics used whenever the AI call is unavailable
// (no API key) or its response fails validation — so classify-ticket always
// answers something useful, never a 5xx, with or without GROQ_API_KEY set.

import { tokenize } from './dsa/similarity.js'

const URGENT_WORDS = ['urgent', 'asap', 'critical', 'down', 'outage', 'broken', 'cannot work', "can't work", 'blocked', 'emergency']

// Picks the category whose name, then whose skill tags, overlap most with the
// ticket text (a name word counts twice, a skill tag once, words lightly stemmed),
// so "my laptop screen flickers" finds Hardware through its `laptop` skill.
// Returns null (no guess) rather than a wrong pick when nothing overlaps at all —
// a missing suggestion is honest; a random one isn't. Ties keep the first category
// in the order given (the route sorts by name).
export const guessCategory = (text, categories) => {
  const words = tokenize(text)
  let best = null
  let bestScore = 0
  for (const c of categories) {
    const nameHits = [...tokenize(c.name)].filter((w) => words.has(w)).length
    const skillHits = [...tokenize((c.skills || []).join(' '))].filter((w) => words.has(w)).length
    const score = nameHits * 2 + skillHits
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }
  return best
}

// `priorityCodes` is whatever the org actually has active — never assume
// MEDIUM/HIGH exist. Prefers the requested code if present, otherwise the
// closest available one, so the result is always one of the codes offered.
export const guessPriority = (text, priorityCodes = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) => {
  const lower = (text || '').toLowerCase()
  const urgent = URGENT_WORDS.some((w) => lower.includes(w))
  const pick = (code) => priorityCodes.find((p) => p.toUpperCase() === code)
  if (urgent) return pick('HIGH') ?? pick('CRITICAL') ?? priorityCodes[priorityCodes.length - 1] ?? null
  return pick('MEDIUM') ?? priorityCodes[0] ?? null
}
