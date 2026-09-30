import { createRng } from './rng.js'
import { createEventQueue } from './eventQueue.js'
import { graphOf, entryNodeIds, terminalNodeIds } from './contract.js'
import { nodeTypes, resolveParams, nodeMemoryLimit } from '../data/nodeTypes.js'
import {
  clamp,
  createAccumulator,
  createLatencySeries,
  createQueueSeries,
  percentile,
  positiveInt,
  positiveNumber,
  round,
} from './metrics.js'

const MAX_STEPS_PER_CASE = 40
const MAX_PROCESSED_EVENTS = 400000
const SERIES_BUCKETS = 40
const MAX_LATENCY_SAMPLES = 200000
const MAX_QUEUE_SAMPLES = 300000
const QUEUE_COMPACT_THRESHOLD = 2048
const FALLBACK_CAPACITY = 100
const DEFAULT_MAX_LOGGED_CASES = 400

const EVENT_ARRIVAL = 'ARRIVAL'
const EVENT_TRANSIT = 'TRANSIT'
const EVENT_SERVICE_DONE = 'SERVICE_DONE'

const ACTIVITY = {
  ARRIVAL: 'REQUEST_ARRIVAL',
  QUEUE_ENTER: 'QUEUE_ENTER',
  QUEUE_EXIT: 'QUEUE_EXIT',
  START: 'PROCESS_START',
  DONE: 'PROCESS_COMPLETE',
  FAILURE: 'FAILURE',
  RETRY: 'RETRY',
  COMPLETE: 'REQUEST_COMPLETE',
  DROPPED: 'REQUEST_DROPPED',
}

const OUTCOME_COMPLETED = 'completed'
const OUTCOME_FAILED = 'failed'
const OUTCOME_DROPPED = 'dropped'

function buildComponents(graph) {
  const list = []
  const index = new Map()
  const pendingTargets = []
  const nodes = graph.nodes || []
  for (const node of nodes) {
    if (!node) continue
    const id = node.id
    if (typeof id !== 'string' && typeof id !== 'number') continue
    if (id === '' || index.has(id)) continue
    const params = resolveParams(node)
    const capacity = Math.max(1, Math.floor(positiveNumber(params.capacity, FALLBACK_CAPACITY)))
    const configuredQueue = Math.floor(positiveNumber(params.queueCapacity, 0))
    const memoryMb = positiveNumber(params.memoryMb, 128)
    const memoryPerSessionMb = positiveNumber(params.memoryPerSessionMb, 8)
    const component = {
      id,
      name: typeof node.name === 'string' && node.name ? node.name : String(id),
      type: typeof node.type === 'string' ? node.type : 'unknown',
      category: nodeTypes[node.type]?.cat || 'application',
      params,
      capacity,
      processingTimeMs: positiveNumber(params.processingTime, 0),
      configuredQueueCapacity: configuredQueue,
      queueCapacity: configuredQueue > 0 ? configuredQueue : Infinity,
      failureProbability: clamp(positiveNumber(params.failureProbability, 0), 0, 1),
      retryLimit: Math.floor(positiveNumber(params.retryLimit, 0)),
      baseLatencyMs: positiveNumber(params.baseLatencyMs, 0),
      memoryMb,
      memoryPerSessionMb,
      memoryLimitMb: nodeMemoryLimit({ ...params, capacity, memoryMb, memoryPerSessionMb }),
      outgoing: [],
      queue: [],
      queueHead: 0,
      queueLength: 0,
      queueLengthMax: 0,
      busy: 0,
      peakOccupancy: 0,
      busyTimeMs: 0,
      processing: createAccumulator(),
      queueWait: createAccumulator(),
      visits: 0,
      failures: 0,
      retries: 0,
      dropped: 0,
    }
    for (const target of graph.outgoing.get(id) || []) {
      if (target === id) continue
      pendingTargets.push([component, target])
    }
    index.set(id, component)
    list.push(component)
  }
  for (const [component, target] of pendingTargets) {
    if (index.has(target)) component.outgoing.push(target)
  }
  return { list, index }
}

function resolveEntries(architecture, graph, index) {
  const primary = entryNodeIds(architecture).filter((id) => index.has(id))
  if (primary.length) return primary
  const roots = []
  for (const node of graph.nodes || []) {
    if (!node) continue
    if ((graph.incoming.get(node.id) || []).length === 0 && index.has(node.id)) roots.push(node.id)
  }
  if (roots.length) return roots
  return [...index.keys()]
}

