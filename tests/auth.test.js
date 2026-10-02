import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

const ctx = read('src/store/AppContext.jsx')
const reducer = read('src/store/reducer.js')
const api = read('src/services/api.js')
const auth = read('src/services/auth.js')
const migrate = read('src/services/migrateLocalData.js')
const builder = read('src/pages/Builder.jsx')
const comparison = read('src/pages/Comparison.jsx')

describe('BUG A — auth is never persisted separately from the token', () => {
  it('persistable() does not write auth to localStorage', () => {
    const body = reducer.slice(reducer.indexOf('export function persistable'))
    const fn = body.slice(0, body.indexOf('}'))
    assert.doesNotMatch(fn, /auth:/, 'auth must not be persisted; the JWT is the only session source of truth')
  })

  it('initFromStorage() never restores a persisted user', () => {
    assert.match(reducer, /auth:\s*initialState\.auth/)
    assert.doesNotMatch(reducer, /auth:\s*parsed\.auth/)
  })

  it('isAuthed requires a live token, not just a cached user', () => {
    assert.match(ctx, /isAuthed:\s*Boolean\(state\.auth\.user\)\s*&&\s*isAuthenticated\(\)/)
  })

  it('the token and the state blob are different keys', () => {
    assert.match(api, /TOKEN_KEY\s*=\s*'archai\.token'/)
    assert.match(reducer, /STORAGE_KEY\s*=\s*'archai\.state\.v1'/)
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
    assert.match(ctx, /\[state,\s*notify,\s*dismissToast\]/)
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
    assert.match(migrate, /source:\s*'unauthorized'/)
  })

  it('migration aborts on the first 401 instead of firing one bad POST per project', () => {
    assert.match(migrate, /unauthorized:\s*true/)
  })

  it('migration is not marked complete when nothing migrated', () => {
    assert.match(migrate, /if \(locals\.length === 0 \|\| migrated > 0\)/)
  })

  it('sign-out clears the migration flag so another account can migrate', () => {
    assert.match(auth, /localStorage\.removeItem\(MIGRATED_KEY\)/)
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
    assert.match(ctx, /const user = await fetchCurrentUser\(\)/)
  })

  it('an unusable token signs out instead of continuing', () => {
    assert.match(ctx, /if \(!user\) \{[\s\S]*?dispatch\(\{ type: 'LOGOUT' \}\)/)
  })

  it('the token is re-checked before subsequent protected calls', () => {
    const afterMe = ctx.slice(ctx.indexOf('fetchCurrentUser'))
    assert.match(afterMe, /if \(!isAuthenticated\(\)\) \{/)
  })

  it('hydration never writes projects while signed out', () => {
    const tail = ctx.slice(ctx.indexOf('fetchProjectsWithFallback'))
    assert.match(tail, /source === 'unauthorized'/)
    assert.match(tail, /isAuthenticated\(\) && projects/)
  })
})
