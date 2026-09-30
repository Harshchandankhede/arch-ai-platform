import api from './api.js'
import { starterArchitecture, strongArchitecture, weakArchitecture } from '../data/seedArchitectures.js'

export const templates = [
  { key: 'blank', label: 'Blank canvas', build: () => ({ nodes: [], edges: [] }) },
  { key: 'starter', label: 'Simple 3-tier (User → API → Server → DB)', build: starterArchitecture },
  { key: 'strong', label: 'Resilient pipeline (LB + 2 servers + cache + auth)', build: strongArchitecture },
  { key: 'weak', label: 'Monolith (no LB, single server, tight DB)', build: weakArchitecture },
]

export async function listProjects() {
  const { data } = await api.get('/projects')
  return data.data.projects
}

export async function getProject(id) {
  const { data } = await api.get(`/projects/${id}`)
  return data.data.project
}

export async function createProject({ name, description, templateKey = 'starter', arch }) {
  const template = templates.find((t) => t.key === templateKey) || templates[1]
  const { data } = await api.post('/projects', {
    name: name?.trim() || 'Untitled Project',
    description: description?.trim() || '',
    arch: arch || template.build(),
  })
  return data.data.project
}

export async function updateProject({ id, patch }) {
  const body = {}
  if (patch.name !== undefined) body.name = patch.name
  if (patch.description !== undefined) body.description = patch.description
  if (patch.arch !== undefined) body.arch = patch.arch
  const { data } = await api.put(`/projects/${id}`, body)
  return data.data.project
}

export async function deleteProject({ id }) {
  try {
    await api.delete(`/projects/${id}`)
    return true
  } catch (err) {
    if (err.status === 404) return true
    throw err
  }
}
