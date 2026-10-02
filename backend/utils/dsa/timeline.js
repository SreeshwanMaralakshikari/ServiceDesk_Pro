import { MinHeap } from './MinHeap.js'

// k-way merge of lists that are each already sorted by `at` (oldest first).
// A heap holds the head of every list, so the merge is O(n log k).
export const mergeSorted = (lists) => {
  const heap = new MinHeap((a, b) => a.at - b.at || a.list - b.list)
  lists.forEach((items, list) => {
    if (items.length) heap.push({ at: new Date(items[0].at).getTime(), list, index: 0 })
  })
  const out = []
  while (heap.size > 0) {
    const head = heap.pop()
    const items = lists[head.list]
    out.push(items[head.index])
    const next = head.index + 1
    if (next < items.length) heap.push({ at: new Date(items[next].at).getTime(), list: head.list, index: next })
  }
  return out
}

// sorts one list by time (used before the merge, since stored arrays are usually but not always ordered)
export const sortByTime = (items) => {
  const heap = new MinHeap((a, b) => a.t - b.t || a.i - b.i, items.map((item, i) => ({ t: new Date(item.at).getTime(), i, item })))
  return heap.drain().map((x) => x.item)
}
