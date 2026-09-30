import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from '../services/project.service.js'

export async function listProjectsHandler(req, res) {
  const projects = await listProjects(req.user.id)
  res.status(200).json({ success: true, data: { projects } })
}

export async function getProjectHandler(req, res) {
  const project = await getProject(req.params.id, req.user.id)
  res.status(200).json({ success: true, data: { project } })
}

export async function createProjectHandler(req, res) {
  const { name, description, arch } = req.body || {}
  const project = await createProject({ ownerId: req.user.id, name, description, arch })
  res.status(201).json({ success: true, data: { project } })
}

export async function updateProjectHandler(req, res) {
  const project = await updateProject(req.params.id, req.user.id, req.body || {})
  res.status(200).json({ success: true, data: { project } })
}

export async function deleteProjectHandler(req, res) {
  const result = await deleteProject(req.params.id, req.user.id)
  res.status(200).json({ success: true, data: result })
}