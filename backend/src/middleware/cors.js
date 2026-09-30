import cors from 'cors'
import { env } from '../config/index.js'

function isOriginAllowed(origin) {
  if (!origin) return true
  if (env.corsOrigins.includes('*')) return true
  return env.corsOrigins.includes(origin)
}

export function corsOptionsDelegate(req, res, next) {
  const origin = req.headers.origin

  if (isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || env.clientUrl)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    res.setHeader(
      'Access-Control-Allow-Headers',
      req.headers['access-control-request-headers'] || 'Content-Type,Authorization',
    )
    res.setHeader('Access-Control-Max-Age', '600')
  }

  if (req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }

  next()
}

export { cors }
