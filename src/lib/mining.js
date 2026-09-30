import { expectedPaths } from './contract.js'

const QUEUE_ENTER = 'QUEUE_ENTER'
const QUEUE_EXIT = 'QUEUE_EXIT'
const PROCESS_START = 'PROCESS_START'
const PROCESS_COMPLETE = 'PROCESS_COMPLETE'
const FAILURE = 'FAILURE'
const RETRY = 'RETRY'
const REQUEST_COMPLETE = 'REQUEST_COMPLETE'
const REQUEST_DROPPED = 'REQUEST_DROPPED'

const DEFAULTS = {
  minVisits: 3,
  minWaitMs: 5,
  queueDeviationMs: 10,
  maxVariants: 12,
  maxFrequentPaths: 8,
  maxBottlenecks: 8,
  maxExpectedPaths: 6,
}

const DEVIATION_SEVERITY = {
  FAILURE: 'high',
  DROPPED: 'high',
  RETRY: 'med',
  QUEUEING: 'med',
  UNEXPECTED_COMPONENT: 'med',
  SKIPPED_COMPONENT: 'low',
}

const ESCALATE_SHARE = 0.25
const EMPTY_VARIANT = 'no-components'
const SINGLE = ['low']
const PAIR = ['med', 'high']

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const share = (part, whole) => (whole > 0 ? part / whole : 0)
const round3 = (v) => Math.round(v * 1000) / 1000
const ms1 = (v) => Math.round(v * 10) / 10
const pct1 = (v) => Math.round(v * 1000) / 10
const name = (v, fallback = 'Unknown') => (v ? String(v) : fallback)

function contractPaths(contract, maxPaths) {
  let raw = []
  try {
    raw = expectedPaths(contract, maxPaths) || []
  } catch {
    raw = []
  }
  const paths = (Array.isArray(raw) ? raw : []).map((p) => {
    const steps = Array.isArray(p) ? p : []
    return steps.map((s) => {
      if (s && typeof s === 'object') {
        const label = s.name != null && s.name !== '' ? String(s.name) : String(s.id ?? '')
        return { id: s.id != null ? String(s.id) : '', name: label }
      }
      return { id: '', name: String(s ?? '') }
    })
  })
  return {
    paths,
    names: paths.map((s) => s.map((x) => x.name)),
    idSets: paths.map((s) => new Set(s.map((x) => x.id).filter(Boolean))),
    allIds: new Set(paths.flatMap((s) => s.map((x) => x.id).filter(Boolean))),
  }
}

function contractEdges(contract) {
  const edges = Array.isArray(contract?.edges) ? contract.edges : []
  const ids = new Set((contract?.nodes || []).map((n) => n?.id).filter(Boolean))
  const out = new Set()
  const hasIncoming = new Set()
  for (const e of edges) {
    if (!e?.source || !e?.target) continue
    if (ids.size && (!ids.has(e.source) || !ids.has(e.target))) continue
    out.add(`${e.source}>${e.target}`)
    hasIncoming.add(e.target)
  }
  return { out, hasIncoming }
}

function normaliseEvents(eventLog) {
  const list = Array.isArray(eventLog) ? eventLog : []
  const out = []
  for (let i = 0; i < list.length; i += 1) {
    const e = list[i]
    if (!e || typeof e !== 'object') continue
    const ts = Number(e.timestamp)
    out.push({
      order: i,
      caseId: e.caseId == null || e.caseId === '' ? 'case-0' : String(e.caseId),
      activity: e.activity == null ? '' : String(e.activity),
      componentId: e.componentId == null ? '' : String(e.componentId),
      componentName: e.componentName == null ? '' : String(e.componentName),
      timestamp: Number.isFinite(ts) ? ts : 0,
    })
  }
  return out.sort((a, b) => a.timestamp - b.timestamp || a.order - b.order)
}

function groupCases(events) {
  const groups = new Map()
  for (const e of events) {
    if (!groups.has(e.caseId)) groups.set(e.caseId, [])
    groups.get(e.caseId).push(e)
  }
  return [...groups.entries()]
    .map(([caseId, list]) => ({ caseId, events: list }))
    .sort((a, b) => a.caseId.localeCompare(b.caseId))
}

