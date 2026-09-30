import api, { tokenStore } from './api.js'

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
}

export function isAuthenticated() {
  return Boolean(tokenStore.get())
}
