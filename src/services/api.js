import axios from 'axios'

const TOKEN_KEY = 'archai.token'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api'

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 20000,
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
      tokenStore.clear()
    }
    const message =
      error.response?.data?.error?.message ||
      (error.code === 'ECONNABORTED' ? 'Request timed out. Is the backend running?' : null) ||
      (error.request && !error.response
        ? 'Cannot reach the backend. Make sure it is running on port 5000.'
        : null) ||
      error.message
    const wrapped = new Error(message)
    wrapped.status = error.response?.status
    wrapped.details = error.response?.data?.error?.details
    return Promise.reject(wrapped)
  },
)

export default api
