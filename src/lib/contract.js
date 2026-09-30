import { resolveParams, nodeTypes } from '../data/nodeTypes.js'

export function toContract(architecture) {
  return {
    nodes: (architecture?.nodes || []).map((n) => ({
      id: n.id,
      type: n.type,
      name: n.name,
      parameters: resolveParams(n),
    })),
    edges: (architecture?.edges || [])
      .filter((e) => e.source && e.target)
      .map((e) => ({ source: e.source, target: e.target })),
  }
}

export function contractToBuilder(contract, template = null) {
  const positions = new Map((template?.nodes || []).map((n) => [n.id, n.position]))
  return {
    nodes: (contract.nodes || []).map((n, i) => ({
      id: n.id,
      type: n.type,
      name: n.name,
      position: positions.get(n.id) || { x: 80 + (i % 4) * 260, y: 80 + Math.floor(i / 4) * 150 },
      parameters: { ...n.parameters },
    })),
    edges: (contract.edges || []).map((e, i) => ({
      id: `e${i + 1}-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
    })),
  }
}

export function archHash(architecture) {
  const c = toContract(architecture)
  const str = JSON.stringify(c)
  let h = 2166136261
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

export function graphOf(architecture) {
  const contract = toContract(architecture)
  const nodes = contract.nodes
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const outgoing = new Map()
  const incoming = new Map()
  for (const n of nodes) {
    outgoing.set(n.id, [])
    incoming.set(n.id, [])
  }
  for (const e of contract.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue
    outgoing.get(e.source).push(e.target)
    incoming.get(e.target).push(e.source)
  }
  return { nodes, edges: contract.edges, byId, outgoing, incoming }
}

export function entryNodeIds(architecture) {
  const { nodes, incoming } = graphOf(architecture)
  const roots = nodes.filter((n) => (incoming.get(n.id) || []).length === 0)
  const preferred = roots.filter((n) => ['user', 'webClient', 'mobileClient'].includes(n.type))
  const chosen = preferred.length ? preferred : roots
  return chosen.map((n) => n.id)
}

export function findEntryNode(architecture) {
  const ids = entryNodeIds(architecture)
  if (!ids.length) return null
  return architecture.nodes.find((n) => n.id === ids[0]) || null
}

export function terminalNodeIds(architecture) {
  const { outgoing } = graphOf(architecture)
  return [...outgoing.entries()].filter(([, kids]) => kids.length === 0).map(([id]) => id)
}

export function expectedPaths(architecture, maxPaths = 6) {
  const { nodes, outgoing, incoming } = graphOf(architecture)
  if (!nodes.length) return []
  const starts = nodes.filter((n) => (incoming.get(n.id) || []).length === 0).map((n) => n.id)
  const roots = starts.length ? starts : [nodes[0].id]
  const results = []
  const walk = (id, path) => {
    if (results.length >= maxPaths) return
    if (path.includes(id)) return
    const next = [...path, id]
    const kids = outgoing.get(id) || []
    if (!kids.length) {
      results.push(next)
      return
    }
    for (const k of kids) walk(k, next)
  }
  for (const r of roots) walk(r, [])
  return results.map((p) => p.map((id) => ({ id, name: nodes.find((n) => n.id === id)?.name || id })))
}

export function nodeLabel(architecture, id) {
  return architecture?.nodes?.find((n) => n.id === id)?.name || nodeTypes[id]?.name || id
}

export function categoryOf(node) {
  return nodeTypes[node?.type]?.cat || 'application'
}
