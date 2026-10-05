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

/**
 * Saves the report profile to the server.
 *
 * Only displayName and affiliation are ever sent. The login email is not part of this
 * contract, so the report profile cannot become a back door for changing the credential.
 */
export async function saveReportProfile({ displayName, affiliation }) {
  const { data } = await api.put('/auth/me/report-profile', {
    displayName: String(displayName ?? '').trim(),
    affiliation: String(affiliation ?? '').trim(),
  })
  return data.data.user
}

export function logout() {
  // Clearing the token is enough to end the session: projects were never cached locally,
  // and the reducer drops them on LOGOUT, so the next sign-in starts from its own data.
  tokenStore.clear()
}

export function isAuthenticated() {
  return Boolean(tokenStore.get())
}
