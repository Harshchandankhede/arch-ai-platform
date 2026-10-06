import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import { afterEach, describe, it } from 'node:test'

const base = new URL('../', import.meta.url)
const read = (rel) => readFileSync(new URL(rel, base), 'utf8')

// Minimal localStorage stand-in. The module under test only touches localStorage inside
// function bodies, so a global installed before each import-time call is enough.
function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    get length() {
      return map.size
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    _dump: () => Object.fromEntries(map),
  }
}

const TOKEN_KEY = 'archai.token'
const USER_KEY = 'archai.state.v1.u.user-1'

async function loadStorageModule(fake) {
  globalThis.localStorage = fake
  // Imported fresh so the module sees the current global.
  const mod = await import(`../src/store/storage.js?fake=${Math.random().toString(36).slice(2)}`)
  return mod
}

afterEach(() => {
  delete globalThis.localStorage
})

describe('obsolete browser project data is removed', () => {
  it('deletes the old shared blob', async () => {
    const fake = makeStorage({
      'archai.state.v1': JSON.stringify({ projects: [{ id: 'p1', name: 'Legacy' }] }),
      [TOKEN_KEY]: 'a-jwt',
    })
    const { purgeLegacyState } = await loadStorageModule(fake)

    purgeLegacyState()

    assert.equal(fake.getItem('archai.state.v1'), null, 'the shared blob must be deleted')
    assert.equal(fake.getItem(TOKEN_KEY), 'a-jwt', 'the session token must survive')
  })

  it('strips projects from a per-user blob but keeps the preferences', async () => {
    const fake = makeStorage({
      [USER_KEY]: JSON.stringify({
        workload: { arrivalRate: 250 },
        settings: { alertThreshold: 70 },
        interview: { asked: 4 },
        projects: [{ id: 'p9', name: 'Stale project' }],
        currentProjectId: 'p9',
      }),
    })
    const { stripLegacyProjectsFromUserBlobs } = await loadStorageModule(fake)

    const rewritten = stripLegacyProjectsFromUserBlobs()
    assert.equal(rewritten, 1)

    const after = JSON.parse(fake.getItem(USER_KEY))
    assert.equal(after.projects, undefined, 'the stale project list must be gone')
    assert.equal(after.currentProjectId, undefined, 'the stale selection must be gone')
    assert.deepEqual(after.workload, { arrivalRate: 250 }, 'workload preference must survive')
    assert.deepEqual(after.settings, { alertThreshold: 70 }, 'settings preference must survive')
    assert.deepEqual(after.interview, { asked: 4 }, 'interview history must survive')
  })

  it('leaves a per-user blob that never held projects untouched', async () => {
    const original = JSON.stringify({ workload: { arrivalRate: 90 } })
    const fake = makeStorage({ [USER_KEY]: original })
    const { stripLegacyProjectsFromUserBlobs } = await loadStorageModule(fake)

    const rewritten = stripLegacyProjectsFromUserBlobs()

    assert.equal(rewritten, 0)
    assert.equal(fake.getItem(USER_KEY), original, 'the blob must not be rewritten needlessly')
  })

  it('cleans several accounts in one pass', async () => {
    const fake = makeStorage({
      'archai.state.v1.u.a': JSON.stringify({ projects: [1], settings: { alertThreshold: 10 } }),
      'archai.state.v1.u.b': JSON.stringify({ projects: [2], workload: { arrivalRate: 30 } }),
    })
    const { purgeLegacyState } = await loadStorageModule(fake)

    purgeLegacyState()

    assert.equal(JSON.parse(fake.getItem('archai.state.v1.u.a')).projects, undefined)
    assert.deepEqual(JSON.parse(fake.getItem('archai.state.v1.u.a')).settings, { alertThreshold: 10 })
    assert.equal(JSON.parse(fake.getItem('archai.state.v1.u.b')).projects, undefined)
    assert.deepEqual(JSON.parse(fake.getItem('archai.state.v1.u.b')).workload, { arrivalRate: 30 })
  })
})

describe('a project can never enter app state from the browser', () => {
  it('refuses to write projects even if a caller forgets to filter them', async () => {
    const fake = makeStorage()
    const { writeUserState } = await loadStorageModule(fake)

    writeUserState('user-1', {
      workload: { arrivalRate: 120 },
      projects: [{ id: 'p1' }],
      currentProjectId: 'p1',
    })

    const stored = JSON.parse(fake.getItem(USER_KEY))
    assert.equal(stored.projects, undefined)
    assert.equal(stored.currentProjectId, undefined)
    assert.deepEqual(stored.workload, { arrivalRate: 120 })
  })

  it('drops projects when reading an uncleaned blob', async () => {
    const fake = makeStorage({
      [USER_KEY]: JSON.stringify({ projects: [{ id: 'p1' }], settings: { alertThreshold: 55 } }),
    })
    const { readUserState } = await loadStorageModule(fake)

    const state = readUserState('user-1')
    assert.equal(state.projects, undefined)
    assert.deepEqual(state.settings, { alertThreshold: 55 })
  })

  it('reports no state for a user with no blob', async () => {
    const fake = makeStorage()
    const { readUserState } = await loadStorageModule(fake)
    assert.equal(readUserState('nobody'), null)
  })

  it('persists nothing without a user id', async () => {
    const fake = makeStorage()
    const { writeUserState, userStorageKey } = await loadStorageModule(fake)
    assert.equal(userStorageKey(''), null)
    assert.equal(writeUserState('', { workload: {} }), false)
    assert.equal(fake.length, 0)
  })
})

