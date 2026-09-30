export class ApiError extends Error {
  constructor(statusCode, message, details) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.details = details
    this.isOperational = true
    Error.captureStackTrace(this, ApiError)
  }
}

export function notFoundHandler(req, res, next) {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`))
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    next(err)
    return
  }

  const statusCode = err.statusCode || err.status || 500
  const isServerError = statusCode >= 500

  if (isServerError) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, err)
  }

  const body = {
    success: false,
    error: {
      message: isServerError && !err.isOperational ? 'Internal server error' : err.message,
      statusCode,
    },
  }

  if (err.details) body.error.details = err.details

  res.status(statusCode).json(body)
}