function readCase(c) {
  const steps = []
  const path = []
  const idPath = []
  const waited = new Map()
  const processed = new Map()
  const depth = new Map()
  const depthMax = new Map()
  const visits = new Map()
  const queues = []
  const retries = new Map()
  const failures = new Map()
  const openStarts = new Map()
  let lastExit = null
  let completed = false
  let dropped = false
  let droppedAt = ''

  const push = (e) => {
    if (!e.componentName) return
    const last = steps[steps.length - 1]
    if (last && last.name === e.componentName) {
      if (!last.id && e.componentId) last.id = e.componentId
      return
    }
    steps.push({ id: e.componentId, name: e.componentName })
    visits.set(e.componentName, (visits.get(e.componentName) || 0) + 1)
  }

  const addWait = (key, value) => {
    if (!(value > 0)) return
    const rec = waited.get(key) || { total: 0, max: 0, count: 0 }
    rec.total += value
    rec.max = Math.max(rec.max, value)
    rec.count += 1
    waited.set(key, rec)
  }

  const addProcessing = (key, value) => {
    if (!(value > 0)) return
    processed.set(key, (processed.get(key) || 0) + value)
  }

  for (const e of c.events) {
    if (e.activity === REQUEST_COMPLETE) {
      completed = true
      push(e)
      continue
    }
    if (e.activity === REQUEST_DROPPED) {
      dropped = true
      droppedAt = e.componentName || droppedAt
      push(e)
      continue
    }
    if (e.activity === QUEUE_ENTER) {
      const key = e.componentName || e.componentId
      const gap = lastExit ? e.timestamp - lastExit.ts : 0
      if (lastExit) addWait(key, gap)
      queues.push({ from: lastExit?.name || '', fromId: lastExit?.id || '', to: key, toId: e.componentId, wait: gap })
      lastExit = null
      const d = (depth.get(key) || 0) + 1
      depth.set(key, d)
      depthMax.set(key, Math.max(depthMax.get(key) || 0, d))
      push(e)
      continue
    }
    if (e.activity === QUEUE_EXIT) {
      const key = e.componentName || e.componentId
      depth.set(key, Math.max(0, (depth.get(key) || 0) - 1))
      push(e)
      continue
    }
    if (e.activity === PROCESS_START) {
      const key = e.componentName || e.componentId
      if (lastExit) addWait(key, e.timestamp - lastExit.ts)
      lastExit = null
      if (!openStarts.has(key)) openStarts.set(key, [])
      openStarts.get(key).push(e.timestamp)
      push(e)
      continue
    }
    if (e.activity === PROCESS_COMPLETE) {
      const key = e.componentName || e.componentId
      const starts = openStarts.get(key)
      if (starts?.length) addProcessing(key, e.timestamp - starts.shift())
      else addProcessing(key, 0)
      lastExit = { ts: e.timestamp, name: key, id: e.componentId }
      push(e)
      continue
    }
    if (e.activity === FAILURE) {
      failures.set(e.componentName, (failures.get(e.componentName) || 0) + 1)
      push(e)
      continue
    }
    if (e.activity === RETRY) {
      retries.set(e.componentName, (retries.get(e.componentName) || 0) + 1)
      push(e)
      continue
    }
    push(e)
  }

  path.push(...steps.map((s) => s.name))
  idPath.push(...steps.map((s) => s.id).filter(Boolean))

  return {
    caseId: c.caseId,
    eventCount: c.events.length,
    steps,
    path,
    idPath,
    waited,
    processed,
    depthMax,
    visits,
    queues,
    retries,
    failures,
    completed,
    dropped,
    droppedAt,
  }
}

