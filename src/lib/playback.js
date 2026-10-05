// Playback timing for the architecture flow animation.
//
// Playback is a time-lapse target, not a bare multiplier: the control says how many real
// seconds the whole run should take, and the multiplier is derived as duration / wallClock.
//
// Two earlier models were wrong here. A fixed 0.02x-2x multiplier applied to a looping
// window made a 100 s run race past, because only the opening seconds of the log existed
// and they were replayed on repeat. An "Auto" mode then scaled the multiplier by
// arrivalRate / 120, so the readout showed values like "1.3x faster" that the user never
// asked for. The target is now always explicit and honoured exactly.

export const REAL_TIME = 'real'

export const WALL_CLOCK_TARGETS = [
  { key: 5, label: '5s' },
  { key: 10, label: '10s' },
  { key: 20, label: '20s' },
  { key: 40, label: '40s' },
  { key: 80, label: '80s' },
]

export const DEFAULT_WALL_CLOCK = 20

/**
 * Simulated-ms elapsed per real-ms spent playing.
 *
 * Deliberately a pure function of the chosen target: an explicit target plays in exactly
 * that many real seconds, whatever the arrival rate.
 */
export function resolveSpeed({ durationSec, wallClockSec } = {}) {
  const duration = Math.max(0, Number(durationSec) || 0)
  if (wallClockSec === REAL_TIME) return 1
  if (duration <= 0) return 1
  const target = Math.max(1, Number(wallClockSec) || DEFAULT_WALL_CLOCK)
  return Math.max(0.02, duration / target)
}

/** Human label for a multiplier produced by resolveSpeed. */
export function speedLabel(speed) {
  if (!Number.isFinite(speed) || speed <= 0) return '—'
  if (Math.abs(speed - 1) < 0.02) return 'real time'
  if (speed >= 1) return `${speed.toFixed(speed >= 10 ? 0 : 1)}x faster than real time`
  return `${(1 / speed).toFixed(1)}x slower than real time`
}