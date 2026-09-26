// Pure business-hours math, IST-only (fixed +05:30, no DST — per the
// handoff plan's "Render runs in UTC" trap). All functions work in plain
// UTC milliseconds shifted by the fixed offset, so they never depend on
// the server's local timezone.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export const DEFAULT_BUSINESS_HOURS = { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00', timezone: 'Asia/Kolkata' }

const parseHM = (hm) => {
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + m
}

// shift a real Date so its UTC getters read as IST wall-clock time
const toIstShifted = (date) => new Date(date.getTime() + IST_OFFSET_MS)
const fromIstShifted = (istDate) => new Date(istDate.getTime() - IST_OFFSET_MS)

const startOfShiftedDayMs = (shifted) => Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate())

const isBusinessDay = (shifted, settings) => settings.days.includes(shifted.getUTCDay())

// move a shifted cursor forward to the next moment that's inside a
// business window (if it already is, it's returned unchanged)
const clampIntoWindow = (shifted, settings, startMin, endMin) => {
  let cursor = shifted
  for (let guard = 0; guard < 14; guard++) { // 14 days is generous headroom
    const dayStart = startOfShiftedDayMs(cursor) + startMin * 60000
    const dayEnd = startOfShiftedDayMs(cursor) + endMin * 60000
    if (isBusinessDay(cursor, settings)) {
      if (cursor.getTime() < dayStart) return new Date(dayStart)
      if (cursor.getTime() < dayEnd) return cursor
    }
    // past today's window (or non-business day) — try tomorrow at start time
    cursor = new Date(startOfShiftedDayMs(cursor) + DAY_MS + startMin * 60000)
  }
  return cursor // pathological settings (e.g. no business days at all)
}

/**
 * Adds `hours` of business time to `startDate`, skipping nights/weekends.
 * If `settings` is missing, falls back to the Mon-Fri 09:00-18:00 IST default.
 */
export const addBusinessHours = (startDate, hours, settings = DEFAULT_BUSINESS_HOURS) => {
  const startMin = parseHM(settings.start)
  const endMin = parseHM(settings.end)
  let remainingMs = Math.max(0, hours) * 3600 * 1000
  let cursor = clampIntoWindow(toIstShifted(startDate), settings, startMin, endMin)

  for (let guard = 0; guard < 100000 && remainingMs > 0; guard++) {
    const dayEnd = startOfShiftedDayMs(cursor) + endMin * 60000
    const availableToday = dayEnd - cursor.getTime()
    if (remainingMs <= availableToday) {
      cursor = new Date(cursor.getTime() + remainingMs)
      remainingMs = 0
    } else {
      remainingMs -= availableToday
      cursor = clampIntoWindow(new Date(startOfShiftedDayMs(cursor) + DAY_MS + startMin * 60000), settings, startMin, endMin)
    }
  }
  return fromIstShifted(cursor)
}

/**
 * Business milliseconds elapsed between two dates (a should be <= b).
 * Weekends/off-hours contribute 0.
 */
export const businessMsBetween = (a, b, settings = DEFAULT_BUSINESS_HOURS) => {
  if (b <= a) return 0
  const startMin = parseHM(settings.start)
  const endMin = parseHM(settings.end)
  let cursor = toIstShifted(a)
  const end = toIstShifted(b)
  let total = 0

  for (let guard = 0; guard < 10000 && cursor < end; guard++) {
    if (isBusinessDay(cursor, settings)) {
      const dayStart = startOfShiftedDayMs(cursor) + startMin * 60000
      const dayEnd = startOfShiftedDayMs(cursor) + endMin * 60000
      const windowStart = Math.max(cursor.getTime(), dayStart)
      const windowEnd = Math.min(end.getTime(), dayEnd)
      if (windowEnd > windowStart) total += windowEnd - windowStart
    }
    cursor = new Date(startOfShiftedDayMs(cursor) + DAY_MS)
  }
  return total
}

// due-date/elapsed-time helpers that respect a policy's businessHoursOnly flag
export const computeDueDate = (startDate, hours, policy, settings = DEFAULT_BUSINESS_HOURS) => {
  if (!policy?.businessHoursOnly) return new Date(startDate.getTime() + Math.max(0, hours) * 3600 * 1000)
  return addBusinessHours(startDate, hours, settings)
}

export const elapsedMs = (a, b, policy, settings = DEFAULT_BUSINESS_HOURS) => {
  if (!policy?.businessHoursOnly) return Math.max(0, b.getTime() - a.getTime())
  return businessMsBetween(a, b, settings)
}
