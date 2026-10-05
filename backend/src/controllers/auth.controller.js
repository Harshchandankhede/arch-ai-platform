import { getUserById, login, register, updateReportProfile } from '../services/auth.service.js'

export async function registerUser(req, res) {
  const { name, email, password, role } = req.body || {}
  const result = await register({ name, email, password, role })
  res.status(201).json({ success: true, data: result })
}

export async function loginUser(req, res) {
  const { email, password } = req.body || {}
  const result = await login({ email, password })
  res.status(200).json({ success: true, data: result })
}

export async function getCurrentUser(req, res) {
  const user = await getUserById(req.user.id)
  res.status(200).json({ success: true, data: { user } })
}

/**
 * Updates the report profile only.
 *
 * `req.user.id` comes from the verified JWT, not from the request body, so one account
 * can never write a profile onto another.
 */
export async function updateMyReportProfile(req, res) {
  const { displayName, affiliation } = req.body || {}
  const user = await updateReportProfile(req.user.id, { displayName, affiliation })
  res.status(200).json({ success: true, data: { user } })
}
