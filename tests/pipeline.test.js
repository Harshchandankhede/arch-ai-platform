import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { toContract, expectedPaths, archHash, graphOf } from '../src/lib/contract.js'
import { runSimulation } from '../src/lib/engine.js'
import { mineEventLog, miningOptions } from '../src/lib/mining.js'
import { evaluateArchitecture, readMetrics } from '../src/lib/evaluation.js'
import { buildRecommendations } from '../src/lib/recommendations.js'
import {
  starterArchitecture,
  strongArchitecture,
  weakArchitecture,
} from '../src/data/seedArchitectures.js'

const OPTIONS = { maxLoggedCases: 400 }

function pipeline(arch, rate, seed = 20260927) {
  const contract = toContract(arch)
  const sim = runSimulation(contract, { arrivalRate: rate, duration: 60, seed }, OPTIONS)
  const mining = mineEventLog(sim.eventLog, contract, miningOptions(sim))
  const evaluation = evaluateArchitecture(contract, sim, mining)
  const recommendations = buildRecommendations(contract, sim, mining, evaluation)
  return { contract, sim, mining, evaluation, recommendations }
}

describe('engine', () => {
  it('completes every request when the architecture has ample capacity', () => {
    const { sim } = pipeline(starterArchitecture(), 100)
    assert.equal(sim.metrics.droppedRequests, 0)
    assert.ok(sim.metrics.totalRequests > 5000, `expected >5000 requests, got ${sim.metrics.totalRequests}`)
    assert.ok(sim.metrics.completedRequests > 5000)
  })

  it('is deterministic for a given seed', () => {
    const a = pipeline(starterArchitecture(), 200).sim.metrics
    const b = pipeline(starterArchitecture(), 200).sim.metrics
    assert.deepEqual(a, b)
  })

  it('changes outcome when the seed changes', () => {
    const a = pipeline(starterArchitecture(), 200, 1).sim.metrics
    const b = pipeline(starterArchitecture(), 200, 2).sim.metrics
    assert.notDeepEqual(a, b)
  })

  it('degrades latency as load rises past capacity', () => {
    const light = pipeline(weakArchitecture(), 100).sim.metrics
    const heavy = pipeline(weakArchitecture(), 2000).sim.metrics
    assert.ok(
      heavy.p95 > light.p95,
      `expected p95 to grow with load: ${light.p95} -> ${heavy.p95}`,
    )
  })

  it('drops requests once queues overflow', () => {
    const { sim } = pipeline(weakArchitecture(), 3000)
    assert.ok(sim.metrics.droppedRequests > 0, 'expected drops at 3000 req/s')
  })

  it('survives an empty architecture', () => {
    const { sim, evaluation, mining } = pipeline({ nodes: [], edges: [] }, 100)
    assert.equal(sim.metrics.totalRequests, 0)
    assert.equal(evaluation.healthScore, 0)
    assert.deepEqual(mining.bottlenecks, [])
  })
})

describe('process mining', () => {
  it('reports full conformance for an architecture that follows its expected paths', () => {
    const { mining } = pipeline(starterArchitecture(), 100)
    assert.equal(mining.statistics.conformanceRate, 1)
  })

  it('derives expected paths from the architecture graph', () => {
    const contract = toContract(starterArchitecture())
    const paths = expectedPaths(contract, 6)
    assert.equal(paths.length, 1, 'a linear 3-tier has exactly one path')
    assert.deepEqual(
      paths[0].map((s) => s.name),
      ['User', 'API Gateway', 'App Server', 'Database'],
    )
  })

  it('surfaces multiple variants when routing can branch', () => {
    const { mining } = pipeline(strongArchitecture(), 300)
    assert.ok(mining.variants.length >= 2, `expected branching variants, got ${mining.variants.length}`)
  })

  it('detects queueing bottlenecks once the system saturates', () => {
    const { mining } = pipeline(weakArchitecture(), 3000)
    assert.ok(
      mining.bottlenecks.length > 0,
      'expected at least one bottleneck at 3000 req/s — regression guard for the readCase wait bug',
    )
  })

  it('reports no bottleneck when nothing actually queues', () => {
    const { mining } = pipeline(starterArchitecture(), 100)
    assert.equal(mining.bottlenecks.length, 0, 'an idle system has no bottleneck')
  })

  it('measures real queue residence time, not network transit', () => {
    const { sim, mining } = pipeline(weakArchitecture(), 3000)
    const engineWorst = Math.max(...Object.values(sim.components).map((c) => c.avgQueueWaitMs))
    const minedWorst = Math.max(...mining.bottlenecks.map((b) => b.waitingMs))
    // Mined waits come from a 400-case log prefix, so they sit below the engine's
    // full-run figure — but they must be in the same order of magnitude now that
    // QUEUE_ENTER -> QUEUE_EXIT is measured.
    assert.ok(minedWorst > 5, `mined wait ${minedWorst}ms should exceed the 5ms floor`)
    assert.ok(
      minedWorst < engineWorst * 2,
      `mined wait ${minedWorst}ms is implausible against engine wait ${engineWorst}ms`,
    )
  })

  it('ranks the queue-depth-maximising component as the worst bottleneck', () => {
    const { sim, mining } = pipeline(weakArchitecture(), 3000)
    const worstByDepth = Object.values(sim.components).sort(
      (a, b) => b.queueLengthMax - a.queueLengthMax,
    )[0]
    assert.ok(mining.bottlenecks.length > 0)
    assert.equal(mining.bottlenecks[0].component, worstByDepth.name)
  })

  it('passes engine utilisation into severity instead of defaulting to zero', () => {
    const { mining } = pipeline(weakArchitecture(), 3000)
    for (const b of mining.bottlenecks) {
      assert.equal(b.severity, b.severity.toLowerCase())
      assert.ok(['low', 'med', 'high'].includes(b.severity))
    }
    assert.ok(
      mining.bottlenecks.some((b) => b.severity !== 'low'),
      'a 3000 req/s collapse should not be reported as uniformly low severity',
    )
  })

  it('finds fewer variants and more deviations as chaos rises', () => {
    const { mining } = pipeline(weakArchitecture(), 3000)
    assert.ok(mining.deviations.length > 0, 'expected deviations under heavy failure')
  })
})