describe('malformed or hostile legacy data is harmless', () => {
  it('does not crash on unparseable per-user content', async () => {
    const fake = makeStorage({ [USER_KEY]: '{ this is not json' })
    const { readUserState, stripLegacyProjectsFromUserBlobs } = await loadStorageModule(fake)

    assert.equal(readUserState('user-1'), null, 'unparseable content is treated as absent')
    assert.equal(stripLegacyProjectsFromUserBlobs(), 0)
    assert.equal(fake.getItem(USER_KEY), '{ this is not json', 'and is left alone, not deleted')
  })

  it('ignores a blob that is not an object', async () => {
    const fake = makeStorage({ [USER_KEY]: '"just a string"' })
    const { readUserState, stripLegacyProjectsFromUserBlobs } = await loadStorageModule(fake)

    assert.equal(readUserState('user-1'), null)
    assert.equal(stripLegacyProjectsFromUserBlobs(), 0)
  })

  it('survives storage being unavailable entirely', async () => {
    const hostile = {
      get length() {
        throw new Error('storage disabled')
      },
      key: () => {
        throw new Error('storage disabled')
      },
      getItem: () => {
        throw new Error('storage disabled')
      },
      setItem: () => {
        throw new Error('storage disabled')
      },
      removeItem: () => {
        throw new Error('storage disabled')
      },
    }
    const mod = await loadStorageModule(hostile)

    assert.doesNotThrow(() => mod.purgeLegacyState())
    assert.equal(mod.readUserState('user-1'), null)
    assert.equal(mod.writeUserState('user-1', { workload: {} }), false)
  })
})

describe('the session token is never touched by cleanup', () => {
  it('keeps the token across every cleanup path', async () => {
    const fake = makeStorage({
      [TOKEN_KEY]: 'header.payload.signature',
      'archai.state.v1': JSON.stringify({ projects: [{ id: 'p1' }] }),
      [USER_KEY]: JSON.stringify({ projects: [{ id: 'p1' }], workload: { arrivalRate: 10 } }),
    })
    const { purgeLegacyState, stripLegacyProjectsFromUserBlobs, clearUserState } =
      await loadStorageModule(fake)

    purgeLegacyState()
    assert.equal(fake.getItem(TOKEN_KEY), 'header.payload.signature')

    stripLegacyProjectsFromUserBlobs()
    assert.equal(fake.getItem(TOKEN_KEY), 'header.payload.signature')

    clearUserState('user-1')
    assert.equal(fake.getItem(TOKEN_KEY), 'header.payload.signature', 'clearing prefs must not sign out')
  })

  it('never writes to the token key', async () => {
    const fake = makeStorage()
    const { writeUserState, purgeLegacyState } = await loadStorageModule(fake)

    writeUserState('user-1', { workload: { arrivalRate: 10 }, projects: [] })
    purgeLegacyState()

    assert.equal(fake.getItem(TOKEN_KEY), null)
  })
})

describe('the app has no browser-project migration left', () => {
  it('the migration module is gone', () => {
    assert.doesNotThrow(() => readFileSync(new URL('src/services/loadProjects.js', base), 'utf8'))
  })

  it('nothing imports a module named for migration', () => {
    for (const file of [
      'src/store/AppContext.jsx',
      'src/services/loadProjects.js',
      'src/store/storage.js',
      'src/store/reducer.js',
    ]) {
      assert.doesNotMatch(read(file), /from '.*migrateLocalData/, `${file} must not import it`)
    }
  })

  it('the loader only ever talks to the backend', () => {
    const loader = read('src/services/loadProjects.js')
    assert.match(loader, /listProjects\(\)/)
    assert.doesNotMatch(loader, /localStorage/)
    assert.doesNotMatch(loader, /source: 'local'/)
  })

  it('the context loads projects through the renamed loader', () => {
    const ctx = read('src/store/AppContext.jsx')
    assert.match(ctx, /from '\.\.\/services\/loadProjects\.js'/)
    assert.match(ctx, /await fetchServerProjects\(\)/)
    assert.doesNotMatch(ctx, /fetchProjectsWithFallback/)
  })

  it('startup still runs the legacy purge', () => {
    assert.match(read('src/store/AppContext.jsx'), /purgeLegacyState\(\)/)
  })

  it('the reducer still refuses to persist projects', async () => {
    // Asserted on behaviour rather than by matching the source: persistable()'s own
    // comment legitimately contains the word, so a regex over the file proves nothing.
    const { persistable } = await import('../src/store/reducer.js')
    const saved = persistable({
      workload: { arrivalRate: 120 },
      interview: {},
      settings: { alertThreshold: 50 },
      auth: { user: { id: 'user-1', name: 'Someone', email: 'a@b.c', role: 'student' } },
      projects: [{ id: 'p1', name: 'Must not persist' }],
      currentProjectId: 'p1',
      simCache: {},
    })

    assert.deepEqual(Object.keys(saved).sort(), ['interview', 'settings', 'workload'])
    assert.equal(saved.projects, undefined)
    assert.equal(saved.currentProjectId, undefined)
    assert.equal(saved.auth, undefined)
  })
})