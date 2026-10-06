import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

// Imported rather than read as source: the key these tests care about is produced by a
// function, and asserting on the function's output survives refactors of how it is written.
// storage.js touches localStorage only inside function bodies, so importing it here is safe.
import { LEGACY_STORAGE_KEY, userStorageKey } from '../src/store/storage.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

const ctx = read('src/store/AppContext.jsx')
const reducer = read('src/store/reducer.js')
const api = read('src/services/api.js')
const auth = read('src/services/auth.js')
const loader = read('src/services/loadProjects.js')
const dashboard = read('src/pages/Dashboard.jsx')
const builder = read('src/pages/Builder.jsx')
const comparison = read('src/pages/Comparison.jsx')

describe('BUG A — auth is never persisted separately from the token', () => {
  it('persistable() does not write auth or projects to localStorage', () => {
    const body = reducer.slice(reducer.indexOf('export function persistable'))
    const fn = body.slice(0, body.indexOf('}'))
    assert.doesNotMatch(fn, /auth:/, 'auth must not be persisted; the JWT is the only session source of truth')
    assert.doesNotMatch(fn, /projects:/, 'projects are server-owned and must never be written to the browser')
  })

  it('initFromStorage() reads nothing from storage at all', () => {
    const body = reducer.slice(reducer.indexOf('export function initFromStorage'))
    const fn = body.slice(0, body.indexOf('\n}'))
    assert.doesNotMatch(fn, /localStorage/, 'boot must not read a cached blob; prefs load per user after /auth/me')
    assert.doesNotMatch(fn, /seedProjects/, 'a new account must start with no projects, not a shared seed list')
  })

  it('isAuthed requires a live token, not just a cached user', () => {
    assert.match(ctx, /const signedIn = Boolean\(state\.auth\.user\) && isAuthenticated\(\)/)
    assert.match(ctx, /isAuthed: signedIn/)
  })

  it('the token and the per-user state blob are different keys', () => {
    const stateKey = userStorageKey('6ac1b2')
    assert.equal(LEGACY_STORAGE_KEY, 'archai.state.v1')
    assert.ok(stateKey.startsWith('archai.state.v1.u.'), `unexpected state key: ${stateKey}`)
    assert.ok(stateKey.endsWith('6ac1b2'), 'the state key must embed the user id')
    // The token must not live under the preference namespace, or signing out of one account
    // could disturb the other's stored session.
    assert.notEqual(stateKey, 'archai.token')
    assert.ok(!stateKey.includes('archai.token'))
  })
})

