import { getUserById, login, register } from '../services/auth.service.js'

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
