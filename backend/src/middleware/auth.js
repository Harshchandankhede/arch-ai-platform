import jwt from 'jsonwebtoken'
import { env } from '../config/index.js'
import { ApiError } from './errorHandler.js'

function readToken(req) {
  const header = req.headers.authorization || ''
  if (header.startsWith('Bearer ')) return header.slice(7).trim()
  return null
}

export function requireAuth(req, res, next) {
  const token = readToken(req)
  if (!token) {
    next(new ApiError(401, 'Authentication required. Provide a Bearer token.'))
    return
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret)
    req.user = { id: payload.sub, role: payload.role }
    next()
  } catch (error) {
    const message =
      error.name === 'TokenExpiredError' ? 'Session expired. Please sign in again.' : 'Invalid token.'
    next(new ApiError(401, message))
  }
}

export function optionalAuth(req, res, next) {
  const token = readToken(req)
  if (!token) {
    next()
    return
  }
  try {
    const payload = jwt.verify(token, env.jwtSecret)
    req.user = { id: payload.sub, role: payload.role }
  } catch {
    req.user = undefined
  }
  next()
}
