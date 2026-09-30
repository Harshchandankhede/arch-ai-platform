import { dimensionMeta, dimensionOrder } from '../theme/tokens.js'
import { resolveParams, isCompute, isStore, isClient } from '../data/nodeTypes.js'
import { categoryOf } from './contract.js'

const LATENCY_BUDGET_MS = 200
const LATENCY_P95_WEIGHT = 0.7
const LATENCY_P99_WEIGHT = 0.3
const LATENCY_DECAY_BUDGETS = 3
const PERFORMANCE_ERROR_CEILING = 0.1
const PERFORMANCE_ERROR_WEIGHT = 0.3
const SCALABILITY_UTIL_FREE = 0.6
const SCALABILITY_UTIL_SPAN = 0.4
const SCALABILITY_HEADROOM_TARGET = 0.4
const SCALABILITY_UTIL_WEIGHT = 0.6
const SCALABILITY_HEADROOM_WEIGHT = 0.4
const SCALABILITY_LB_BONUS = 10
const SCALABILITY_REPLICA_BONUS = 10
const RELIABILITY_FAILURE_CEILING = 0.05
const RELIABILITY_DROP_CEILING = 0.05
const RELIABILITY_OVERFLOW_CEILING = 3
const RELIABILITY_WEIGHTS = { failure: 0.3, drop: 0.25, overflow: 0.25, retry: 0.2 }
const RELIABILITY_REPLICA_BONUS = 10
const SECURITY_BASE = 20
const SECURITY_CONTROL_POINTS = 25
const SECURITY_NO_GATEWAY_PENALTY = 20
const MAINTAINABILITY_IDEAL_MIN = 4
const MAINTAINABILITY_IDEAL_MAX = 10
const MAINTAINABILITY_HEAVY = 18
const MAINTAINABILITY_WEIGHTS = { count: 0.55, cache: 0.25, modular: 0.2 }
const PROCESS_CONFORMANCE_SHARE = 60
const PROCESS_DEVIATION_PENALTY = 5
const PROCESS_DEVIATION_CAP = 50
const PROCESS_BOTTLENECK_PENALTY = 8
const PROCESS_BOTTLENECK_CAP = 30
const PROCESS_BOTTLENECK_FLOOR_MS = 50
const PROCESS_SIGNIFICANT_SEVERITIES = new Set(['high', 'med'])
const APPLICATION_TYPES = ['apiGateway', 'loadBalancer', 'server', 'microservice']

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const num = (v, fallback = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}
const rate = (v) => clamp(num(v), 0, 1)
const round1 = (v) => Math.round(v * 10) / 10
const round2 = (v) => Math.round(v * 100) / 100
const pct1 = (v) => Math.round(clamp(v, 0, 1) * 1000) / 10
const score = (v) => Math.round(clamp(v, 0, 100))
const label = (v, fallback = 'Unnamed') => (v ? String(v) : fallback)
const listOf = (items) => (items.length ? items.join(', ') : 'none')

export function architectureFacts(architecture) {
  const nodes = (architecture?.nodes || []).filter((n) => n && n.id != null)
  const edges = (architecture?.edges || []).filter((e) => e && e.source && e.target)
  const ids = new Set(nodes.map((n) => n.id))
  const incoming = new Map(nodes.map((n) => [n.id, []]))
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue
    incoming.get(e.target).push(e.source)
  }
  const clients = nodes.filter((n) => isClient(n))
  const compute = nodes.filter((n) => isCompute(n))
  const stores = nodes.filter((n) => isStore(n))
  const types = new Set(nodes.map((n) => n.type))
  const applicationTypes = new Set(nodes.filter((n) => categoryOf(n) === 'application').map((n) => n.type))
  const gateways = nodes.filter((n) => n.type === 'apiGateway' || n.type === 'loadBalancer')
  const entryGateway = gateways.find((n) => !hasApplicationAncestor(n.id, incoming, byId(nodes))) || null
  const params = new Map(nodes.map((n) => [n.id, resolveParams(n)]))
  return {
    nodes,
    edges,
    ids,
    incoming,
    clients,
    compute,
    stores,
    types,
    applicationTypes,
    gateways,
    entryGateway,
    params,
    nodeCount: nodes.length,
    hasLoadBalancer: types.has('loadBalancer'),
    hasAuthentication: types.has('authentication'),
    hasFirewall: types.has('firewall'),
    hasCache: types.has('cache'),
    hasAuthNode: nodes.some((n) => n.type === 'authentication'),
    hasFirewallNode: nodes.some((n) => n.type === 'firewall'),
    hasEntryGateway: Boolean(entryGateway),
  }
}

