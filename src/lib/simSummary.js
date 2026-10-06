/**
 * Compact, persistable summary of a simulation run.
 *
 * WHY THIS EXISTS
 * Simulation results live only in the reducer's simCache, which is deliberately not persisted
 * because it holds the full event log. The consequence is that a reload throws away every
 * figure a run just produced, so results cannot be screenshotted and revisited, and a
 * reviewer watching the page refresh loses the evidence.
 *
 * WHY IT IS NOT THE FULL RESULT
 * The event log is the large part and is what feeds process mining. Storing it would bloat
 * localStorage and, worse, a partial result injected into simCache would reach Evaluation
 * and Recommendations, which consume `mining` as well as `sim`. A half-restored result
 * would make those pages show numbers they cannot justify. So only what the Simulation page
 * actually renders is kept, and it is stored outside simCache entirely.
 *
 * A restored summary is always labelled as restored, and playback is unavailable because
 * there is no event log to animate. Nothing pretends to be a live run.
 */

/** Bumped when the shape changes, so an old blob is discarded rather than misread. */
export const DIGEST_VERSION = 2

/** Most recent runs kept per browser. Each is a few KB; this bounds the worst case. */
export const MAX_SUMMARIES = 12

/**
 * Reduces a run to the fields the Simulation summary and charts render.
 *
 * eventLog is the only large field and is intentionally not carried over.
 */
export function toSimDigest(sim) {
  if (!sim || typeof sim !== 'object') return null
  const metrics = sim.metrics && typeof sim.metrics === 'object' ? sim.metrics : null
  if (!metrics) return null

  const logging = sim.loggingStats || {}
  return {
    v: DIGEST_VERSION,
    savedAt: Date.now(),
    arrivalRate: Number(sim.arrivalRate) || 0,
    duration: Number(sim.duration) || 0,
    seed: sim.seed ?? null,
    simulatedMs: Number(sim.simulatedMs) || 0,
    truncated: Boolean(sim.truncated),
    concurrentUsers: Number(sim.concurrentUsers) || 0,
    metrics,
    components: sim.components && typeof sim.components === 'object' ? sim.components : {},
    latencySeries: Array.isArray(sim.latencySeries) ? sim.latencySeries : [],
    queueSeries: Array.isArray(sim.queueSeries) ? sim.queueSeries : [],
    // Counts only. The log itself is not stored.
    loggingStats: {
      totalEvents: Number(logging.totalEvents) || 0,
      loggedEvents: Number(logging.loggedEvents) || 0,
      sampledCases: Number(logging.sampledCases) || 0,
      totalCases: Number(logging.totalCases) || 0,
      sampleEvery: Number(logging.sampleEvery) || 1,
    },
    // Marks what this is, so the page never has to guess.
    restored: true,
  }
}

/**
 * Identifies a stored summary by project and by the exact configuration that produced it.
 *
 * Keying on the configuration means moving a slider never shows figures from a workload the
 * reader is not looking at. The result key already encodes architecture plus rate, duration,
 * mode and seed, so it is reused rather than duplicated.
 */
export function summaryId(projectId, resultKey) {
  if (!projectId || !resultKey) return null
  return `${projectId}::${resultKey}`
}

export function isUsableDigest(digest) {
  return Boolean(digest && digest.v === DIGEST_VERSION && digest.metrics && !digest.eventLog)
}

/** Inserts or replaces a summary, then trims to the newest MAX_SUMMARIES entries. */
export function storeSummary(summaries, projectId, resultKey, sim, now = Date.now()) {
  const id = summaryId(projectId, resultKey)
  if (!id) return summaries && typeof summaries === 'object' ? summaries : {}
  const digest = toSimDigest(sim)
  if (!digest) return summaries && typeof summaries === 'object' ? summaries : {}

  const next = { ...(summaries && typeof summaries === 'object' ? summaries : {}) }
  next[id] = { ...digest, savedAt: now }

  const ids = Object.keys(next).sort((a, b) => (next[b].savedAt || 0) - (next[a].savedAt || 0))
  for (const stale of ids.slice(MAX_SUMMARIES)) delete next[stale]
  return next
}

export function readSummary(summaries, projectId, resultKey) {
  const id = summaryId(projectId, resultKey)
  if (!id) return null
  const found = summaries && typeof summaries === 'object' ? summaries[id] : null
  return isUsableDigest(found) ? found : null
}