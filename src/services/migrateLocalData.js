import { createProject, listProjects } from './projects.js'
import { STORAGE_KEY } from '../store/reducer.js'

// Cleared on sign-out so a different account gets its own migration pass.
export const MIGRATED_KEY = 'archai.migrated.v1'

export function hasMigrated() {
  try {
    return localStorage.getItem(MIGRATED_KEY) === '1'
  } catch {
    return true
  }
}

function readLocalProjects() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed.projects) ? parsed.projects : []
  } catch {
    return []
  }
}

function clearLocalProjects() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    delete parsed.projects
    delete parsed.currentProjectId
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed))
  } catch {
    // storage unavailable; migration is best-effort and must never block sign-in
  }
}

export async function migrateLocalProjects() {
  if (hasMigrated()) return { migrated: 0, skipped: true }

  const locals = readLocalProjects()
  let migrated = 0

  for (const project of locals) {
    try {
      await createProject({
        name: project.name,
        description: project.description,
        arch: project.arch,
      })
      migrated += 1
    } catch (err) {
      // Stop on the first authentication failure. Continuing would fire one
      // guaranteed-401 POST per remaining project after the session is already dead.
      if (err.status === 401 || err.status === 403) return { migrated, skipped: false, unauthorized: true }
      // Any other failure is skipped so one bad project cannot block sign-in.
    }
  }

  if (migrated > 0) clearLocalProjects()
  // Only mark migration complete when it actually ran. Setting this flag after a
  // total failure would strand the local projects on disk with no way to retry them.
  if (locals.length === 0 || migrated > 0) {
    try {
      localStorage.setItem(MIGRATED_KEY, '1')
    } catch {
      // ignore
    }
  }

  return { migrated, skipped: false }
}

export async function fetchProjectsWithFallback() {
  const local = readLocalProjects()
  try {
    const projects = await listProjects()
    return { projects, source: 'server' }
  } catch (err) {
    // A 401 is an authentication outcome, not a connectivity problem. Falling back to
    // local projects here would mask the expiry and leave stale seed ids in place.
    if (err.status === 401 || err.status === 403) return { projects: null, source: 'unauthorized' }
    return { projects: local, source: 'local' }
  }
}