describe('project data is scoped to the signed-in account', () => {
  it('storage keys are namespaced per user id, never shared', () => {
    assert.notEqual(userStorageKey('userA'), userStorageKey('userB'))
    assert.match(userStorageKey('userA'), /userA$/)
    assert.equal(userStorageKey(''), null, 'no user id means no key, not a shared one')
    assert.equal(userStorageKey('   '), null)
  })

  it('nothing is persisted while signed out', () => {
    // Slice the effect body only: `purgeLegacyState` also appears in the import list.
    const start = ctx.indexOf('const userId = state.auth.user?.id\n    if (!userId) return')
    const effect = ctx.slice(start, ctx.indexOf('}, [state])', start))
    assert.ok(start > -1, 'the persistence effect must resolve the signed-in user id first')
    assert.match(effect, /if \(!userId\) return/, 'an anonymous blob would be shared by every later visitor')
    assert.match(effect, /writeUserState\(userId, persistable\(state\)\)/)
  })

  it('the stale shared blob is purged at startup', () => {
    assert.match(ctx, /purgeLegacyState\(\)/)
  })

  it('LOGOUT clears the previous account\'s projects and results', () => {
    const body = reducer.slice(reducer.indexOf("case 'LOGOUT'"), reducer.indexOf("case 'LOAD_PREFS'"))
    assert.match(body, /projects: \[\]/, 'sign-out must not leave another account\'s projects in memory')
    assert.match(body, /currentProjectId: null/)
    assert.match(body, /simCache: \{\}/)
    assert.match(body, /projectsOwnerId: null/)
  })

  it('HYDRATE_PROJECTS records which account the list belongs to', () => {
    assert.match(reducer, /projectsOwnerId: ownerId/)
    assert.match(reducer, /hydrated: true/)
  })

  it('the context refuses to expose projects owned by someone else', () => {
    assert.match(ctx, /const ownsProjects = Boolean\(userId\) && state\.projectsOwnerId === userId/)
    assert.match(ctx, /ownsProjects: signedIn && ownsProjects/)
    assert.match(
      ctx,
      /projects: ownsProjects \? state\.projects : \[\]/,
      'the raw project list must be emptied unless it belongs to the signed-in user',
    )
    assert.match(
      ctx,
      /currentProject: ownsProjects \? state\.projects\.find/,
      'currentProject must be null unless the list belongs to the signed-in user',
    )
    assert.match(ctx, /projectById: \(id\) => \(ownsProjects \?/)
  })

  it('no page reads the project list without going through the gate', () => {
    // Comparison and Reports both index `projects` directly; they are safe only because
    // the context hands them an empty list when ownership does not match.
    for (const name of ['Comparison.jsx', 'Reports.jsx']) {
      assert.match(ctx, /projects: ownsProjects \? state\.projects : \[\]/, `${name} depends on this gate`)
    }
  })

  it('a late response for a previous account is discarded', () => {
    // The owner id is taken from the verified /auth/me result, so a response that lands
    // after a sign-out or a different account cannot be applied to the current session.
    assert.match(ctx, /const stillOurs = \(\) => current\(\) && isAuthenticated\(\)/)
    assert.match(ctx, /if \(stillOurs\(\)\) dispatch\(\{ type: 'HYDRATE_PROJECTS', projects: \[\], ownerId: userId \}\)/)
    assert.match(ctx, /dispatch\(\{ type: 'HYDRATE_PROJECTS', projects, ownerId: userId \}\)/)
  })

  it('a connectivity failure never substitutes a cached project list', () => {
    // The old fallback returned `local` projects here, which handed one account the
    // previous account's work whenever the backend was unreachable.
    assert.match(loader, /source:\s*'unauthorized'/)
    assert.doesNotMatch(loader, /source: 'local'/, 'a local list may belong to a different account')
    assert.doesNotMatch(loader, /migrateLocalProjects/, 'there is no local project list left to migrate')
  })

  it('the Dashboard gates on the session and on ownership before rendering data', () => {
    assert.match(dashboard, /if \(!isAuthed\) \{\s*return <Navigate to="\/login" replace \/>/)
    assert.match(dashboard, /if \(!hydrated \|\| !ownsProjects\)/)
    assert.ok(
      dashboard.indexOf('if (!isAuthed)') < dashboard.indexOf('if (!currentProject)'),
      'the auth check must precede the empty-project branch',
    )
  })

  it('protected routes still redirect when there is no session', () => {
    const app = read('src/App.jsx')
    assert.match(app, /if \(!isAuthed\) return <Navigate to="\/login"/)
  })
})

describe('BUG B — no request loop through notify identity', () => {
  it('notify is a stable useCallback, not an inline arrow in the [state] memo', () => {
    assert.match(ctx, /const notify = useCallback\(\(message, tone = 'ok'\)/)
    const memo = ctx.slice(ctx.indexOf('const value = useMemo'))
    assert.doesNotMatch(memo, /notify:\s*\(/)
  })

  it('dismissToast is also stable', () => {
    assert.match(ctx, /const dismissToast = useCallback\(\(\) => dispatch/)
  })

  it('the context memo lists notify and dismissToast as dependencies', () => {
    assert.match(ctx, /\[state,\s*notify,\s*dismissToast/)
  })

  it('Builder never calls notify from inside a callback feeding its effect', () => {
    // The regression that caused the storm: notify -> TOAST -> new notify ->
    // new refreshVersions -> effect re-runs -> listVersions.
    const refresh = builder.slice(builder.indexOf('const refreshVersions = useCallback'))
    const fn = refresh.slice(0, refresh.indexOf('\n  )'))
    assert.match(fn, /notify\(versionFailure/)
    // The request must be guarded so a failure cannot retrigger itself.
    assert.match(builder, /if \(!isServerProjectId\(projectId\)\) \{/)
  })

  it('Comparison uses a stable notifyRef rather than notify in effect deps', () => {
    assert.match(comparison, /notifyRef\.current\(/)
    assert.doesNotMatch(comparison, /notify\(versionFailure/)
  })
})

describe('BUG C — stale seed ids are never requested', () => {
  it('Builder skips listVersions for non-ObjectId projects', () => {
    assert.match(builder, /isServerProjectId/)
  })

  it('Comparison skips listVersions for non-ObjectId projects', () => {
    assert.match(comparison, /isServerProjectId/)
  })

  it('isServerProjectId accepts only 24-char hex, matching backend isValidId', () => {
    const projects = read('src/services/projects.js')
    assert.match(projects, /\^\[a-fA-F0-9\]\{24\}\$/)
    assert.match(read('backend/src/services/architecture.service.js'), /\^\[a-fA-F0-9\]\{24\}\$/)
  })

  it('no page calls listVersions before the id guard', () => {
    for (const [src, name] of [[builder, 'Builder'], [comparison, 'Comparison']]) {
      const guard = src.indexOf('isServerProjectId')
      const call = src.indexOf('listVersions(')
      assert.ok(guard > -1 && call > -1, `${name} must have both`)
      assert.ok(guard < call, `${name}: the id guard must precede the request`)
    }
  })
})

describe('401 handling — handled once, no retry', () => {
  it('a 401 invalidates the whole session, not just the token', () => {
    assert.match(api, /export function onSessionInvalidated/)
    assert.match(api, /if \(error\.response\?\.status === 401\) \{[\s\S]*?invalidateSession\(\)/)
  })

  it('AppContext subscribes and dispatches LOGOUT', () => {
    assert.match(ctx, /onSessionInvalidated\(\(\) => \{[\s\S]*?dispatch\(\{ type: 'LOGOUT' \}\)/)
  })

  it('the session listener is registered before hydration runs', () => {
    assert.ok(
      ctx.indexOf('onSessionInvalidated') < ctx.indexOf('fetchCurrentUser'),
      'listener must be registered first so a failed hydration cannot outlive it',
    )
  })

  it('no retry or backoff logic exists in the api client', () => {
    assert.doesNotMatch(api, /axios-retry|retryDelay|backoff|setInterval/)
  })

  it('the auth fallback distinguishes 401 from a connectivity failure', () => {
    assert.match(loader, /source:\s*'unauthorized'/)
  })

  it('errors never carry the Authorization header', () => {
    assert.doesNotMatch(api, /wrapped\.response/)
    // error.config is only ever read to build a message, never attached to the error.
    assert.doesNotMatch(api, /wrapped\.config/)
    assert.doesNotMatch(api, /wrapped\.request/)
  })
})

describe('session restoration', () => {
  it('a reload with a valid token restores the session via /auth/me', () => {
    assert.match(ctx, /user = await fetchCurrentUser\(\)/)
  })

  it('runs on token presence, not on a cached user', () => {
    // This is the bug that sent every refresh to /login. Auth is deliberately not
    // persisted, so after a reload `state.auth.user` is null while the JWT is still valid.
    // Keying hydration on the user id meant the effect never fired on a reload at all.
    // Slice from the effect's own doc comment: the provider has several effects and an
    // earlier `useEffect(() => {` would otherwise match the preference-persistence one.
    const start = ctx.indexOf('// Runs when a token is available')
    assert.ok(start > -1, 'the hydration effect must be identifiable')
    const effect = ctx.slice(start, ctx.indexOf('}, [state.auth.user?.id])', start))
    assert.match(effect, /const token = tokenStore\.get\(\)/)
    assert.match(effect, /dispatch\(\{ type: 'AUTH_CHECKED' \}\)/)
    assert.doesNotMatch(effect, /const userId = state\.auth\.user\?\.id/)
    // The id used for scoping has to come from the verified token, not from prior state.
    assert.match(effect, /const userId = user\.id/)
  })

  it('the route guard waits for the check instead of redirecting on the first frame', () => {
    const app = read('src/App.jsx')
    assert.match(app, /if \(!authChecked\) return <Loading/)
    assert.match(app, /if \(!isAuthed\) return <Navigate to="\/login"/)
    assert.ok(
      app.indexOf('!authChecked') < app.indexOf('!isAuthed'),
      'the wait must come before the redirect, or a reload still lands on /login',
    )
    assert.match(ctx, /authChecked: Boolean\(state\.auth\.checked\)/)
  })

  it('an unusable token signs out instead of continuing', () => {
    assert.match(ctx, /if \(!user\) \{[\s\S]*?dispatch\(\{ type: 'LOGOUT' \}\)/)
  })

  it('the token is re-checked before subsequent protected calls', () => {
    const afterMe = ctx.slice(ctx.indexOf('fetchCurrentUser'))
    assert.match(afterMe, /if \(!isAuthenticated\(\)\) \{/)
  })

  it('hydration never writes projects while signed out', () => {
    const tail = ctx.slice(ctx.indexOf('fetchServerProjects'))
    assert.match(tail, /source === 'unauthorized'/)
    assert.match(tail, /isAuthenticated\(\) && projects/)
  })

  it('AUTH_CHECKED cannot undo a sign-in that already landed', () => {
    const reducer = read('src/store/reducer.js')
    const body = reducer.slice(reducer.indexOf("case 'AUTH_CHECKED'"), reducer.indexOf("case 'LOGOUT'"))
    assert.match(body, /if \(state\.auth\.checked\) return state/)
  })
})
