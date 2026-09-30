import { seedProjects } from '../data/seedArchitectures.js'

export const STORAGE_KEY = 'archai.state.v1'

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
  name: 'Aditi Sharma',
  email: 'aditi.sharma@student.edu',
}

export const initialState = {
  auth: { user: null, demoMode: true },
  projects: [],
  currentProjectId: null,
  workload: defaultWorkload,
  simCache: {},
  interview: { history: [], log: [], index: 0 },
  settings: defaultSettings,
  toast: null,
}

export function initFromStorage() {
  if (typeof localStorage === 'undefined') return initialState
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...initialState, projects: seedProjects(), currentProjectId: 'p1' }
    const parsed = JSON.parse(raw)
    const projects = Array.isArray(parsed.projects) && parsed.projects.length ? parsed.projects : seedProjects()
    const currentProjectId =
      parsed.currentProjectId && projects.some((p) => p.id === parsed.currentProjectId)
        ? parsed.currentProjectId
        : projects[0].id
    return {
      ...initialState,
      auth: parsed.auth || initialState.auth,
      projects,
      currentProjectId,
      workload: { ...defaultWorkload, ...(parsed.workload || {}) },
      interview: { ...initialState.interview, ...(parsed.interview || {}) },
      settings: { ...defaultSettings, ...(parsed.settings || {}) },
    }
  } catch {
    return { ...initialState, projects: seedProjects(), currentProjectId: 'p1' }
  }
}

export function persistable(state) {
  return {
    auth: state.auth,
    projects: state.projects,
    currentProjectId: state.currentProjectId,
    workload: state.workload,
    interview: state.interview,
    settings: state.settings,
  }
}

let uid = 0
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
        },
      }
    }
    case 'LOGOUT':
      return { ...state, auth: { user: null, demoMode: true } }
    case 'SET_PROFILE':
      return { ...state, settings: { ...state.settings, ...action.settings } }
    case 'SET_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.settings } }

    case 'HYDRATE_PROJECTS': {
      const projects = action.projects || []
      if (!projects.length) return { ...state, simCache: {} }
      const currentProjectId = projects.some((p) => p.id === state.currentProjectId)
        ? state.currentProjectId
        : projects[0].id
      return { ...state, projects, currentProjectId, simCache: {} }
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

    default:
      return state
  }
}
