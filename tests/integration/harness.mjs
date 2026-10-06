/**
 * Harness for the two-account integration suite.
 *
 * Connects directly with mongoose rather than through the app's config, because
 * config/index.js loads backend/.env and would therefore reach the DEVELOPMENT database.
 * The suite must only ever touch the disposable database named by ARCHAI_TEST_DB_NAME, and
 * that name is validated before any connection is opened.
 */
import { randomBytes } from 'node:crypto'
import dns from 'node:dns'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { after } from 'node:test'

import User from '../../backend/src/models/User.model.js'
import Project from '../../backend/src/models/Project.model.js'
import ArchitectureVersion from '../../backend/src/models/ArchitectureVersion.model.js'

// mongoose is a backend dependency and is not installed at the repository root, so it is
// resolved against the backend package rather than imported directly.
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend')
const mongoose = createRequire(path.join(backendRoot, 'package.json'))('mongoose')

export const BASE = process.env.ARCHAI_TEST_BASE_URL || 'http://127.0.0.1:5099/api'
export const PASSWORD = 'Integration!Pass123'
export const TEST_DB = process.env.ARCHAI_TEST_DB_NAME || ''

// Hard stop before anything is read or written. Without this a missing env var would fall
// back to the development database and the suite would delete real accounts.
if (!/^archai_it_[a-z0-9]+$/.test(TEST_DB)) {
  throw new Error(
    `refusing to run outside a test database (ARCHAI_TEST_DB_NAME="${TEST_DB}"). ` +
      'Use: npm run test:integration',
  )
}
if (!process.env.MONGO_URI) {
  throw new Error('MONGO_URI is not set; run through tests/integration/run.mjs')
}

const RUN_TOKEN = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`
let sequence = 0
let connected = false
const tracked = new Set()

/**
 * Counts the accounts created by THIS test file.
 *
 * Every spec file runs in its own process against the one shared disposable database, so a
 * plain countDocuments({}) also counts accounts that sibling files are creating at the same
 * moment. An assertion built on the global total is therefore racing the rest of the suite,
 * and failed intermittently with the total climbing by two instead of one.
 */
export async function countAccountsFromThisFile() {
  await connect()
  return User.countDocuments({ email: { $regex: `^it\\..*\\.${RUN_TOKEN}\\.` } })
}

export async function connect() {
  if (connected) return
  // The application applies the same override in config/database.js. Without it, resolving
  // the Atlas SRV record fails with ECONNREFUSED on this network, which is what made an
  // earlier attempt of this suite report connection errors rather than test results.
  const dnsServers = (process.env.MONGO_DNS_SERVERS || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s))
  if (dnsServers.length) dns.setServers(dnsServers)

  await mongoose.connect(process.env.MONGO_URI, {
    dbName: TEST_DB,
    serverSelectionTimeoutMS: 20000,
  })
  // Belt and braces: confirm the connection really is the disposable database.
  if (mongoose.connection.name !== TEST_DB) {
    throw new Error(`connected to "${mongoose.connection.name}", expected "${TEST_DB}"`)
  }
  connected = true
}

export async function serverAvailable() {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return false
    const health = await res.json()
    return health?.database?.name === TEST_DB
  } catch {
    return false
  }
}

/** Client carrying one account's bearer token. */
class Account {
  constructor(label, email, token, user) {
    this.label = label
    this.email = email
    this.token = token
    this.user = user
  }

  async call(method, path, body) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    return { status: res.status, json, text }
  }

  get(path) { return this.call('GET', path) }
  post(path, body) { return this.call('POST', path, body) }
  put(path, body) { return this.call('PUT', path, body) }
  del(path) { return this.call('DELETE', path) }

  listProjects() { return this.get('/projects') }
  getProject(id) { return this.get(`/projects/${id}`) }
  createProject(body) { return this.post('/projects', body) }
  updateProject(id, body) { return this.put(`/projects/${id}`, body) }
  deleteProject(id) { return this.del(`/projects/${id}`) }
  listVersions(projectId) { return this.get(`/projects/${projectId}/versions`) }
  createVersion(projectId, body) { return this.post(`/projects/${projectId}/versions`, body) }
  me() { return this.get('/auth/me') }
  saveProfile(patch) { return this.put('/auth/me/report-profile', patch) }

  /** Signs in again from scratch, as a browser reload with a stored token would. */
  async relogin() {
    const res = await this.call('POST', '/auth/login', {
      email: this.email,
      password: PASSWORD,
    })
    if (res.status !== 200) throw new Error(`relogin failed for ${this.label}: ${res.status}`)
    this.token = res.json.data.token
    this.user = res.json.data.user
    return this.user
  }
}

export function registerTracked(label) {
  return register(label)
}

export async function register(label, opts = {}) {
  await connect()
  sequence += 1
  const email = opts.email || `it.${label}.${RUN_TOKEN}.${sequence}@example.com`
  const res = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: opts.name || `IT ${label}`, email, password: PASSWORD }),
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, json, email }
}

/** Registers an account and returns a ready client. */
export async function registerAccount(label) {
  const res = await register(label)
  if (res.status !== 201) {
    throw new Error(`register failed for ${label}: ${res.status} ${JSON.stringify(res.json)}`)
  }
  tracked.add(res.email)
  return new Account(label, res.email, res.json.data.token, res.json.data.user)
}

/**
 * Registers an account WITHOUT tracking it, for negative registration tests.
 *
 * `opts` must be forwarded: dropping it silently generated a fresh email, which made a
 * duplicate-email assertion pass through the register path instead of the conflict path.
 */
export async function registerUntracked(label, opts) {
  return register(label, opts)
}

export async function withTwoAccounts() {
  const a = await registerAccount('a')
  const b = await registerAccount('b')
  return { a, b }
}

export function anonymous() {
  return new Account('anon', null, null, null)
}

/** A caller holding a syntactically valid but unsigned token. */
export function withInvalidToken() {
  return new Account('badtoken', null, 'not.a.real.token', null)
}

export function archWith(label, nodeCount = 2) {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: `n${i + 1}`,
    type: i === 0 ? 'api' : 'db',
    name: `${label}-node-${i + 1}`,
  }))
  const edges = nodes.slice(1).map((n, i) => ({ id: `e${i + 1}`, source: nodes[i].id, target: n.id }))
  return { nodes, edges }
}

/**
 * Removes the accounts this file created, together with their projects and versions.
 *
 * Nothing cascades at the database level, so deleting only the user document would leave
 * its projects behind as orphans that still occupy rows.
 */
export async function cleanupAccounts() {
  if (tracked.size === 0) return
  const emails = [...tracked]
  tracked.clear()
  await connect()
  const owners = await User.find({ email: { $in: emails } }).select('_id').lean()
  const ownerIds = owners.map((o) => o._id)
  const projects = await Project.find({ owner: { $in: ownerIds } }).select('_id').lean()
  const projectIds = projects.map((p) => p._id)
  await ArchitectureVersion.deleteMany({ project: { $in: projectIds } })
  await Project.deleteMany({ _id: { $in: projectIds } })
  await User.deleteMany({ _id: { $in: ownerIds } })
  await mongoose.connection.close()
  connected = false
}

after(cleanupAccounts)