import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toCsv, csvCell, CSV_BOM } from '../utils/toCsv.js'

test('plain values are written as they are', () => {
  assert.equal(csvCell('hello'), 'hello')
  assert.equal(csvCell(42), '42')
  assert.equal(csvCell(0), '0')
  assert.equal(csvCell(true), 'true')
  assert.equal(csvCell(null), '')
  assert.equal(csvCell(undefined), '')
  assert.equal(csvCell(Number.NaN), '')
  assert.equal(csvCell(new Date('2026-10-07T06:30:00Z')), '2026-10-07T06:30:00.000Z')
})

test('commas, quotes and line breaks are quoted, quotes doubled', () => {
  assert.equal(csvCell('a,b'), '"a,b"')
  assert.equal(csvCell('say "hi"'), '"say ""hi"""')
  assert.equal(csvCell('line1\nline2'), '"line1\nline2"')
  assert.equal(csvCell('line1\r\nline2'), '"line1\r\nline2"')
})

test('text that would run as a spreadsheet formula is neutralised', () => {
  for (const payload of ['=SUM(A1:A9)', '+1+1', '-2+3', '@SUM(1)', '=HYPERLINK("http://evil","x")', '\t=1', '\r=1']) {
    assert.ok(csvCell(payload).replace(/^"/, '').startsWith("'"), `not neutralised: ${JSON.stringify(payload)}`)
  }
  assert.equal(csvCell('=1+1'), "'=1+1")
  // a quote and a formula together: neutralised AND quoted
  assert.equal(csvCell('=A1,"x"'), '"\'=A1,""x"""')
  // a real number is a number, not text, so it keeps its minus sign
  assert.equal(csvCell(-5), '-5')
  // text that merely contains the characters later in the cell is untouched
  assert.equal(csvCell('a=b'), 'a=b')
})

test('toCsv: header row, CRLF line ends, key and value columns, no rows', () => {
  const columns = [{ key: 'id', header: 'ID' }, { header: 'Name, full', value: (r) => `${r.first} ${r.last}` }]
  const csv = toCsv(columns, [{ id: 1, first: 'Ada', last: 'Lovelace' }, { id: 2, first: '=cmd', last: 'x' }])
  assert.equal(csv, 'ID,"Name, full"\r\n1,Ada Lovelace\r\n2,\'=cmd x\r\n')
  assert.equal(toCsv(columns, []), 'ID,"Name, full"\r\n')
  assert.equal(CSV_BOM, '﻿')
})
