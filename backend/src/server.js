import app from './app.js'
import { env } from './config/index.js'
import { logger } from './config/logger.js'
import { connectDatabase, disconnectDatabase } from './config/database.js'

let server = null
let shuttingDown = false

async function start() {
  try {
    await connectDatabase()
  } catch (error) {
    logger.error('Cannot start Arch-AI backend: MongoDB connection failed')
    logger.error(error.message)
    process.exit(1)
  }

  server = app.listen(env.port, () => {
    logger.startup({ url: `http://localhost:${env.port}${env.apiPrefix}` })
    logger.info(`Environment: ${env.nodeEnv}`)
    logger.info(`Database: ${env.dbName}`)
    logger.info(`CORS origins: ${env.corsOrigins.join(', ')}`)
  })

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      logger.error(`Port ${env.port} is already in use. Set a different PORT in backend/.env`)
    } else {
      logger.error('Server failed to start', error.message)
    }
    process.exit(1)
  })
}

function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true

  logger.info(`${signal} received, shutting down gracefully`)

  const forceExit = setTimeout(() => {
    logger.warn('Forcing shutdown after timeout')
    process.exit(1)
  }, 10000)
  forceExit.unref()

  const closeServer = () => {
    if (server) {
      server.close(() => logger.info('HTTP server closed'))
      server.closeIdleConnections?.()
    }
  }

  closeServer()

  disconnectDatabase()
    .catch((error) => logger.error('Error while closing MongoDB connection', error.message))
    .finally(() => {
      clearTimeout(forceExit)
      process.exit(0)
    })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', reason)
})

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error.message)
  process.exit(1)
})

start()