function byId(nodes) {
  return new Map(nodes.map((n) => [n.id, n]))
}

function hasApplicationAncestor(id, incoming, nodes) {
  const seen = new Set([id])
  const stack = [...(incoming.get(id) || [])]
  while (stack.length) {
    const current = stack.pop()
    if (seen.has(current)) continue
    seen.add(current)
    const node = nodes.get(current)
    if (node && categoryOf(node) === 'application') return true
    for (const parent of incoming.get(current) || []) stack.push(parent)
  }
  return false
}

export function securityAssessment(architecture) {
  const facts = architectureFacts(architecture)
  const controls = []
  if (facts.hasAuthNode) controls.push('authentication')
  if (facts.hasFirewallNode) controls.push('firewall')
  if (facts.hasEntryGateway) controls.push(`entry-point ${facts.entryGateway.name}`)
  const missing = []
  if (!facts.hasAuthNode) missing.push('an authentication node')
  if (!facts.hasFirewallNode) missing.push('a firewall')
  if (!facts.hasEntryGateway) missing.push('an entry-point gateway')
  const appNodes = facts.nodes.filter((n) => APPLICATION_TYPES.includes(n.type))
  const gatewayPenalty = !facts.hasEntryGateway && appNodes.length ? SECURITY_NO_GATEWAY_PENALTY : 0
  const value = SECURITY_BASE + controls.length * SECURITY_CONTROL_POINTS - gatewayPenalty
  return {
    score: score(value),
    controls,
    missing,
    gatewayPenalty,
    appNodeCount: appNodes.length,
    nodeCount: facts.nodeCount,
  }
}

function simComponents(sim) {
  const raw = sim?.components && typeof sim.components === 'object' ? Object.values(sim.components) : []
  return raw.filter((c) => c && typeof c === 'object')
}

export function readMetrics(sim) {
  const m = sim?.metrics && typeof sim.metrics === 'object' ? sim.metrics : {}
  return {
    total: num(m.totalRequests),
    completed: num(m.completedRequests),
    dropped: num(m.droppedRequests),
    failed: num(m.failedRequests),
    avg: num(m.avgLatencyMs),
    p95: num(m.p95),
    p99: num(m.p99),
    max: num(m.maxLatencyMs),
    throughput: num(m.throughputPerSec),
    failureRate: rate(m.failureRate),
    dropRate: rate(m.dropRate),
    successRate: rate(m.successRate),
    arrivalRate: num(m.arrivalRate ?? sim?.arrivalRate),
    concurrent: num(m.concurrentUsers ?? sim?.concurrentUsers),
  }
}

function peakComponents(components) {
  const byUtil = components
    .map((c) => ({ c, utilization: rate(c.utilization) }))
    .sort((a, b) => b.utilization - a.utilization)
  const byMemory = components
    .map((c) => ({ c, used: rate(c.memoryUtilization) }))
    .sort((a, b) => b.used - a.used)
  return {
    topUtil: byUtil[0] || null,
    topMemory: byMemory[0] || null,
    peakUtil: byUtil[0]?.utilization || 0,
    peakMemory: byMemory[0]?.used || 0,
  }
}

function latencyScore(valueMs) {
  return 100 * clamp((LATENCY_DECAY_BUDGETS * LATENCY_BUDGET_MS - num(valueMs)) / ((LATENCY_DECAY_BUDGETS - 1) * LATENCY_BUDGET_MS), 0, 1)
}

