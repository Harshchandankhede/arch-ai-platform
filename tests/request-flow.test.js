import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { toContract } from '../src/lib/contract.js'
import { runSimulation } from '../src/lib/engine.js'
import { mineEventLog, miningOptions } from '../src/lib/mining.js'
import {
  buildTrajectories,
  locateAt,
  statsAt,
} from '../src/lib/trajectories.js'
import { strongArchitecture, weakArchitecture } from '../src/data/seedArchitectures.js'

const OPTS = { maxLoggedCases: 400 }

function simAt(rate, arch = strongArchitecture()) {
  return runSimulation(toContract(arch), { arrivalRate: rate, duration: 60, seed: 20260927 }, OPTS)
}

describe('buildTrajectories', () => {
  it('produces one trajectory per simulated request', () => {
    const sim = simAt(100)
    const trajs = buildTrajectories(sim.eventLog)
    assert.equal(trajs.length, new Set(sim.eventLog.map((e) => e.caseId)).size)
    assert.ok(trajs.length > 300, `expected hundreds of trajectories, got ${trajs.length}`)
  })

  it('orders hops by the real event timestamps', () => {
    const trajs = buildTrajectories(simAt(100).eventLog)
    const multi = trajs.find((t) => t.hops.length > 2)
    assert.ok(multi, 'expected a multi-hop request')
    for (let i = 1; i < multi.hops.length; i += 1) {
      assert.ok(multi.hops[i].enter >= multi.hops[i - 1].enter, 'hops must be chronological')
    }
    assert.equal(multi.start, multi.hops[0].enter)
    assert.equal(multi.end, multi.hops[multi.hops.length - 1].exit)
  })

  it('records measured service duration per hop, not a fixed guess', () => {
    const trajs = buildTrajectories(simAt(100).eventLog)
    const durations = new Set()
    for (const traj of trajs) {
      for (const hop of traj.hops) durations.add(Math.round((hop.exit - hop.enter) * 1000))
    }
    assert.ok(durations.size > 3, `service times should vary, saw ${durations.size} distinct values`)
  })

  it('produces latencies consistent with the engine run window', () => {
    const sim = simAt(100)
    const trajs = buildTrajectories(sim.eventLog)
    const latencies = trajs.map((t) => t.latency).sort((a, b) => a - b)
    // The event log is a deterministic sample of cases, not the whole run, so its
    // distribution differs from sim.metrics. Assert it is a plausible sample of the same
    // run rather than an exact match to the percentile helpers.
    assert.ok(latencies.every((l) => l > 0), 'every trajectory must have a positive latency')
    assert.ok(latencies.every((l) => l <= sim.metrics.maxLatencyMs + 1e-6), 'no trajectory may exceed the slowest observed request')
    const p95 = latencies[Math.floor(latencies.length * 0.95)]
    assert.ok(
      p95 >= sim.metrics.p50 && p95 <= sim.metrics.p99,
      `sampled p95 ${p95} should sit within the engine's [p50 ${sim.metrics.p50}, p99 ${sim.metrics.p99}] band`,
    )
    assert.ok(trajs.length < sim.metrics.totalRequests, 'the log is a sample of the run')
  })

  it('classifies outcomes from real terminal events', () => {
    const healthy = buildTrajectories(simAt(100).eventLog)
    assert.ok(healthy.every((t) => t.outcome === 'completed' || t.outcome === 'retried'))

    const overloaded = buildTrajectories(simAt(3000, weakArchitecture()).eventLog)
    const outcomes = new Set(overloaded.map((t) => t.outcome))
    assert.ok(outcomes.has('dropped'), 'a saturated run must produce dropped requests')
    assert.ok(
      outcomes.has('failed') || outcomes.has('retried'),
      'a saturated run must produce failures or retries',
    )
    // A retried request still completed, so it must not be reported as a failure.
    for (const traj of overloaded) {
      if (traj.outcome === 'failed') assert.equal(traj.failures > 0, true)
      if (traj.outcome === 'retried') assert.ok(traj.failures > 0)
    }
  })

  it('is deterministic for the same event log', () => {
    const log = simAt(200).eventLog
    assert.deepEqual(buildTrajectories(log), buildTrajectories(log))
  })

  it('handles an empty or malformed log without throwing', () => {
    assert.deepEqual(buildTrajectories([]), [])
    assert.deepEqual(buildTrajectories(null), [])
    assert.deepEqual(buildTrajectories([{ caseId: 1 }, { caseId: 1, activity: 'WEIRD' }]), [])
  })

  it('respects maxCases', () => {
    const log = simAt(100).eventLog
    assert.equal(buildTrajectories(log, { maxCases: 25 }).length, 25)
  })
})

