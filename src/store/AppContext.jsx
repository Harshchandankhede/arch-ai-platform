import { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react'
import { initFromStorage, persistable, reducer, STORAGE_KEY } from './reducer.js'
import { fetchProjectsWithFallback, migrateLocalProjects } from '../services/migrateLocalData.js'
import { isAuthenticated } from '../services/auth.js'

const AppStateContext = createContext(null)
const AppDispatchContext = createContext(null)

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, initFromStorage)
  const timer = useRef(null)
  const hydrated = useRef(false)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable(state)))
    } catch {
      // storage full or unavailable; app still works in-memory
    }
  }, [state])

  useEffect(() => {
    if (hydrated.current) return
    if (!isAuthenticated()) return
    hydrated.current = true

    let cancelled = false

    ;(async () => {
      try {
        await migrateLocalProjects()
      } catch {
        // migration is best-effort
      }
      if (cancelled) return
      const { projects } = await fetchProjectsWithFallback()
      if (cancelled) return
      dispatch({ type: 'HYDRATE_PROJECTS', projects })
    })()

    return () => {
      cancelled = true
    }
  }, [state.auth.user])

  useEffect(() => () => clearTimeout(timer.current), [])

  const value = useMemo(
    () => ({
      ...state,
      user: state.auth.user,
      isAuthed: Boolean(state.auth.user),
      demoMode: state.auth.demoMode,
      currentProject: state.projects.find((p) => p.id === state.currentProjectId) || null,
      projectById: (id) => state.projects.find((p) => p.id === id) || null,
      notify: (message, tone = 'ok') => {
        dispatch({ type: 'TOAST', toast: { message, tone, key: Date.now() } })
        clearTimeout(timer.current)
        timer.current = setTimeout(() => dispatch({ type: 'DISMISS_TOAST' }), 2600)
      },
      dismissToast: () => dispatch({ type: 'DISMISS_TOAST' }),
    }),
    [state],
  )

  return (
    <AppStateContext.Provider value={value}>
      <AppDispatchContext.Provider value={dispatch}>{children}</AppDispatchContext.Provider>
    </AppStateContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppStateContext)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}

export function useDispatch() {
  const ctx = useContext(AppDispatchContext)
  if (!ctx) throw new Error('useDispatch must be used inside AppProvider')
  return ctx
}
