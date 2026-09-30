import { ApiError } from '../middleware/errorHandler.js'
import { assertArchitecture, emptyArchitecture } from '../models/architecture.schema.js'
import ArchitectureVersion from '../models/ArchitectureVersion.model.js'
import Project from '../models/Project.model.js'
import { toPublic as toPublicProject } from './project.service.js'

const MAX_LABEL_LENGTH = 80

function isValidId(id) {
  return /^[a-fA-F0-9]{24}$/.test(String(id || ''))
}

function toArch(arch) {
  if (!arch) return emptyArchitecture()
  if (typeof arch.toObject === 'function') return arch.toObject()
  return arch
}

function toPublicVersion(version) {
  return {
    id: version._id.toString(),
    projectId: version.project ? version.project.toString() : null,
    versionNumber: version.versionNumber,
    label: version.label || '',
    arch: toArch(version.arch),
    nodeCount: version.nodeCount ?? 0,
    edgeCount: version.edgeCount ?? 0,
    createdBy: version.createdBy ? version.createdBy.toString() : null,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
  }
}

function toSummary(version, currentVersion) {
  return {
    id: version._id.toString(),
    versionNumber: version.versionNumber,
    label: version.label || '',
    nodeCount: version.nodeCount ?? 0,
    edgeCount: version.edgeCount ?? 0,
    createdAt: version.createdAt,
    isCurrent: version.versionNumber === currentVersion,
  }
}

function assertLabel(label) {
  const trimmed = String(label ?? '').trim()
  if (trimmed.length > MAX_LABEL_LENGTH) {
    throw new ApiError(400, 'Label must be at most 80 characters.')
  }
  return trimmed
}

async function requireOwnedProject(projectId, ownerId) {
  if (!isValidId(projectId)) throw new ApiError(404, 'Project not found.')
  const project = await Project.findOne({ _id: projectId, owner: ownerId })
  if (!project) throw new ApiError(404, 'Project not found.')
  return project
}

async function requireOwnedVersion(project, versionId) {
  if (!isValidId(versionId)) throw new ApiError(404, 'Version not found.')
  const version = await ArchitectureVersion.findOne({ _id: versionId, project: project._id })
  if (!version) throw new ApiError(404, 'Version not found.')
  return version
}

async function highestVersionNumber(projectId) {
  const latest = await ArchitectureVersion.find({ project: projectId }).sort({ versionNumber: -1 })
  if (!latest.length) return 0
  return latest[0].versionNumber
}

export async function listVersions(projectId, ownerId) {
  const project = await requireOwnedProject(projectId, ownerId)
  const versions = await ArchitectureVersion.find({ project: project._id }).sort({ versionNumber: -1 })
  const currentVersion = project.currentVersion ?? 0
  return versions.map((version) => toSummary(version, currentVersion))
}

export async function getVersion(projectId, versionId, ownerId) {
  const project = await requireOwnedProject(projectId, ownerId)
  const version = await requireOwnedVersion(project, versionId)
  return toPublicVersion(version)
}

export async function createVersion(projectId, ownerId, { label, arch } = {}) {
  const project = await requireOwnedProject(projectId, ownerId)
  const safeLabel = assertLabel(label)
  const validated = arch ? assertArchitecture(arch, ApiError) : emptyArchitecture()

  const versionNumber = (await highestVersionNumber(project._id)) + 1

  let created
  try {
    created = await ArchitectureVersion.create({
      project: project._id,
      versionNumber,
      label: safeLabel,
      arch: validated,
      nodeCount: validated.nodes.length,
      edgeCount: validated.edges.length,
      createdBy: ownerId,
    })
  } catch (error) {
    if (error.statusCode) throw error
    if (error.code === 11000) {
      throw new ApiError(409, 'A version with that number already exists. Please retry.')
    }
    if (error.name === 'ValidationError') throw new ApiError(400, error.message)
    throw error
  }

  await Project.updateOne({ _id: project._id }, { $set: { currentVersion: versionNumber } })

  return toPublicVersion(created)
}

export async function updateVersionLabel(projectId, versionId, ownerId, label) {
  const project = await requireOwnedProject(projectId, ownerId)
  const version = await requireOwnedVersion(project, versionId)
  version.label = assertLabel(label)
  await version.save()
  return toPublicVersion(version)
}

export async function deleteVersion(projectId, versionId, ownerId) {
  const project = await requireOwnedProject(projectId, ownerId)
  const version = await requireOwnedVersion(project, versionId)

  const existing = await ArchitectureVersion.find({ project: project._id })
  if (existing.length <= 1) {
    throw new ApiError(400, 'A project must keep at least one version.')
  }

  const deleted = await ArchitectureVersion.findOneAndDelete({
    _id: version._id,
    project: project._id,
  })
  if (!deleted) throw new ApiError(404, 'Version not found.')

  if (project.currentVersion === version.versionNumber) {
    const nextCurrent = await highestVersionNumber(project._id)
    await Project.updateOne({ _id: project._id }, { $set: { currentVersion: nextCurrent } })
  }

  return {
    id: deleted._id.toString(),
    versionNumber: deleted.versionNumber,
    label: deleted.label || '',
  }
}

export async function restoreVersion(projectId, versionId, ownerId) {
  const project = await requireOwnedProject(projectId, ownerId)
  const version = await requireOwnedVersion(project, versionId)

  const arch = toArch(version.arch)
  project.arch = { nodes: arch.nodes, edges: arch.edges }
  project.currentVersion = version.versionNumber
  await project.save()

  return {
    project: toPublicProject(project.toObject()),
    version: toPublicVersion(version),
  }
}

export { toPublicVersion, toSummary }
