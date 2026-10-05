import { listProjects } from './projects.js'

// Local-project migration used to live here. It POSTed whatever sat in the shared
// `archai.state.v1` blob into whichever account happened to sign in first, and then fell
// back to that same blob on any network error — which is how one account's projects could
// be handed to the next. Projects are server-owned now and every query is scoped by the
// JWT subject, so there is nothing local left to migrate and no local copy to fall back to.

export async function fetchProjectsWithFallback() {
  try {
    const projects = await listProjects()
    return { projects, source: 'server' }
  } catch (err) {
    // A 401 is an authentication outcome, not a connectivity problem, and must stay
    // distinguishable so the caller ends the session instead of retrying.
    if (err.status === 401 || err.status === 403) return { projects: null, source: 'unauthorized' }
    // Any other failure (backend down, timeout, 500) returns no projects. Substituting a
    // locally cached list here would show the signed-in user projects that may belong to a
    // different account, so the caller shows an error and retries instead.
    return { projects: null, source: 'error', error: err }
  }
}