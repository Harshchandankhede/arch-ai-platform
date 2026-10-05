import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const page = read('src/pages/Evaluation.jsx')
const countUp = read('src/lib/useCountUp.js')
const reducedMotion = read('src/lib/useReducedMotion.js')
const graphLayout = read('src/features/three/useGraphLayout.js')

describe('the health score animates up like the old needle did', () => {
  it('the dial sweeps and the number counts, together', () => {
    assert.match(page, /<Gauge score=\{healthScore\}/)
    assert.match(page, /ref=\{scoreRef\}/)
    assert.match(page, /useCountUp\(/)
  })

  it('still renders the real score as its content', () => {
    // The ref writes text imperatively, so the JSX must already hold the correct value for
    // the first paint and for anyone without JS.
    assert.match(page, /ref=\{scoreRef\}[\s\S]*?\{healthScore\}\s*<\/span>/)
  })

  it('uses tabular figures so the number does not jitter as digits change', () => {
    assert.match(page, /tabular-nums/)
  })

  it('keeps the grade and colour beside the animating number', () => {
    assert.match(page, /style=\{\{ color: scoreColor\(healthScore\) \}\}/)
    assert.match(page, /\{verdict\.label\}/)
  })
})

describe('useCountUp is safe to call', () => {
  it('is declared before every early return', () => {
    // A hook called after an early return is conditional, and React requires the same hook
    // order on every render. The page has three early returns.
    const hookAt = page.indexOf('useCountUp(')
    const firstReturnAt = page.indexOf('if (!currentProject)')
    assert.ok(hookAt > -1 && firstReturnAt > -1)
    assert.ok(hookAt < firstReturnAt, 'useCountUp must be declared above the first early return')
  })

  it('is fed a number even when there is no evaluation yet', () => {
    assert.match(page, /useCountUp\(evaluation \? .* : 0\)/)
  })

  it('writes to the DOM instead of state, so the page is not re-rendered per frame', () => {
    // This page renders a radar chart; reconciling it dozens of times a second is not free.
    assert.doesNotMatch(countUp, /useState/)
    assert.match(countUp, /el\.textContent = /)
    assert.match(countUp, /requestAnimationFrame/)
  })

  it('lands exactly on the target so repeated runs cannot drift', () => {
    assert.match(countUp, /fromRef\.current = to/)
    assert.match(countUp, /write\(el, to\)/)
  })

  it('starts the next sweep from the current value rather than from zero', () => {
    assert.match(countUp, /const from = fromRef\.current/)
  })

  it('cancels its frame on unmount and on retarget', () => {
    assert.match(countUp, /return \(\) => cancelAnimationFrame\(raf\)/)
  })

  it('guards against a non-numeric target', () => {
    assert.match(countUp, /Number\.isFinite\(n\) \? n : 0/)
  })
})

describe('reduced motion is respected', () => {
  it('reads the preference through one shared hook', () => {
    assert.match(countUp, /usePrefersReducedMotion/)
    assert.match(countUp, /prefersReduced \|\| durationMs <= 0/)
    // The instant path is a layout effect so no one ever sees a frame of 0.
    assert.match(countUp, /useLayoutEffect/)
  })

  it('the login hero reuses the same hook rather than keeping a second copy', () => {
    assert.match(reducedMotion, /export function usePrefersReducedMotion/)
    assert.match(graphLayout, /export \{ usePrefersReducedMotion \} from '\.\.\/\.\.\/lib\/useReducedMotion\.js'/)
    assert.doesNotMatch(graphLayout, /function usePrefersReducedMotion\(\) \{/)
  })
})