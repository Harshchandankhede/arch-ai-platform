import mongoose from 'mongoose'
import dns from 'node:dns'
import { env } from './index.js'
import { logger } from './logger.js'

const READY_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting']

let eventsRegistered = false

function applyDnsOverride() {
  if (!env.dnsServers) return
  dns.setServers(env.dnsServers)
  logger.warn(`Using custom DNS servers: ${env.dnsServers.join(', ')}`)
}

function registerConnectionEvents() {
  if (eventsRegistered) return
  eventsRegistered = true

  const { connection } = mongoose

  connection.on('connected', () => {
    logger.info(`MongoDB connected (database: ${connection.name || env.dbName})`)
  })

  connection.on('error', (error) => {
    logger.error(`MongoDB connection error: ${error.message}`)
  })

  connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected')
  })

  connection.on('reconnected', () => {
    logger.info('MongoDB reconnected')
  })
}

export async function connectDatabase() {
  if (mongoose.connection.readyState === 1) {
    logger.info('MongoDB already connected, skipping')
    return mongoose.connection
  }

  registerConnectionEvents()
  applyDnsOverride()

  try {
    await mongoose.connect(env.mongoUri, {
      dbName: env.dbName,
      serverSelectionTimeoutMS: env.mongoServerSelectionTimeoutMs,
    })
    return mongoose.connection
  } catch (error) {
    logger.error(`Failed to connect to MongoDB: ${error.message}`)
    throw error
  }
}

export async function disconnectDatabase() {
  if (mongoose.connection.readyState === 0) {
    return
  }
  await mongoose.disconnect()
  logger.info('MongoDB connection closed')
}

export function getDbState() {
  const readyState = mongoose.connection.readyState
  return {
    status: READY_STATES[readyState] || 'unknown',
    name: mongoose.connection.name || env.dbName,
  }
}

export default mongoose