export function runSimulation(contract, workload, options) {
  const settings = options && typeof options === 'object' ? options : {}
  const load = workload && typeof workload === 'object' ? workload : {}
  const architecture = contract && typeof contract === 'object' ? contract : { nodes: [], edges: [] }
  const maxLoggedCases = positiveInt(settings.maxLoggedCases, DEFAULT_MAX_LOGGED_CASES)
  const arrivalRate = positiveNumber(load.arrivalRate, 0)
  const duration = positiveNumber(load.duration, 0)
  const seed = load.seed ?? 0
  const windowMs = Math.max(0, duration) * 1000
  const rng = createRng(seed)

  const graph = graphOf(architecture)
  const { list: componentList, index: componentIndex } = buildComponents(graph)
  const entries = resolveEntries(architecture, graph, componentIndex)
  const terminalIds = terminalNodeIds(architecture).filter((id) => componentIndex.has(id))

  const queue = createEventQueue()
  const latencies = []
  const latencyPairs = []
  const queueHistory = new Map()
  const eventLog = []
  const finishedCaseIds = new Set()

  let now = 0
  let lastEventTime = 0
  let processedEvents = 0
  let nextCaseId = 0
  let loggedCaseSlots = 0
  let nextEventId = 0
  let totalActivities = 0
  let totalRequests = 0
  let completedRequests = 0
  let failedRequests = 0
  let droppedRequests = 0
  let inFlight = 0
  let latencyTotal = 0
  let queueSamples = 0
  let nextArrivalTime = 0

  const record = (simCase, activity, component, status) => {
    totalActivities += 1
    if (!simCase || !simCase.logged) return
    nextEventId += 1
    eventLog.push({
      caseId: simCase.id,
      eventId: nextEventId,
      activity,
      componentId: component ? component.id : null,
      componentName: component ? component.name : null,
      timestamp: round(now, 3),
      status,
    })
  }

  const trackQueueDepth = (component) => {
    let history = queueHistory.get(component.name)
    if (!history) {
      history = []
      queueHistory.set(component.name, history)
    }
    if (queueSamples < MAX_QUEUE_SAMPLES) {
      history.push(now, component.queueLength)
      queueSamples += 1
    } else if (history.length >= 2) {
      history[history.length - 2] = now
      history[history.length - 1] = component.queueLength
    } else {
      history.push(now, component.queueLength)
    }
  }

  const compactQueue = (component) => {
    if (component.queueHead < QUEUE_COMPACT_THRESHOLD) return
    if (component.queueHead * 2 < component.queue.length) return
    component.queue = component.queue.slice(component.queueHead)
    component.queueHead = 0
  }

  const finishCase = (simCase, outcome, component) => {
    finishedCaseIds.add(simCase.id)
    inFlight -= 1
    if (outcome === OUTCOME_COMPLETED) {
      completedRequests += 1
      record(simCase, ACTIVITY.COMPLETE, component, 'success')
    } else if (outcome === OUTCOME_FAILED) {
      failedRequests += 1
    }
    const latency = now - simCase.startTime
    if (!Number.isFinite(latency) || latency < 0) return
    latencies.push(latency)
    latencyTotal += latency
    if (latencyPairs.length < MAX_LATENCY_SAMPLES * 2) {
      latencyPairs.push(now, latency)
    } else {
      latencyPairs[latencyPairs.length - 2] = now
      latencyPairs[latencyPairs.length - 1] = latency
    }
  }

  const dropCase = (simCase, component) => {
    droppedRequests += 1
    if (component) component.dropped += 1
    record(simCase, ACTIVITY.DROPPED, component, 'dropped')
    finishCase(simCase, OUTCOME_DROPPED, component)
  }

  const startService = (simCase, component) => {
    component.busy += 1
    if (component.busy > component.peakOccupancy) component.peakOccupancy = component.busy
    component.visits += 1
    simCase.steps += 1
    record(simCase, ACTIVITY.QUEUE_EXIT, component, 'success')
    record(simCase, ACTIVITY.START, component, 'success')
    queue.push({
      time: now + component.processingTimeMs,
      type: EVENT_SERVICE_DONE,
      payload: { simCase, component, startedAt: now },
    })
  }

  const serveNextWaiting = (component) => {
    if (component.queueHead >= component.queue.length) return
    const waiting = component.queue[component.queueHead]
    component.queue[component.queueHead] = null
    component.queueHead += 1
    component.queueLength -= 1
    compactQueue(component)
    trackQueueDepth(component)
    if (!waiting) return
    component.queueWait.add(now - waiting.queuedAt)
    startService(waiting, component)
  }

  const releaseSlot = (component) => {
    component.busy -= 1
    if (component.busy < 0) component.busy = 0
    serveNextWaiting(component)
  }

  const enterNode = (simCase, component) => {
    if (!component) {
      dropCase(simCase, null)
      return
    }
    if (component.busy >= component.capacity && component.queueLength >= component.queueCapacity) {
      dropCase(simCase, component)
      return
    }
    const mustQueue = component.busy >= component.capacity
    record(simCase, ACTIVITY.QUEUE_ENTER, component, mustQueue ? 'waiting' : 'served')
    if (!mustQueue) {
      startService(simCase, component)
      return
    }
    simCase.queuedAt = now
    component.queue.push(simCase)
    component.queueLength += 1
    if (component.queueLength > component.queueLengthMax) component.queueLengthMax = component.queueLength
    trackQueueDepth(component)
  }

  const routeForward = (simCase, component) => {
    const targets = component.outgoing
    if (!targets.length) {
      finishCase(simCase, OUTCOME_COMPLETED, component)
      return
    }
    if (simCase.steps >= MAX_STEPS_PER_CASE) {
      record(simCase, ACTIVITY.FAILURE, component, 'aborted')
      finishCase(simCase, OUTCOME_FAILED, component)
      return
    }
    const targetId = targets.length === 1 ? targets[0] : rng.pick(targets)
    const target = componentIndex.get(targetId)
    simCase.retries = 0
    const delay = target ? target.baseLatencyMs : 0
    if (delay > 0) {
      queue.push({ time: now + delay, type: EVENT_TRANSIT, payload: { simCase, component: target } })
    } else {
      enterNode(simCase, target)
    }
  }

  const completeService = (payload) => {
    const simCase = payload?.simCase
    const component = payload?.component
    if (!simCase || !component) return
    const startedAt = Number.isFinite(payload.startedAt) ? payload.startedAt : now
    const elapsed = Math.max(0, now - startedAt)
    component.busyTimeMs += elapsed
    component.processing.add(elapsed)
    const failed = component.failureProbability > 0 && rng.next() < component.failureProbability
    record(simCase, ACTIVITY.DONE, component, failed ? 'failure' : 'success')
    releaseSlot(component)
    if (failed) {
      component.failures += 1
      record(simCase, ACTIVITY.FAILURE, component, 'failure')
      if (simCase.retries < component.retryLimit) {
        simCase.retries += 1
        component.retries += 1
        record(simCase, ACTIVITY.RETRY, component, 'retry')
        enterNode(simCase, component)
        return
      }
      finishCase(simCase, OUTCOME_FAILED, component)
      return
    }
    routeForward(simCase, component)
  }

  const startCase = (entryId) => {
    const component = componentIndex.get(entryId)
    nextCaseId += 1
    totalRequests += 1
    inFlight += 1
    const simCase = { id: nextCaseId, startTime: now, queuedAt: now, steps: 0, retries: 0, logged: false }
    if (loggedCaseSlots < maxLoggedCases) {
      simCase.logged = true
      loggedCaseSlots += 1
    }
    record(simCase, ACTIVITY.ARRIVAL, component, 'success')
    enterNode(simCase, component)
  }

  const pushArrival = () => {
    queue.push({ time: nextArrivalTime, type: EVENT_ARRIVAL, payload: null })
    nextArrivalTime += rng.exponential(1000 / arrivalRate)
  }

  if (arrivalRate > 0 && windowMs > 0 && entries.length > 0) {
    nextArrivalTime = rng.exponential(1000 / arrivalRate)
    if (nextArrivalTime <= windowMs) pushArrival()
  }

  while (queue.size > 0 && processedEvents < MAX_PROCESSED_EVENTS) {
    const event = queue.pop()
    if (!event) break
    now = event.time
    lastEventTime = now
    processedEvents += 1
    if (event.type === EVENT_ARRIVAL) {
      startCase(entries.length === 1 ? entries[0] : rng.pick(entries))
      if (nextArrivalTime <= windowMs) pushArrival()
    } else if (event.type === EVENT_TRANSIT) {
      const transit = event.payload || {}
      enterNode(transit.simCase, transit.component)
    } else if (event.type === EVENT_SERVICE_DONE) {
      completeService(event.payload)
    }
  }

  failedRequests += inFlight
  inFlight = 0

  const sampledCaseIds = new Set()
  const trimmedLog = []
  for (let i = 0; i < eventLog.length; i += 1) {
    const event = eventLog[i]
    if (!finishedCaseIds.has(event.caseId)) continue
    event.eventId = trimmedLog.length + 1
    sampledCaseIds.add(event.caseId)
    trimmedLog.push(event)
  }

  const simulatedRaw = Math.max(windowMs, lastEventTime, 0)
  const simulatedMs = round(simulatedRaw, 3)
  const denominator = simulatedRaw > 0 ? simulatedRaw / 1000 : 1
  const finishedCount = latencies.length
  latencies.sort((a, b) => a - b)

  const latencyBuilder = createLatencySeries({ buckets: SERIES_BUCKETS, spanMs: simulatedMs })
  for (let i = 0; i + 1 < latencyPairs.length; i += 2) latencyBuilder.add(latencyPairs[i], latencyPairs[i + 1])
  const latencySeries = latencyBuilder.points()

  const queueBuilder = createQueueSeries({
    buckets: SERIES_BUCKETS,
    spanMs: simulatedMs,
    names: componentList.map((component) => component.name),
  })
  for (const name of queueHistory.keys()) {
    const history = queueHistory.get(name) || []
    for (let i = 0; i + 1 < history.length; i += 2) queueBuilder.record(history[i], name, history[i + 1])
  }
  const queueSeries = queueBuilder.points()

  const safeTotal = Math.max(1, totalRequests)
  const avgLatencyMs = finishedCount > 0 ? latencyTotal / finishedCount : 0
  const littleLawConcurrency = (arrivalRate * avgLatencyMs) / 1000

  const metrics = {
    totalRequests,
    completedRequests,
    droppedRequests,
    failedRequests,
    avgLatencyMs: round(avgLatencyMs, 3),
    p50: round(percentile(latencies, 50), 3),
    p90: round(percentile(latencies, 90), 3),
    p95: round(percentile(latencies, 95), 3),
    p99: round(percentile(latencies, 99), 3),
    maxLatencyMs: round(finishedCount > 0 ? latencies[finishedCount - 1] : 0, 3),
    throughputPerSec: round(completedRequests / denominator, 4),
    successRate: round((completedRequests / safeTotal) * 100, 3),
    failureRate: round((failedRequests / safeTotal) * 100, 3),
    dropRate: round((droppedRequests / safeTotal) * 100, 3),
    simulatedMs,
    littleLawConcurrency: round(littleLawConcurrency, 4),
  }

  const components = {}
  for (const component of componentList) {
    const memoryUsedMb = component.memoryMb + component.memoryPerSessionMb * component.peakOccupancy
    components[component.id] = {
      id: component.id,
      name: component.name,
      type: component.type,
      category: component.category,
      capacity: component.capacity,
      processingTimeMs: round(component.processingTimeMs, 3),
      queueCapacity: component.configuredQueueCapacity,
      busyTimeMs: round(component.busyTimeMs, 3),
      utilization: simulatedMs > 0 ? round(component.busyTimeMs / (component.capacity * simulatedMs), 5) : 0,
      avgQueueWaitMs: round(component.queueWait.count > 0 ? component.queueWait.mean : 0, 3),
      avgProcessingMs: round(component.processing.count > 0 ? component.processing.mean : 0, 3),
      queueLengthMax: component.queueLengthMax,
      memoryUsedMb: round(memoryUsedMb, 3),
      memoryLimitMb: round(component.memoryLimitMb, 3),
      memoryUtilization: component.memoryLimitMb > 0 ? round((memoryUsedMb / component.memoryLimitMb) * 100, 3) : 0,
      throughputPerSec: round(component.visits / denominator, 4),
      visits: component.visits,
      failures: component.failures,
      retries: component.retries,
      dropped: component.dropped,
    }
  }

  return {
    seed,
    arrivalRate,
    duration,
    concurrentUsers: round(littleLawConcurrency, 4),
    metrics,
    components,
    eventLog: trimmedLog,
    latencySeries,
    queueSeries,
    loggingStats: {
      totalEvents: totalActivities,
      loggedEvents: trimmedLog.length,
      sampledCases: sampledCaseIds.size,
      totalCases: totalRequests,
    },
    entryIds: entries,
    terminalIds,
  }
}
