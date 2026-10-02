import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MinHeap, topK } from '../utils/dsa/MinHeap.js'
import { rankTechnicians, pickTechnician } from '../utils/dsa/techHeap.js'
import { urgencyOf, buildQueue } from '../utils/dsa/smartQueue.js'
import { tokenize, jaccard, findSimilar } from '../utils/dsa/similarity.js'
import { mergeSorted, sortByTime } from '../utils/dsa/timeline.js'

const num = (a, b) => a - b

test('MinHeap: fuzz against Array.sort, incl. heapify constructor and drain', () => {
  for (let round = 0; round < 200; round++) {
    const n = Math.floor(Math.random() * 60)
    const data = Array.from({ length: n }, () => Math.floor(Math.random() * 20))
    const expected = data.slice().sort(num)
    const viaPush = new MinHeap(num)
    data.forEach((x) => viaPush.push(x))
    assert.deepEqual(viaPush.drain(), expected)
    assert.deepEqual(new MinHeap(num, data).drain(), expected)
    assert.deepEqual(new MinHeap(num, data).drain(3), expected.slice(0, 3))
  }
})

test('MinHeap: empty and single', () => {
  const h = new MinHeap(num)
  assert.equal(h.pop(), undefined)
  assert.equal(h.peek(), undefined)
  h.push(4)
  assert.equal(h.size, 1)
  assert.equal(h.pop(), 4)
  assert.equal(h.size, 0)
})

test('topK matches sorted slice, handles k bigger than n and k=0', () => {
  for (let round = 0; round < 100; round++) {
    const data = Array.from({ length: Math.floor(Math.random() * 40) }, () => Math.floor(Math.random() * 15))
    const k = Math.floor(Math.random() * 10)
    assert.deepEqual(topK(data, k, num), data.slice().sort(num).slice(0, k))
  }
  assert.deepEqual(topK([3, 1], 5, num), [1, 3])
  assert.deepEqual(topK([3, 1], 0, num), [])
})

const tech = (id, openTickets, skills = [], lastAssignedAt = null) => ({ id, openTickets, skills, lastAssignedAt })

test('rankTechnicians: lowest load wins inside the skilled pool', () => {
  const list = [tech('a', 5, ['vpn']), tech('b', 1, ['printer']), tech('c', 2, ['vpn']), tech('d', 0, [])]
  const ranked = rankTechnicians(list, ['vpn'])
  assert.deepEqual(ranked.map((t) => t.id), ['c', 'a'])
})

test('rankTechnicians: no skill match falls back to everyone', () => {
  const list = [tech('a', 3), tech('b', 1), tech('c', 2)]
  assert.deepEqual(rankTechnicians(list, ['vpn']).map((t) => t.id), ['b', 'c', 'a'])
  assert.deepEqual(rankTechnicians(list, []).map((t) => t.id), ['b', 'c', 'a'])
})

test('rankTechnicians: ties go to more matched skills, then least recently assigned, then id', () => {
  const old = new Date('2026-01-01')
  const recent = new Date('2026-06-01')
  const moreSkills = rankTechnicians([tech('x', 1, ['vpn']), tech('y', 1, ['vpn', 'wifi'])], ['vpn', 'wifi'])
  assert.equal(moreSkills[0].id, 'y')
  const lru = rankTechnicians([tech('x', 1, [], recent), tech('y', 1, [], old), tech('z', 1, [], null)], [])
  assert.deepEqual(lru.map((t) => t.id), ['z', 'y', 'x'])
  assert.deepEqual(rankTechnicians([tech('b', 0), tech('a', 0)], []).map((t) => t.id), ['a', 'b'])
})

test('pickTechnician: none when there are no technicians; limit works', () => {
  assert.equal(pickTechnician([], ['vpn']), null)
  assert.equal(rankTechnicians([tech('a', 1), tech('b', 2), tech('c', 3)], [], 2).length, 2)
})

const NOW = new Date('2026-10-05T10:00:00Z')
const hrs = (h) => new Date(NOW.getTime() + h * 3600000)
const tk = (id, over = {}) => ({ _id: id, status: 'IN_PROGRESS', createdAt: hrs(-5), priorityLevel: 2, sla: { responseDueAt: hrs(-4), firstRespondedAt: hrs(-4.5), resolutionDueAt: hrs(20) }, ...over })