function bestExpectedIndex(model, record) {
  let best = -1
  let bestScore = -1
  for (let i = 0; i < model.idSets.length; i += 1) {
    const set = model.idSets[i]
    if (!set.size) continue
    let hit = 0
    for (const id of record.idPath) if (set.has(id)) hit += 1
    if (hit > bestScore) {
      bestScore = hit
      best = i
    }
  }
  if (best >= 0) return best
  let nameBest = -1
  let nameScore = -1
  for (let i = 0; i < model.names.length; i += 1) {
    const steps = model.names[i]
    if (!steps.length) continue
    const hit = record.path.filter((n) => steps.includes(n)).length
    if (hit > nameScore) {
      nameScore = hit
      nameBest = i
    }
  }
  return nameBest
}

function deviationGroup(store, type, key, component, record) {
  const id = `${type}|${key}`
  if (!store.has(id)) {
    store.set(id, { type, key, component, cases: new Set(), events: 0, wait: 0, hops: new Map() })
  }
  const group = store.get(id)
  group.cases.add(record.caseId)
  return group
}

function collectDeviations(records, model, edges, options) {
  const store = new Map()
  for (const record of records) {
    const expectedIndex = bestExpectedIndex(model, record)
    const expectedNames = expectedIndex >= 0 ? model.names[expectedIndex] || [] : []

    for (const q of record.queues) {
      if (q.wait < options.queueDeviationMs) continue
      const routedDirectly = q.from
        ? Boolean(q.fromId && q.toId && edges.out.has(`${q.fromId}>${q.toId}`))
        : !edges.hasIncoming.has(q.toId) || (model.names[expectedIndex] || [])[0] === q.to
      if (!routedDirectly) continue
      const group = deviationGroup(store, 'QUEUEING', q.to || q.toId, name(q.to), record)
      group.events += 1
      group.wait += q.wait
      const hop = q.from ? `${q.from} → ${q.to}` : `entry → ${q.to}`
      group.hops.set(hop, (group.hops.get(hop) || 0) + 1)
    }

    for (const [key, count] of record.retries) {
      const group = deviationGroup(store, 'RETRY', key, name(key), record)
      group.events += count
    }

    for (const [key, count] of record.failures) {
      const group = deviationGroup(store, 'FAILURE', key, name(key), record)
      group.events += count
    }

    for (const step of record.steps) {
      if (!step.id) continue
      if (model.allIds.size && !model.allIds.has(step.id)) {
        const group = deviationGroup(store, 'UNEXPECTED_COMPONENT', step.id, name(step.name), record)
        group.events += 1
      }
    }

    const seenNames = new Set(record.path)
    if (expectedNames.length && !record.dropped) {
      for (const missing of expectedNames) {
        if (missing && !seenNames.has(missing)) {
          const group = deviationGroup(store, 'SKIPPED_COMPONENT', missing, missing, record)
          group.events += 1
        }
      }
    }

    if (record.dropped) {
      const key = record.droppedAt || 'entry'
      const group = deviationGroup(store, 'DROPPED', key, name(record.droppedAt, 'Entry point'), record)
      group.events += 1
    }
  }
  return store
}

