import { createProject, listProjects } from './projects.js'
import { STORAGE_KEY } from '../store/reducer.js'

const MIGRATED_KEY = 'archai.migrated.v1'

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
    } catch {
      // skip anything the API rejects; never block sign-in
    }
  }

  if (migrated > 0) clearLocalProjects()
  try {
    localStorage.setItem(MIGRATED_KEY, '1')
  } catch {
    // ignore
  }

  return { migrated, skipped: false }
}

export async function fetchProjectsWithFallback() {
  const local = readLocalProjects()
  try {
    const projects = await listProjects()
    return { projects, source: 'server' }
  } catch {
    return { projects: local, source: 'local' }
  }
}