import { useEffect, useLayoutEffect, useRef } from 'react'
import { usePrefersReducedMotion } from './useReducedMotion.js'

const DEFAULT_DURATION_MS = 900

// easeOutCubic: quick off the mark, then a gentle settle. It reads like a dial sweeping up
// and coming to rest, where a linear ramp looks mechanical.
function easeOutCubic(t) {
  return 1 - (1 - t) ** 3
}

/**
 * Sweeps a number up from its previous value to `target` and returns a ref to attach to the
 * element that displays it.
 *
 * The text is written straight to the DOM rather than held in state. Holding it in state
 * would re-render the surrounding page on every frame, and this page renders a radar chart
 * that has no business being reconciled dozens of times a second.
 *
 * When `target` changes the sweep restarts from wherever the number currently sits, so a
 * new evaluation animates out of the previous score instead of snapping back to zero.
 *
 * Readers who prefer reduced motion get the final value immediately.
 */
export function useCountUp(target, { durationMs = DEFAULT_DURATION_MS } = {}) {
  const ref = useRef(null)
  // Where the next sweep starts. Seeded at the target so the very first paint shows the
  // real score rather than a misleading zero.
  const fromRef = useRef(normalise(target))
  const prefersReduced = usePrefersReducedMotion()

  // A layout effect so the instant path below lands before the browser paints; otherwise a
  // reduced-motion reader would see 0 for one frame before the real score.
  useLayoutEffect(() => {
    const to = normalise(target)
    if (prefersReduced || durationMs <= 0) {
      fromRef.current = to
      write(ref.current, to)
    }
  }, [target, durationMs, prefersReduced])

  useEffect(() => {
    const to = normalise(target)
    if (prefersReduced || durationMs <= 0) return undefined

    const el = ref.current
    const from = fromRef.current
    if (from === to) return undefined

    let raf = 0
    let startedAt = null

    const step = (now) => {
      if (startedAt === null) startedAt = now
      const progress = Math.min(1, (now - startedAt) / durationMs)
      const current = from + (to - from) * easeOutCubic(progress)
      write(el, current)
      if (progress < 1) {
        raf = requestAnimationFrame(step)
      } else {
        // Land exactly on the target so repeated runs cannot accumulate rounding drift.
        fromRef.current = to
        write(el, to)
      }
    }

    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, durationMs, prefersReduced])

  return ref
}

function normalise(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function write(el, value) {
  if (el) el.textContent = String(Math.round(value))
}