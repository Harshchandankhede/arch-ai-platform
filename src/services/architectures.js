import api from './api.js'

export async function listVersions(projectId) {
  const { data } = await api.get(`/projects/${projectId}/versions`)
  return data.data.versions
}

export async function getVersion(projectId, versionId) {
  const { data } = await api.get(`/projects/${projectId}/versions/${versionId}`)
  return data.data.version
}

export async function createVersion(projectId, { label, arch }) {
  const finalLabel = (label === undefined || label === null ? 'Snapshot' : label).trim()
  const { data } = await api.post(`/projects/${projectId}/versions`, {
    label: finalLabel,
    arch,
  })
  return data.data.version
}

export async function renameVersion(projectId, versionId, label) {
  const { data } = await api.put(`/projects/${projectId}/versions/${versionId}/label`, {
    label: label.trim(),
  })
  return data.data.version
}

export async function restoreVersion(projectId, versionId) {
  const { data } = await api.post(`/projects/${projectId}/versions/${versionId}/restore`)
  return { project: data.data.project, version: data.data.version }
}

export async function deleteVersion(projectId, versionId) {
  try {
    await api.delete(`/projects/${projectId}/versions/${versionId}`)
    return true
  } catch (err) {
    if (err.status === 404) return true
    throw err
  }
}
