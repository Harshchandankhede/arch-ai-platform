const INITIAL_CAPACITY = 1024

export function createEventQueue() {
  let times = new Float64Array(INITIAL_CAPACITY)
  let seqs = new Float64Array(INITIAL_CAPACITY)
  let items = new Array(INITIAL_CAPACITY)
  let count = 0
  let lastSeq = 0

  function grow() {
    const capacity = times.length * 2
    const grownTimes = new Float64Array(capacity)
    const grownSeqs = new Float64Array(capacity)
    grownTimes.set(times)
    grownSeqs.set(seqs)
    times = grownTimes
    seqs = grownSeqs
  }

  function before(a, b) {
    const ta = times[a]
    const tb = times[b]
    if (ta !== tb) return ta < tb
    return seqs[a] < seqs[b]
  }

  function swap(a, b) {
    const t = times[a]
    times[a] = times[b]
    times[b] = t
    const s = seqs[a]
    seqs[a] = seqs[b]
    seqs[b] = s
    const item = items[a]
    items[a] = items[b]
    items[b] = item
  }

  function siftUp(start) {
    let index = start
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (!before(index, parent)) break
      swap(index, parent)
      index = parent
    }
  }

  function siftDown(start) {
    let index = start
    const half = count >> 1
    while (index < half) {
      let child = (index << 1) + 1
      const right = child + 1
      if (right < count && before(right, child)) child = right
      if (!before(child, index)) break
      swap(index, child)
      index = child
    }
  }

  return {
    push(event) {
      const item = event && typeof event === 'object' ? event : { time: 0 }
      if (!Number.isFinite(item.time)) item.time = 0
      lastSeq += 1
      if (Number.isFinite(item.seq)) {
        if (item.seq > lastSeq) lastSeq = item.seq
      } else {
        item.seq = lastSeq
      }
      if (count === times.length) grow()
      times[count] = item.time
      seqs[count] = item.seq
      items[count] = item
      count += 1
      siftUp(count - 1)
      return count
    },
    pop() {
      if (count === 0) return undefined
      const top = items[0]
      count -= 1
      if (count > 0) {
        times[0] = times[count]
        seqs[0] = seqs[count]
        items[0] = items[count]
        siftDown(0)
      }
      items[count] = undefined
      times[count] = 0
      seqs[count] = 0
      return top
    },
    peek() {
      return count > 0 ? items[0] : undefined
    },
    get size() {
      return count
    },
    clear() {
      for (let i = 0; i < count; i += 1) items[i] = undefined
      count = 0
      lastSeq = 0
    },
  }
}
