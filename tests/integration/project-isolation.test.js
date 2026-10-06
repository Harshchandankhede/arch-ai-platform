import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

import {
  BASE,
  PASSWORD,
  archWith,
  anonymous,
  serverAvailable,
  withTwoAccounts,
} from './harness.mjs'

const online = await serverAvailable()
const SKIP_REASON = `no test instance reachable at ${BASE} — run npm run test:integration`
const opts = online ? {} : { skip: SKIP_REASON }

describe('project isolation', opts, () => {
  let a
  let b
  let aProjects

  before(async () => {
    ;({ a, b } = await withTwoAccounts())

    const first = await a.createProject({ name: 'A Project One', description: 'owned by A', arch: archWith('A1') })
    const second = await a.createProject({ name: 'A Project Two', description: 'also A', arch: archWith('A2') })
    assert.equal(first.status, 201)
    assert.equal(second.status, 201)
    aProjects = [first.json.data.project, second.json.data.project]
  })

  it('shows A both of the projects A created', async () => {
    const list = (await a.listProjects()).json.data.projects
    const ids = list.map((p) => p.id)
    for (const p of aProjects) {
      assert.ok(ids.includes(p.id), `A must see ${p.name}`)
    }
    assert.ok(list.some((p) => p.name === 'A Project One'))
    assert.ok(list.some((p) => p.name === 'A Project Two'))
  })

  it('shows B none of A’s projects — the central isolation property', async () => {
    const list = (await b.listProjects()).json.data.projects
    const ids = new Set(list.map((p) => p.id))

    for (const p of aProjects) {
      assert.equal(ids.has(p.id), false, `B must not see ${p.name}`)
      assert.equal(list.some((x) => x.name === p.name), false, 'nor by name')
    }
  })

  it('keeps B’s own project invisible to A', async () => {
    const bOwn = await b.createProject({ name: 'B Own Project', arch: archWith('B1') })
    assert.equal(bOwn.status, 201)
    const bId = bOwn.json.data.project.id

    const aList = (await a.listProjects()).json.data.projects
    assert.equal(aList.some((p) => p.id === bId), false, 'A must not see B’s project')
    assert.equal(aList.some((p) => p.name === 'B Own Project'), false)
  })

  it('counts each account’s projects separately', async () => {
    const aCount = (await a.listProjects()).json.data.projects.length
    const bCount = (await b.listProjects()).json.data.projects.length
    assert.equal(aCount, 2, 'A has exactly the two projects A created')
    assert.equal(bCount, 1, 'B has exactly the one project B created')
  })
})

describe('project security', opts, () => {
  let a
  let b
  let aProject

  before(async () => {
    ;({ a, b } = await withTwoAccounts())
    const created = await a.createProject({ name: 'A Secret', arch: archWith('Original') })
    aProject = created.json.data.project
    await a.createVersion(aProject.id, { label: 'A snapshot one' })
  })

  it('refuses B any view of A’s project', async () => {
    const res = await b.getProject(aProject.id)
    assert.equal(res.status, 404)
  })

  it('refuses B any edit of A’s project and leaves it untouched', async () => {
    const res = await b.updateProject(aProject.id, { name: 'B hijacked', arch: archWith('Hijacked') })
    assert.equal(res.status, 404)

    // The status code alone would not catch a write that happened anyway.
    const still = await a.getProject(aProject.id)
    assert.equal(still.status, 200)
    assert.equal(still.json.data.project.name, 'A Secret')
    assert.equal(still.json.data.project.arch.nodes[0].name, 'Original-node-1')
  })

  it('refuses B any delete of A’s project and keeps it alive', async () => {
    const res = await b.deleteProject(aProject.id)
    assert.equal(res.status, 404)

    const still = await a.getProject(aProject.id)
    assert.equal(still.status, 200, 'a refused delete must not remove the project')
  })

  it('refuses B access to A’s architecture versions', async () => {
    const list = await b.listVersions(aProject.id)
    assert.equal(list.status, 404)

    const created = await b.createVersion(aProject.id, { label: 'injected by B' })
    assert.equal(created.status, 404)

    const stillA = await a.listVersions(aProject.id)
    assert.equal(stillA.status, 200)
    assert.equal(stillA.json.data.versions.length, 1, 'the refused create must not add a snapshot')
  })

  it('refuses B a rename and delete of an individual A version', async () => {
    const versionId = (await a.listVersions(aProject.id)).json.data.versions[0].id

    const read = await b.get(`/projects/${aProject.id}/versions/${versionId}`)
    assert.equal(read.status, 404)

    const rename = await b.put(`/projects/${aProject.id}/versions/${versionId}/label`, { label: 'B was here' })
    assert.equal(rename.status, 404)

    const remove = await b.del(`/projects/${aProject.id}/versions/${versionId}`)
    assert.equal(remove.status, 404)

    const survivors = await a.listVersions(aProject.id)
    assert.equal(survivors.json.data.versions.length, 1, 'A’s version must survive')
    assert.equal(survivors.json.data.versions[0].label, 'A snapshot one', 'and keep its label')
  })

  it('refuses anonymous access to A’s project outright', async () => {
    const res = await anonymous().getProject(aProject.id)
    assert.equal(res.status, 401)
  })
})

describe('version isolation', opts, () => {
  it('gives each account an independent version list for their own project', async () => {
    const { a, b } = await withTwoAccounts()
    const aProj = (await a.createProject({ name: 'A versioned', arch: archWith('A') })).json.data.project
    const bProj = (await b.createProject({ name: 'B versioned', arch: archWith('B') })).json.data.project

    await a.createVersion(aProj.id, { label: 'a-1' })
    await a.createVersion(aProj.id, { label: 'a-2' })
    await b.createVersion(bProj.id, { label: 'b-1' })

    const aVersions = (await a.listVersions(aProj.id)).json.data.versions
    const bVersions = (await b.listVersions(bProj.id)).json.data.versions

    assert.equal(aVersions.length, 2)
    assert.equal(bVersions.length, 1)
    assert.ok(aVersions.every((v) => v.label.startsWith('a-')))
    assert.ok(bVersions.every((v) => v.label.startsWith('b-')))
  })

  it('rejects a version write against a project that belongs to another account', async () => {
    const { a, b } = await withTwoAccounts()
    const aProj = (await a.createProject({ name: 'A owned', arch: archWith('A') })).json.data.project

    const res = await b.createVersion(aProj.id, { label: 'not mine' })
    assert.equal(res.status, 404)

    const asA = (await a.listVersions(aProj.id)).json.data.versions
    assert.equal(asA.length, 0)
  })
})

describe('a restored version is persisted, not merely previewed', opts, () => {
  it('stores the restored architecture as the project’s current one', async () => {
    const { a } = await withTwoAccounts()
    const proj = (await a.createProject({ name: 'A restore', arch: archWith('Before') })).json.data.project

    const v1 = await a.createVersion(proj.id, { label: 'keep me', arch: archWith('Snapshot') })
    assert.equal(v1.status, 201)
    const versionId = (await a.listVersions(proj.id)).json.data.versions[0].id

    await a.updateProject(proj.id, { arch: archWith('Changed') })
    const restore = await a.post(`/projects/${proj.id}/versions/${versionId}/restore`)
    assert.equal(restore.status, 200)

    // A fresh read stands in for a reload, which is what would expose a restore that only
    // lived in the browser's memory.
    const reread = await a.getProject(proj.id)
    assert.equal(reread.json.data.project.arch.nodes[0].name, 'Snapshot-node-1')
  })
})