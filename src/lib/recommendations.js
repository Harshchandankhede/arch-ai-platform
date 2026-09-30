import { dimensionMeta, dimensionOrder } from '../theme/tokens.js'
import { architectureFacts, readMetrics, securityAssessment, evaluateArchitecture, isSignificantBottleneck } from './evaluation.js'

const BELOW_THRESHOLD = 80
const HIGH_SEVERITY = 50
const MED_SEVERITY = 70
const SECURITY_CONTROL_POINTS = 25
const PICK_LIMIT = 3
const CAP = 4

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const num = (v, fallback = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}
const rate = (v) => clamp(num(v), 0, 1)
const round1 = (v) => Math.round(v * 10) / 10
const ratio2 = (v) => Math.round(num(v) * 100) / 100
const pct1 = (v) => Math.round(clamp(v, 0, 1) * 1000) / 10
const label = (v, fallback = 'Unlabelled') => (v ? String(v) : fallback)
const labelise = (key) => dimensionMeta[key]?.label || key
const listOf = (items) => (items.length ? items.join(', ') : 'none')
const andList = (items) =>
  items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0] || 'none'

const severityFor = (value) => (value < HIGH_SEVERITY ? 'high' : value < MED_SEVERITY ? 'med' : 'low')

function componentList(sim) {
  const raw = sim?.components && typeof sim.components === 'object' ? Object.values(sim.components) : []
  return raw.filter((c) => c && typeof c === 'object')
}

function slowestComponent(components, mining) {
  const mined = (mining?.bottlenecks || [])[0]
  if (mined?.component) {
    const match = components.find((c) => c.id === mined.componentId || c.name === mined.component)
    return {
      name: label(mined.component),
      id: mined.componentId || match?.id || '',
      utilization: rate(match?.utilization),
      wait: num(mined.waitingMs),
      waitRatio: num(mined.waitRatio),
      processing: num(mined.processingMs),
      capacity: num(match?.capacity),
      visits: num(mined.visits),
      source: 'mining',
    }
  }
  const ranked = components
    .map((c) => ({ c, cost: num(c.avgProcessingMs) + num(c.avgQueueWaitMs) }))
    .sort((a, b) => b.cost - a.cost)
  const top = ranked[0]?.c
  if (!top) {
    return { name: 'the busiest component', id: '', utilization: 0, wait: 0, waitRatio: 0, processing: 0, capacity: 0, visits: 0, source: 'none' }
  }
  const wait = num(top.avgQueueWaitMs)
  const processing = num(top.avgProcessingMs)
  return {
    name: label(top.name),
    id: top.id || '',
    utilization: rate(top.utilization),
    wait,
    waitRatio: processing > 0 ? wait / Math.max(processing, 1) : wait,
    processing,
    capacity: num(top.capacity),
    visits: num(top.visits),
    source: 'sim',
  }
}

function miningFacts(mining) {
  const stats = mining?.statistics && typeof mining.statistics === 'object' ? mining.statistics : {}
  const deviations = Array.isArray(mining?.deviations) ? mining.deviations : []
  const bottlenecks = Array.isArray(mining?.bottlenecks) ? mining.bottlenecks : []
  return {
    present: Boolean(mining && typeof mining === 'object'),
    stats,
    deviations,
    bottlenecks,
    significant: bottlenecks.filter(isSignificantBottleneck),
    conformance: clamp(num(stats.conformanceRate, 1), 0, 1),
    totalCases: num(stats.totalCases),
    droppedCases: num(stats.droppedCases),
    topDeviation: [...deviations].sort(
      (a, b) => num(b?.caseCount) - num(a?.caseCount) || String(a?.type).localeCompare(String(b?.type)),
    )[0] || null,
  }
}

function buildPerformance(ctx) {
  const { m, slowest } = ctx
  const budget = 200
  const over = Math.max(0, m.p95 - budget)
  const visits = num(slowest.visits) || m.total
  return {
    title: `Pull p95 latency back under the ${budget} ms budget`,
    issue: `p95 latency reached ${round1(m.p95)} ms (${round1(over)} ms over the ${budget} ms budget), p99 was ${round1(m.p99)} ms, the average was ${round1(m.avg)} ms, and ${m.failed} of ${m.total} requests failed while ${m.dropped} were dropped.`,
    why: `${slowest.name} is the largest cost: it adds ${round1(slowest.wait)} ms of queue wait ahead of ${round1(slowest.processing)} ms of processing across ${visits} visits (${ratio2(slowest.waitRatio)}x wait ratio) while sitting at ${pct1(slowest.utilization)}% utilisation, so every request pays that delay on the way in and again on the way back.`,
    recommendation:
      `Scale out or split ${slowest.name} (capacity ${slowest.capacity} concurrent, ${pct1(slowest.utilization)}% utilised) so the ${round1(slowest.wait)} ms queue wait per visit falls below its ${round1(slowest.processing)} ms of real work, and cache whatever it re-reads across the ${num(ctx.facts.stores.length)} data store${num(ctx.facts.stores.length) === 1 ? '' : 's'}.`,
    effect: `Removing roughly ${round1(slowest.wait)} ms of wait per visit trims the slowest hop out of the ${round1(m.p95)} ms p95 path and lifts the current ${round1(m.throughput)} requests per second.`,
    expectedImpact: ['lower p95 latency', 'shorter queue waits', 'higher throughput'],
  }
}

