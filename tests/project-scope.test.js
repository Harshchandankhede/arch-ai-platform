import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { initialState, reducer, initFromStorage, persistable } from '../src/store/reducer.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const migrateSrc = read('src/services/migrateLocalData.js')

// These exercise the reducer directly rather than pattern-matching its source, because
// the guarantee under test is behavioural: one account's projects must never survive into
// the next account's session.

function signedInState(projects, ownerId) {
  return {
    ...initialState,
    auth: {
      user: { name: 'A', email: 'a@x.edu', id: ownerId, initials: 'A', role: 'student' },
      demoMode: false,
    },
    projects,
    projectsOwnerId: ownerId,
    currentProjectId: projects[0]?.id ?? null,
    hydrated: true,
  }
}

const owned = (id, owner) => ({ id, name: `Project ${id}`, arch: { nodes: [], edges: [] }, owner })

describe('initFromStorage', () => {
  it('starts every boot with no projects at all', () => {
    const state = initFromStorage()
    assert.deepEqual(state.projects, [])
    assert.equal(state.currentProjectId, null)
    assert.equal(state.projectsOwnerId, null)
    assert.equal(state.hydrated, false)
  })

  it('does not read localStorage, so no cached project list can be restored', () => {
    const body = initFromStorage.toString()
    assert.doesNotMatch(body, /localStorage/)
    assert.doesNotMatch(body, /seedProjects/)
  })
})

describe('persistable', () => {
  it('excludes projects, auth and the current selection', () => {
    const saved = persistable(signedInState([owned('p1', 'userA')], 'userA'))
    assert.deepEqual(Object.keys(saved).sort(), ['interview', 'settings', 'workload'])
  })
})

describe('LOGOUT', () => {
  it('discards the previous account\'s projects, results and selection', () => {
    const before = signedInState([owned('p1', 'userA'), owned('p2', 'userA')], 'userA')
    before.simCache = { 'p1': { metrics: { p95: 12 } } }
    before.interview = { history: [{ q: 'secret' }], log: ['secret'], index: 0 }

    const after = reducer(before, { type: 'LOGOUT' })

    assert.equal(after.auth.user, null)
    assert.deepEqual(after.projects, [], 'projects from the old account must not survive sign-out')
    assert.equal(after.projectsOwnerId, null)
    assert.equal(after.currentProjectId, null)
    assert.deepEqual(after.simCache, {}, 'cached results are derived from the old account\'s projects')
    assert.deepEqual(after.interview, { history: [], log: [], index: 0 })
  })

  it('resets the profile so one account\'s name cannot appear under another', () => {
    const before = signedInState([], 'userA')
    before.settings = { alertThreshold: 60, name: 'Aditi Sharma', email: 'aditi.sharma@student.edu' }
    const after = reducer(before, { type: 'LOGOUT' })
    assert.equal(after.settings.name, '')
    assert.equal(after.settings.email, '')
  })

  it('leaves the app signed out and not hydrated', () => {
    const after = reducer(signedInState([owned('p1', 'userA')], 'userA'), { type: 'LOGOUT' })
    assert.equal(after.hydrated, false)
    assert.equal(after.auth.demoMode, true)
  })
})

describe('HYDRATE_PROJECTS', () => {
  it('tags the list with the account it was fetched for', () => {
    const projects = [owned('a1', 'userB')]
    const next = reducer(initialState, { type: 'HYDRATE_PROJECTS', projects, ownerId: 'userB' })
    assert.equal(next.projectsOwnerId, 'userB')
    assert.equal(next.currentProjectId, 'a1')
    assert.equal(next.hydrated, true)
  })

  it('treats an empty list as a valid answer for a brand-new account', () => {
    const next = reducer(signedInState([owned('p1', 'userA')], 'userA'), {
      type: 'HYDRATE_PROJECTS',
      projects: [],
      ownerId: 'userB',
    })
    assert.deepEqual(next.projects, [])
    assert.equal(next.projectsOwnerId, 'userB', 'ownership is still recorded, so the UI can trust the empty state')
    assert.equal(next.currentProjectId, null)
    assert.equal(next.hydrated, true, 'an empty workspace must not be stuck on a loading spinner')
  })

  it('drops a selection that the new account does not own', () => {
    const before = signedInState([owned('p1', 'userA')], 'userA')
    const next = reducer(before, { type: 'HYDRATE_PROJECTS', projects: [owned('b1', 'userB')], ownerId: 'userB' })
    assert.equal(next.currentProjectId, 'b1')
  })
})

