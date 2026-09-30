const FNV_OFFSET = 2166136261
const FNV_PRIME = 16777619
const UINT32_MAX = 4294967296
const FALLBACK_STATE = 0x9e3779b9

export function hashSeed(input) {
  const raw = typeof input === 'number' ? `n:${Number.isFinite(input) ? input : 0}` : `s:${String(input ?? '')}`
  let hash = FNV_OFFSET
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME)
  }
  hash ^= hash >>> 15
  hash = Math.imul(hash, 2246822507)
  hash ^= hash >>> 13
  return hash >>> 0
}

function toState(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return Math.trunc(seed) >>> 0
  return hashSeed(seed)
}

export function createRng(seed) {
  let state = toState(seed)
  if (state === 0) state = FALLBACK_STATE

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_MAX
  }

  const int = (min, max) => {
    const lo = Math.ceil(Math.min(min, max))
    const hi = Math.floor(Math.max(min, max))
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return 0
    if (hi <= lo) return lo
    return lo + Math.floor(next() * (hi - lo + 1))
  }

  const float = (min, max) => {
    const lo = Math.min(min, max)
    const hi = Math.max(min, max)
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return 0
    if (hi === lo) return lo
    return lo + next() * (hi - lo)
  }

  const pick = (list) => {
    if (!Array.isArray(list) || list.length === 0) return undefined
    if (list.length === 1) return list[0]
    const index = Math.floor(next() * list.length)
    return list[index < 0 ? 0 : index >= list.length ? list.length - 1 : index]
  }

  const bool = (probability) => {
    const p = Number.isFinite(probability) ? probability : 0
    if (p <= 0) return false
    if (p >= 1) return true
    return next() < p
  }

  const exponential = (mean) => {
    const m = Number.isFinite(mean) ? mean : 0
    if (m <= 0) return 0
    const u = 1 - next()
    return -Math.log(u > 0 && u < 1 ? u : Number.EPSILON) * m
  }

  return { next, int, float, pick, bool, exponential }
}
