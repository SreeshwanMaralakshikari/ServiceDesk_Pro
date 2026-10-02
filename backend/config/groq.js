// Thin wrapper around Groq's OpenAI-compatible chat completions endpoint —
// a single fetch call, no SDK, so using it needs no extra npm install.
//
// Exposed as one mutable object (not separate named exports) so tests can
// swap `groqClient.chatCompletion` for a stub, the same way this codebase's
// other tests replace a Mongoose model's methods directly (see
// test/kb.test.js) rather than mocking modules.
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
// Groq retires models over time (llama-3.1-8b-instant was the old default). Change the
// model with the AI_MODEL env var, no code change needed; GROQ_MODEL still works as an alias.
export const DEFAULT_MODEL = 'openai/gpt-oss-20b'
const TIMEOUT_MS = 8000

// The model actually in use for a given call — exported so callers (e.g. for
// an AiLog entry) always report exactly what chatCompletion used, rather than
// re-deriving `process.env.GROQ_MODEL || DEFAULT_MODEL` a second time and
// risking the two falling out of sync later.
export const resolveModel = () => process.env.AI_MODEL || process.env.GROQ_MODEL || DEFAULT_MODEL

export const groqClient = {
  isConfigured: () => Boolean(process.env.GROQ_API_KEY),

  // Returns the assistant's raw text content. Throws a short, non-sensitive
  // Error on ANY failure — no key, network error, timeout, non-2xx, empty
  // response — so callers can catch once and fall back to the offline
  // heuristic. The API key itself is never included in a thrown message.
  chatCompletion: async ({ system, user, maxTokens = 300, temperature = 0.2 }) => {
    if (!groqClient.isConfigured()) throw new Error('AI not configured (no GROQ_API_KEY)')
    const model = resolveModel()
    // gpt-oss models "think" before answering and those tokens count against the limit,
    // so they get a low reasoning effort and some headroom, or the JSON could be cut off
    const reasoning = /gpt-oss/i.test(model)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          max_tokens: reasoning ? maxTokens + 400 : maxTokens,
          temperature,
          ...(reasoning ? { reasoning_effort: 'low' } : {}),
        }),
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`AI request failed (HTTP ${res.status})`)
      const data = await res.json()
      const content = data?.choices?.[0]?.message?.content
      if (!content || typeof content !== 'string') throw new Error('AI returned an empty response')
      return content
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('AI request timed out')
      throw err
    } finally {
      clearTimeout(timeout)
    }
  },
}