function buildScalability(ctx) {
  const { m, facts, peaks } = ctx
  const utilName = label(peaks.topUtil?.name, 'the busiest component')
  const memName = label(peaks.topMemory?.name, 'the largest memory consumer')
  const memLimit = num(peaks.topMemory?.memoryLimitMb)
  const memUsed = num(peaks.topMemory?.memoryUsedMb)
  const steps = []
  if (!facts.hasLoadBalancer) {
    steps.push(
      facts.compute.length
        ? `insert a load balancer in front of the ${facts.compute.length} compute node${facts.compute.length === 1 ? '' : 's'} so traffic spreads evenly`
        : `insert a load balancer between ${label(facts.entryGateway?.name, 'the entry point')} and the ${num(facts.applicationTypes.size)} application-tier type${num(facts.applicationTypes.size) === 1 ? '' : 's'} so requests are spread before they reach a single instance`,
    )
  }
  if (facts.compute.length === 0) {
    steps.push(`add a server or microservice node to execute requests, since all ${num(facts.stores.length)} of the current components are non-compute`)
  } else if (facts.compute.length === 1) {
    steps.push(`add a second compute node beside ${label(facts.compute[0]?.name, 'the single server')}`)
  }
  if (peaks.peakUtil > 0.85) steps.push(`raise the concurrency limit on ${utilName}, which is already at ${pct1(peaks.peakUtil)}% utilisation`)
  if (peaks.peakMemory > 0.75) steps.push(`give ${memName} more heap or move sessions out of it, since it holds ${round1(memUsed)} MB of ${round1(memLimit)} MB (${pct1(peaks.peakMemory)}%)`)
  if (!steps.length) steps.push(`watch ${utilName} at ${pct1(peaks.peakUtil)}% and add capacity before it passes 85% at the current ${round1(m.arrivalRate)} requests per second of offered load`)
  const plan = steps
    .slice(0, 3)
    .map((s, i, all) => (i === 0 ? s.charAt(0).toUpperCase() + s.slice(1) : i === all.length - 1 ? `and ${s}` : `then ${s}`))
    .join(', ')
  return {
    title: `Create headroom on the ${pct1(peaks.peakUtil)}% tier before ${round1(m.arrivalRate)} req/s doubles`,
    issue: `peak utilisation is ${pct1(peaks.peakUtil)}% at ${utilName} and peak memory use is ${pct1(peaks.peakMemory)}% at ${memName} (${round1(memUsed)} MB of ${round1(memLimit)} MB), with ${facts.hasLoadBalancer ? 'a' : 'no'} load balancer and ${facts.compute.length} compute node${facts.compute.length === 1 ? '' : 's'} across ${facts.nodeCount} components.`,
    why: `A single saturated tier sets the ceiling for everyone behind it: at ${pct1(peaks.peakUtil)}% utilisation ${utilName} has only ${round1((1 - peaks.peakUtil) * 100)}% of its capacity left, and ${pct1(peaks.peakMemory)}% memory on ${memName} means an out-of-memory failure long before the load doubles.`,
    recommendation: `${plan}.`,
    effect: `Balance ${utilName} across ${Math.max(2, facts.compute.length)} instances and keep ${memName} under ${pct1(0.6)}% memory, which protects the ${round1(m.throughput)} requests per second already delivered as offered load grows.`,
    expectedImpact: ['more concurrent users per node', 'lower peak utilisation', 'no memory ceiling breach'],
  }
}

