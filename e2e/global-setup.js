// Runs before the whole end-to-end suite: empties the disposable database so a previously
// aborted run cannot influence results.
import { emptyDatabase } from './support/testDb.mjs'

export const E2E_DB = 'archai_it_e2e'

export default async function globalSetup() {
  const result = await emptyDatabase(E2E_DB)
  console.log(`[e2e] pre-run cleanup: ${result}`)
}