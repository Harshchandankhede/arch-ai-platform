import axios from 'axios'

const TOKEN_KEY = 'archai.token'

// Relative by default, resolved by the browser against the page origin.
//
// It used to fall back to an absolute http://localhost:5000/api, and that literal was
// compiled into the production bundle: a deployed build then asked the visitor's own
// machine for the API instead of the server hosting the page. Going through a same-origin
// /api also means development no longer depends on the backend's CORS allowlist — Vite
// proxies it in dev and in preview.
// VITE_API_BASE_URL is only needed when the API genuinely lives on another origin.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

// A 401 must invalidate the whole session exactly once, not just the token. The
// reducer keeps its own copy of the signed-in user, so clearing only localStorage
// left the app rendering protected routes while every request went out unsigned.
// Listeners are notified once per 401 burst; AppContext subscribes and dispatches
// LOGOUT, which drops the user and sends them back to /login.
const sessionListeners = new Set()

export function onSessionInvalidated(listener) {
  sessionListeners.add(listener)
  return () => sessionListeners.delete(listener)
}

function invalidateSession() {
  tokenStore.clear()
  for (const listener of [...sessionListeners]) {
    try {
      listener()
    } catch {
      // a failing listener must not block the rest of the rejection path
    }
  }
}

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  // Generous, because the slowest endpoint here is not ours: the Gemini advisor proxies a
  // language-model call that legitimately takes 10-60s under load. At the old 20s the
  // browser gave up first and reported "Request timed out. Is the backend running?" — which
  // blamed the backend for a request the backend was still servicing.
  timeout: Number(import.meta.env.VITE_API_TIMEOUT_MS) || 120000,
})

api.interceptors.request.use((config) => {
  const token = tokenStore.get()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Never retry an unauthorised request. Clearing the token without clearing the
      // redux session is what produced the repeated 401s in the request log.
      invalidateSession()
    }
    const message =
      error.response?.data?.error?.message ||
      (error.code === 'ECONNABORTED'
        ? 'The server took too long to answer. The Gemini advisor can take a minute under load — try again.'
        : null) ||
      (error.request && !error.response
        ? 'Cannot reach the backend. Make sure it is running on port 5000.'
        : null) ||
      error.message
    const wrapped = new Error(message)
    wrapped.status = error.response?.status
    wrapped.details = error.response?.data?.error?.details
    // Callers read the server message from err.message, which is already set above.
    // error.config is deliberately NOT copied across: it carries the Authorization
    // header, and attaching it to every caught error would leak the JWT into any
    // future logging or error reporting.
    return Promise.reject(wrapped)
  },
)

export default api