function buildReliability(ctx) {
  const { m, facts, components, overflows } = ctx
  const topFailure = [...components].sort((a, b) => num(b.failures) - num(a.failures))[0]
  const withoutRetry = facts.nodes.filter((n) => num(facts.params.get(n.id)?.retryLimit) <= 0)
  const overflowName = label(overflows[0]?.c?.name, 'the deepest component')
  return {
    title: `Stop the ${pct1(m.failureRate + m.dropRate)}% request loss`,
    issue: `${m.failed} of ${m.total} requests failed (${pct1(m.failureRate)}% failure rate) and ${m.dropped} were dropped (${pct1(m.dropRate)}%), leaving a ${pct1(m.successRate)}% success rate; ${overflows.length} of ${components.length} queues hit their configured limit${overflows.length === 1 ? '' : 's'} and ${withoutRetry.length} of ${facts.nodeCount} components have no retry limit.`,
    why: `Losses concentrate where there is no redundancy: ${label(topFailure?.name, 'the busiest component')} raised ${num(topFailure?.failures)} failure${num(topFailure?.failures) === 1 ? '' : 's'} and ${num(topFailure?.retries)} retries, so every one of those requests turned into a ${round1(m.avg)} ms wait followed by an error for the caller.`,
    recommendation: `Bound the blast radius of ${label(topFailure?.name, 'the failing component')}: cap retries at 1-2 attempts with backoff, keep a spare ${facts.compute.length > 1 ? 'instance behind the load balancer' : 'compute node behind a new load balancer'}, and size the queue on ${overflowName} so it stops rejecting at ${num(overflows[0]?.max)} of ${num(overflows[0]?.cap)} waiting.`,
    effect: `Halving the observed ${pct1(m.failureRate)}% failure rate and clearing the ${pct1(m.dropRate)}% drop rate lifts the success rate from ${pct1(m.successRate)}% and returns roughly ${m.failed + m.dropped} of ${m.total} requests per run.`,
    expectedImpact: ['fewer failed requests', 'no dropped requests', 'bounded retry storms'],
  }
}

function buildSecurity(ctx) {
  const { security, facts } = ctx
  const appLabel = `${security.appNodeCount} application component${security.appNodeCount === 1 ? '' : 's'}`
  const projected = clamp(security.score + security.missing.length * SECURITY_CONTROL_POINTS, 0, 100)
  const present = security.controls.length
  const missing = security.missing.length
  const gatewayClause = security.gatewayPenalty
    ? `the unfronted application tier costs ${security.gatewayPenalty} points on its own`
    : `the entry-point gateway is already in place, so only the ${missing} missing control${missing === 1 ? '' : 's'} stand between this design and a perfect score`
  return {
    title: missing === 0 ? 'Tighten the perimeter controls that are already present' : `Add the ${missing} missing perimeter control${missing === 1 ? '' : 's'}`,
    issue: `Of the 3 perimeter controls this scoring looks for, ${present} ${present === 1 ? 'is' : 'are'} present (${listOf(security.controls)}) and ${missing} ${missing === 1 ? 'is' : 'are'} missing (${listOf(security.missing)}); the ${facts.nodeCount}-node design places ${appLabel} with ${security.gatewayPenalty ? 'no gateway in front of them' : 'an entry-point gateway in front of them'}.`,
    why: `Each missing control leaves a real gap: without ${andList(security.missing)}, traffic reaches the ${appLabel} unauthenticated and unfiltered, and ${gatewayClause}.`,
    recommendation:
      missing === 0
        ? `Keep the ${andList(security.controls)} chain intact and place a second authentication node behind the entry gateway so the ${appLabel} is never reachable directly.`
        : `Insert ${security.missing.map((c, i) => (i === 0 ? c : c)).join(', then ')} at the front of the ${appLabel}, then re-run the simulation to confirm the added hop latency stays inside the ${round1(ctx.m.p95)} ms p95.`,
    effect: `Restoring all ${missing} missing control${missing === 1 ? '' : 's'} takes the security score from ${security.score} to a projected ${projected}${security.gatewayPenalty ? ` and gives back the ${security.gatewayPenalty} point unfronted-tier penalty` : ''}.`,
    expectedImpact: ['authenticated entry point', 'filtered perimeter traffic', 'higher security score'],
  }
}