function performance(sim) {
  const m = readMetrics(sim)
  const p95Score = latencyScore(m.p95)
  const p99Score = latencyScore(m.p99)
  const latency = LATENCY_P95_WEIGHT * p95Score + LATENCY_P99_WEIGHT * p99Score
  const loss = clamp(m.failureRate + m.dropRate, 0, 1)
  const errorFree = 100 * (1 - clamp(loss / PERFORMANCE_ERROR_CEILING, 0, 1))
  const value = (1 - PERFORMANCE_ERROR_WEIGHT) * latency + PERFORMANCE_ERROR_WEIGHT * errorFree
  const overBudget = m.p95 > LATENCY_BUDGET_MS
  return {
    value: score(value),
    note: `p95 latency measured ${round1(m.p95)} ms against a ${LATENCY_BUDGET_MS} ms budget (p99 ${round1(m.p99)} ms, average ${round1(m.avg)} ms), and ${pct1(loss)}% of ${m.total} requests were lost to failures (${pct1(m.failureRate)}%) or drops (${pct1(m.dropRate)}%); latency is scored ${Math.round(LATENCY_P95_WEIGHT * 100)}% p95 / ${Math.round(LATENCY_P99_WEIGHT * 100)}% p99 on a 3x-budget decay and the remaining ${Math.round(PERFORMANCE_ERROR_WEIGHT * 100)}% treats ${pct1(PERFORMANCE_ERROR_CEILING)}% combined loss as zero${overBudget ? `, so p95 is ${round1(m.p95 - LATENCY_BUDGET_MS)} ms over budget` : ', so p95 sits inside budget'}.`,
  }
}

function scalability(sim, facts) {
  const components = simComponents(sim)
  const peaks = peakComponents(components)
  const util = 100 * (1 - clamp((peaks.peakUtil - SCALABILITY_UTIL_FREE) / SCALABILITY_UTIL_SPAN, 0, 1))
  const headroom = 100 * clamp((1 - peaks.peakMemory) / SCALABILITY_HEADROOM_TARGET, 0, 1)
  const base = SCALABILITY_UTIL_WEIGHT * util + SCALABILITY_HEADROOM_WEIGHT * headroom
  const bonus = (facts.hasLoadBalancer ? SCALABILITY_LB_BONUS : 0) + (facts.compute.length > 1 ? SCALABILITY_REPLICA_BONUS : 0)
  const utilName = label(peaks.topUtil?.c?.name, 'no measured component')
  const memName = label(peaks.topMemory?.c?.name, 'no measured component')
  return {
    value: score(base + bonus),
    note: `peak utilisation is ${pct1(peaks.peakUtil)}% at ${utilName} (scored ${Math.round(util)}% where ${pct1(SCALABILITY_UTIL_FREE)}% is free and 100% is zero) and peak memory use is ${pct1(peaks.peakMemory)}% at ${memName}, leaving ${pct1(1 - peaks.peakMemory)}% headroom (scored ${Math.round(headroom)}% against a ${pct1(SCALABILITY_HEADROOM_TARGET)}% target), weighted ${Math.round(SCALABILITY_UTIL_WEIGHT * 100)}/${Math.round(SCALABILITY_HEADROOM_WEIGHT * 100)} and then ${bonus > 0 ? `plus ${bonus} points for ${facts.hasLoadBalancer ? 'a load balancer' : 'no load balancer'} and ${facts.compute.length} compute node${facts.compute.length === 1 ? '' : 's'}` : 'no structural bonus because there is no load balancer and only 1 compute node'}.`,
  }
}

