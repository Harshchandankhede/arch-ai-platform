// Reconstructs per-request trajectories from the simulation event log so the 2D view can
// replay what the engine actually did. Every timestamp, hop order and duration here is
// read from the log â€” there is no synthetic or looping motion in this module.

const ARRIVE = 'QUEUE_ENTER'
const EXIT = 'QUEUE_EXIT'
const DONE = 'PROCESS_COMPLETE'
const COMPLETE = 'REQUEST_COMPLETE'
const DROPPED = 'REQUEST_DROPPED'
const FAILURE = 'FAILURE'

function componentKey(event) {
  return event.componentId || event.componentName || null
}

/**
 * Group the event log into one trajectory per simulated request.
 * Each hop records when the request entered a component and when it finished there, so
 * the gap between one hop's exit and the next hop's entry is genuine network transit.
 */
export function buildTrajectories(eventLog, options = {}) {
  const maxCases = Number.isFinite(options.maxCases) ? options.maxCases : Infinity
  const byCase = new Map()

  for (const event of eventLog || []) {
    if (!event || event.caseId === undefined || event.caseId === null) continue
    if (!Number.isFinite(event.timestamp)) continue
    let list = byCase.get(event.caseId)
    if (!list) {
      list = []
      byCase.set(event.caseId, list)
    }
    list.push(event)
  }

  const trajectories = []
  for (const [caseId, events] of byCase) {
    events.sort((a, b) => a.timestamp - b.timestamp)

    const hops = []
    let open = null
    let sawComplete = false
    let sawDropped = false
    let failures = 0

    for (const event of events) {
      const id = componentKey(event)
      if (!id) continue

      if (event.activity === ARRIVE) {
        // A retry re-enters the same component; keep it as a separate hop so the
        // back-and-forth is visible rather than collapsed.
        open = { id, name: event.componentName || id, enter: event.timestamp, exit: event.timestamp }
        hops.push(open)
        continue
      }

      if (event.activity === DONE || event.activity === COMPLETE || event.activity === DROPPED) {
        if (open && open.id === id) open.exit = event.timestamp
        if (event.activity === COMPLETE) {
          sawComplete = true
          open = null
        } else if (event.activity === DROPPED) {
          sawDropped = true
          open = null
        }
        continue
      }

      if (event.activity === EXIT && open && open.id === id && open.exit === open.enter) {
        open.exit = event.timestamp
        continue
      }

      if (event.activity === FAILURE) failures += 1
    }

    if (!hops.length) continue

    // Outcome follows the terminal event, not the presence of a failure. A request that
    // failed once and then retried through to REQUEST_COMPLETE succeeded, and colouring it
    // as a failure would misreport how often the design actually breaks.
    let outcome
    if (sawDropped) outcome = 'dropped'
    else if (sawComplete) outcome = failures > 0 ? 'retried' : 'completed'
    else if (failures > 0) outcome = 'failed'
    else outcome = 'completed'

    const start = hops[0].enter
    const end = hops[hops.length - 1].exit
    trajectories.push({
      caseId,
      hops,
      start,
      end: Math.max(end, start),
      outcome,
      latency: Math.max(0, end - start),
      failures,
    })
  }

  trajectories.sort((a, b) => a.start - b.start || String(a.caseId).localeCompare(String(b.caseId)))
  return trajectories.slice(0, maxCases)
}

/** Where a request is at simulation-time `t`, or null when it is not in flight. */
export function locateAt(trajectory, t) {
  const { hops, start, end } = trajectory
  if (t < start || t > end) return null

  for (let i = 0; i < hops.length; i += 1) {
    const hop = hops[i]
    const span = Math.max(hop.exit - hop.enter, 0)
    if (t >= hop.enter && t <= hop.exit) {
      return { kind: 'service', index: i, nodeId: hop.id, progress: span ? (t - hop.enter) / span : 1 }
    }
    const next = hops[i + 1]
    if (next && t > hop.exit && t < next.enter) {
      const gap = next.enter - hop.exit
      return {
        kind: 'transit',
        index: i,
        fromId: hop.id,
        toId: next.id,
        progress: gap ? (t - hop.exit) / gap : 1,
      }
    }
  }
  return null
}

/**
 * Aggregate real counters for the replay position. Used for the live read-out.
 *
 * `options.scale` is the engine's logging stride. The event log holds every Nth arrival so
 * that it spans the whole run, which means a raw count of sampled cases understates the
 * real concurrency by that factor. Multiplying the counters by the stride recovers a
 * straight estimate of the true totals. `perNode` is deliberately NOT scaled: it is a
 * distribution across components, and scaling it would not make it any more accurate.
 */
export function statsAt(trajectories, t, options = {}) {
  const scale = Number.isFinite(options.scale) && options.scale > 0 ? options.scale : 1
  const perNode = new Map()
  let inFlight = 0
  let completed = 0
  let failed = 0
  let dropped = 0

  for (const traj of trajectories) {
    if (t >= traj.end) {
      if (traj.outcome === 'dropped') dropped += 1
      else if (traj.outcome === 'failed') failed += 1
      else completed += 1
      continue
    }
    if (t < traj.start) continue
    inFlight += 1
    const where = locateAt(traj, t)
    if (where) {
      const key = where.kind === 'service' ? where.nodeId : where.toId
      perNode.set(key, (perNode.get(key) || 0) + 1)
    }
  }

  return {
    inFlight: Math.round(inFlight * scale),
    completed: Math.round(completed * scale),
    failed: Math.round(failed * scale),
    dropped: Math.round(dropped * scale),
    // True when these counters are extrapolated from a sampled log rather than counted.
    estimated: scale > 1,
    perNode,
  }
}

/**
 * Pick the window of simulated time with the most concurrent traffic, so a looped
 * replay always lands on a representative moment instead of an idle one.
 */
/**
 * Count how many requests actually traversed each directed edge, using the hop order
 * recorded from the event log. This is what drives the animated flow along each
 * connection, so the animation intensity reflects measured traffic rather than being
 * decorative.
 */
export function edgeTraffic(trajectories) {
  const traffic = new Map()
  for (const traj of trajectories || []) {
    const hops = traj.hops || []
    for (let i = 0; i < hops.length - 1; i += 1) {
      const from = hops[i].id
      const to = hops[i + 1].id
      if (!from || !to || from === to) continue
      const key = `${from}->${to}`
      const entry = traffic.get(key) || { count: 0, failed: 0, dropped: 0, totalMs: 0, maxMs: 0 }
      entry.count += 1
      // Time spent on the wire for this hop, i.e. between the two components.
      const wire = Math.max(0, hops[i + 1].enter - hops[i].exit)
      entry.totalMs += wire
      entry.maxMs = Math.max(entry.maxMs, wire)
      if (traj.outcome === 'dropped') entry.dropped += 1
      else if (traj.outcome === 'failed') entry.failed += 1
      traffic.set(key, entry)
    }
  }
  for (const entry of traffic.values()) {
    entry.avgMs = entry.count ? entry.totalMs / entry.count : 0
  }
  return traffic
}

/** Requests currently inside a component, keyed by component id. */
export function nodeLoad(trajectories, at) {
  const load = new Map()
  for (const traj of trajectories || []) {
    const where = locateAt(traj, at)
    if (!where || where.kind !== 'service') continue
    load.set(where.nodeId, (load.get(where.nodeId) || 0) + 1)
  }
  return load
}
