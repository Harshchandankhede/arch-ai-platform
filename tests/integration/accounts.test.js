import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

import {
  BASE,
  PASSWORD,
  anonymous,
  connect,
  countAccountsFromThisFile,
  registerUntracked,
  serverAvailable,
  withInvalidToken,
  withTwoAccounts,
} from './harness.mjs'
import User from '../../backend/src/models/User.model.js'

const online = await serverAvailable()
const SKIP_REASON = `no test instance reachable at ${BASE} — run npm run test:integration`
const opts = online ? {} : { skip: SKIP_REASON }

describe('registration', opts, () => {
  it('registers both accounts and gives them different user ids', async () => {
    const a = await registerUntracked('reg-a')
    const b = await registerUntracked('reg-b')

    assert.equal(a.status, 201)
    assert.equal(b.status, 201)

    const aUser = a.json.data.user
    const bUser = b.json.data.user
    assert.ok(aUser.id, 'A must receive an id')
    assert.ok(bUser.id, 'B must receive an id')
    assert.notEqual(aUser.id, bUser.id, 'the two accounts must be distinct identities')
    assert.notEqual(aUser.email, bUser.email)
    assert.ok(a.json.data.token, 'A must receive a token')
  })

  it('rejects a duplicate email instead of creating a second account', async () => {
    const first = await registerUntracked('dupe')
    assert.equal(first.status, 201)

    const second = await registerUntracked('dupe', { email: first.email })
    assert.equal(second.status, 409, 'a duplicate email must be refused')
    assert.match(second.json.error.message, /already exists/i)
  })

  it('never returns the password or its hash', async () => {
    const res = await registerUntracked('secrets')
    assert.equal(res.status, 201)

    const serialised = JSON.stringify(res.json)
    assert.equal(serialised.includes(PASSWORD), false, 'the password must not appear in the response')
    assert.equal(/passwordHash|"password"/.test(serialised), false, 'no password field may be returned')

    // And the stored document must hold a hash, never the plaintext. passwordHash is
    // declared select:false, so it has to be asked for explicitly.
    await connect()
    const stored = await User.findOne({ email: res.email }).select('+passwordHash').lean()
    assert.ok(stored, 'the account must exist in the database')
    assert.notEqual(stored.passwordHash, PASSWORD, 'the password must not be stored in plaintext')
    assert.match(stored.passwordHash, /^\$2[aby]\$/, 'the password must be stored as a bcrypt hash')
  })

  it('rejects a registration with no password', async () => {
    const res = await fetch(`${BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'No Password', email: `nopass.${Date.now()}@example.com` }),
    })
    assert.equal(res.status, 400)
    const body = await res.json()
    assert.ok(body.error.details.password, 'the rejection must name the password field')
  })

  it('refuses to register the same email with different casing twice', async () => {
    const first = await registerUntracked('case')
    assert.equal(first.status, 201)

    const upper = first.email.toUpperCase()
    const second = await registerUntracked('case', { email: upper })
    assert.equal(second.status, 409, 'email uniqueness must be case-insensitive')
  })
})

describe('login', opts, () => {
  let a
  let b

  before(async () => {
    ;({ a, b } = await withTwoAccounts())
  })

  it('signs in as A and reports A from /auth/me', async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: a.email, password: PASSWORD }),
    })
    assert.equal(res.status, 200)

    const body = await res.json()
    const token = body.data.token
    assert.equal(body.data.user.email, a.email)

    const me = await fetch(`${BASE}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
    assert.equal(me.status, 200)
    const meBody = await me.json()
    assert.equal(meBody.data.user.id, a.user.id)
    assert.equal(meBody.data.user.email, a.email)
  })

  it('signs in as B and reports B from /auth/me', async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: b.email, password: PASSWORD }),
    })
    assert.equal(res.status, 200)

    const body = await res.json()
    const token = body.data.token
    assert.equal(body.data.user.email, b.email)

    const me = await fetch(`${BASE}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
    const meBody = await me.json()
    assert.equal(meBody.data.user.id, b.user.id)
    assert.equal(meBody.data.user.email, b.email)
  })

  it('issues different tokens and different identities for the two accounts', async () => {
    const aMe = (await a.me()).json.data.user
    const bMe = (await b.me()).json.data.user
    assert.notEqual(aMe.id, bMe.id)
    assert.notEqual(a.token, b.token)
  })

  it('rejects a wrong password without revealing which field was wrong', async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: a.email, password: 'definitely-not-the-password' }),
    })
    assert.equal(res.status, 401)
    const body = await res.json()
    assert.match(body.error.message, /invalid email or password/i)
  })
})

describe('invalid access', opts, () => {
  it('refuses the project list with no token', async () => {
    const res = await anonymous().listProjects()
    assert.equal(res.status, 401)
  })

  it('refuses the project list with an invalid token', async () => {
    const res = await withInvalidToken().listProjects()
    assert.equal(res.status, 401)
  })

  it('refuses reading a project with no token', async () => {
    const res = await anonymous().getProject('a'.repeat(24))
    assert.equal(res.status, 401)
  })

  it('refuses writing a project with an invalid token', async () => {
    const res = await withInvalidToken().createProject({ name: 'injected' })
    assert.equal(res.status, 401)
  })

  it('refuses the current user with an invalid token', async () => {
    const res = await withInvalidToken().me()
    assert.equal(res.status, 401)
  })

  it('returns no project data in an unauthenticated rejection', async () => {
    const res = await anonymous().listProjects()
    assert.equal(res.status, 401)
    assert.equal(res.json?.data, undefined, 'a 401 must not carry a data payload')
    assert.doesNotMatch(res.text, /"projects"/)
  })

it('does not leave an orphaned account behind when a duplicate registration is refused', async () => {
  // Scoped to the accounts this file created: the spec files run as separate processes
  // against one shared disposable database, so a global total would race the sibling files.
  const before = await countAccountsFromThisFile()
  const first = await registerUntracked('orphan-check')
  assert.equal(first.status, 201)
  const refused = await registerUntracked('orphan-check', { email: first.email })
  assert.equal(refused.status, 409)
  const after = await countAccountsFromThisFile()
  assert.equal(after, before + 1, 'the refused registration must not add a second document')
})
})