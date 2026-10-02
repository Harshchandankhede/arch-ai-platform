import api, { tokenStore } from './api.js'
import { MIGRATED_KEY } from './migrateLocalData.js'

export async function login({ email, password }) {
  const { data } = await api.post('/auth/login', { email, password })
  tokenStore.set(data.data.token)
  return data.data.user
}

export async function register({ name, email, password }) {
  const { data } = await api.post('/auth/register', { name, email, password })
  tokenStore.set(data.data.token)
  return data.data.user
}

export async function fetchCurrentUser() {
  const { data } = await api.get('/auth/me')
  return data.data.user
}

export function logout() {
  tokenStore.clear()
  // The migration flag is per-browser but the projects it guards are per-account.
  // Leaving it set would stop the next account from ever migrating its local work.
  try {
    localStorage.removeItem(MIGRATED_KEY)
  } catch {
    // storage unavailable; sign-out must still succeed
  }
}

export function isAuthenticated() {
  return Boolean(tokenStore.get())
}
