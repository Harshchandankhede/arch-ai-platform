import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { utilPct } from '../src/lib/metrics.js'
import { toContract } from '../src/lib/contract.js'
import { runSimulation } from '../src/lib/engine.js'
import { strongArchitecture } from '../src/data/seedArchitectures.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

describe('utilization units', () => {
  it('converts the engine 0-1 ratio into a 0-100 percentage', () => {
    assert.equal(utilPct(0.051), 5.1)
    assert.equal(utilPct(0.5), 50)
    assert.equal(utilPct(1), 100)
    assert.equal(utilPct(0), 0)
  })

  it('passes through a value that is already a percentage', () => {
    assert.equal(utilPct(45), 45)
    assert.equal(utilPct(99.5), 99.5)
  })

  it('is safe for missing and non-numeric input', () => {
    assert.equal(utilPct(undefined), 0)
    assert.equal(utilPct(null), 0)
    assert.equal(utilPct('abc'), 0)
    assert.equal(utilPct(Number.NaN), 0)
  })

  it('clamps out-of-range input', () => {
    assert.equal(utilPct(150), 100)
    assert.equal(utilPct(-5), 0)
  })

  it('the engine really does emit a ratio, not a percentage', () => {
    const sim = runSimulation(toContract(strongArchitecture()), { arrivalRate: 500, duration: 60, seed: 1 }, {})
    const comps = Object.values(sim.components)
    const ratio = Math.max(...comps.map((c) => c.utilization))
    assert.ok(ratio > 0 && ratio <= 1, `expected a 0-1 ratio, got ${ratio}`)
    // If the UI read this value as a percentage it would under-report by 100x.
    assert.ok(utilPct(ratio) > ratio, 'utilPct must scale the ratio up')
  })

  it('every page that renders utilisation converts it', () => {
    for (const page of ['Simulation', 'Comparison', 'Reports', 'Dashboard']) {
      const src = read(`src/pages/${page}.jsx`)
      // Any remaining raw read of .utilization would reintroduce the 100x under-report.
      const raw = src.match(/Number\(\s*(?:stat|entry|c\.utilization|\w+\.utilization)[\w.?]*\.utilization\s*\)\s*\|\|\s*0/g)
      assert.ok(!raw, `${page}.jsx still reads .utilization without utilPct()`)
      assert.match(src, /utilPct/, `${page}.jsx must use utilPct for utilisation display`)
    }
  })

  it('memory display is unaffected: the engine already reports memoryUtilization as a percentage', () => {
    const sim = runSimulation(toContract(strongArchitecture()), { arrivalRate: 200, duration: 30, seed: 1 }, {})
    const comps = Object.values(sim.components)
    const mem = comps.find((c) => c.memoryUtilization > 1)
    assert.ok(mem, 'expected at least one component above 1% memory')
    // MemoryChart plots absolute MB, so no conversion belongs here.
    assert.doesNotMatch(read('src/components/charts.jsx'), /memoryUtilization/)
  })
})

describe('session restore under StrictMode', () => {
  it('hydration is guarded at module scope, not with a component ref', () => {
    const ctx = read('src/store/AppContext.jsx')
    assert.match(ctx, /let hydrationState = 'idle'/)
    assert.doesNotMatch(ctx, /hydrated\.current/, 'a ref latch is discarded by StrictMode cleanup')
  })

  it('hydration results are applied even after the effect cleanup runs', () => {
    const ctx = read('src/store/AppContext.jsx')
    // The old bug: `if (cancelled) return` after the await threw the /auth/me result away.
    assert.doesNotMatch(ctx, /cancelled/)
    assert.match(ctx, /if \(!current\(\)\) return/)
  })

  it('a failed hydration can be retried', () => {
    const ctx = read('src/store/AppContext.jsx')
    // The latch is reset on the failure paths and on session invalidation.
    assert.match(ctx, /hydrationState = 'idle'/)
  })
})

describe('deep link redirect', () => {
  it('Login honours the originally requested route when already signed in', () => {
    const login = read('src/pages/Login.jsx')
    assert.match(login, /if \(isAuthed\) \{[\s\S]*?from && typeof from === 'string' \? from : '\/dashboard'/)
    assert.doesNotMatch(login, /if \(isAuthed\) return <Navigate to="\/dashboard"/)
  })

  it('Protected still records where the user was headed', () => {
    assert.match(read('src/App.jsx'), /state=\{\{ from: location\.pathname \}\}/)
  })
})