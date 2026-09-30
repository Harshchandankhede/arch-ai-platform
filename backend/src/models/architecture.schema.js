import mongoose from 'mongoose'

const { Schema } = mongoose

export const MAX_NODES = 120
export const MAX_EDGES = 120

export const nodeSchema = new Schema(
  {
    id: { type: String, required: true },
    type: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    position: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
    },
    parameters: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false },
)

export const edgeSchema = new Schema(
  {
    id: { type: String, required: true },
    source: { type: String, required: true },
    target: { type: String, required: true },
  },
  { _id: false },
)

export const architectureSchema = new Schema(
  {
    nodes: { type: [nodeSchema], default: [] },
    edges: { type: [edgeSchema], default: [] },
  },
  { _id: false },
)

export function emptyArchitecture() {
  return { nodes: [], edges: [] }
}

export function assertArchitecture(arch, ApiError) {
  if (!arch || typeof arch !== 'object') return emptyArchitecture()

  const nodes = Array.isArray(arch.nodes) ? arch.nodes : []
  const edges = Array.isArray(arch.edges) ? arch.edges : []

  if (nodes.length > MAX_NODES) {
    throw new ApiError(400, `An architecture may contain at most ${MAX_NODES} components.`)
  }
  if (edges.length > MAX_EDGES) {
    throw new ApiError(400, `An architecture may contain at most ${MAX_EDGES} connections.`)
  }

  const ids = new Set()
  for (const n of nodes) {
    if (!n?.id || !n?.type) throw new ApiError(400, 'Every component needs an id and a type.')
    if (ids.has(n.id)) throw new ApiError(400, `Duplicate component id: ${n.id}`)
    ids.add(n.id)
  }

  for (const e of edges) {
    if (!e?.source || !e?.target) throw new ApiError(400, 'Every connection needs a source and a target.')
    if (!ids.has(e.source) || !ids.has(e.target)) {
      throw new ApiError(400, 'Connection references a component that does not exist.')
    }
  }

  return { nodes, edges }
}