describe('evaluation', () => {
  it('scores all six dimensions as numbers', () => {
    const { evaluation } = pipeline(starterArchitecture(), 100)
    for (const key of ['performance', 'scalability', 'reliability', 'security', 'maintainability', 'processEfficiency']) {
      assert.equal(typeof evaluation.dimensions[key], 'number', `${key} missing`)
      assert.ok(evaluation.dimensions[key] >= 0 && evaluation.dimensions[key] <= 100)
    }
    assert.ok(evaluation.healthScore > 0 && evaluation.healthScore <= 100)
  })

  it('ranks the resilient architecture above the monolith', () => {
    const strong = pipeline(strongArchitecture(), 300).evaluation.healthScore
    const weak = pipeline(weakArchitecture(), 300).evaluation.healthScore
    assert.ok(strong > weak, `strong ${strong} should beat weak ${weak}`)
  })

  it('ranks the simple tier above the monolith', () => {
    const starter = pipeline(starterArchitecture(), 300).evaluation.healthScore
    const weak = pipeline(weakArchitecture(), 300).evaluation.healthScore
    assert.ok(starter > weak, `starter ${starter} should beat weak ${weak}`)
  })

  it('decreases monotonically as load increases', () => {
    const scores = [50, 100, 300, 600, 1000, 2000].map(
      (rate) => pipeline(weakArchitecture(), rate).evaluation.healthScore,
    )
    for (let i = 1; i < scores.length; i += 1) {
      assert.ok(
        scores[i] <= scores[i - 1],
        `health score rose with load at index ${i}: ${scores.join(' -> ')}`,
      )
    }
  })

  it('converts engine percentages into fractions before scoring', () => {
    const { sim, evaluation } = pipeline(starterArchitecture(), 100)
    const m = readMetrics(sim)
    assert.ok(m.failureRate <= 1, `failureRate must be a 0-1 fraction, got ${m.failureRate}`)
    assert.ok(m.dropRate <= 1, `dropRate must be a 0-1 fraction, got ${m.dropRate}`)
    // 1 failure in ~6000 is 0.017% -> 0.00017 as a fraction, which must not be
    // treated as 17% loss against a 10% ceiling.
    assert.ok(evaluation.dimensions.performance > 70, 'a single failure must not tank performance')
  })

  it('penalises real latency rather than clamping every sub-budget p95 to 100', () => {
    const fast = pipeline(strongArchitecture(), 300).evaluation.dimensions.performance
    const slow = pipeline(weakArchitecture(), 300).evaluation.dimensions.performance
    assert.ok(fast > slow, `fast ${fast} must outscore slow ${slow}`)
  })

  it('gives memory headroom credit proportional to actual memory use', () => {
    const { evaluation } = pipeline(strongArchitecture(), 300)
    assert.ok(
      evaluation.dimensions.scalability > 0,
      'scalability must be able to exceed the structural floor',
    )
    assert.ok(evaluation.notes.scalability.length > 0, 'every dimension needs an explanation')
  })
})

describe('recommendations', () => {
  it('always returns an array with usable entries', () => {
    const { recommendations } = pipeline(weakArchitecture(), 1000)
    assert.ok(Array.isArray(recommendations))
    for (const r of recommendations) {
      assert.ok(r.id, 'recommendation needs an id')
      assert.ok(r.title, 'recommendation needs a title')
      assert.ok(['high', 'med', 'low'].includes(r.severity))
    }
  })

  it('marks a saturating architecture with at least one high-severity item', () => {
    const { recommendations } = pipeline(weakArchitecture(), 3000)
    assert.ok(
      recommendations.some((r) => r.severity === 'high'),
      'a collapsing architecture must produce a high-severity recommendation',
    )
  })

  it('reacts to the architecture, not just the workload', () => {
    const strong = pipeline(strongArchitecture(), 1000).recommendations.map((r) => r.id)
    const weak = pipeline(weakArchitecture(), 1000).recommendations.map((r) => r.id)
    assert.notDeepEqual(strong, weak, 'identical recommendation sets for different architectures')
  })
})

describe('contract', () => {
  it('hashes equal architectures identically and different ones differently', () => {
    assert.equal(archHash(starterArchitecture()), archHash(starterArchitecture()))
    assert.notEqual(archHash(starterArchitecture()), archHash(weakArchitecture()))
  })

  it('ignores edges that reference missing nodes without crashing the engine', () => {
    const dangling = {
      nodes: [{ id: 'a', type: 'server', name: 'A', parameters: {} }],
      edges: [{ id: 'e1', source: 'a', target: 'ghost' }],
    }
    // graphOf drops the edge, so no phantom node enters the simulation.
    const graph = graphOf(dangling)
    assert.equal(graph.nodes.length, 1)
    assert.deepEqual(graph.outgoing.get('a'), [])

    const { sim } = pipeline(dangling, 50)
    assert.ok(sim.metrics.totalRequests > 0, 'the reachable node still serves requests')
    assert.equal(
      sim.metrics.droppedRequests,
      0,
      'a dangling edge must not cause drops or crashes',
    )
  })
})
