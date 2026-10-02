import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react'
import { initFromStorage, persistable, reducer, STORAGE_KEY } from './reducer.js'
import { fetchProjectsWithFallback, migrateLocalProjects } from '../services/migrateLocalData.js'
import { onSessionInvalidated } from '../services/api.js'
import { isAuthenticated, fetchCurrentUser } from '../services/auth.js'

const AppStateContext = createContext(null)
const AppDispatchContext = createContext(null)

// Hydration is guarded at module scope rather than with a component ref. A ref latch
// set before the first await is incompatible with React StrictMode: the double-invoke
// runs cleanup (cancelling the in-flight request) and then skips the effect entirely,
// so the /auth/me result was discarded and a valid token never restored the session.
let hydrationState = 'idle'
let hydrationGeneration = 0

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, initFromStorage)
  const timer = useRef(null)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable(state)))
    } catch {
      // storage full or unavailable; app still works in-memory
    }
  }, [state])

  // Runs when the session becomes available. Keyed on authentication rather than [] so
  // that a user who signs in during this session still gets their projects loaded, and a
  // user whose token expires and is later replaced still re-hydrates.
  useEffect(() => {
    if (!isAuthenticated()) return
    if (hydrationState !== 'idle') return
    hydrationState = 'running'
    const generation = ++hydrationGeneration

    // The dispatch from useReducer is stable for the lifetime of the provider, so it is
    // safe to call after this effect's cleanup has run. Results are only applied if they
    // belong to the most recent hydration attempt.
    const current = () => generation === hydrationGeneration

    ;(async () => {
      // Restore the session from the token itself. Auth is no longer persisted, so a
      // reload with a still-valid JWT would otherwise drop the user to the login page.
      // A rejected token (expired or wrong secret) clears the token and leaves the
      // app signed out, instead of rendering protected routes with no Authorization
      // header and retrying protected calls indefinitely.
      try {
        const user = await fetchCurrentUser()
        if (!current()) return
        if (!user) {
          // A 200 without a user means the token is not usable. Sign out rather than
          // continuing into requests that are guaranteed to fail.
          hydrationState = 'idle'
          dispatch({ type: 'LOGOUT' })
          return
        }
        dispatch({ type: 'LOGIN', name: user.name, email: user.email, id: user.id, role: user.role })
      } catch {
        if (!current()) return
        hydrationState = 'idle'
        dispatch({ type: 'LOGOUT' })
        return
      }

      // Re-check the token after the round-trip: a token can expire between the
      // /auth/me check and these calls, and issuing known-doomed signed-out
      // requests is what produced the original 401 storm.
      if (!isAuthenticated()) {
        if (current()) {
          hydrationState = 'idle'
          dispatch({ type: 'LOGOUT' })
        }
        return
      }

      try {
        await migrateLocalProjects()
      } catch {
        // migration is best-effort
      }
      if (!current()) return
      if (!isAuthenticated()) return

      const { projects, source } = await fetchProjectsWithFallback()
      if (!current()) return
      // Only hydrate while still authenticated. After a 401 the session listener has
      // already dispatched LOGOUT; writing projects now would leave a signed-out app
      // holding a project list it may never be allowed to read.
      if (source === 'unauthorized') {
        hydrationState = 'idle'
        dispatch({ type: 'LOGOUT' })
        return
      }
      if (isAuthenticated() && projects) dispatch({ type: 'HYDRATE_PROJECTS', projects })
      hydrationState = 'done'
    })()
  }, [state.auth.user?.id])

  useEffect(() => () => clearTimeout(timer.current), [])

  // A 401 anywhere in the app ends the session once: drop the cached user so the
  // Protected wrapper redirects to /login instead of re-issuing signed-out requests.
  useEffect(
    () =>
      onSessionInvalidated(() => {
        // Reset the latch so signing in again in this session re-hydrates.
        hydrationState = 'idle'
        dispatch({ type: 'LOGOUT' })
      }),
    [],
  )

  // notify and dismissToast MUST keep a stable identity. They used to be defined
  // inline inside the [state] memo below, which gave them a new reference on every
  // dispatch. Builder's refreshVersions useCallback depends on notify and its effect
  // depends on refreshVersions, so a single failed request turned into an unbounded
  // request loop: 401 -> notify -> TOAST -> new notify -> new refreshVersions -> 401.
  const notify = useCallback((message, tone = 'ok') => {
    dispatch({ type: 'TOAST', toast: { message, tone, key: Date.now() } })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => dispatch({ type: 'DISMISS_TOAST' }), 2600)
  }, [])

  const dismissToast = useCallback(() => dispatch({ type: 'DISMISS_TOAST' }), [])

  const value = useMemo(
    () => ({
      ...state,
      user: state.auth.user,
      isAuthed: Boolean(state.auth.user) && isAuthenticated(),
      demoMode: state.auth.demoMode,
      currentProject: state.projects.find((p) => p.id === state.currentProjectId) || null,
      projectById: (id) => state.projects.find((p) => p.id === id) || null,
      notify,
      dismissToast,
    }),
    [state, notify, dismissToast],
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
