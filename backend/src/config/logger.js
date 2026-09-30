import { env } from './index.js'

function timestamp() {
  return new Date().toISOString()
}

function emit(stream, level, message, meta) {
  const prefix = `[${timestamp()}] [${level.toUpperCase()}]`
  const suffix = meta === undefined ? '' : ` ${typeof meta === 'string' ? meta : JSON.stringify(meta)}`
  stream(`${prefix} ${message}${suffix}`)
}

export const logger = {
  info(message, meta) {
    emit(console.log, 'info', message, meta)
  },
  warn(message, meta) {
    emit(console.warn, 'warn', message, meta)
  },
  error(message, meta) {
    emit(console.error, 'error', message, meta)
  },
  request(req, statusCode, durationMs) {
    if (!env.logRequests) return
    emit(console.log, 'http', `${req.method} ${req.originalUrl} ${statusCode} ${durationMs}ms`)
  },
  startup(details) {
    emit(console.log, 'info', `Arch-AI backend listening on ${details.url}`)
  },
}