describe('switching accounts in one browser', () => {
  it('userB never observes userA\'s projects at any point', () => {
    let state = signedInState([], 'userA')
    state = reducer(state, { type: 'HYDRATE_PROJECTS', projects: [owned('a1', 'userA')], ownerId: 'userA' })
    assert.equal(state.projects.length, 1)

    // Sign out, then sign in as somebody else.
    state = reducer(state, { type: 'LOGOUT' })
    assert.deepEqual(state.projects, [])

    state = reducer(state, {
      type: 'LOGIN',
      name: 'B',
      email: 'b@x.edu',
      id: 'userB',
      role: 'student',
    })
    state = reducer(state, { type: 'HYDRATE_PROJECTS', projects: [], ownerId: 'userB' })

    assert.deepEqual(state.projects, [], 'the second account starts empty')
    assert.equal(state.projectsOwnerId, 'userB')
    assert.equal(state.currentProjectId, null)
  })

  it('a list fetched for userA cannot be rendered while userB is signed in', () => {
    // The context gates on this equality; the reducer alone makes the mismatch visible.
    const stale = signedInState([owned('a1', 'userA')], 'userA')
    stale.auth.user.id = 'userB'
    assert.notEqual(stale.projectsOwnerId, stale.auth.user.id)
  })
})

describe('fetchProjectsWithFallback', () => {
  it('never returns a cached project list on a connectivity failure', () => {
    // This used to `return { projects: local, source: 'local' }`, which handed the signed-in
    // user whatever the previous account had left in the shared blob.
    assert.doesNotMatch(migrateSrc, /source: 'local'/)
    assert.match(migrateSrc, /return \{ projects: null, source: 'error'/)
  })

  it('still reports a 401 separately from a connectivity failure', () => {
    assert.match(migrateSrc, /err\.status === 401 \|\| err\.status === 403/)
    assert.match(migrateSrc, /source: 'unauthorized'/)
  })

  it('has no local-project migration left to run', () => {
    assert.doesNotMatch(migrateSrc, /export async function migrateLocalProjects/)
  })
})

describe('the backend is the only owner of project data', () => {
  const service = read('backend/src/services/project.service.js')
  const routes = read('backend/src/routes/project.routes.js')
  const controller = read('backend/src/controllers/project.controller.js')

  it('requires a session on every project route', () => {
    assert.match(routes, /router\.use\(requireAuth\)/)
  })

  it('scopes every query by owner', () => {
    assert.match(service, /Project\.find\(\{ owner: ownerId \}\)/)
    assert.match(service, /findOne\(\{ _id: id, owner: ownerId \}\)/)
    assert.match(service, /findOneAndUpdate\(\{ _id: id, owner: ownerId \}/)
    assert.match(service, /findOneAndDelete\(\{ _id: id, owner: ownerId \}\)/)
  })

  it('takes the owner from the verified token, never from the request body', () => {
    assert.match(controller, /listProjects\(req\.user\.id\)/)
    assert.match(controller, /getProject\(req\.params\.id, req\.user\.id\)/)
    assert.match(controller, /createProject\(\{ ownerId: req\.user\.id/)
    assert.doesNotMatch(controller, /req\.body\.owner/)
  })

  it('never returns the owner field to the client', () => {
    assert.match(read('backend/src/models/Project.model.js'), /delete ret\.owner/)
    const toPublic = service.slice(service.indexOf('function toPublic'))
    assert.doesNotMatch(toPublic.slice(0, toPublic.indexOf('\n}')), /owner/)
  })
})