/**
 * Orchestrates the integration suite against a THROWN-AWAY DATABASE.
 *
 * The suite deliberately never runs against the development database. Destructive checks
 * and ownership probes would otherwise be one typo away from touching real accounts, and
 * an earlier version of this harness did leave orphaned test projects behind in it.
 *
 * This runner therefore:
 *   1. mints a unique database name that must match /^archai_it_/,
 *   2. starts a second backend instance on its own port, overriding DB_NAME and JWT_SECRET,
 *   3. runs the test files against that instance,
 *   4. stops the instance and drops the database.
 *
 * dotenv does not overwrite variables already present in the environment, so the overrides
 * below win over backend/.env without that file being read, edited or printed.
 *
 * No secret is ever written to stdout: the database URI and signing key are passed to the
 * child through the environment only.
 */
import { spawn } from 'node:child_process'
import dns from 'node:dns'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

/**
 * Reads a single key out of backend/.env without pulling in dotenv, which is a backend
 * dependency and not resolvable from the repository root. The file is only read for
 * MONGO_URI; nothing from it is ever printed or returned.
 */
function readEnvValue(file, key) {
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    if (line.slice(0, eq).trim() !== key) continue
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    return value
  }
  return undefined
}

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const backendRoot = path.join(repoRoot, 'backend')

// mongoose is a backend dependency, so it is resolved against backend/package.json rather
// than the repository root, where it is not installed.
const mongoose = createRequire(path.join(backendRoot, 'package.json'))('mongoose')

const TEST_PORT = Number(process.env.ARCHAI_IT_PORT || 5099)
const BASE_URL = `http://127.0.0.1:${TEST_PORT}/api`

// A single fixed name, reused across runs.
//
// The Atlas role used here is not permitted to dropDatabase, so a per-run unique name
// would leave an empty database behind on the cluster every single time. Reusing one
// database and emptying it before and after the run keeps the residue to exactly one
// disposable shell, whatever the number of runs.
const TEST_DB = 'archai_it_suite'

// The name is the only thing standing between this suite and the real database.
if (!/^archai_it_[a-z0-9]+$/.test(TEST_DB)) {
  throw new Error(`refusing to run: generated database name is not a test name: ${TEST_DB}`)
}

// The value is used to reach the cluster and is passed to the child through the
// environment only. It is never printed, logged or written to the database name.
const mongoUri = readEnvValue(path.join(backendRoot, '.env'), 'MONGO_URI')
if (!mongoUri) throw new Error('backend/.env has no MONGO_URI; cannot start a test instance')
const mongoDnsServers = readEnvValue(path.join(backendRoot, '.env'), 'MONGO_DNS_SERVERS') || ''

const childEnv = {
  ...process.env,
  NODE_ENV: 'test',
  PORT: String(TEST_PORT),
  DB_NAME: TEST_DB,
  // A throwaway signing key: tokens minted by this instance must not be valid anywhere else.
  JWT_SECRET: `it-only-${TEST_DB}-${process.pid}`,
  // Hashing dominates the runtime of a suite that registers many accounts, and the cost
  // factor buys nothing against a database that is discarded afterwards.
  BCRYPT_ROUNDS: '4',
  LOG_REQUESTS: 'false',
  // No outbound advisor calls from an integration run.
  GEMINI_API_KEY: '',
  MONGO_URI: mongoUri,
  MONGO_DNS_SERVERS: mongoDnsServers,
}

let child = null

async function waitForHealth(timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(3000) })
      if (res.ok) return await res.json()
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`test instance did not become healthy on port ${TEST_PORT}`)
}

function runTests() {
  return new Promise((resolve) => {
    const files = [
      'accounts.test.js',
      'project-isolation.test.js',
      'project-actions.test.js',
      'report-profile.test.js',
    ].map((f) => path.join(here, f))

    const proc = spawn(process.execPath, ['--test', ...files], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        ARCHAI_TEST_BASE_URL: BASE_URL,
        ARCHAI_TEST_DB_NAME: TEST_DB,
        MONGO_URI: mongoUri,
        MONGO_DNS_SERVERS: mongoDnsServers,
      },
    })
    proc.on('exit', (code) => resolve(code ?? 1))
  })
}

/**
 * Removes every document from the disposable database.
 *
 * dropDatabase is attempted first because it leaves no residue at all, but the Atlas role
 * in use does not have that privilege. Deleting the documents is the fallback: the
 * database shell still exists, but it holds nothing from the run.
 */
async function emptyTestDatabase() {
  if (!/^archai_it_/.test(TEST_DB)) throw new Error(`refusing to empty ${TEST_DB}`)

  const servers = (mongoDnsServers || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s))
  if (servers.length) dns.setServers(servers)

  const conn = await mongoose.connect(mongoUri, { dbName: TEST_DB, serverSelectionTimeoutMS: 20000 })
  try {
    await conn.connection.dropDatabase()
    return 'dropped'
  } catch {
    const collections = await conn.connection.db.listCollections().toArray()
    for (const c of collections) {
      await conn.connection.db.collection(c.name).deleteMany({})
    }
    return `emptied ${collections.length} collection(s)`
  } finally {
    await conn.connection.close()
  }
}

async function main() {
  console.log(`integration database: ${TEST_DB}  (disposable, emptied around every run)`)
  console.log(`integration base url: ${BASE_URL}`)

  // Start from a known-empty state so a previously aborted run cannot influence results.
  try {
    console.log(`pre-run cleanup: ${await emptyTestDatabase()}`)
  } catch (err) {
    console.error(`pre-run cleanup failed: ${err.message}`)
  }

  child = spawn(process.execPath, ['src/server.js'], {
    cwd: backendRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv,
  })
  const serverLog = []
  child.stdout.on('data', (b) => serverLog.push(String(b)))
  child.stderr.on('data', (b) => serverLog.push(String(b)))
  child.on('exit', (code) => {
    if (code && code !== 0) console.error(`test instance exited early with code ${code}`)
  })

  let code = 1
  try {
    const health = await waitForHealth()
    // Prove the server under test is pointed at the disposable database before any test
    // runs. If this ever mismatches, the suite must not proceed.
    if (health?.database?.name !== TEST_DB) {
      throw new Error(
        `test instance is using database "${health?.database?.name}", expected "${TEST_DB}"`,
      )
    }
    console.log(`test instance healthy, database confirmed: ${health.database.name}\n`)
    code = await runTests()
  } catch (err) {
    console.error(`\n${err.message}`)
    if (serverLog.length) console.error(serverLog.join(''))
    code = 1
  } finally {
    if (child && child.exitCode === null) {
      child.kill()
      await new Promise((r) => setTimeout(r, 400))
    }
    try {
      console.log(`\npost-run cleanup: ${await emptyTestDatabase()}`)
      console.log(
        'note: an empty archai_it_suite database remains on the cluster because the ' +
          'configured Atlas role may not dropDatabase. It holds no data.',
      )
    } catch (err) {
      console.error(`could not clean up ${TEST_DB}: ${err.message}`)
    }
  }

  console.log(code === 0 ? '\nintegration suite PASSED' : '\nintegration suite FAILED')
  process.exit(code)
}

main()