// Pure input rules for the admin routes (no database), so they are unit
// tested directly. Each returns { value } or { error }.

const SKILL_PATTERN = /^[a-z0-9][a-z0-9 .+#_-]{0,29}$/
export const MAX_SKILLS = 15

// skills are lowercase tags: "vpn", "wifi", "windows"
export const normalizeSkills = (input) => {
  if (!Array.isArray(input)) return { error: 'skills must be a list of text tags' }
  if (input.length > MAX_SKILLS) return { error: `at most ${MAX_SKILLS} skills` }
  const skills = []
  for (const raw of input) {
    if (typeof raw !== 'string') return { error: 'every skill must be text' }
    const tag = raw.trim().toLowerCase().replace(/\s+/g, ' ')
    if (!SKILL_PATTERN.test(tag)) return { error: `invalid skill "${raw.slice(0, 30)}": use 1-30 letters, digits, spaces or . + # _ -` }
    if (!skills.includes(tag)) skills.push(tag)
  }
  return { skills }
}

// trimmed text with a length range; `required: false` lets undefined through
export const cleanText = (value, label, { min = 1, max = 100, required = true } = {}) => {
  if (value === undefined || value === null) return required ? { error: `${label} is required` } : { value: undefined }
  if (typeof value !== 'string') return { error: `${label} must be text` }
  const text = value.trim()
  if (text.length < min || text.length > max) return { error: `${label} must be ${min}-${max} characters` }
  return { value: text }
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

// `input` is the client's businessHours object, `current` what is stored now.
// An empty day list or an end before the start would break the SLA clock math
export const validateBusinessHours = (input, current) => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { error: 'businessHours must be an object' }
  const next = { days: [...current.days], start: current.start, end: current.end }
  if (input.days !== undefined) {
    const ok = Array.isArray(input.days) && input.days.length > 0 && input.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    if (!ok) return { error: 'days must be a non-empty list of weekday numbers, 0 (Sunday) to 6 (Saturday)' }
    next.days = [...new Set(input.days)].sort((a, b) => a - b)
  }
  for (const key of ['start', 'end']) {
    if (input[key] === undefined) continue
    if (typeof input[key] !== 'string' || !HHMM.test(input[key])) return { error: `${key} must be a time like 09:00 (24-hour HH:mm)` }
    next[key] = input[key]
  }
  if (next.start >= next.end) return { error: 'business hours must start before they end' }
  return { value: next }
}

const MAX_SLA_HOURS = 8760 // one year
const COLOR = /^#[0-9a-fA-F]{6}$/

// response/resolution hours, as numbers, resolution never shorter than response
export const validateSlaHours = (responseTimeHours, resolutionTimeHours) => {
  for (const [label, value] of [['responseTimeHours', responseTimeHours], ['resolutionTimeHours', resolutionTimeHours]]) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > MAX_SLA_HOURS) {
      return { error: `${label} must be a number above 0 and at most ${MAX_SLA_HOURS}` }
    }
  }
  if (resolutionTimeHours < responseTimeHours) return { error: 'resolution time cannot be shorter than response time' }
  return { value: { responseTimeHours, resolutionTimeHours } }
}

export const validateColor = (color) => (typeof color === 'string' && COLOR.test(color) ? { value: color } : { error: 'color must look like #6b7280' })

const PRIORITY_CODE = /^[A-Z][A-Z0-9_]{1,19}$/
export const normalizePriorityCode = (code) => {
  if (typeof code !== 'string') return { error: 'priority must be text' }
  const value = code.trim().toUpperCase()
  return PRIORITY_CODE.test(value) ? { value } : { error: 'priority code must be 2-20 letters, digits or _ and start with a letter' }
}

const DEPT_CODE = /^[A-Z0-9]{2,8}$/
export const normalizeDepartmentCode = (code) => {
  if (typeof code !== 'string') return { error: 'code must be text' }
  const value = code.trim().toUpperCase()
  return DEPT_CODE.test(value) ? { value } : { error: 'code must be 2-8 letters or digits' }
}
