const DEFAULT_DIGITS = 4
const MAX_SERIES_BUCKETS = 512

export function round(value, digits = DEFAULT_DIGITS) {
  if (!Number.isFinite(value)) return 0
  const places = Math.max(0, Math.min(10, Math.floor(Number.isFinite(digits) ? digits : DEFAULT_DIGITS)))
  const factor = 10 ** places
  const rounded = Math.round(value * factor) / factor
  return rounded === 0 ? 0 : rounded
}

export function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}

export function positiveNumber(value, fallback) {
  if (!Number.isFinite(value) || value <= 0) return fallback
  return value
}

export function positiveInt(value, fallback) {
  if (!Number.isFinite(value)) return fallback
  const floored = Math.floor(value)
  if (floored <= 0) return fallback
  return floored
}

export function percentile(sorted, point) {
  if (!Array.isArray(sorted) || sorted.length === 0) return 0
  const p = Number.isFinite(point) ? clamp(point, 0, 100) : 0
  if (sorted.length === 1) return sorted[0] || 0
  const rank = (p / 100) * (sorted.length - 1)
  const lowIndex = Math.floor(rank)
  const highIndex = Math.ceil(rank)
  const low = sorted[lowIndex] ?? 0
  const high = sorted[highIndex] ?? low
  if (lowIndex === highIndex) return low
  return low + (high - low) * (rank - lowIndex)
}

export function mean(values) {
  if (!Array.isArray(values) || values.length === 0) return 0
  let total = 0
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]
    if (Number.isFinite(value)) total += value
  }
  return values.length > 0 ? total / values.length : 0
}

export function createAccumulator() {
  let count = 0
  let total = 0
  let lowest = Infinity
  let highest = -Infinity
  return {
    add(value) {
      if (!Number.isFinite(value)) return false
      count += 1
      total += value
      if (value < lowest) lowest = value
      if (value > highest) highest = value
      return true
    },
    get count() {
      return count
    },
    get total() {
      return total
    },
    get mean() {
      return count > 0 ? total / count : 0
    },
    get min() {
      return count > 0 ? lowest : 0
    },
    get max() {
      return count > 0 ? highest : 0
    },
  }
}

function bucketLayout(buckets, spanMs) {
  const count = Math.max(1, Math.min(MAX_SERIES_BUCKETS, Math.floor(positiveInt(buckets, 40))))
  const span = positiveNumber(spanMs, 0) > 0 ? spanMs : 1
  return { count, width: span / count }
}

export function createLatencySeries({ buckets = 40, spanMs = 0, maxSamples = 200000 } = {}) {
  const { count, width } = bucketLayout(buckets, spanMs)
  const cap = positiveInt(maxSamples, 200000)
  const data = new Array(count)
  for (let i = 0; i < count; i += 1) data[i] = []
  let stored = 0

  const add = (t, value) => {
    if (!Number.isFinite(t) || !Number.isFinite(value)) return false
    const raw = Math.floor(t / width)
    const index = raw < 0 ? 0 : raw >= count ? count - 1 : raw
    const bucket = data[index]
    if (!bucket) return false
    if (stored < cap) {
      bucket.push(value)
      stored += 1
    } else if (bucket.length > 0) {
      bucket[bucket.length - 1] = value
    } else {
      bucket.push(value)
    }
    return true
  }

  const points = () => {
    const out = []
    for (let i = 0; i < count; i += 1) {
      const bucket = data[i] || []
      bucket.sort((a, b) => a - b)
      out.push({
        t: round(i * width, 3),
        p50: round(percentile(bucket, 50), 3),
        p95: round(percentile(bucket, 95), 3),
        p99: round(percentile(bucket, 99), 3),
      })
    }
    return out
  }

  return { add, points, get sampleCount() { return stored } }
}

export function createQueueSeries({ buckets = 40, spanMs = 0, names = [], maxSamples = 300000 } = {}) {
  const { count, width } = bucketLayout(buckets, spanMs)
  const cap = positiveInt(maxSamples, 300000)
  const labelList = Array.isArray(names) ? names.filter((n) => typeof n === 'string' && n.length > 0) : []
  const history = new Map()
  let stored = 0

  const record = (t, name, depth) => {
    if (typeof name !== 'string' || name.length === 0) return false
    if (!Number.isFinite(t) || !Number.isFinite(depth) || depth < 0) return false
    let series = history.get(name)
    if (!series) {
      series = []
      history.set(name, series)
    }
    if (stored < cap) {
      series.push(t, Math.floor(depth))
      stored += 1
    } else if (series.length >= 2) {
      series[series.length - 2] = t
      series[series.length - 1] = Math.floor(depth)
    } else {
      series.push(t, Math.floor(depth))
    }
    return true
  }

  const points = () => {
    const labels = labelList.slice()
    for (const name of history.keys()) {
      if (!labels.includes(name)) labels.push(name)
    }
    const cursors = new Map()
    for (const name of labels) cursors.set(name, 0)
    const out = []
    for (let i = 0; i < count; i += 1) {
      const edge = (i + 1) * width
      const queues = {}
      for (const name of labels) {
        const series = history.get(name)
        if (!series) {
          queues[name] = 0
          continue
        }
        let cursor = cursors.get(name) || 0
        let depth = 0
        while (cursor + 1 < series.length && series[cursor] <= edge) {
          depth = series[cursor + 1]
          cursor += 2
        }
        cursors.set(name, cursor)
        queues[name] = depth
      }
      out.push({ t: round(i * width, 3), queues })
    }
    return out
  }

  return { record, points, get sampleCount() { return stored } }
}
