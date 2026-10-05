import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { env } from '../config/index.js'
import { ApiError } from '../middleware/errorHandler.js'
import User from '../models/User.model.js'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normaliseEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function toPublicUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    // Report profile, defaulted from the login identity so a report is never attributed
    // to a blank author just because the profile has not been filled in yet.
    reportProfile: {
      displayName: user.displayName || user.name || '',
      affiliation: user.affiliation || '',
    },
  }
}

export function validateRegistration({ name, email, password }) {
  const errors = {}

  if (!name || !String(name).trim()) errors.name = 'Full name is required.'
  else if (String(name).trim().length < 2) errors.name = 'Full name must be at least 2 characters.'

  if (!email) errors.email = 'Email is required.'
  else if (!EMAIL_PATTERN.test(String(email).trim())) errors.email = 'Please provide a valid email address.'

  if (!password) errors.password = 'Password is required.'
  else if (String(password).length < 6) errors.password = 'Password must be at least 6 characters.'

  return { valid: Object.keys(errors).length === 0, errors }
}

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  })
}

export async function register({ name, email, password, role }) {
  const { valid, errors } = validateRegistration({ name, email, password })
  if (!valid) throw new ApiError(400, 'Validation failed', errors)

  if (!env.jwtSecret) throw new ApiError(500, 'Server is missing JWT_SECRET configuration')

  const normalised = normaliseEmail(email)
  const existing = await User.findOne({ email: normalised })
  if (existing) throw new ApiError(409, 'An account with that email already exists.')

  const passwordHash = await bcrypt.hash(String(password), env.bcryptRounds)

  let user
  try {
    user = await User.create({
      name: String(name).trim(),
      email: normalised,
      passwordHash,
      role: role && ['student', 'faculty', 'admin'].includes(role) ? role : 'student',
    })
  } catch (error) {
    if (error.code === 11000) throw new ApiError(409, 'An account with that email already exists.')
    throw error
  }

  return { user: toPublicUser(user), token: signToken(user) }
}

export async function login({ email, password }) {
  if (!email || !password) throw new ApiError(400, 'Email and password are required.')

  const user = await User.findOne({ email: normaliseEmail(email) }).select('+passwordHash')
  if (!user || !user.passwordHash) {
    throw new ApiError(401, 'Invalid email or password.')
  }

  const matches = await bcrypt.compare(String(password), user.passwordHash)
  if (!matches) throw new ApiError(401, 'Invalid email or password.')

  return { user: toPublicUser(user), token: signToken(user) }
}

export async function getUserById(id) {
  const user = await User.findById(id)
  if (!user) throw new ApiError(404, 'User not found.')
  return toPublicUser(user)
}

/**
 * Validates the editable report profile.
 *
 * The login identity is intentionally absent from this payload. There is no branch here
 * that can touch `email`, `name` or `role`, so a Settings save cannot change how the
 * account signs in or which account it belongs to.
 */
export function validateReportProfile({ displayName, affiliation }) {
  const errors = {}

  const name = String(displayName ?? '').trim()
  if (!name) errors.displayName = 'Display name is required.'
  else if (name.length < 2) errors.displayName = 'Display name must be at least 2 characters.'
  else if (name.length > 80) errors.displayName = 'Display name must be at most 80 characters.'

  const org = String(affiliation ?? '').trim()
  if (org.length > 120) errors.affiliation = 'Affiliation must be at most 120 characters.'

  return { valid: Object.keys(errors).length === 0, errors }
}

export async function updateReportProfile(id, { displayName, affiliation }) {
  const { valid, errors } = validateReportProfile({ displayName, affiliation })
  if (!valid) throw new ApiError(400, 'Validation failed', errors)

  // Whitelisted update: only the two report fields are named here, so any extra key a
  // client sends is discarded rather than written.
  const user = await User.findByIdAndUpdate(
    id,
    { $set: { displayName: String(displayName).trim(), affiliation: String(affiliation ?? '').trim() } },
    { new: true, runValidators: true },
  )
  if (!user) throw new ApiError(404, 'User not found.')

  return toPublicUser(user)
}
