// the one CSV writer for every export. Rules:
//   - quotes fields that contain a comma, a quote or a line break (RFC 4180), CRLF between rows
//   - a text cell that starts with = + - @ (or a tab / carriage return) is prefixed with a
//     single quote, so Excel and Sheets show it as text instead of running it as a formula.
//     Ticket titles and names are typed by users, so this is a real injection path
//   - null and undefined become an empty cell; numbers and booleans are written as they are
// Columns are { key, header } or { header, value(row) }.

export const CSV_BOM = '﻿' // makes Excel read the file as UTF-8

const FORMULA_START = /^[=+\-@\t\r]/

export const csvCell = (value) => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  let text = value instanceof Date ? value.toISOString() : String(value)
  if (FORMULA_START.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export const toCsv = (columns, rows) => {
  const lines = [columns.map((c) => csvCell(c.header)).join(',')]
  for (const row of rows) {
    lines.push(columns.map((c) => csvCell(c.value ? c.value(row) : row[c.key])).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}