function reliability(sim, facts) {
  const m = readMetrics(sim)
  const components = simComponents(sim)
  const failure = 100 * (1 - clamp(m.failureRate / RELIABILITY_FAILURE_CEILING, 0, 1))
  const drop = 100 * (1 - clamp(m.dropRate / RELIABILITY_DROP_CEILING, 0, 1))
  const overflows = components
    .map((c) => ({ c, cap: num(c.queueCapacity, -1), max: num(c.queueLengthMax) }))
    .filter((x) => x.cap > 0 && x.max >= x.cap)
  const overflow = 100 * (1 - clamp(overflows.length / RELIABILITY_OVERFLOW_CEILING, 0, 1))
  const retryNodes = facts.nodes.filter((n) => num(facts.params.get(n.id)?.retryLimit) > 0)
  const retry = 100 * (retryNodes.length / Math.max(1, facts.nodeCount))
  const w = RELIABILITY_WEIGHTS
  const base = w.failure * failure + w.drop * drop + w.overflow * overflow + w.retry * retry
  const bonus = facts.compute.length > 1 ? RELIABILITY_REPLICA_BONUS : 0
  const overflowNames = listOf(overflows.map((x) => `${label(x.c.name)} at ${x.max}/${x.cap}`))
  return {
    value: score(base + bonus),
    note: `${m.failed} of ${m.total} requests failed (${pct1(m.failureRate)}% against a ${pct1(RELIABILITY_FAILURE_CEILING)}% ceiling) and ${m.dropped} were dropped (${pct1(m.dropRate)}%), ${overflows.length} queue${overflows.length === 1 ? '' : 's'} hit their configured limit (${overflowNames}, zeroed at ${RELIABILITY_OVERFLOW_CEILING}), and ${retryNodes.length} of ${facts.nodeCount} components carry a retry limit; the four parts weigh ${Math.round(w.failure * 100)}/${Math.round(w.drop * 100)}/${Math.round(w.overflow * 100)}/${Math.round(w.retry * 100)} with ${bonus > 0 ? `+${bonus} for ${facts.compute.length} compute nodes` : 'no replica bonus because there is only 1 compute node'}.`,
  }
}

function security(architecture) {
  const s = securityAssessment(architecture)
  return {
    value: s.score,
    note: `rule-based: ${SECURITY_BASE} base points, +${SECURITY_CONTROL_POINTS} each for the ${s.controls.length} of 3 perimeter controls found (${listOf(s.controls)}), and ${s.gatewayPenalty ? `-${s.gatewayPenalty} because no entry-point gateway fronts the ${s.appNodeCount}-node application tier` : 'no gateway penalty because an entry-point gateway fronts the application tier'}.`,
  }
}

function maintainabilityScore(count) {
  if (count <= 1) return 40
  if (count === 2) return 55
  if (count === 3) return 75
  if (count <= MAINTAINABILITY_IDEAL_MAX) return 100
  if (count <= MAINTAINABILITY_HEAVY) return 100 - (count - MAINTAINABILITY_IDEAL_MAX) * 5
  return 30
}

function maintainability(facts) {
  const w = MAINTAINABILITY_WEIGHTS
  const countScore = maintainabilityScore(facts.nodeCount)
  const cacheScore = facts.hasCache ? 100 : 40
  const modular = facts.applicationTypes.size >= 2 || facts.compute.length >= 2
  const modularScore = modular ? 100 : 50
  const value = w.count * countScore + w.cache * cacheScore + w.modular * modularScore
  const largest = [...facts.nodes].sort((a, b) => String(b.name).length - String(a.name).length)[0]
  return {
    value: score(value),
    note: `${facts.nodeCount} component${facts.nodeCount === 1 ? '' : 's'} scores ${countScore}/100 for size (${MAINTAINABILITY_IDEAL_MIN}-${MAINTAINABILITY_IDEAL_MAX} is the sweet spot, 1-2 is coupling risk, over ${MAINTAINABILITY_HEAVY} is monolith risk), the cache scores ${cacheScore}/100 because one is ${facts.hasCache ? 'present' : 'absent'}, and the application tier scores ${modularScore}/100 because it has ${facts.applicationTypes.size} distinct component type${facts.applicationTypes.size === 1 ? '' : 's'}; weighted ${Math.round(w.count * 100)}/${Math.round(w.cache * 100)}/${Math.round(w.modular * 100)} with the widest name being "${label(largest?.name)}".`,
  }
}

