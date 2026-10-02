// Hand-written binary min-heap (array backed). No library, no Array.sort.
// compare(a, b) < 0 means a comes out before b.
//   new MinHeap(items)   O(n)      bottom-up heapify
//   push                 O(log n)
//   pop                  O(log n)
//   peek / size          O(1)
//   drain(limit)         O(k log n) pops the k best items in order
export class MinHeap {
  constructor(compare, items = []) {
    this.compare = compare
    this.items = items.slice()
    for (let i = (this.items.length >> 1) - 1; i >= 0; i--) this.siftDown(i)
  }

  get size() {
    return this.items.length
  }

  peek() {
    return this.items[0]
  }

  push(item) {
    this.items.push(item)
    this.siftUp(this.items.length - 1)
  }

  pop() {
    const items = this.items
    if (items.length === 0) return undefined
    const top = items[0]
    const last = items.pop()
    if (items.length > 0) {
      items[0] = last
      this.siftDown(0)
    }
    return top
  }

  // pop up to limit items (all when limit is omitted), best first
  drain(limit = Infinity) {
    const out = []
    while (this.items.length > 0 && out.length < limit) out.push(this.pop())
    return out
  }

  siftUp(index) {
    const items = this.items
    const item = items[index]
    let i = index
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.compare(item, items[parent]) >= 0) break
      items[i] = items[parent]
      i = parent
    }
    items[i] = item
  }

  siftDown(index) {
    const items = this.items
    const n = items.length
    const item = items[index]
    let i = index
    while (true) {
      let child = 2 * i + 1
      if (child >= n) break
      if (child + 1 < n && this.compare(items[child + 1], items[child]) < 0) child++
      if (this.compare(items[child], item) >= 0) break
      items[i] = items[child]
      i = child
    }
    items[i] = item
  }
}

// the k best items (best first) in O(n log k): keep a max-heap of size k, so the
// worst of the current best-k sits on top and is the one that gets replaced
export const topK = (items, k, compare) => {
  if (k <= 0) return []
  const worstFirst = new MinHeap((a, b) => compare(b, a))
  for (const item of items) {
    if (worstFirst.size < k) worstFirst.push(item)
    else if (compare(item, worstFirst.peek()) < 0) {
      worstFirst.pop()
      worstFirst.push(item)
    }
  }
  return worstFirst.drain().reverse()
}
