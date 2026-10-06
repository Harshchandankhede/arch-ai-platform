// Shared helpers for the end-to-end suite. Lives inside the project on purpose.
//
// Reads only MONGO_URI and MONGO_DNS_SERVERS out of backend/.env, and never prints either.
// The database name is validated against the archai_it_ prefix before anything is opened,
// so this cannot be pointed at the development database.
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import dns from 'node:dns'

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend')
const mongoose = createRequire(path.join(backendRoot, 'package.json'))('mongoose')

export function readEnvValue(file, key) {
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1 || line.slice(0, eq).trim() !== key) continue
    return line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
  }
  return undefined
}

export function assertTestDatabase(name) {
  if (!/^archai_it_[a-z0-9_]+$/.test(name)) {
    throw new Error(`refusing to touch database "${name}": not a test database name`)
  }
  return name
}

/**
 * Removes every document from a disposable database.
 *
 * dropDatabase is attempted first, but the Atlas role in use does not have that privilege,
 * so the fallback deletes documents and leaves an empty shell behind.
 */
export async function emptyDatabase(name) {
  assertTestDatabase(name)
  const uri = readEnvValue(path.join(backendRoot, '.env'), 'MONGO_URI')
  if (!uri) throw new Error('backend/.env has no MONGO_URI')

  const servers = (readEnvValue(path.join(backendRoot, '.env'), 'MONGO_DNS_SERVERS') || '')
    .split(',').map((s) => s.trim()).filter((s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s))
  if (servers.length) dns.setServers(servers)

  const conn = await mongoose.connect(uri, { dbName: name, serverSelectionTimeoutMS: 20000 })
  try {
    await conn.connection.dropDatabase()
    return `dropped ${name}`
  } catch {
    const collections = await conn.connection.db.listCollections().toArray()
    let removed = 0
    for (const c of collections) {
      const res = await conn.connection.db.collection(c.name).deleteMany({})
      removed += res.deletedCount
    }
    return `emptied ${name} (${removed} documents)`
  } finally {
    await conn.connection.close()
  }
}