import { listProjects } from './projects.js'

/**
 * Loads the signed-in account's projects from the backend.
 *
 * The file this replaced was called migrateLocalData.js and its function
 * fetchProjectsWithFallback. Neither name described what the code does: there has been no
 * browser-project migration since projects became server-owned, and there is no fallback to
 * anything local, because substituting a locally held list would hand the signed-in user
 * whatever a previous account left behind. The behaviour is kept exactly as it was; only
 * the naming is corrected.
 *
 * MongoDB is the only source of truth for projects. A failure here is reported as a
 * failure and never quietly replaced with cached data.
 */
export async function fetchServerProjects() {
  try {
    const projects = await listProjects()
    return { projects, source: 'server' }
  } catch (err) {
    // A 401 is an authentication outcome, not a connectivity problem, and must stay
    // distinguishable so the caller ends the session instead of retrying.
    if (err.status === 401 || err.status === 403) return { projects: null, source: 'unauthorized' }
    // Any other failure (backend down, timeout, 500) returns no projects. Reading a locally
    // cached list here would show the signed-in user projects that may belong to a
    // different account, so the caller shows an error and retries instead.
    return { projects: null, source: 'error', error: err }
  }
}