function buildMaintainability(ctx) {
  const { facts, m } = ctx
  const widest = [...facts.nodes].sort((a, b) => num(facts.params.get(b.id)?.capacity) - num(facts.params.get(a.id)?.capacity))[0]
  const widestName = label(widest?.name)
  const widestCapacity = num(facts.params.get(widest?.id)?.capacity)
  const sizeWord = facts.nodeCount <= 2 ? 'a coupling risk' : facts.nodeCount > 10 ? 'a monolith risk' : 'a workable size'
  return {
    title: `Keep ${facts.nodeCount} components at ${sizeWord}`,
    issue: `The design has ${facts.nodeCount} component${facts.nodeCount === 1 ? '' : 's'} (${sizeWord}), ${facts.hasCache ? 1 : 0} cache${facts.hasCache ? '' : 's'} and ${facts.applicationTypes.size} distinct application-tier type${facts.applicationTypes.size === 1 ? '' : 's'}, with the widest node "${widestName}" configured for ${widestCapacity} concurrent sessions.`,
    why: `Shape drives change cost: at ${facts.nodeCount} nodes the change surface spans ${round1(m.throughput)} requests per second, and ${facts.hasCache ? `the cache keeps repeated reads off the data tier` : `every read still goes to the data tier, which is where ${round1(ctx.slowest.wait)} ms of the slowest hop is spent`}.`,
    recommendation:
      facts.nodeCount <= 2
        ? `Split "${widestName}" into an API gateway plus a service so its ${widestCapacity}-session ceiling has its own scaling limit, then add a cache in front of the ${facts.stores.length > 1 ? 'stores' : 'store'}.`
        : facts.nodeCount > 10
          ? `Collapse the ${facts.nodeCount} nodes into bounded services behind the ${label(facts.entryGateway?.name, 'entry point')}, keep a cache in front of the data tier, and remember that ${round1(ctx.slowest.wait)} ms of wait at ${ctx.slowest.name} makes every extra hop expensive.`
          : `Keep the ${facts.applicationTypes.size} application type${facts.applicationTypes.size === 1 ? '' : 's'} separate and give "${widestName}" its own ${widestCapacity}-session capacity budget rather than raising the whole tier.`,
    effect: `Holding ${facts.nodeCount} components with ${facts.hasCache ? 'a' : 'no'} cache keeps change blast radius small while ${round1(ctx.slowest.wait)} ms of queue wait at ${ctx.slowest.name} stays attributable to a single component.`,
    expectedImpact: ['smaller change blast radius', 'independent component scaling', 'clearer ownership'],
  }
}

function buildProcessEfficiency(ctx) {
  const { mined, slowest } = ctx
  const dev = mined.topDeviation
  const bottleneck = mined.bottlenecks[0]
  const nonConforming = pct1(1 - mined.conformance)
  const conforming = mined.conformance >= 1
  const routeClause = conforming
    ? `every logged case follows the modelled route, so the remaining ${mined.deviations.length} deviation group${mined.deviations.length === 1 ? '' : 's'} are runtime events rather than routing errors`
    : `${nonConforming}% of cases take a route you did not design`
  const queueClause = bottleneck
    ? `${label(bottleneck.component)} waits ${round1(bottleneck.waitingMs)} ms per visit at a ${ratio2(bottleneck.waitRatio)}x wait ratio, which is the queueing the log is measuring`
    : `no component queued for 5 ms or more, so the slowest hop (${label(slowest.name)} at ${round1(slowest.processing)} ms of processing) is service time rather than queueing`
  return {
    title:
      mined.deviations.length === 0
        ? 'Keep the modelled process aligned with the log'
        : `Close ${mined.deviations.length} process deviation${mined.deviations.length === 1 ? '' : 's'}`,
    issue: `${pct1(mined.conformance)}% of ${mined.totalCases} logged cases matched an expected path, so ${nonConforming}% diverged; the log shows ${mined.deviations.length} deviation group${mined.deviations.length === 1 ? '' : 's'} and ${mined.bottlenecks.length} bottleneck${mined.bottlenecks.length === 1 ? '' : 's'}, led by ${dev ? `${dev.type} at ${label(dev.component)} in ${num(dev.caseCount)} case${num(dev.caseCount) === 1 ? '' : 's'}` : `queue wait of ${round1(slowest.wait)} ms at ${slowest.name}`}.`,
    why: `The logged process does not match the model you drew: ${routeClause}, and ${queueClause}.`,
    recommendation: dev
      ? `Fix the ${dev.type} deviation at ${label(dev.component)}: ${dev.detail.replace(/\.$/, '')}, then re-run the process mining view to confirm it clears from the ${mined.deviations.length} group${mined.deviations.length === 1 ? '' : 's'}.`
      : `Instrument the ${mined.bottlenecks.length} bottleneck${mined.bottlenecks.length === 1 ? '' : 's'} in the log and re-check ${label(slowest.name)} so its ${round1(slowest.wait)} ms wait stays under the ${round1(slowest.processing)} ms it spends working.`,
    effect: `Clearing the ${mined.deviations.length} deviation group${mined.deviations.length === 1 ? '' : 's'} and the ${mined.significant.length} bottleneck${mined.significant.length === 1 ? '' : 's'} of 50 ms or more affects the ${mined.totalCases} logged case${mined.totalCases === 1 ? '' : 's'} of this run and lifts process efficiency from ${ctx.processScore} towards 100.`,
    expectedImpact: ['higher conformance rate', 'fewer deviations in the log', 'shorter case cycle time'],
  }
}

