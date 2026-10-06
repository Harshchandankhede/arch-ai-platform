import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

import { BASE, PASSWORD, archWith, serverAvailable, withTwoAccounts } from './harness.mjs'

const online = await serverAvailable()
const SKIP_REASON = `no test instance reachable at ${BASE} — run npm run test:integration`
const opts = online ? {} : { skip: SKIP_REASON }

// The Builder debounces autosave by 400 ms, so a realistic pause is used before asserting
// that nothing further is pending. The API assertions themselves do not depend on it.
const AUTOSAVE_SETTLE_MS = 600

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

describe('project persistence (autosave target)', opts, () => {
  let a

  before(async () => {
    ;({ a } = await withTwoAccounts())
  })

  it('persists an architecture edit so it survives a reload', async () => {
    const created = await a.createProject({ name: 'Autosave Target', arch: archWith('Initial') })
    assert.equal(created.status, 201)
    const id = created.json.data.project.id

    // Step 2/3: edit the architecture and allow the autosave window to elapse.
    const edit = await a.updateProject(id, { arch: archWith('Edited') })
    assert.equal(edit.status, 200)
    await wait(AUTOSAVE_SETTLE_MS)

    // Step 4/5: a fresh read stands in for a reload and reopen.
    const reopened = await a.getProject(id)
    assert.equal(reopened.status, 200)
    assert.equal(reopened.json.data.project.arch.nodes[0].name, 'Edited-node-1')
    assert.ok(
      reopened.json.data.project.arch.nodes.length >= 2,
      'the edited node count must be what was stored, not the original',
    )
  })

  it('persists through a re-authentication, proving it is in MongoDB', async () => {
    const created = await a.createProject({ name: 'Persisted Deep', arch: archWith('One') })
    const id = created.json.data.project.id
    await a.updateProject(id, { arch: archWith('Two') })
    await wait(AUTOSAVE_SETTLE_MS)

    // A brand new session and a brand new token: nothing survives from the old one except
    // what is actually stored on the server.
    await a.relogin()

    const reopened = await a.getProject(id)
    assert.equal(reopened.status, 200)
    assert.equal(reopened.json.data.project.arch.nodes[0].name, 'Two-node-1')
  })

  it('keeps each autosave write scoped to its own project', async () => {
    const one = (await a.createProject({ name: 'Scope One', arch: archWith('One') })).json.data.project
    const two = (await a.createProject({ name: 'Scope Two', arch: archWith('Two') })).json.data.project

    await a.updateProject(one.id, { arch: archWith('OneEdited') })
    await a.updateProject(two.id, { arch: archWith('TwoEdited') })
    await wait(AUTOSAVE_SETTLE_MS)

    const readOne = await a.getProject(one.id)
    const readTwo = await a.getProject(two.id)
    assert.equal(readOne.json.data.project.arch.nodes[0].name, 'OneEdited-node-1')
    assert.equal(readTwo.json.data.project.arch.nodes[0].name, 'TwoEdited-node-1')
  })

  it('does not let a repeated autosave of one project bleed into another account', async () => {
    const { a: userA, b: userB } = await withTwoAccounts()
    const aProj = (await userA.createProject({ name: 'A autosave', arch: archWith('A1') })).json.data.project
    const bProj = (await userB.createProject({ name: 'B autosave', arch: archWith('B1') })).json.data.project

    await userA.updateProject(aProj.id, { arch: archWith('A2') })
    await userB.updateProject(bProj.id, { arch: archWith('B2') })
    await wait(AUTOSAVE_SETTLE_MS)

    assert.equal((await userA.getProject(aProj.id)).json.data.project.arch.nodes[0].name, 'A2-node-1')
    assert.equal((await userB.getProject(bProj.id)).json.data.project.arch.nodes[0].name, 'B2-node-1')
    assert.equal((await userA.getProject(bProj.id)).status, 404)
  })
})

