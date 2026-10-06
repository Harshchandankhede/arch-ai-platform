// Runs after the whole end-to-end suite: empties the disposable database.
import { emptyDatabase } from './support/testDb.mjs'
import { E2E_DB } from './global-setup.js'

export default async function globalTeardown() {
  const result = await emptyDatabase(E2E_DB)
  console.log(`[e2e] post-run cleanup: ${result}`)
  console.log(
    `[e2e] an empty ${E2E_DB} database may remain on the cluster because the configured ` +
      'Atlas role may not permit dropDatabase. It holds no data.',
  )
}