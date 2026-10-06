import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DIGEST_VERSION,
  MAX_SUMMARIES,
  isUsableDigest,
  readSummary,
  storeSummary,
  summaryId,
  toSimDigest,
} from '../src/lib/simSummary.js'

/** A run shaped like the engine's output, including the large field we must not keep. */
function makeSim(overrides = {}) {
  return {
    arrivalRate: 120,
    duration: 60,
    seed: 42,
    simulatedMs: 60000,
    truncated: false,
    concurrentUsers: 24,
    metrics: {
      p50: 12,
      p95: 40,
      p99: 90,
      throughputPerSec: 119.5,
      successRate: 0.99,
      totalRequests: 7000,
      completedRequests: 6930,
      failedRequests: 40,
      droppedRequests: 30,
    },
    components: { api: { id: 'api', utilization: 0.42, capacity: 4, visits: 300, memoryLimitMb: 512 } },
    latencySeries: [{ t: 1, p50: 10, p95: 30, p99: 70 }],
    queueSeries: [{ t: 1, queues: { api: 2 } }],
    loggingStats: { totalEvents: 90000, loggedEvents: 400, sampledCases: 400, totalCases: 7000, sampleEvery: 17 },
    eventLog: Array.from({ length: 400 }, (_, i) => ({
      eventId: `e${i}`,
      caseId: `c${i}`,
      activity: 'handle',
      componentName: 'api',
      timestamp: i,
    })),
    ...overrides,
  }
}

describe('toSimDigest', () => {
  it('keeps the figures the summary and charts render', () => {
    const d = toSimDigest(makeSim())
    assert.equal(d.v, DIGEST_VERSION)
    assert.equal(d.arrivalRate, 120)
    assert.equal(d.duration, 60)
    assert.equal(d.seed, 42)
    assert.equal(d.metrics.p95, 40)
    assert.equal(d.components.api.utilization, 0.42)
    assert.equal(d.latencySeries.length, 1)
    assert.equal(d.queueSeries.length, 1)
    assert.equal(d.loggingStats.totalEvents, 90000)
  })

  it('never carries the event log', () => {
    // The log is the bulk of a result and the input to process mining. Storing it would bloat
    // storage, and a partial result in simCache would reach Evaluation and Recommendations,
    // which also need the log.
    const d = toSimDigest(makeSim())
    assert.equal(d.eventLog, undefined)
    assert.equal(JSON.stringify(d).includes('eventId'), false)
  })

  it('is orders of magnitude smaller than the full result', () => {
    const sim = makeSim()
    const full = JSON.stringify(sim).length
    const digest = JSON.stringify(toSimDigest(sim)).length
    assert.ok(digest < full / 5, `digest ${digest} should be far smaller than ${full}`)
  })

  it('marks itself as restored so the page never has to guess', () => {
    assert.equal(toSimDigest(makeSim()).restored, true)
  })

  it('refuses a result with no metrics', () => {
    assert.equal(toSimDigest(null), null)
    assert.equal(toSimDigest({}), null)
    assert.equal(toSimDigest({ metrics: null }), null)
  })

  it('tolerates a result missing the optional series', () => {
    const d = toSimDigest({ metrics: { p50: 1 } })
    assert.deepEqual(d.latencySeries, [])
    assert.deepEqual(d.queueSeries, [])
    assert.deepEqual(d.components, {})
  })
})

describe('summaryId', () => {
  it('separates the same project run under different configurations', () => {
    // Moving a slider must never surface figures from a workload the reader is not viewing.
    assert.notEqual(summaryId('p1', 'arch::rate::120::60::1'), summaryId('p1', 'arch::rate::250::60::1'))
  })

  it('separates different projects under the same configuration', () => {
    assert.notEqual(summaryId('p1', 'k'), summaryId('p2', 'k'))
  })

  it('is stable for the same pair', () => {
    assert.equal(summaryId('p1', 'k'), summaryId('p1', 'k'))
  })

  it('is null without both parts', () => {
    assert.equal(summaryId(null, 'k'), null)
    assert.equal(summaryId('p1', null), null)
  })
})

describe('storeSummary and readSummary', () => {
  it('round-trips a run', () => {
    const store = storeSummary({}, 'p1', 'k', makeSim(), 1000)
    const back = readSummary(store, 'p1', 'k')
    assert.equal(back.metrics.p95, 40)
    assert.equal(back.savedAt, 1000)
  })

  it('returns nothing for a configuration that was never run', () => {
    const store = storeSummary({}, 'p1', 'k', makeSim(), 1000)
    assert.equal(readSummary(store, 'p1', 'other'), null)
  })

  it('replaces rather than duplicates on a re-run', () => {
    let store = storeSummary({}, 'p1', 'k', makeSim({ seed: 1 }), 1000)
    store = storeSummary(store, 'p1', 'k', makeSim({ seed: 2 }), 2000)
    assert.equal(Object.keys(store).length, 1)
    assert.equal(readSummary(store, 'p1', 'k').seed, 2)
  })

  it('keeps at most MAX_SUMMARIES entries, newest first', () => {
    let store = {}
    for (let i = 0; i < MAX_SUMMARIES + 6; i += 1) {
      store = storeSummary(store, `p${i}`, 'k', makeSim(), 1000 + i)
    }
    const ids = Object.keys(store)
    assert.equal(ids.length, MAX_SUMMARIES)
    // The oldest entries are the ones dropped.
    assert.equal(store[`p${MAX_SUMMARIES + 5}::k`].savedAt, 1000 + MAX_SUMMARIES + 5)
    assert.equal(store['p0::k'], undefined)
  })

  it('leaves the map untouched when there is nothing to store', () => {
    const before = { 'x::k': { keep: true } }
    assert.equal(storeSummary(before, 'p1', 'k', null), before)
    assert.equal(storeSummary(before, null, 'k', makeSim()), before)
  })

  it('does not mutate the map it is given', () => {
    const before = {}
    storeSummary(before, 'p1', 'k', makeSim(), 1000)
    assert.deepEqual(before, {})
  })
})

describe('isUsableDigest', () => {
  it('accepts a current digest', () => {
    assert.equal(isUsableDigest(toSimDigest(makeSim())), true)
  })

  it('rejects an older shape rather than misreading it', () => {
    const d = toSimDigest(makeSim())
    assert.equal(isUsableDigest({ ...d, v: DIGEST_VERSION - 1 }), false)
  })

  it('rejects a blob that somehow carries an event log', () => {
    const d = toSimDigest(makeSim())
    assert.equal(isUsableDigest({ ...d, eventLog: [] }), false)
  })

  it('rejects nothing at all', () => {
    assert.equal(isUsableDigest(null), false)
    assert.equal(isUsableDigest({}), false)
  })
})