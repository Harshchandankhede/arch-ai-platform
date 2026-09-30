import { ApiError } from '../middleware/errorHandler.js'
import Project from '../models/Project.model.js'

const MAX_NODE_ID = 120
const MAX_EDGE_ID = 120

function assertArch(arch) {
  if (!arch || typeof arch !== 'object') return { nodes: [], edges: [] }
  const nodes = Array.isArray(arch.nodes) ? arch.nodes : []
  const edges = Array.isArray(arch.edges) ? arch.edges : []
  if (nodes.length > MAX_NODE_ID) throw new ApiError(400, `An architecture may contain at most ${MAX_NODE_ID} components.`)
  if (edges.length > MAX_EDGE_ID) throw new ApiError(400, `An architecture may contain at most ${MAX_EDGE_ID} connections.`)

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

function toPublic(project) {
  return {
    id: project._id.toString(),
    name: project.name,
    description: project.description,
    arch: project.arch || { nodes: [], edges: [] },
    currentVersion: project.currentVersion ?? 0,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  }
}

export async function listProjects(ownerId) {
  const projects = await Project.find({ owner: ownerId }).sort({ updatedAt: -1 })
  return projects.map(toPublic)
}

export async function getProject(id, ownerId) {
  if (!isValidId(id)) throw new ApiError(404, 'Project not found.')
  const project = await Project.findOne({ _id: id, owner: ownerId })
  if (!project) throw new ApiError(404, 'Project not found.')
  return toPublic(project)
}

export async function createProject({ ownerId, name, description, arch }) {
  const trimmed = String(name || '').trim()
  if (!trimmed) throw new ApiError(400, 'Project name is required.')
  if (trimmed.length > 120) throw new ApiError(400, 'Project name must be at most 120 characters.')

  let created
  try {
    created = await Project.create({
      name: trimmed,
      description: String(description || '').trim(),
      owner: ownerId,
      arch: assertArch(arch),
    })
  } catch (error) {
    if (error.statusCode) throw error
    if (error.name === 'ValidationError') {
      throw new ApiError(400, error.message)
    }
    throw error
  }
  return toPublic(created)
}

export async function updateProject(id, ownerId, patch) {
  if (!isValidId(id)) throw new ApiError(404, 'Project not found.')

  const update = {}
  if (patch.name !== undefined) {
    const trimmed = String(patch.name).trim()
    if (!trimmed) throw new ApiError(400, 'Project name cannot be empty.')
    update.name = trimmed
  }
  if (patch.description !== undefined) update.description = String(patch.description).trim()
  if (patch.arch !== undefined) update.arch = assertArch(patch.arch)

  const project = await Project.findOneAndUpdate({ _id: id, owner: ownerId }, update, {
    new: true,
    runValidators: true,
  })
  if (!project) throw new ApiError(404, 'Project not found.')
  return toPublic(project)
}

export async function deleteProject(id, ownerId) {
  if (!isValidId(id)) throw new ApiError(404, 'Project not found.')
  const project = await Project.findOneAndDelete({ _id: id, owner: ownerId })
  if (!project) throw new ApiError(404, 'Project not found.')
  return { id: project._id.toString(), name: project.name }
}

function isValidId(id) {
  return /^[a-fA-F0-9]{24}$/.test(String(id || ''))
}

export { toPublic }