import {
  createVersion,
  deleteVersion,
  getVersion,
  listVersions,
  restoreVersion,
  updateVersionLabel,
} from '../services/architecture.service.js'

export async function listVersionsHandler(req, res) {
  const versions = await listVersions(req.params.projectId, req.user.id)
  res.status(200).json({ success: true, data: { versions } })
}

export async function getVersionHandler(req, res) {
  const version = await getVersion(req.params.projectId, req.params.versionId, req.user.id)
  res.status(200).json({ success: true, data: { version } })
}

export async function createVersionHandler(req, res) {
  const { label, arch } = req.body || {}
  const version = await createVersion(req.params.projectId, req.user.id, { label, arch })
  res.status(201).json({ success: true, data: { version } })
}

export async function updateVersionLabelHandler(req, res) {
  const { label } = req.body || {}
  const version = await updateVersionLabel(
    req.params.projectId,
    req.params.versionId,
    req.user.id,
    label,
  )
  res.status(200).json({ success: true, data: { version } })
}

export async function restoreVersionHandler(req, res) {
  const result = await restoreVersion(req.params.projectId, req.params.versionId, req.user.id)
  res.status(200).json({ success: true, data: result })
}

export async function deleteVersionHandler(req, res) {
  const result = await deleteVersion(req.params.projectId, req.params.versionId, req.user.id)
  res.status(200).json({ success: true, data: result })
}