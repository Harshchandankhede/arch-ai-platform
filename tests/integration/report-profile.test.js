import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

import {
  BASE,
  PASSWORD,
  archWith,
  registerAccount,
  serverAvailable,
  withTwoAccounts,
} from './harness.mjs'

const online = await serverAvailable()
const SKIP_REASON = `no test instance reachable at ${BASE} — run npm run test:integration`
const opts = online ? {} : { skip: SKIP_REASON }

describe('report profile isolation', opts, () => {
  let a
  let b

  before(async () => {
    ;({ a, b } = await withTwoAccounts())

    const aRes = await a.saveProfile({ displayName: 'User A', affiliation: 'University A' })
    const bRes = await b.saveProfile({ displayName: 'User B', affiliation: 'University B' })
    assert.equal(aRes.status, 200)
    assert.equal(bRes.status, 200)
  })

  it('gives A only A’s profile', async () => {
    const me = (await a.me()).json.data.user
    assert.equal(me.reportProfile.displayName, 'User A')
    assert.equal(me.reportProfile.affiliation, 'University A')
  })

  it('gives B only B’s profile', async () => {
    const me = (await b.me()).json.data.user
    assert.equal(me.reportProfile.displayName, 'User B')
    assert.equal(me.reportProfile.affiliation, 'University B')
  })

  it('never returns the other account’s profile', async () => {
    const aMe = (await a.me()).json.data.user
    const bMe = (await b.me()).json.data.user
    assert.notEqual(aMe.reportProfile.displayName, bMe.reportProfile.displayName)
    assert.doesNotMatch(JSON.stringify(aMe.reportProfile), /University B/)
    assert.doesNotMatch(JSON.stringify(bMe.reportProfile), /University A/)
  })

  it('leaves B’s profile untouched when A changes theirs', async () => {
    const bBefore = (await b.me()).json.data.user.reportProfile

    await a.saveProfile({ displayName: 'User A Renamed', affiliation: 'University A2' })

    const bAfter = (await b.me()).json.data.user.reportProfile
    assert.deepEqual(bAfter, bBefore, 'B’s profile changed as a side effect of A’s save')
    assert.equal(bAfter.displayName, 'User B')
    assert.equal(bAfter.affiliation, 'University B')

    const aAfter = (await a.me()).json.data.user.reportProfile
    assert.equal(aAfter.displayName, 'User A Renamed')
  })

  it('survives signing in again, proving it is stored server-side', async () => {
    await a.saveProfile({ displayName: 'User A Persisted', affiliation: 'Institute Persisted' })
    await a.relogin()
    const me = (await a.me()).json.data.user
    assert.equal(me.reportProfile.displayName, 'User A Persisted')
    assert.equal(me.reportProfile.affiliation, 'Institute Persisted')
  })

  it('cannot change the login email, role or user id', async () => {
    const before = (await a.me()).json.data.user

    const res = await a.saveProfile({
      displayName: 'Still User A',
      affiliation: 'University A',
      email: 'attacker@evil.example',
      name: 'Imposter',
      role: 'admin',
      id: '000000000000000000000000',
    })
    assert.equal(res.status, 200)

    const after = (await a.me()).json.data.user
    assert.equal(after.email, before.email, 'login email must be immutable here')
    assert.equal(after.name, before.name, 'login name must be immutable here')
    assert.equal(after.role, before.role, 'role must be immutable here')
    assert.equal(after.id, before.id, 'user id must be immutable')
    assert.equal(after.reportProfile.displayName, 'Still User A')
  })

  it('leaves the account usable with the original credentials after a tampered save', async () => {
    await a.saveProfile({
      displayName: 'Renamed Again',
      affiliation: 'X',
      email: 'attacker@evil.example',
    })

    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: a.email, password: PASSWORD }),
    })
    assert.equal(res.status, 200, 'the original email must still sign in')
    const body = await res.json()
    assert.equal(body.data.user.email, a.email)
    assert.equal(body.data.user.reportProfile.displayName, 'Renamed Again')
  })

  it('does not let one account’s profile write reach another account’s document', async () => {
    const bIdBefore = b.user.id
    await a.saveProfile({ displayName: 'Cross Attempt', affiliation: 'Cross' })
    const bMe = (await b.me()).json.data.user
    assert.equal(bMe.id, bIdBefore)
    assert.notEqual(bMe.reportProfile.displayName, 'Cross Attempt')
  })
})

