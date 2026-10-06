import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react'
import { initFromStorage, loadPrefsFor, persistable, reducer } from './reducer.js'
import { purgeLegacyState, writeUserState } from './storage.js'
import { fetchServerProjects } from '../services/loadProjects.js'
import { onSessionInvalidated } from '../services/api.js'
import { isAuthenticated, fetchCurrentUser } from '../services/auth.js'
import { tokenStore } from '../services/api.js'
import { setNotificationSink } from './notificationSink.js'

const AppStateContext = createContext(null)
const AppDispatchContext = createContext(null)

// Hydration is guarded by the VALUE OF THE TOKEN, not by a boolean flag.
//
// The previous guard was a module-level 'idle' | 'running' | 'done' latch. That is not a
// safe key: a hot reload re-evaluates the module and resets it to 'idle' while a token is
// still live, so the effect restarted, refetched /auth/me, re-dispatched LOGIN, changed
// its own dependency, and ran again. That is the repeated
// "GET /auth/me, GET /api/projects, GET /auth/me, ..." loop in the server log.
//
// Comparing the token itself makes the guard idempotent: the same session is restored
// exactly once, and a genuinely new session (sign-in, or sign-out followed by sign-in)
// always has a different token and therefore always re-hydrates.
let hydratedToken = null
let hydrationGeneration = 0

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, initFromStorage)
  const timer = useRef(null)

  // Preferences are written under a key derived from the signed-in user id, so one
  // account's workload/profile/interview history can never surface under another.
  // Nothing is written while signed out: an anonymous blob would be shared by every
  // subsequent visitor. Projects are never written at all — they are server-owned.
  useEffect(() => {
    const userId = state.auth.user?.id
    if (!userId) return
    writeUserState(userId, persistable(state))
  }, [state])

  // The pre-namespacing `archai.state.v1` blob may still hold a project list from an
  // earlier session. Remove it once so that data is not readable by any later account.
  useEffect(() => {
    purgeLegacyState()
  }, [])

  // Runs when a token is available: once on mount when the browser still holds a session,
  // and again after a manual sign-in.
  //
  // It must NOT be keyed on `state.auth.user`. Auth is deliberately not persisted, so after
  // a reload `auth.user` is null while the JWT is still valid. Keying on the user therefore
  // meant this effect never ran on a reload, the session was never restored, and the route
  // guard sent every refresh to /login.
  useEffect(() => {
    // No token at all: nothing to restore. Still mark the check as done, otherwise the route
    // guard would sit on a loader forever for a genuinely signed-out visitor.
    const token = tokenStore.get()
    if (!token) {
      hydratedToken = null
      dispatch({ type: 'AUTH_CHECKED' })
      return undefined
    }
    // Already restored, or already being restored, for this exact session. This is what
    // makes the effect idempotent under StrictMode's mount/unmount/mount: the second invoke
    // sees the same token and stands down, so exactly one request is ever in flight.
    if (hydratedToken === token) return undefined
    hydratedToken = token
    const generation = ++hydrationGeneration

    // Deliberately NO AbortController cleanup here.
    //
    // StrictMode's synthetic unmount fires a cleanup immediately after mount. An earlier
    // version aborted on cleanup, which cancelled the only /auth/me request, while the guard
    // above then refused to let the remount retry it. `auth.checked` was never dispatched and
    // the app hung on "Restoring your session..." forever.
    //
    // The token guard already prevents a duplicate request, and `current()` below discards
    // the result if a genuinely newer hydration superseded this one. Leaving the request to
    // finish is therefore both safe and necessary.

    const current = () => generation === hydrationGeneration

    ;(async () => {
      // Restore the session from the token itself. A rejected token (expired or wrong
      // secret) signs out instead of rendering protected routes with no Authorization
      // header and retrying protected calls indefinitely.
      let user
      try {
        user = await fetchCurrentUser()
      } catch {
        if (!current()) return
        // Forget the attempt so a later trigger can retry, rather than leaving a token that
        // looks hydrated when the fetch never actually completed.
        hydratedToken = null
        dispatch({ type: 'LOGOUT' })
        return
      }
      if (!current()) return
      if (!user) {
        // A 200 without a user means the token is not usable. Sign out rather than
        // continuing into requests that are guaranteed to fail.
        dispatch({ type: 'LOGOUT' })
        return
      }

      const userId = user.id
      const stillOurs = () => current() && isAuthenticated()
      dispatch({
        type: 'LOGIN',
        name: user.name,
        email: user.email,
        id: userId,
        role: user.role,
        // Without this the reducer stored a user object with no reportProfile, and Settings
        // fell back to the login name on every load even though the server held a saved one.
        reportProfile: user.reportProfile,
      })
      // Preferences live under this user's key, so they can only be read now that the
      // account is known.
      dispatch({ type: 'LOAD_PREFS', prefs: loadPrefsFor(userId) })

      // Re-check the token after the round-trip: a token can expire between the
      // /auth/me check and this call, and issuing known-doomed signed-out
      // requests is what produced the original 401 storm.
      if (!isAuthenticated()) {
        if (current()) dispatch({ type: 'LOGOUT' })
        return
      }

      // Projects come from the backend only. Nothing local is consulted, so a browser left over
      // from an earlier build cannot reintroduce projects that no longer exist server-side.
      const { projects, source } = await fetchServerProjects()
      if (!current()) return
      if (source === 'unauthorized') {
        // After a 401 the session listener has already dispatched LOGOUT; writing
        // projects now would leave a signed-out app holding a list it may never read.
        dispatch({ type: 'LOGOUT' })
        return
      }

      // 'error' means the server could not be reached. The user stays signed in and sees
      // an empty, clearly-labelled workspace rather than a cached list that might belong
      // to someone else.
      if (source === 'error' || !projects) {
        if (stillOurs()) dispatch({ type: 'HYDRATE_PROJECTS', projects: [], ownerId: userId })
        return
      }

      // Only hydrate while still authenticated as the same account. The owner id travels
      // with the payload so the UI can verify the list belongs to the signed-in user.
      if (isAuthenticated() && projects) {
        dispatch({ type: 'HYDRATE_PROJECTS', projects, ownerId: userId })
      }
    })()
  }, [state.auth.user?.id])

  useEffect(() => () => clearTimeout(timer.current), [])

  // A 401 anywhere in the app ends the session once: drop the cached user so the
  // Protected wrapper redirects to /login instead of re-issuing signed-out requests.
  useEffect(
    () =>
      onSessionInvalidated(() => {
        // The token is already gone, so forget which session was hydrated. Signing in again
        // issues a different token and is therefore allowed to hydrate.
        hydratedToken = null
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

  /**
   * Adds a persistent, bell-visible notification. Separate from `notify`, which raises a
   * toast that dismisses itself after 2.6s: a finished simulation is worth keeping around
   * until it has actually been read.
   *
   * Must keep a stable identity. Pages list it in effect dependencies, and a new reference
   * on every render would restart those effects on every dispatch.
   */
  const pushNotification = useCallback((notification) => {
    dispatch({ type: 'PUSH_NOTIFICATION', notification })
  }, [])
  const markNotificationRead = useCallback((id) => dispatch({ type: 'MARK_NOTIFICATION_READ', id }), [])
  const markAllNotificationsRead = useCallback(
    () => dispatch({ type: 'MARK_ALL_NOTIFICATIONS_READ' }),
    [],
  )
  const clearNotifications = useCallback(() => dispatch({ type: 'CLEAR_NOTIFICATIONS' }), [])

  // useResults notifies through a module-level sink rather than a hook, because a run
  // started on one page can finish while another page is mounted. Registered here, once, so
  // "simulation finished" raises a bell notification wherever the user has navigated to.
  useEffect(() => {
    setNotificationSink((n) => dispatch({ type: 'PUSH_NOTIFICATION', notification: n }))
    return () => setNotificationSink(null)
  }, [])

  const userId = state.auth.user?.id || null

  const value = useMemo(() => {
    const signedIn = Boolean(state.auth.user) && isAuthenticated()
    // Project data is only trustworthy when it was fetched for the account that is
    // currently signed in. Pages gate on this so a stale list can never be rendered as
    // the current user's own work.
    const ownsProjects = Boolean(userId) && state.projectsOwnerId === userId
    const notifications = state.notifications || []
    return {
      ...state,
      // Expose an empty list unless it was fetched for the account that is signed in.
      // Gating here rather than per page means no component can render another
      // account's projects by reading `projects` straight off the context.
      projects: ownsProjects ? state.projects : [],
      user: state.auth.user,
      isAuthed: signedIn,
      // True once the stored token has been verified either way. The route guard waits on
      // this instead of treating "not looked yet" as "signed out".
      authChecked: Boolean(state.auth.checked),
      demoMode: state.auth.demoMode,
      // True only when there is a session, the project list is loaded, and it belongs to
      // this user. Anything else must not be rendered as the user's data.
      ownsProjects: signedIn && ownsProjects,
      currentProject: ownsProjects ? state.projects.find((p) => p.id === state.currentProjectId) || null : null,
      projectById: (id) => (ownsProjects ? state.projects.find((p) => p.id === id) || null : null),
      notifications,
      unreadCount: notifications.filter((n) => !n.read).length,
      pushNotification,
      markNotificationRead,
      markAllNotificationsRead,
      clearNotifications,
      notify,
      dismissToast,
    }
  }, [state, notify, dismissToast, userId, pushNotification, markNotificationRead, markAllNotificationsRead, clearNotifications])

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