describe('duplicate', opts, () => {
  let a
  let b
  let source

  before(async () => {
    ;({ a, b } = await withTwoAccounts())
    source = (await a.createProject({
      name: 'Checkout Service',
      description: 'the original',
      arch: archWith('Original'),
    })).json.data.project
  })

  it('creates a new project with its own database id', async () => {
    const copy = await a.createProject({
      name: 'Checkout Service v1',
      description: source.description,
      arch: source.arch,
    })
    assert.equal(copy.status, 201)

    const duplicate = copy.json.data.project
    assert.ok(duplicate.id)
    assert.notEqual(duplicate.id, source.id, 'a duplicate must be a separate document')
    assert.notEqual(duplicate.name, source.name)
  })

  it('copies the architecture', async () => {
    const duplicate = (await a.createProject({
      name: 'Copy Of Arch',
      description: source.description,
      arch: source.arch,
    })).json.data.project

    const reread = await a.getProject(duplicate.id)
    assert.equal(reread.json.data.project.arch.nodes.length, source.arch.nodes.length)
    assert.deepEqual(
      reread.json.data.project.arch.nodes.map((n) => n.name),
      source.arch.nodes.map((n) => n.name),
    )
    assert.equal(reread.json.data.project.arch.edges.length, source.arch.edges.length)
  })

  it('keeps the duplicate after a reload and after signing in again', async () => {
    const duplicate = (await a.createProject({
      name: 'Durable Duplicate',
      description: 'copy',
      arch: archWith('Durable'),
    })).json.data.project

    let list = (await a.listProjects()).json.data.projects
    assert.ok(list.some((p) => p.id === duplicate.id), 'present before re-auth')

    await a.relogin()

    list = (await a.listProjects()).json.data.projects
    assert.ok(list.some((p) => p.id === duplicate.id), 'present after re-auth')

    const reread = await a.getProject(duplicate.id)
    assert.equal(reread.json.data.project.arch.nodes[0].name, 'Durable-node-1')
  })

  it('leaves the original untouched by duplicating it', async () => {
    const before = await a.getProject(source.id)
    await a.createProject({ name: 'Another Copy', arch: source.arch })
    const after = await a.getProject(source.id)
    assert.deepEqual(
      after.json.data.project.arch.nodes.map((n) => n.name),
      before.json.data.project.arch.nodes.map((n) => n.name),
    )
    assert.equal(after.json.data.project.name, 'Checkout Service')
  })

  it('does not expose the duplicate to the other account', async () => {
    const duplicate = (await a.createProject({
      name: 'Private Copy',
      arch: archWith('Private'),
    })).json.data.project

    assert.equal((await b.getProject(duplicate.id)).status, 404)
    const bList = (await b.listProjects()).json.data.projects
    assert.equal(bList.some((p) => p.id === duplicate.id), false)
  })
})

describe('delete', opts, () => {
  let a
  let b

  before(async () => {
    ;({ a, b } = await withTwoAccounts())
  })

  it('deletes a project and keeps it deleted after a reload', async () => {
    const created = (await a.createProject({ name: 'Doomed', arch: archWith('Doomed') })).json.data.project

    const del = await a.deleteProject(created.id)
    assert.equal(del.status, 200)

    // Stand-in for the page refresh: a brand new session and token.
    await a.relogin()

    assert.equal((await a.getProject(created.id)).status, 404, 'must stay gone after re-auth')
    const list = (await a.listProjects()).json.data.projects
    assert.equal(list.some((p) => p.id === created.id), false, 'and stay out of the list')
  })

  it('denies the other account access to a deleted project', async () => {
    const created = (await a.createProject({ name: 'Deleted Then Hidden', arch: archWith('X') })).json.data.project
    assert.equal((await a.deleteProject(created.id)).status, 200)

    assert.equal((await b.getProject(created.id)).status, 404)
    assert.equal((await b.updateProject(created.id, { name: 'B was here' })).status, 404)
    assert.equal((await b.deleteProject(created.id)).status, 404)
  })

  it('deletes only the requested project', async () => {
    const keep = (await a.createProject({ name: 'Keep Me', arch: archWith('Keep') })).json.data.project
    const drop = (await a.createProject({ name: 'Drop Me', arch: archWith('Drop') })).json.data.project

    assert.equal((await a.deleteProject(drop.id)).status, 200)

    assert.equal((await a.getProject(keep.id)).status, 200, 'the sibling must survive')
    assert.equal((await a.getProject(drop.id)).status, 404)
  })

  it('reports 404 when deleting a project that is already gone', async () => {
    const created = (await a.createProject({ name: 'Delete Twice', arch: archWith('Y') })).json.data.project
    assert.equal((await a.deleteProject(created.id)).status, 200)
    assert.equal((await a.deleteProject(created.id)).status, 404)
  })
})