describe('report profile validation', opts, () => {
  let a

  before(async () => {
    ;({ a } = await withTwoAccounts())
  })

  it('rejects a one-character display name with a field-level message', async () => {
    const res = await a.saveProfile({ displayName: 'X', affiliation: 'MIT' })
    assert.equal(res.status, 400)
    assert.match(res.json.error.details.displayName, /at least 2/i)
  })

  it('rejects a blank display name', async () => {
    const res = await a.saveProfile({ displayName: '    ', affiliation: 'MIT' })
    assert.equal(res.status, 400)
    assert.ok(res.json.error.details.displayName)
  })

  it('allows an empty affiliation, since only the display name is required', async () => {
    const res = await a.saveProfile({ displayName: 'Valid Name', affiliation: '' })
    assert.equal(res.status, 200)
  })

  it('defaults an untouched profile to the login name rather than blank', async () => {
    // A brand new account, because the tests above in this describe have already set a
    // profile on the shared account.
    const fresh = await registerAccount('untouched')
    const me = (await fresh.me()).json.data.user
    assert.equal(me.reportProfile.displayName, me.name)
    assert.notEqual(me.reportProfile.displayName, '')
    assert.equal(me.reportProfile.affiliation, '')
  })
})

describe('refresh and session restore', opts, () => {
  let a
  let b

  before(async () => {
    ;({ a, b } = await withTwoAccounts())

    const aProject = await a.createProject({ name: 'A Session Project', arch: archWith('A') })
    await a.saveProfile({ displayName: 'User A Session', affiliation: 'University A' })
    await b.createProject({ name: 'B Session Project', arch: archWith('B') })
    await b.saveProfile({ displayName: 'User B Session', affiliation: 'University B' })
    assert.equal(aProject.status, 201)
  })

  it('restores A and A’s projects after a fresh session', async () => {
    const user = await a.relogin()
    assert.equal(user.id, a.user.id)
    assert.equal(user.email, a.email)

    const list = (await a.listProjects()).json.data.projects
    assert.ok(list.some((p) => p.name === 'A Session Project'), 'A’s projects must still be there')
    assert.equal(list.some((p) => p.name === 'B Session Project'), false)
  })

  it('restores A’s profile after a fresh session', async () => {
    await a.relogin()
    const me = (await a.me()).json.data.user
    assert.equal(me.reportProfile.displayName, 'User A Session')
    assert.equal(me.reportProfile.affiliation, 'University A')
  })

  it('shows only B’s data once B signs in', async () => {
    const user = await b.relogin()
    assert.equal(user.id, b.user.id)

    const list = (await b.listProjects()).json.data.projects
    assert.ok(list.some((p) => p.name === 'B Session Project'))
    assert.equal(list.some((p) => p.name === 'A Session Project'), false, 'no stale A data after switching')

    const me = (await b.me()).json.data.user
    assert.equal(me.reportProfile.displayName, 'User B Session')
  })

  it('gives A back exactly A’s data after switching away and back', async () => {
    await b.relogin()
    await a.relogin()

    const list = (await a.listProjects()).json.data.projects
    assert.ok(list.some((p) => p.name === 'A Session Project'), 'A’s own project returns')
    assert.equal(list.some((p) => p.name === 'B Session Project'), false, 'B’s project never appears')

    const me = (await a.me()).json.data.user
    assert.equal(me.id, a.user.id)
    assert.equal(me.email, a.email)
    assert.equal(me.reportProfile.displayName, 'User A Session')
    assert.equal(me.reportProfile.affiliation, 'University A')
  })

  it('keeps A’s architecture edits after the round trip', async () => {
    const project = (await a.listProjects()).json.data.projects.find((p) => p.name === 'A Session Project')
    assert.ok(project)

    await a.updateProject(project.id, { arch: archWith('AEdited') })

    await b.relogin()
    await a.relogin()

    const reread = await a.getProject(project.id)
    assert.equal(reread.status, 200)
    assert.equal(reread.json.data.project.arch.nodes[0].name, 'AEdited-node-1')
  })

  it('keeps the session valid across a re-authentication', async () => {
    // Note: a JWT signed with the same key for the same subject within the same second is
    // byte-identical by design, so asserting the token string changes would be wrong.
    // What matters is that the new session is usable and identifies the same account.
    const before = a.token
    const user = await a.relogin()
    assert.equal(user.id, a.user.id)

    assert.ok(a.token.split('.').length === 3, 'the credential must be a three-part JWT')
    const payload = JSON.parse(Buffer.from(a.token.split('.')[1], 'base64url').toString('utf8'))
    assert.equal(payload.sub, a.user.id, 'the token must name the signed-in account')

    const me = await a.me()
    assert.equal(me.status, 200)
    assert.equal(me.json.data.user.id, a.user.id)
    assert.ok(before.length > 0)
  })

  it('never leaks the other account’s data through the project list of a switched session', async () => {
    await a.relogin()
    const aIds = new Set((await a.listProjects()).json.data.projects.map((p) => p.id))

    await b.relogin()
    const bIds = (await b.listProjects()).json.data.projects.map((p) => p.id)
    for (const id of aIds) {
      assert.equal(bIds.includes(id), false, 'A’s project id appeared in B’s list')
    }
  })
})