describe('locateAt', () => {
  it('reports nothing outside a request lifetime', () => {
    const [traj] = buildTrajectories(simAt(100).eventLog)
    assert.equal(locateAt(traj, traj.start - 1), null)
    assert.equal(locateAt(traj, traj.end + 500), null)
  })

  it('pins a request to its component while it is being served', () => {
    const traj = buildTrajectories(simAt(100).eventLog).find((t) => t.hops.length > 2)
    const hop = traj.hops[1]
    const mid = hop.enter + (hop.exit - hop.enter) / 2
    const where = locateAt(traj, mid)
    assert.equal(where.kind, 'service')
    assert.equal(where.nodeId, hop.id)
    assert.ok(where.progress > 0.3 && where.progress < 0.7)
  })

  it('moves between components during transit', () => {
    const trajs = buildTrajectories(simAt(100).eventLog)
    const traj = trajs.find((t) => {
      for (let i = 0; i < t.hops.length - 1; i += 1) {
        if (t.hops[i + 1].enter > t.hops[i].exit) return true
      }
      return false
    })
    assert.ok(traj, 'expected a request with a transit gap between hops')
    const i = traj.hops.findIndex((h, idx) => idx < traj.hops.length - 1 && traj.hops[idx + 1].enter > h.exit)
    const between = (traj.hops[i].exit + traj.hops[i + 1].enter) / 2
    const where = locateAt(traj, between)
    assert.equal(where.kind, 'transit')
    assert.equal(where.fromId, traj.hops[i].id)
    assert.equal(where.toId, traj.hops[i + 1].id)
  })
})

describe('statsAt', () => {
  it('partitions every request into exactly one bucket', () => {
    const trajs = buildTrajectories(simAt(3000, weakArchitecture()).eventLog)
    const at = trajs[Math.floor(trajs.length / 2)].start + 50
    const stats = statsAt(trajs, at)
    // Requests that have not started yet are in none of the four buckets, so the totals
    // must equal the number that have already entered, not the total trajectory count.
    const started = trajs.filter((t) => t.start <= at).length
    assert.equal(stats.completed + stats.failed + stats.dropped + stats.inFlight, started)
    assert.ok(started < trajs.length, 'some requests are still in the future at this instant')
  })

  it('reports zero activity before the run starts', () => {
    const trajs = buildTrajectories(simAt(100).eventLog)
    const stats = statsAt(trajs, trajs[0].start - 1)
    assert.equal(stats.inFlight, 0)
    assert.equal(stats.completed, 0)
    assert.equal(stats.perNode.size, 0)
  })

  it('attributes in-flight requests to real components', () => {
    const trajs = buildTrajectories(simAt(600).eventLog)
    const stats = statsAt(trajs, trajs[Math.floor(trajs.length / 2)].start + 30)
    const known = new Set(trajs.flatMap((t) => t.hops.map((h) => h.id)))
    for (const id of stats.perNode.keys()) {
      assert.ok(known.has(id), `unknown component in per-node counts: ${id}`)
    }
  })

  it('is safe with no trajectories', () => {
    const stats = statsAt([], 0)
    assert.deepEqual(stats, {
      inFlight: 0,
      completed: 0,
      failed: 0,
      dropped: 0,
      estimated: false,
      perNode: new Map(),
    })
  })
})


describe('the animation is driven by the simulation, not decoration', () => {
  it('derives its data from the same event log the mining stage consumes', () => {
    const sim = simAt(100)
    const trajs = buildTrajectories(sim.eventLog)
    const mining = mineEventLog(sim.eventLog, toContract(strongArchitecture()), miningOptions(sim))
    assert.equal(trajs.length, mining.statistics.loggedCases)
    assert.equal(trajs.length, mining.variants.reduce((sum, v) => sum + v.count, 0))
  })

  it('changes when the workload changes', () => {
    const lightSim = simAt(100)
    const heavySim = simAt(1000)
    // The event log holds every Nth arrival so that it spans the whole run, so raw counts
    // of sampled cases are not concurrency. Both runs are sampled to the same 400 cases,
    // which means the sample alone says nothing about load; the logging stride carries
    // that information and has to be applied before comparing.
    const peak = (sim) => {
      const list = buildTrajectories(sim.eventLog)
      const stride = Math.max(1, Number(sim.loggingStats.sampleEvery) || 1)
      let best = 0
      for (const traj of list) {
        const overlap = list.filter((o) => o.start < traj.end && o.end > traj.start).length
        best = Math.max(best, overlap)
      }
      return best * stride
    }
    assert.ok(
      peak(heavySim) > peak(lightSim),
      `a busier workload must show more concurrent requests (light ${peak(lightSim)}, heavy ${peak(heavySim)})`,
    )
  })

  it('the log is spread across the whole run, not clustered at its start', () => {
    // Logging only the first N arrivals meant a long run was represented by its opening
    // seconds, so the replay could never line up with the configured duration.
    const sim = simAt(300)
    const list = buildTrajectories(sim.eventLog)
    assert.ok(list.length > 100, `expected a populated sample, got ${list.length}`)
    const span = list[list.length - 1].end - list[0].start
    const runMs = sim.duration * 1000
    assert.ok(
      span > runMs * 0.9,
      `the logged sample should cover most of the ${sim.duration}s run, covered ${(span / 1000).toFixed(1)}s`,
    )
    // Sampling must stay within the logging budget.
    assert.ok(list.length <= sim.loggingStats.sampledCases)
  })

  it('statsAt extrapolates sampled counters and leaves the per-node split alone', () => {
    const sim = simAt(300)
    const list = buildTrajectories(sim.eventLog)
    const stride = Math.max(1, Number(sim.loggingStats.sampleEvery) || 1)
    const at = list[0].start + (list[list.length - 1].end - list[0].start) / 2

    const raw = statsAt(list, at)
    const scaled = statsAt(list, at, { scale: stride })

    assert.equal(raw.estimated, false)
    assert.equal(scaled.estimated, stride > 1)
    assert.ok(scaled.inFlight >= raw.inFlight, 'a sampled count must not be reported below the raw sample')
    // The distribution is relative; scaling it would not make it more accurate.
    assert.equal(raw.perNode.size, scaled.perNode.size)
  })
})
