import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const here = path.dirname(fileURLToPath(import.meta.url))
export const backendRoot = path.resolve(here, '..', '..')

dotenv.config({ path: path.join(backendRoot, '.env'), quiet: true })

function toPort(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : fallback
}

/**
 * Millisecond durations. Deliberately separate from toPort: a port can never exceed 65535,
 * but a timeout legitimately can. Routing GEMINI_TIMEOUT_MS through toPort meant any value
 * of 65536 ms or more was silently rejected and reset to the 20 s default, so raising the
 * advisor timeout above ~65 s appeared to have no effect at all.
 */
function toDuration(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 10 * 60 * 1000 ? parsed : fallback
}

function toList(value) {
  if (!value) return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function toDnsServers(value) {
  const list = toList(value)
  const valid = list.filter((server) => /^\d{1,3}(\.\d{1,3}){3}$/.test(server))
  return valid.length ? valid : null
}

const nodeEnv = process.env.NODE_ENV || 'development'
const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173'

const defaultDevOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]

export const env = Object.freeze({
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port: toPort(process.env.PORT, 5000),
  apiPrefix: process.env.API_PREFIX || '/api',
  clientUrl,
  corsOrigins: toList(process.env.CORS_ORIGINS).length
    ? toList(process.env.CORS_ORIGINS)
    : [...defaultDevOrigins, clientUrl],
  logRequests: process.env.LOG_REQUESTS !== 'false',
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017',
  dbName: process.env.DB_NAME || 'archai',
  mongoServerSelectionTimeoutMs: toPort(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS, 10000),
  dnsServers: toDnsServers(process.env.MONGO_DNS_SERVERS),
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  bcryptRounds: toPort(process.env.BCRYPT_ROUNDS, 10),
  // Read only from the backend environment. Anything prefixed VITE_ is compiled into
  // the public browser bundle, so the key must never live there.
  geminiApiKey: (process.env.GEMINI_API_KEY || '').trim(),
  geminiModel: (process.env.GEMINI_MODEL || 'gemini-3.6-flash').trim(),
  // A reasoning model can spend well over 20 s on a cold call, and the free tier answers
  // 503 under demand, so this budget has to cover retries as well as a single attempt.
  geminiTimeoutMs: toDuration(process.env.GEMINI_TIMEOUT_MS, 90000),
  // Transient 503/429 answers are retried with jittered exponential backoff.
  geminiMaxAttempts: toDuration(process.env.GEMINI_MAX_ATTEMPTS, 4),
  advisorWindowMs: toDuration(process.env.ADVISOR_WINDOW_MS, 60000),
  advisorMaxPerWindow: toDuration(process.env.ADVISOR_MAX_PER_WINDOW, 10),
})
