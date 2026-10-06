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
const USER_PREFIX = `${PREFIX}.u.`

// The pre-namespacing key. Anything still sitting under it may contain a stale project
// list, so it is purged once at startup rather than left readable by the next account.
export const LEGACY_STORAGE_KEY = PREFIX

/**
 * Fields that must never enter or leave browser storage.
 *
 * Projects and the selected project are owned data held in MongoDB and scoped there by the
 * JWT subject. Builds from before that change did persist them, including under the
 * per-user key, so an old browser can still hold a copy in a blob we still read for
 * preferences. Stripping these on read, on write and at startup means no project can enter
 * app state from the browser, however old the blob is.
 */
const FORBIDDEN_FIELDS = ['projects', 'currentProjectId']

function stripForbiddenFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const clean = { ...value }
  for (const field of FORBIDDEN_FIELDS) delete clean[field]
  return clean
}

function hasForbiddenFields(value) {
  return FORBIDDEN_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(value, field))
}

export function userStorageKey(userId) {
  const id = String(userId || '').trim()
  return id ? `${USER_PREFIX}${id}` : null
}

export function readUserState(userId) {
  const key = userStorageKey(userId)
  if (!key) return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    // Unparseable legacy content is treated as absent rather than thrown, so a corrupted
    // blob cannot stop the app from starting. Preferences in that blob are simply lost.
    return stripForbiddenFields(parsed)
  } catch {
    return null
  }
}

export function writeUserState(userId, value) {
  const key = userStorageKey(userId)
  if (!key) return false
  // Applied here as well as by the caller's persistable() so that no future caller can put a
  // project list in the browser by forgetting to filter it.
  const clean = stripForbiddenFields(value)
  if (!clean) return false
  try {
    localStorage.setItem(key, JSON.stringify(clean))
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

/**
 * Removes obsolete project data written by earlier builds while keeping the preferences
 * that legitimately live in the same blob.
 *
 * The whole per-user key is NOT deleted, because that would throw away the workload,
 * settings and interview preferences the user actually saved. Only the owned-data fields
 * are dropped.
 *
 * @returns {number} how many blobs were rewritten.
 */
export function stripLegacyProjectsFromUserBlobs() {
  let rewritten = 0
  try {
    // Collected first: removing or rewriting a key while iterating changes the indices.
    const keys = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key && key.startsWith(USER_PREFIX)) keys.push(key)
    }

    for (const key of keys) {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      let parsed
      try {
        parsed = JSON.parse(raw)
      } catch {
        // Malformed blob: leave it exactly as it is. It is unreadable either way, and
        // deleting a user's key on their behalf is worse than leaving junk behind.
        continue
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
      if (!hasForbiddenFields(parsed)) continue
      localStorage.setItem(key, JSON.stringify(stripForbiddenFields(parsed)))
      rewritten += 1
    }
  } catch {
    // storage unavailable; nothing to strip
  }
  return rewritten
}

/**
 * One-time startup cleanup of obsolete browser project data.
 *
 * The JWT lives under `archai.token`, a different key from this prefix, so the session is
 * never affected: signing in again after this runs still restores the same account.
 */
export function purgeLegacyState() {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    // storage unavailable; nothing to purge
  }
  stripLegacyProjectsFromUserBlobs()
}