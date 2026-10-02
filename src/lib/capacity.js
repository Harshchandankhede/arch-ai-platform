// Finds how much load an architecture can actually sustain, using the same discrete event
// engine as the main run. A rate is "sustainable" when it serves every request it accepts
// without dropping any and keeps p95 inside the latency budget, so the answer is measured
// from the model rather than estimated from component capacities.

import { runSimulation } from './engine.js'
import { toContract } from './contract.js'

const DEFAULTS = {
  // Matches LATENCY_BUDGET_MS in evaluation.js, so "sustainable" here agrees with the
  // Performance dimension on the Evaluation page.
  latencyBudgetMs: 200,
  // A short probe run keeps the sweep cheap. The steady-state rate is reached well before
  // the run ends, and every candidate uses the same seed so results are comparable.
  // The ceiling is only meaningful for this duration, which is reported back to the caller.
  probeDuration: 5,
  minRate: 25,
  // Bounded so the sweep cannot walk into a very expensive probe. A design that is still
  // healthy at this rate is reported as "at least" rather than given a false exact ceiling.
  maxRate: 6000,
  maxDropRatePct: 0.01,
  seed: 20260927,
  samples: 9,
  // Binary-search refinement steps. Six localises the knee without turning the sweep into
  // dozens of engine runs.
  refineSteps: 6,
}

function probe(contract, rate, options) {
  const sim = runSimulation(contract, { arrivalRate: rate, duration: options.probeDuration, seed: options.seed }, {
    maxLoggedCases: 60,
  })
  const m = sim.metrics
  const components = Object.values(sim.components || {})
  const peakUtil = components.reduce((max, c) => Math.max(max, Number(c.utilization) || 0), 0)
  const peakMemory = components.reduce((max, c) => Math.max(max, Number(c.memoryUtilization) || 0), 0)

  return {
    rate,
    p95: m.p95,
    avg: m.avgLatencyMs,
    throughput: m.throughputPerSec,
    dropRate: m.dropRate,
    failureRate: m.failureRate,
    totalRequests: m.totalRequests,
    peakUtil,
    peakMemory,
    // The component that saturated first is what caps the design.
    hottest: components.slice().sort((a, b) => (b.utilization || 0) - (a.utilization || 0))[0]?.name || null,
  }
}

function sustainable(sample, options) {
  return sample.dropRate <= options.maxDropRatePct && sample.p95 <= options.latencyBudgetMs
}

/**
 * Binary-searches the highest sustainable arrival rate, then reports how close the
 * current load is to that ceiling.
 */
export function analyzeCapacity(architecture, options = {}) {
  const opts = { ...DEFAULTS, ...(options && typeof options === 'object' ? options : {}) }
  const contract = architecture && architecture.nodes ? toContract(architecture) : toContract({ nodes: [], edges: [] })

  if (!contract.nodes.length) {
    return { ok: false, reason: 'This architecture has no components yet.' }
  }

  const ladder = []
  let low = opts.minRate
  let high = opts.minRate
  let lastGood = null
  let firstBad = null

  // Coarse ladder: double until something breaks, so a wide architecture is not probed
  // hundreds of times before we even find its ceiling.
  for (let i = 0; i < 14; i += 1) {
    const sample = probe(contract, high, opts)
    ladder.push(sample)
    if (sustainable(sample, opts)) {
      lastGood = sample
      if (high >= opts.maxRate) break
      low = high
      high = Math.min(opts.maxRate, Math.ceil(high * 2))
    } else {
      firstBad = sample
      break
    }
  }

  if (!lastGood) {
    // Even the slowest probe failed, so there is no sustainable rate to report.
    return {
      ok: false,
      reason: 'This architecture could not serve the slowest probe rate without latency or drops.',
      ladder,
      samples: ladder,
    }
  }

  // Narrow down to the knee between the last good rate and the first failing one.
  if (high > low && firstBad) {
    for (let i = 0; i < opts.refineSteps; i += 1) {
      const mid = Math.round((low + high) / 2)
      if (mid <= low || mid >= high) break
      const sample = probe(contract, mid, opts)
      ladder.push(sample)
      if (sustainable(sample, opts)) {
        lastGood = sample
        low = mid
      } else {
        firstBad = sample
        high = mid
      }
    }
  }

  const samples = ladder.slice().sort((a, b) => a.rate - b.rate).slice(0, opts.samples)
  const sustainableRate = lastGood.rate
  const breakingRate = firstBad ? firstBad.rate : null

  // Little's Law converts the sustainable request rate into a concurrent-user figure,
  // which is the number architecture reviews usually ask for.
  const meanLatencyS = Math.max(0.001, (lastGood.avg || 1) / 1000)
  const concurrentUsers = Math.round(sustainableRate * meanLatencyS)

  return {
    ok: true,
    sustainableRate,
    breakingRate,
    concurrentUsers,
    latencyBudgetMs: opts.latencyBudgetMs,
    // The ceiling is only meaningful for the duration it was measured at; a longer run
    // reaches a deeper warm-up and can degrade sooner.
    probeDuration: opts.probeDuration,
    // True when the sweep ran out of headroom before the design broke, so the reported
    // rate is a lower bound rather than the true ceiling.
    atCeilingLimit: !firstBad,
    atCeiling: lastGood,
    justOver: firstBad,
    limitedBy: lastGood.hottest,
    ladder,
    samples,
  }
}

/** Where the supplied load sits relative to the measured ceiling. */
export function assessLoad(capacity, arrivalRate, latencyBudgetMs) {
  if (!capacity || !capacity.ok) {
    return { verdict: 'unknown', text: 'Capacity has not been measured for this architecture.' }
  }
  const rate = capacity.sustainableRate
  const ceiling = capacity.atCeilingLimit ? `at least ${rate}` : String(rate)
  const ratio = arrivalRate / rate
  const budget = latencyBudgetMs ?? capacity.latencyBudgetMs

  if (ratio > 1) {
    return {
      verdict: 'over',
      ratio,
      text: `At ${arrivalRate} req/s this design is past its measured ceiling of ${ceiling} req/s. Requests are being dropped or breaching the ${budget} ms p95 budget.`,
    }
  }
  if (ratio > 0.85) {
    return {
      verdict: 'at-risk',
      ratio,
      text: `At ${arrivalRate} req/s this design is at ${Math.round(ratio * 100)}% of its ${ceiling} req/s ceiling. It holds now, with little margin before it degrades.`,
    }
  }
  if (ratio > 0.5) {
    return {
      verdict: 'sustainable',
      ratio,
      text: `At ${arrivalRate} req/s this design is at ${Math.round(ratio * 100)}% of its ${ceiling} req/s ceiling. That is a sustainable operating point.`,
    }
  }
  return {
    verdict: 'underused',
    ratio,
    text: `At ${arrivalRate} req/s this design is only using ${Math.round(ratio * 100)}% of its ${ceiling} req/s ceiling. It could absorb roughly ${Math.max(0, rate - arrivalRate).toLocaleString()} more req/s.`,
  }
}