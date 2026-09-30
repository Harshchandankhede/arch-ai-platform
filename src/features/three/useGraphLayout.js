import { useEffect, useMemo, useState } from 'react'
import { categoryColor, colors, tierY } from '../../theme/tokens.js'
import { nodeTypes } from '../../data/nodeTypes.js'
import { graphOf } from '../../lib/contract.js'

export const MAX_PACKETS = 120
export const MAX_LABELS = 12
export const LAYOUT_SPAN = 16
export const PACKET_RATE_MIN = 0.5
export const PACKET_RATE_MAX = 14
export const PACKET_RATE_SCALE = 400
export const PACKET_MS_GAIN = 0.028
export const PACKET_DURATION_MIN = 0.6
export const PACKET_DURATION_MAX = 4

const TIER_Y_VALUES = Object.values(tierY).filter((v) => Number.isFinite(v))
const TIER_Y_MIN = TIER_Y_VALUES.length ? Math.min(...TIER_Y_VALUES) : 0
const TIER_Y_MAX = TIER_Y_VALUES.length ? Math.max(...TIER_Y_VALUES) : 0
const FALLBACK_TIER_Y = Number.isFinite(tierY.application) ? tierY.application : 0

export const TIER_CENTER_Y = (TIER_Y_MIN + TIER_Y_MAX) / 2

function finite(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function clamp(value, min, max) {
  const n = finite(value, min)
  if (n < min) return min
  if (n > max) return max
  return n
}

export function ratio(value) {
  const n = finite(value, 0)
  if (n <= 0) return 0
  if (n <= 1) return n
  return Math.min(1, n / 100)
}

function channel(hex, index) {
  const clean = String(hex).replace('#', '')
  const value = parseInt(clean.slice(index * 2, index * 2 + 2), 16)
  return Number.isFinite(value) ? value : 0
}

export function mixHex(from, to, amount) {
  const t = clamp(amount, 0, 1)
  const parts = [0, 1, 2].map((i) => {
    const base = channel(from, i)
    const next = channel(to, i)
    return Math.round(clamp(base + (next - base) * t, 0, 255))
  })
  return `#${parts.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

export function packetRateFor(throughputPerSec) {
  const t = Math.max(0, finite(throughputPerSec, 0))
  const saturate = 1 - Math.exp(-t / PACKET_RATE_SCALE)
  return PACKET_RATE_MIN + (PACKET_RATE_MAX - PACKET_RATE_MIN) * saturate
}

export function packetDurationFor(avgProcessingMs) {
  return clamp(
    PACKET_DURATION_MIN + Math.max(0, finite(avgProcessingMs, 12)) * PACKET_MS_GAIN,
    PACKET_DURATION_MIN,
    PACKET_DURATION_MAX,
  )
}

function distance3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

function coord(value) {
  return value === 0 ? 0 : value
}

function emptyBounds() {
  const center = [0, TIER_CENTER_Y, 0]
  return { min: [...center], max: [...center], center, span: 0, radius: 0 }
}

export function computeGraphLayout(architecture, sim) {
  const graph = graphOf(architecture)
  const samples = (architecture?.nodes || []).filter((n) => n && n.id && graph.byId.has(n.id))
  if (!samples.length) {
    return { nodes: [], edges: [], labelIds: [], throughputPerSec: 0, bounds: emptyBounds() }
  }

  const projected = samples.map((node) => ({
    node,
    category: nodeTypes[node.type]?.cat || 'application',
    px: finite(node.position?.x, 0),
    py: finite(node.position?.y, 0),
  }))

  const xs = projected.map((s) => s.px)
  const zs = projected.map((s) => s.py)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minZ = Math.min(...zs)
  const maxZ = Math.max(...zs)
  const midX = (minX + maxX) / 2
  const midZ = (minZ + maxZ) / 2
  const spanX = maxX - minX
  const spanZ = maxZ - minZ
  const scale = Math.max(spanX, spanZ) > 0 ? LAYOUT_SPAN / Math.max(spanX, spanZ) : 1
  const components = sim?.components || {}

  const nodes = projected.map((sample) => {
    const stat = components[sample.node.id] || {}
    const utilization = ratio(stat.utilization)
    const memoryUtilization = ratio(stat.memoryUtilization)
    const baseColor = categoryColor[sample.category] || categoryColor.application
    return {
      id: sample.node.id,
      node: sample.node,
      name: sample.node.name || nodeTypes[sample.node.type]?.name || sample.node.id,
      category: sample.category,
      shape: nodeTypes[sample.node.type]?.shape || 'rect',
      position: [
        coord((sample.px - midX) * scale),
        Number.isFinite(tierY[sample.category]) ? tierY[sample.category] : FALLBACK_TIER_Y,
        coord(-(sample.py - midZ) * scale),
      ],
      baseColor,
      color: mixHex(baseColor, colors.red, utilization),
      utilization,
      memoryUtilization,
      throughputPerSec: Math.max(0, finite(stat.throughputPerSec, 0)),
      avgProcessingMs: Math.max(
        0,
        finite(stat.avgProcessingMs, finite(nodeTypes[sample.node.type]?.defaults?.processingTime, 12)),
      ),
    }
  })

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const edges = []
  for (const edge of graph.edges) {
    const from = byId.get(edge.source)
    const to = byId.get(edge.target)
    if (!from || !to) continue
    const span = distance3(from.position, to.position)
    edges.push({
      key: `${edge.source}>${edge.target}#${edges.length}`,
      source: edge.source,
      target: edge.target,
      from: from.position,
      to: to.position,
      color: from.color,
      duration: packetDurationFor(to.avgProcessingMs),
      arc: span * 0.12,
    })
  }

  const labelIds = [...nodes]
    .sort((a, b) => b.utilization - a.utilization)
    .slice(0, MAX_LABELS)
    .map((n) => n.id)

  const positions = nodes.map((n) => n.position)
  const min = [
    Math.min(...positions.map((p) => p[0])),
    Math.min(...positions.map((p) => p[1])),
    Math.min(...positions.map((p) => p[2])),
  ]
  const max = [
    Math.max(...positions.map((p) => p[0])),
    Math.max(...positions.map((p) => p[1])),
    Math.max(...positions.map((p) => p[2])),
  ]
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2])

  return {
    nodes,
    edges,
    labelIds,
    throughputPerSec: Math.max(0, finite(sim?.metrics?.throughputPerSec, 0)),
    bounds: { min, max, center, span, radius: span / 2 },
  }
}

export function useGraphLayout(architecture, sim) {
  return useMemo(() => computeGraphLayout(architecture, sim), [architecture, sim])
}

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])
  return reduced
}

export function useDocumentActive() {
  const [active, setActive] = useState(true)
  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const sync = () => setActive(!document.hidden)
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])
  return active
}