test('urgencyOf covers every bucket', () => {
  assert.equal(urgencyOf(tk('a', { status: 'ON_HOLD' }), NOW), 'ON_HOLD')
  assert.equal(urgencyOf(tk('a', { sla: {} }), NOW), 'NO_CLOCK')
  assert.equal(urgencyOf(tk('a', { sla: { resolutionBreached: true, resolutionDueAt: hrs(5) } }), NOW), 'BREACHED')
  assert.equal(urgencyOf(tk('a', { sla: { resolutionDueAt: hrs(-1) } }), NOW), 'BREACHED')
  assert.equal(urgencyOf(tk('a', { sla: { responseDueAt: hrs(-1), resolutionDueAt: hrs(30) } }), NOW), 'BREACHED')
  assert.equal(urgencyOf(tk('a', { sla: { warnAt: hrs(-1), resolutionDueAt: hrs(30), firstRespondedAt: hrs(-4) } }), NOW), 'AT_RISK')
  assert.equal(urgencyOf(tk('a', { sla: { responseBreached: true, resolutionDueAt: hrs(30) } }), NOW), 'BREACHED')
  assert.equal(urgencyOf(tk('a', { sla: { responseBreached: true, firstRespondedAt: hrs(-1), resolutionDueAt: hrs(30) } }), NOW), 'ON_TRACK')
  assert.equal(urgencyOf(tk('a'), NOW), 'ON_TRACK')
})

test('buildQueue order: urgency, due date, priority, age, id', () => {
  const list = [
    tk('hold', { status: 'ON_HOLD' }),
    tk('ok-late', { sla: { responseDueAt: hrs(-4), firstRespondedAt: hrs(-4.5), resolutionDueAt: hrs(40) } }),
    tk('ok-soon', { sla: { responseDueAt: hrs(-4), firstRespondedAt: hrs(-4.5), resolutionDueAt: hrs(10) } }),
    tk('late', { sla: { resolutionDueAt: hrs(-2) } }),
    tk('noclock', { sla: {} }),
    tk('tie-low', { priorityLevel: 1 }),
    tk('tie-high', { priorityLevel: 3 }),
  ]
  const out = buildQueue(list, { now: NOW }).map((t) => t._id)
  assert.deepEqual(out, ['late', 'ok-soon', 'tie-high', 'tie-low', 'ok-late', 'noclock', 'hold'])
  assert.equal(buildQueue(list, { now: NOW, limit: 2 }).length, 2)
  assert.deepEqual(buildQueue([], { now: NOW }), [])
})

test('tokenize drops stop words and stems lightly', () => {
  const t = tokenize('The printers are not working, Printing failed!')
  assert.ok(t.has('printer'))
  assert.ok(t.has('print'))
  assert.ok(!t.has('the'))
  assert.ok(!t.has('not'))
  assert.equal(tokenize('').size, 0)
})

test('jaccard known values', () => {
  assert.equal(jaccard(new Set(['a', 'b']), new Set(['a', 'b'])), 1)
  assert.equal(jaccard(new Set(['a', 'b']), new Set(['c'])), 0)
  assert.equal(jaccard(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd'])), 0.5)
  assert.equal(jaccard(new Set(), new Set()), 0)
})

test('findSimilar ranks related tickets, skips itself and unrelated', () => {
  const target = { _id: '1', title: 'VPN not connecting', description: 'VPN client fails to connect from home' }
  const cands = [
    target,
    { _id: '2', title: 'VPN connection fails', description: 'cannot connect to vpn from home network' },
    { _id: '3', title: 'Printer jam', description: 'paper stuck in tray' },
    { _id: '4', title: 'VPN slow', description: 'vpn connects but slow', resolution: { summary: 'reset the vpn client' } },
  ]
  const out = findSimilar(target, cands)
  assert.equal(out[0].ticket._id, '2')
  assert.ok(out.every((x) => x.ticket._id !== '1' && x.ticket._id !== '3'))
  assert.ok(out[0].score >= out[out.length - 1].score)
  assert.deepEqual(findSimilar(target, []), [])
})

test('mergeSorted keeps global time order, stable between lists', () => {
  const d = (n) => new Date(2026, 0, n)
  const a = [{ at: d(1), k: 'a1' }, { at: d(4), k: 'a4' }]
  const b = [{ at: d(2), k: 'b2' }, { at: d(4), k: 'b4' }, { at: d(9), k: 'b9' }]
  const c = []
  assert.deepEqual(mergeSorted([a, b, c]).map((x) => x.k), ['a1', 'b2', 'a4', 'b4', 'b9'])
  assert.deepEqual(mergeSorted([]), [])
  assert.deepEqual(sortByTime([{ at: d(3), k: 3 }, { at: d(1), k: 1 }, { at: d(2), k: 2 }]).map((x) => x.k), [1, 2, 3])
})