function deviationDetail(group, totalCases) {
  const pct = pct1(share(group.cases.size, totalCases))
  const label = group.component
  if (group.type === 'QUEUEING') {
    const hops = [...group.hops.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    const hop = hops[0] ? hops[0][0] : 'the modelled route'
    return `${label} queued work on the direct ${hop} hop in ${group.cases.size} of ${totalCases} cases (${pct}%), averaging ${ms1(group.wait / Math.max(1, group.events))} ms of wait across ${group.events} queueing episodes.`
  }
  if (group.type === 'RETRY') {
    return `${label} retried in ${group.cases.size} of ${totalCases} cases (${pct}%), logging ${group.events} retry events.`
  }
  if (group.type === 'FAILURE') {
    return `${label} failed in ${group.cases.size} of ${totalCases} cases (${pct}%), logging ${group.events} failure events.`
  }
  if (group.type === 'UNEXPECTED_COMPONENT') {
    return `${label} appears on no expected path yet ${group.cases.size} of ${totalCases} cases (${pct}%) visited it ${group.events} times.`
  }
  if (group.type === 'SKIPPED_COMPONENT') {
    return `${label} is on the expected path but was skipped by ${group.cases.size} of ${totalCases} cases (${pct}%).`
  }
  if (group.type === 'DROPPED') {
    return `${group.cases.size} of ${totalCases} cases (${pct}%) were dropped before completion${label === 'Entry point' ? '' : ` at ${label}`}.`
  }
  return `${label} deviated in ${group.cases.size} of ${totalCases} cases (${pct}%).`
}

function rankDeviations(store, totalCases) {
  const list = [...store.values()].map((group) => {
    const base = DEVIATION_SEVERITY[group.type] || 'low'
    const order = PAIR.indexOf(base) >= 0 ? PAIR : SINGLE
    const shareValue = share(group.cases.size, totalCases)
    const severity = shareValue >= ESCALATE_SHARE ? order[order.length - 1] : base
    return {
      type: group.type,
      component: group.component,
      detail: deviationDetail(group, totalCases),
      severity,
      caseCount: group.cases.size,
    }
  })
  const weight = { high: 0, med: 1, low: 2 }
  return list.sort(
    (a, b) =>
      weight[a.severity] - weight[b.severity] ||
      b.caseCount - a.caseCount ||
      a.type.localeCompare(b.type) ||
      a.component.localeCompare(b.component),
  )
}

function severityFor(waitRatio, utilisation) {
  if (waitRatio > 3 || utilisation > 0.85) return 'high'
  if (waitRatio > 1.5 || utilisation > 0.65) return 'med'
  return 'low'
}

function bottleneckNote(component, stats) {
  const wait = ms1(stats.avgWait)
  const proc = ms1(stats.avgProcessing)
  const ratio = round3(stats.waitRatio)
  const util = stats.derived
    ? `, a peak queue of ${stats.queueDepthMax} and ${pct1(stats.utilisation)}% supplied utilisation`
    : ` and a peak queue of ${stats.queueDepthMax}, with no utilisation available because an event log prefix cannot yield it`
  return `${component} makes requests wait ${wait} ms on average against ${proc} ms of processing, a wait ratio of ${ratio}x over ${stats.visits} visits${util}.`
}

function buildBottlenecks(records, options) {
  const waits = new Map()
  const procs = new Map()
  const visits = new Map()
  const depths = new Map()
  const ids = new Map()

  for (const record of records) {
    for (const [key, rec] of record.waited) {
      const cur = waits.get(key) || { total: 0, max: 0, count: 0 }
      cur.total += rec.total
      cur.count += rec.count
      cur.max = Math.max(cur.max, rec.max)
      waits.set(key, cur)
    }
    for (const [key, total] of record.processed) procs.set(key, (procs.get(key) || 0) + total)
    for (const [key, count] of record.visits) {
      visits.set(key, (visits.get(key) || 0) + count)
      const step = record.steps.find((s) => s.name === key)
      if (step?.id && !ids.has(key)) ids.set(key, step.id)
    }
    for (const [key, depth] of record.depthMax) depths.set(key, Math.max(depths.get(key) || 0, depth))
  }

  const supplied = options?.utilization && typeof options.utilization === 'object' ? options.utilization : null
  const list = []
  for (const [key, wait] of waits) {
    const visitsCount = visits.get(key) || wait.count
    if (visitsCount < options.minVisits) continue
    if (wait.count <= 0) continue
    const avgWait = wait.total / wait.count
    if (avgWait < options.minWaitMs) continue
    const avgProcessing = (procs.get(key) || 0) / Math.max(1, visitsCount)
    const waitRatio = avgWait / Math.max(avgProcessing, 1)
    const componentId = ids.get(key) || key
    const measured = supplied ? supplied[componentId] ?? supplied[key] : undefined
    const utilisation = clamp(measured != null ? Number(measured) : 0, 0, 1)
    const stats = {
      componentId,
      component: key,
      avgWait,
      avgProcessing,
      waitRatio,
      queueDepthMax: depths.get(key) || 0,
      visits: visitsCount,
      utilisation,
      derived: measured == null,
    }
    list.push({
      componentId,
      component: key,
      waitingMs: ms1(avgWait),
      processingMs: ms1(avgProcessing),
      waitRatio: round3(waitRatio),
      queueDepthMax: stats.queueDepthMax,
      visits: visitsCount,
      severity: severityFor(waitRatio, utilisation),
      note: bottleneckNote(key, stats),
    })
  }

  const weight = { high: 0, med: 1, low: 2 }
  list.sort(
    (a, b) =>
      weight[a.severity] - weight[b.severity] ||
      b.waitRatio - a.waitRatio ||
      b.waitingMs - a.waitingMs ||
      a.component.localeCompare(b.component),
  )
  return list.slice(0, options.maxBottlenecks)
}

function variantKey(path) {
  return path.join(' > ')
}

export function mineEventLog(eventLog, contract, options) {
  const opts = { ...DEFAULTS, ...(options && typeof options === 'object' ? options : {}) }
  const events = normaliseEvents(eventLog)
  const cases = groupCases(events).map(readCase)
  const model = contractPaths(contract, opts.maxExpectedPaths)
  const edges = contractEdges(contract)

  const totalCases = cases.length
  const completedCases = cases.filter((c) => c.completed && !c.dropped).length
  const droppedCases = cases.filter((c) => c.dropped).length
  const loggedCases = cases.filter((c) => c.eventCount > 0).length

  const buckets = new Map()
  for (const record of cases) {
    const key = variantKey(record.path) || EMPTY_VARIANT
    if (!buckets.has(key)) buckets.set(key, { path: record.path.slice(), count: 0, caseIds: [] })
    const bucket = buckets.get(key)
    bucket.count += 1
    bucket.caseIds.push(record.caseId)
  }

  const rawVariants = [...buckets.values()]
  const conformKeys = new Set()
  for (const i of model.names) conformKeys.add(variantKey(i))

  let conformHits = 0
  for (const record of cases) {
    if (record.completed && !record.dropped && conformKeys.has(variantKey(record.path))) conformHits += 1
  }

  const deviationStore = collectDeviations(cases, model, edges, opts)
  const deviations = rankDeviations(deviationStore, totalCases)
  const affected = new Map()
  for (const record of cases) {
    const key = variantKey(record.path) || EMPTY_VARIANT
    const hit = affected.get(key) || new Set()
    for (const [id, group] of deviationStore) {
      if (group.cases.has(record.caseId)) hit.add(id)
    }
    if (hit.size) affected.set(key, hit)
  }

  const ordered = rawVariants.sort(
    (a, b) => b.count - a.count || a.path.length - b.path.length || variantKey(a.path).localeCompare(variantKey(b.path)),
  )

  const variants = ordered.slice(0, opts.maxVariants).map((v) => ({
    path: v.path,
    count: v.count,
    support: round3(share(v.count, totalCases)),
    deviates: (affected.get(variantKey(v.path) || EMPTY_VARIANT) || new Set()).size,
    caseIds: v.caseIds,
  }))

  const frequentPaths = variants
    .slice(0, opts.maxFrequentPaths)
    .map((v) => ({ path: v.path, count: v.count, support: v.support }))

  const bottlenecks = buildBottlenecks(cases, opts)

  const waitingTimes = {}
  let maxWaitMs = 0
  for (const record of cases) {
    for (const [key, rec] of record.waited) {
      const cur = waitingTimes[key] || { total: 0, avg: 0, max: 0, count: 0 }
      cur.total += rec.total
      cur.count += rec.count
      cur.max = Math.max(cur.max, rec.max)
      cur.avg = round3(cur.total / cur.count)
      waitingTimes[key] = cur
      maxWaitMs = Math.max(maxWaitMs, rec.max)
    }
  }

  const expectedNames = model.names.map((steps) => steps.slice())
  const totalLength = cases.reduce((sum, c) => sum + c.path.length, 0)

  return {
    frequentPaths,
    variants,
    bottlenecks,
    deviations,
    waitingTimes,
    statistics: {
      totalCases,
      completedCases,
      droppedCases,
      avgCaseLength: round3(share(totalLength, totalCases)),
      variants: rawVariants.length,
      conformanceRate: round3(share(conformHits, completedCases)),
      maxWaitMs: ms1(maxWaitMs),
      loggedCases,
    },
    expectedPaths: expectedNames,
  }
}
