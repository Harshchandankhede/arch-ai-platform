import { resolveParams, isClient, isStore } from '../data/nodeTypes.js'
import { graphOf, entryNodeIds, terminalNodeIds } from './contract.js'

const CLIENT = ['user', 'webClient', 'mobileClient']

export function validateArchitecture(architecture) {
  const errors = []
  const warnings = []
  const nodes = architecture?.nodes || []
  const edges = architecture?.edges || []

  if (!nodes.length) {
    errors.push('Architecture has no components.')
    return { valid: false, errors, warnings }
  }

  const ids = nodes.map((n) => n.id)
  if (new Set(ids).size !== ids.length) errors.push('Duplicate node IDs detected.')

  const idSet = new Set(ids)
  for (const e of edges) {
    if (!idSet.has(e.source) || !idSet.has(e.target)) {
      errors.push(`Edge "${e.id || `${e.source}->${e.target}`}" references a component that does not exist.`)
    }
    if (e.source === e.target) {
      errors.push(`Component "${e.source}" cannot connect to itself.`)
    }
  }

  const hasEntry = nodes.some((n) => CLIENT.includes(n.type))
  if (!hasEntry) {
    errors.push('No entry point found (add a User, Web Client or Mobile Client).')
  }

  const connected = new Set()
  for (const e of edges) {
    connected.add(e.source)
    connected.add(e.target)
  }
  if (nodes.length > 1) {
    for (const n of nodes) {
      if (!connected.has(n.id)) warnings.push(`"${n.name}" is not connected to any other component.`)
    }
  }

  if (!terminalNodeIds(architecture).length && edges.length) {
    warnings.push('No terminal component found — every path keeps routing onwards.')
  }

  if (!nodes.some((n) => isStore(n))) {
    warnings.push('No persistent data store (Database or File Storage) found in this architecture.')
  }

  if (!edges.length && nodes.length > 1) {
    errors.push('No connections between components — nothing can reach the data store.')
  }

  for (const n of nodes) {
    const p = resolveParams(n)
    if (p.capacity !== undefined && p.capacity <= 0) {
      errors.push(`"${n.name}" has a capacity of ${p.capacity}; it must be greater than zero.`)
    }
    if (p.processingTime !== undefined && p.processingTime < 0) {
      errors.push(`"${n.name}" has a negative processing time.`)
    }
    if (p.failureProbability !== undefined && (p.failureProbability < 0 || p.failureProbability > 1)) {
      errors.push(`"${n.name}" has a failure probability of ${p.failureProbability}; it must be between 0 and 1.`)
    }
    if (p.queueCapacity !== undefined && p.queueCapacity < 0) {
      errors.push(`"${n.name}" has a negative queue capacity.`)
    }
  }

  const { outgoing } = graphOf(architecture)
  const hasCycles = detectCycles(outgoing, nodes.map((n) => n.id))
  if (hasCycles) {
    warnings.push('Architecture contains a cycle. Simulation will cap traversal depth to avoid infinite routing.')
  }

  const entries = entryNodeIds(architecture)
  if (entries.length > 1) {
    warnings.push(`${entries.length} entry points detected. Workload is distributed evenly across them.`)
  }

  const reachable = reachableFrom(outgoing, entries, ids)
  for (const n of nodes) {
    if (!reachable.has(n.id)) warnings.push(`"${n.name}" is unreachable from the entry point.`)
  }

  return { valid: errors.length === 0, errors, warnings }
}

export function detectCycles(outgoing, ids) {
  const state = new Map()
  const visit = (id) => {
    if (state.get(id) === 1) return true
    if (state.get(id) === 2) return false
    state.set(id, 1)
    for (const kid of outgoing.get(id) || []) {
      if (visit(kid)) return true
    }
    state.set(id, 2)
    return false
  }
  return ids.some((id) => visit(id))
}

export function reachableFrom(outgoing, starts, allIds) {
  const seen = new Set()
  const stack = [...starts]
  while (stack.length) {
    const id = stack.pop()
    if (seen.has(id)) continue
    seen.add(id)
    for (const kid of outgoing.get(id) || []) {
      if (allIds.includes(kid)) stack.push(kid)
    }
  }
  return seen
}

export function canSimulate(architecture) {
  if (!architecture?.nodes?.length) return false
  if (!architecture?.edges?.length) return false
  if (!architecture.nodes.some((n) => isClient(n))) return false
  return true
}
