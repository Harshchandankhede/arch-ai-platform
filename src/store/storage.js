// Browser storage, namespaced per user id.
//
// Projects are deliberately NOT kept here. They are owned data and the API scopes every
// project query by the JWT subject, so the server is the only place they belong. A single
// shared `archai.state.v1` blob holding a project list is what let a second account on the
// same browser render the first account's projects: LOGOUT reset `auth` but left
// `projects` in memory and on disk, and the Dashboard rendered `currentProject` before
// hydration replaced it.
//
// What remains in storage is per-account preference only (workload, settings, interview),
// which is namespaced by user id so one account's profile cannot surface under another.

const PREFIX = 'archai.state.v1'

// The pre-namespacing key. Anything still sitting under it may contain a stale project
// list, so it is purged once at startup rather than left readable by the next account.
export const LEGACY_STORAGE_KEY = PREFIX

export function userStorageKey(userId) {
  const id = String(userId || '').trim()
  return id ? `${PREFIX}.u.${id}` : null
}

export function readUserState(userId) {
  const key = userStorageKey(userId)
  if (!key) return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export function writeUserState(userId, value) {
  const key = userStorageKey(userId)
  if (!key) return false
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    // storage full or unavailable; the app still works from server state
    return false
  }
}

export function clearUserState(userId) {
  const key = userStorageKey(userId)
  if (!key) return
  try {
    localStorage.removeItem(key)
  } catch {
    // storage unavailable; sign-out must still succeed
  }
}

export function purgeLegacyState() {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    // storage unavailable; nothing to purge
  }
}