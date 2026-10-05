import { readUserState } from './storage.js'

export const workloadPresets = [
  { label: '100 concurrent users', concurrentUsers: 100 },
  { label: '1,000 concurrent users', concurrentUsers: 1000 },
  { label: '10,000 concurrent users', concurrentUsers: 10000 },
]

export const defaultWorkload = {
  mode: 'rate',
  arrivalRate: 120,
  duration: 60,
  concurrentUsers: 1000,
  seed: 20260927,
}

export const defaultSettings = {
  alertThreshold: 60,
  name: '',
  email: '',
}

export const initialState = {
  // `checked` records that the stored token has already been verified. Auth itself is not
  // persisted, so after a reload `user` is null while a perfectly valid token is still in
  // localStorage. Without this flag the route guard had no way to tell "not signed in" from
  // "not looked yet", so it treated every reload as signed out and redirected to /login.
  auth: { user: null, demoMode: true, checked: false },
  // Projects are server-owned and arrive per signed-in user via HYDRATE_PROJECTS.
  // They start empty on every boot: seeding demo projects here handed every new account
  // a shared project list that looked like their own work.
  projects: [],
  // The user id that `projects` was loaded for. The UI refuses to render project data
  // unless this matches the signed-in user, so a late response from a previous session
  // cannot paint over the current account.
  projectsOwnerId: null,
  currentProjectId: null,
  hydrated: false,
  workload: defaultWorkload,
  simCache: {},
  interview: { history: [], log: [], index: 0 },
  settings: defaultSettings,
  // In-memory only, and deliberately not persisted: a notification about a run that
  // finished yesterday is noise, not information.
  notifications: [],
  toast: null,
}

export function initFromStorage() {
  // No storage read at boot. Which account's preferences to restore is unknown until the
  // token has been verified, so preferences are applied by LOAD_PREFS once /auth/me
  // returns. Projects are never restored from storage under any circumstances.
  return initialState
}

export function loadPrefsFor(userId) {
  const stored = readUserState(userId)
  if (!stored) return null
  return {
    workload: { ...defaultWorkload, ...(stored.workload || {}) },
    interview: { ...initialState.interview, ...(stored.interview || {}) },
    settings: { ...defaultSettings, ...(stored.settings || {}) },
  }
}

export function persistable(state) {
  // Projects and currentProjectId are intentionally absent: they are owned data and are
  // re-read from the API for the signed-in user on every load. `auth` is not persisted
  // either — the JWT in `archai.token` is the only session source of truth, so a reload
  // restores the session via /auth/me instead of a cached user object.
  return {
    workload: state.workload,
    interview: state.interview,
    settings: state.settings,
  }
}

let uid = 0

// Notifications are session-scoped, so a bounded cap is enough to stop an unbounded list.
const NOTIFICATION_LIMIT = 40

export function makeId(prefix) {
  uid += 1
  return `${prefix}-${Date.now().toString(36)}-${uid}`
}

export function reducer(state, action) {
  switch (action.type) {
    case 'LOGIN': {
      const name = action.name?.trim() || 'Student'
      return {
        ...state,
        auth: {
          user: {
            name,
            email: action.email?.trim() || 'demo@student.edu',
            id: action.id || null,
            initials: name
              .split(/\s+/)
              .map((w) => w[0])
              .join('')
              .slice(0, 2)
              .toUpperCase(),
            role: action.role || 'student',
          },
          demoMode: false,
          checked: true,
        },
      }
    }
    case 'AUTH_CHECKED':
      // The stored token was looked at and found absent or already verified. Only ever
      // clears the flag: a concurrent LOGIN must not be undone by a late AUTH_CHECKED.
      if (state.auth.checked) return state
      return { ...state, auth: { ...state.auth, checked: true } }
    case 'LOGOUT':
      // Drop every trace of the previous account. Leaving `projects` in place is what
      // let the next sign-in on this browser render the previous user's projects before
      // hydration finished.
      return {
        ...state,
        auth: { user: null, demoMode: true, checked: true },
        projects: [],
        projectsOwnerId: null,
        currentProjectId: null,
        hydrated: false,
        simCache: {},
        interview: { history: [], log: [], index: 0 },
        settings: defaultSettings,
        notifications: [],
        toast: null,
      }
    case 'LOAD_PREFS': {
      const prefs = action.prefs
      if (!prefs) return state
      return {
        ...state,
        workload: { ...state.workload, ...(prefs.workload || {}) },
        interview: { ...state.interview, ...(prefs.interview || {}) },
        settings: { ...state.settings, ...(prefs.settings || {}) },
      }
    }
    case 'SET_PROFILE':
      return { ...state, settings: { ...state.settings, ...action.settings } }
    case 'SET_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.settings } }

    case 'HYDRATE_PROJECTS': {
      const projects = action.projects || []
      const ownerId = action.ownerId || null
      const currentProjectId = projects.some((p) => p.id === state.currentProjectId)
        ? state.currentProjectId
        : (projects[0]?.id ?? null)
      // An empty list is a valid answer: a brand-new account legitimately owns nothing.
      return { ...state, projects, projectsOwnerId: ownerId, currentProjectId, simCache: {}, hydrated: true }
    }

    case 'CREATE_PROJECT': {
      const project = action.project
      return { ...state, projects: [project, ...state.projects], currentProjectId: project.id }
    }
    case 'UPDATE_PROJECT':
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.id ? { ...p, ...action.patch, updatedAt: Date.now() } : p,
        ),
      }
    case 'DELETE_PROJECT': {
      const projects = state.projects.filter((p) => p.id !== action.id)
      const currentProjectId =
        state.currentProjectId === action.id ? (projects[0]?.id ?? null) : state.currentProjectId
      return { ...state, projects, currentProjectId }
    }
    case 'SET_CURRENT_PROJECT':
      return { ...state, currentProjectId: action.id }
    case 'SET_ARCH': {
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.projectId ? { ...p, arch: action.arch, updatedAt: Date.now() } : p,
        ),
        simCache: {},
      }
    }

    case 'SET_WORKLOAD':
      return { ...state, workload: { ...state.workload, ...action.workload } }
    case 'CACHE_RESULT':
      return { ...state, simCache: { ...state.simCache, [action.key]: action.value } }
    case 'CLEAR_CACHE':
      return { ...state, simCache: {} }

    case 'SET_INTERVIEW':
      return { ...state, interview: { ...state.interview, ...action.interview } }
    case 'RESET_INTERVIEW':
      return { ...state, interview: { history: [], log: [], index: 0 } }

    case 'TOAST':
      return { ...state, toast: action.toast }
    case 'DISMISS_TOAST':
      return { ...state, toast: null }

    case 'PUSH_NOTIFICATION': {
      const item = action.notification
      if (!item?.title) return state
      // Newest first, and capped: an unbounded list would grow for the life of the tab.
      const next = [{ ...item, id: item.id || `n${Date.now()}${++uid}`, read: false, at: Date.now() }, ...state.notifications]
      return { ...state, notifications: next.slice(0, NOTIFICATION_LIMIT) }
    }
    case 'MARK_NOTIFICATION_READ':
      return {
        ...state,
        notifications: state.notifications.map((n) => (n.id === action.id ? { ...n, read: true } : n)),
      }
    case 'MARK_ALL_NOTIFICATIONS_READ':
      return { ...state, notifications: state.notifications.map((n) => ({ ...n, read: true })) }
    case 'CLEAR_NOTIFICATIONS':
      return { ...state, notifications: [] }

    default:
      return state
  }
}
