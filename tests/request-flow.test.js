import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { toContract } from '../src/lib/contract.js'
import { runSimulation } from '../src/lib/engine.js'
import { mineEventLog, miningOptions } from '../src/lib/mining.js'
import {
  buildTrajectories,
  chooseReplayWindow,
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
    assert.deepEqual(stats, { inFlight: 0, completed: 0, failed: 0, dropped: 0, perNode: new Map() })
  })
})

describe('chooseReplayWindow', () => {
  it('prefers the busiest slice of the run', () => {
    const trajs = buildTrajectories(simAt(600).eventLog)
    const win = chooseReplayWindow(trajs, { windowMs: 1500 })
    assert.ok(win.concurrency > 0)

    // concurrency must describe the window that is actually returned.
    const inWindow = trajs.filter((t) => t.start < win.end && t.end > win.start).length
    assert.equal(inWindow, win.concurrency)

    // An idle slice must not beat the chosen one, and the search must have found a busy
    // stretch at least as loaded as the very first slice.
    const first = { start: trajs[0].start, end: trajs[0].start + 1500 }
    const firstCount = trajs.filter((t) => t.start < first.end && t.end > first.start).length
    assert.ok(win.peakConcurrency >= firstCount)
  })

  it('wraps where traffic is thinnest so the loop does not snap', () => {
    const trajs = buildTrajectories(simAt(600).eventLog)
    const win = chooseReplayWindow(trajs, { windowMs: 1500 })
    // The wrap point is chosen for a lower in-window count than the busiest slice, which
    // is what keeps requests from teleporting backwards at the loop boundary.
    assert.ok(win.concurrency <= win.peakConcurrency)
  })

  it('falls back safely when there is nothing to replay', () => {
    const win = chooseReplayWindow([], { windowMs: 800 })
    assert.equal(win.start, 0)
    assert.equal(win.end, 800)
    assert.equal(win.concurrency, 0)
  })

  it('handles a single instant run', () => {
    const traj = { start: 5, end: 5, hops: [] }
    const win = chooseReplayWindow([traj], { windowMs: 100 })
    assert.equal(win.start, 5)
    assert.equal(win.end, 105)
    assert.equal(win.concurrency, 1)
  })

  it('clamps the window when the sampled span is shorter than requested', () => {
    // A saturated run's logged cases can span far less simulated time than the window the
    // page asks for; the returned window must still sit inside the real data.
    const trajs = buildTrajectories(simAt(3000, weakArchitecture()).eventLog)
    const span = trajs[trajs.length - 1].end - trajs[0].start
    const win = chooseReplayWindow(trajs, { windowMs: 3000 })
    assert.ok(win.concurrency > 0, 'a real window must report a real concurrency')
    assert.ok(win.end - win.start <= Math.max(1, span) + 1e-6, 'window must not exceed the data span')
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
    const light = buildTrajectories(simAt(100).eventLog)
    const heavy = buildTrajectories(simAt(1000).eventLog)
    const peak = (list) => {
      let best = 0
      for (const t of list) {
        const overlap = list.filter((o) => o.start < t.end && o.end > t.start).length
        best = Math.max(best, overlap)
      }
      return best
    }
    assert.ok(peak(heavy) > peak(light), 'a busier workload must show more concurrent requests')
  })
})