const BUILDERS = {
  performance: buildPerformance,
  scalability: buildScalability,
  reliability: buildReliability,
  security: buildSecurity,
  maintainability: buildMaintainability,
  processEfficiency: buildProcessEfficiency,
}

function buildContext(contract, sim, mining, evaluation) {
  const facts = architectureFacts(contract)
  const components = componentList(sim)
  const topUtil = [...components].sort((a, b) => rate(b.utilization) - rate(a.utilization))[0] || null
  const topMemory = [...components].sort((a, b) => rate(b.memoryUtilization) - rate(a.memoryUtilization))[0] || null
  return {
    facts,
    m: readMetrics(sim),
    components,
    peaks: {
      topUtil,
      topMemory,
      peakUtil: rate(topUtil?.utilization),
      peakMemory: rate(topMemory?.memoryUtilization),
    },
    overflows: components
      .map((c) => ({ c, cap: num(c.queueCapacity, -1), max: num(c.queueLengthMax) }))
      .filter((x) => x.cap > 0 && x.max >= x.cap),
    slowest: slowestComponent(components, mining),
    security: securityAssessment(contract),
    mined: miningFacts(mining),
    processScore: num(evaluation?.dimensions?.processEfficiency),
  }
}

function positiveFinding(contract, sim, mining, evaluation) {
  const ctx = buildContext(contract, sim, mining, evaluation)
  const dims = evaluation?.dimensions || {}
  const weakest = dimensionOrder
    .map((key) => ({ key, value: num(dims[key]) }))
    .sort((a, b) => a.value - b.value || dimensionOrder.indexOf(a.key) - dimensionOrder.indexOf(b.key))[0]
  return {
    id: 'rec-architecture-strength',
    severity: 'low',
    dimension: weakest?.key || 'performance',
    title: `${labelise(weakest?.key)} is the thinnest dimension at ${num(weakest?.value)}/100`,
    issue: `Every dimension scores at or above ${BELOW_THRESHOLD}: ${dimensionOrder.map((k) => `${labelise(k)} ${num(dims[k])}`).join(', ')}, with a weighted health score of ${num(evaluation?.healthScore)}/100 across ${ctx.m.total} simulated requests.`,
    why: `Nothing here is a bottleneck: ${ctx.slowest.name} is the slowest hop at ${round1(ctx.slowest.wait)} ms of wait for ${round1(ctx.slowest.processing)} ms of work (${pct1(ctx.slowest.utilization)}% utilisation), and ${pct1(ctx.mined.conformance)}% of logged cases matched the expected path.`,
    recommendation: `Lock the current shape of the ${ctx.facts.nodeCount} components in as a baseline, then raise the bar on ${labelise(weakest?.key)} (${num(weakest?.value)}/100) before adding load, since ${ctx.m.dropped} drops and ${ctx.m.failed} failures are already low.`,
    effect: `Holding p95 at ${round1(ctx.m.p95)} ms and conformance at ${pct1(ctx.mined.conformance)} keeps the health score near ${num(evaluation?.healthScore)} while the workload grows beyond ${round1(ctx.m.arrivalRate)} requests per second.`,
    expectedImpact: ['no regressions as load grows', 'stable p95 latency', 'preserved conformance'],
  }
}

export function buildRecommendations(contract, sim, mining, evaluation) {
  const evaluationResult =
    evaluation && typeof evaluation === 'object' && evaluation.dimensions
      ? evaluation
      : evaluateArchitecture(contract, sim, mining)
  const dimensions = evaluationResult.dimensions || {}
  const ctx = buildContext(contract, sim, mining, evaluationResult)

  const ordered = dimensionOrder
    .map((key) => ({ key, value: num(dimensions[key]) }))
    .sort((a, b) => a.value - b.value || dimensionOrder.indexOf(a.key) - dimensionOrder.indexOf(b.key))

  const picked = ordered.filter((d) => d.value < BELOW_THRESHOLD).slice(0, PICK_LIMIT)
  if (!picked.length) return [positiveFinding(contract, sim, mining, evaluationResult)]

  return picked.slice(0, CAP).map(({ key, value }) => {
    const built = BUILDERS[key](ctx)
    return {
      id: `rec-${key}`,
      severity: severityFor(value),
      dimension: key,
      title: built.title,
      issue: built.issue,
      why: built.why,
      recommendation: built.recommendation,
      effect: built.effect,
      expectedImpact: built.expectedImpact,
    }
  })
}
