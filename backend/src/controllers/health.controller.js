import { getDbState } from '../config/database.js'

const startedAt = Date.now()

export function getHealth(req, res) {
  const database = getDbState()
  const isHealthy = database.status === 'connected'

  res.status(isHealthy ? 200 : 503).json({
    success: isHealthy,
    status: isHealthy ? 'OK' : 'DEGRADED',
    message: isHealthy ? 'Arch-AI backend is running' : 'Arch-AI backend is running without a database',
    service: 'arch-ai-backend',
    environment: process.env.NODE_ENV || 'development',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    database: {
      status: database.status,
      name: database.name,
    },
  })
}
