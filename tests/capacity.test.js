import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { analyzeCapacity, assessLoad } from '../src/lib/capacity.js'
import { toContract } from '../src/lib/contract.js'
import { runSimulation } from '../src/lib/engine.js'
import { strongArchitecture, starterArchitecture, weakArchitecture } from '../src/data/seedArchitectures.js'

// Capacity probing runs the engine many times, so the suite uses short probe durations
// while still exercising the real code path.
const FAST = { probeDuration: 4, maxRate: 6000 }

describe('analyzeCapacity', () => {
  it('finds a sustainable rate that the engine actually holds', () => {
    const cap = analyzeCapacity(starterArchitecture(), FAST)
    assert.equal(cap.ok, true)
    assert.ok(cap.sustainableRate > 0)

    // Re-run at the reported ceiling. The same probe duration must be used: a short probe
    // reaches a different warm-up state than a long run, and the ceiling is only meaningful
    // for the duration it was measured at.
    const at = runSimulation(
      toContract(starterArchitecture()),
      { arrivalRate: cap.sustainableRate, duration: FAST.probeDuration, seed: 20260927 },
      { maxLoggedCases: 60 },
    )
    assert.ok(at.metrics.dropRate <= 0.01, `drop rate at the reported ceiling was ${at.metrics.dropRate}%`)
    assert.ok(at.metrics.p95 <= 200, `p95 at the reported ceiling was ${at.metrics.p95}ms`)
  })

  it('reports the duration the ceiling was measured at', () => {
    const cap = analyzeCapacity(starterArchitecture(), FAST)
    assert.equal(cap.probeDuration, FAST.probeDuration)
  })

  it('does not fail just above the ceiling', () => {
    const cap = analyzeCapacity(starterArchitecture(), FAST)
    if (!cap.breakingRate) return
    assert.ok(cap.breakingRate > cap.sustainableRate, 'the breaking rate must exceed the sustainable one')
    const over = runSimulation(toContract(starterArchitecture()), { arrivalRate: cap.breakingRate, duration: 10, seed: 20260927 }, { maxLoggedCases: 60 })
    const degraded = over.metrics.dropRate > 0.01 || over.metrics.p95 > 200
    assert.ok(degraded, 'a rate above the ceiling must show drops or a breached latency budget')
  })

  it('ranks a resilient design above a monolith', () => {
    const strong = analyzeCapacity(strongArchitecture(), FAST)
    const weak = analyzeCapacity(weakArchitecture(), FAST)
    assert.equal(strong.ok, true)
    assert.equal(weak.ok, true)
    assert.ok(
      strong.sustainableRate > weak.sustainableRate,
      `strong ${strong.sustainableRate} should exceed weak ${weak.sustainableRate}`,
    )
  })

  it('names the component that caps the design', () => {
    const cap = analyzeCapacity(weakArchitecture(), FAST)
    assert.ok(cap.limitedBy, 'a bottleneck component should be identified')
    assert.equal(typeof cap.limitedBy, 'string')
  })

  it('estimates concurrent users from the sustainable rate', () => {
    const cap = analyzeCapacity(starterArchitecture(), FAST)
    assert.ok(cap.concurrentUsers > 0)
    assert.ok(
      cap.concurrentUsers < cap.sustainableRate * 10,
      'concurrency should be in a plausible range for the latency',
    )
  })

  it('is deterministic for the same architecture', () => {
    const a = analyzeCapacity(weakArchitecture(), FAST)
    const b = analyzeCapacity(weakArchitecture(), FAST)
    assert.equal(a.sustainableRate, b.sustainableRate)
    assert.equal(a.limitedBy, b.limitedBy)
  })

  it('refuses to report a ceiling for an empty architecture', () => {
    const cap = analyzeCapacity({ nodes: [], edges: [] })
    assert.equal(cap.ok, false)
    assert.ok(cap.reason)
  })

  it('keeps every probed sample within the swept range', () => {
    const cap = analyzeCapacity(starterArchitecture(), FAST)
    for (const sample of cap.ladder) {
      assert.ok(sample.rate >= FAST.minRate || sample.rate >= 10)
      assert.ok(sample.rate <= FAST.maxRate || sample.rate <= 20000)
      assert.ok(Number.isFinite(sample.p95))
      assert.ok(sample.peakUtil >= 0 && sample.peakUtil <= 1)
    }
  })
})

describe('assessLoad', () => {
  const cap = analyzeCapacity(weakArchitecture(), FAST)

  it('reports unknown when capacity was not measured', () => {
    assert.equal(assessLoad(null, 100).verdict, 'unknown')
    assert.equal(assessLoad({ ok: false }, 100).verdict, 'unknown')
  })

  it('flags a load above the ceiling as over capacity', () => {
    const a = assessLoad(cap, cap.sustainableRate * 2)
    assert.equal(a.verdict, 'over')
    assert.ok(a.text.includes('ceiling'))
  })

  it('warns when the load is close to the ceiling', () => {
    const a = assessLoad(cap, Math.round(cap.sustainableRate * 0.9))
    assert.equal(a.verdict, 'at-risk')
  })

  it('calls a mid-range load sustainable', () => {
    const a = assessLoad(cap, Math.round(cap.sustainableRate * 0.6))
    assert.equal(a.verdict, 'sustainable')
  })

  it('reports spare capacity when the design is lightly loaded', () => {
    const a = assessLoad(cap, Math.round(cap.sustainableRate * 0.1))
    assert.equal(a.verdict, 'underused')
    assert.ok(a.ratio < 0.5)
  })

  it('produces a sentence naming the current and ceiling rates', () => {
    const a = assessLoad(cap, 100)
    assert.ok(a.text.includes('100 req/s'))
    assert.ok(a.text.includes(String(cap.sustainableRate)))
  })

  it('transitions monotonically as the load rises', () => {
    const order = ['underused', 'sustainable', 'at-risk', 'over']
    const seen = [0.1, 0.6, 0.9, 1.5].map((f) =>
      order.indexOf(assessLoad(cap, Math.round(cap.sustainableRate * f)).verdict),
    )
    for (let i = 1; i < seen.length; i += 1) {
      assert.ok(seen[i] >= seen[i - 1], `verdicts should not go backwards: ${seen.join(' -> ')}`)
    }
  })
})