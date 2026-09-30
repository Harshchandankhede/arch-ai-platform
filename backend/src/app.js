import express from 'express'
import { env } from './config/index.js'
import { corsOptionsDelegate } from './middleware/cors.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'
import routes from './routes/index.js'

const app = express()

app.disable('x-powered-by')
app.set('trust proxy', 1)

app.use(corsOptionsDelegate)
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true, limit: '2mb' }))

app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint()
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6
    console.log(
      `[${new Date().toISOString()}] [HTTP] ${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs.toFixed(1)}ms`,
    )
  })
  next()
})

app.use(env.apiPrefix, routes)

app.use(notFoundHandler)
app.use(errorHandler)

export default app