export function isSignificantBottleneck(bottleneck) {
  return PROCESS_SIGNIFICANT_SEVERITIES.has(bottleneck?.severity) && num(bottleneck?.waitingMs) >= PROCESS_BOTTLENECK_FLOOR_MS
}

function processEfficiency(mining) {
  if (!mining || typeof mining !== 'object') {
    return {
      value: score(100),
      note: 'no event log was mined, so 0 deviation groups and 0 bottlenecks are counted and conformance is treated as 100%, giving the full 100 points.',
    }
  }
  const stats = mining.statistics && typeof mining.statistics === 'object' ? mining.statistics : {}
  const deviations = Array.isArray(mining.deviations) ? mining.deviations : []
  const bottlenecks = Array.isArray(mining.bottlenecks) ? mining.bottlenecks : []
  const significant = bottlenecks.filter(isSignificantBottleneck)
  const totalCases = num(stats.totalCases)
  if (totalCases <= 0) {
    return {
      value: 0,
      note: `the log contains ${totalCases} cases, so the process was never observed and this dimension scores 0 rather than guessing at conformance.`,
    }
  }
  const conformance = clamp(num(stats.conformanceRate, 1), 0, 1)
  const deviationPenalty = Math.min(PROCESS_DEVIATION_CAP, PROCESS_DEVIATION_PENALTY * deviations.length)
  const bottleneckPenalty = Math.min(PROCESS_BOTTLENECK_CAP, PROCESS_BOTTLENECK_PENALTY * significant.length)
  const value = 100 - PROCESS_CONFORMANCE_SHARE * (1 - conformance) - deviationPenalty - bottleneckPenalty
  const byType = new Map()
  for (const d of deviations) {
    const key = d?.type || 'UNKNOWN'
    byType.set(key, (byType.get(key) || 0) + 1)
  }
  const types = [...byType.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k} x${v}`)
  return {
    value: score(value),
    note: `${pct1(conformance)}% of ${num(stats.completedCases)} completed cases followed an expected path, ${deviations.length} deviation group${deviations.length === 1 ? '' : 's'} (${listOf(types)}) and ${significant.length} bottleneck${significant.length === 1 ? '' : 's'} of at least ${PROCESS_BOTTLENECK_FLOOR_MS} ms per visit were found, so the score is 100 minus ${PROCESS_CONFORMANCE_SHARE} points for the non-conforming share, ${round1(deviationPenalty)} for deviation groups (${PROCESS_DEVIATION_PENALTY} each, capped at ${PROCESS_DEVIATION_CAP}) and ${round1(bottleneckPenalty)} for high/medium bottlenecks of ${PROCESS_BOTTLENECK_FLOOR_MS} ms or more (${PROCESS_BOTTLENECK_PENALTY} each, capped at ${PROCESS_BOTTLENECK_CAP}).`,
  }
}

export function evaluateArchitecture(contract, sim, mining) {
  const facts = architectureFacts(contract)
  const weights = {}
  for (const key of dimensionOrder) weights[key] = round2(dimensionMeta[key]?.weight ?? 0)

  if (!facts.nodeCount) {
    const dimensions = {}
    const notes = {}
    for (const key of dimensionOrder) {
      dimensions[key] = 0
      notes[key] = 'the architecture has no components, so there is nothing to score and this dimension reads 0.'
    }
    return { dimensions, weights, healthScore: 0, notes }
  }

  const parts = {
    performance: performance(sim),
    scalability: scalability(sim, facts),
    reliability: reliability(sim, facts),
    security: security(contract),
    maintainability: maintainability(facts),
    processEfficiency: processEfficiency(mining),
  }

  const dimensions = {}
  const notes = {}
  let weighted = 0
  for (const key of dimensionOrder) {
    const part = parts[key]
    dimensions[key] = part.value
    notes[key] = part.note
    weighted += part.value * (weights[key] || 0)
  }

  return {
    dimensions,
    weights,
    healthScore: clamp(Math.round(weighted), 0, 100),
    notes,
  }
}
