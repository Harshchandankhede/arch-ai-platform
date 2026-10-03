import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

const migrateSrc = await import('node:fs').then((fs) =>
  fs.readFileSync(new URL('../src/services/migrateLocalData.js', import.meta.url), 'utf8'),
)

describe('migrateLocalProjects', () => {
  it('never references `err` outside a catch block', () => {
    // A stray `err.status` guard above the try threw ReferenceError on the first local
    // project, so migration could never run at all and 116 tests still passed.
    const loop = migrateSrc.slice(
      migrateSrc.indexOf('for (const project of locals)'),
      migrateSrc.indexOf('if (migrated > 0)'),
    )
    const tryIndex = loop.indexOf('try {')
    const catchIndex = loop.indexOf('catch (err)')

    assert.ok(tryIndex > -1, 'the loop body must contain a try block')
    assert.ok(catchIndex > tryIndex, 'the catch must follow the try')

    for (const match of loop.matchAll(/err\.\w+/g)) {
      const at = match.index
      assert.ok(
        at > catchIndex,
        `\`${match[0]}\` at offset ${at} is outside the catch block and would throw ReferenceError`,
      )
    }
  })

  it('keeps the 401 abort inside the catch', () => {
    const loop = migrateSrc.slice(
      migrateSrc.indexOf('for (const project of locals)'),
      migrateSrc.indexOf('if (migrated > 0)'),
    )
    assert.match(loop, /catch \(err\) \{[\s\S]*?err\.status === 401/)
  })

  it('still clears local projects only after a successful migration', () => {
    assert.match(migrateSrc, /if \(migrated > 0\) clearLocalProjects\(\)/)
  })

  it('does not mark migration complete when nothing migrated', () => {
    assert.match(migrateSrc, /if \(locals\.length === 0 \|\| migrated > 0\)/)
  })

  it('distinguishes an unauthorised response from a connectivity failure', () => {
    assert.match(migrateSrc, /source:\s*'unauthorized'/)
    // A 500 or a dropped connection must still fall back to local data.
    assert.match(migrateSrc, /return \{ projects: local, source: 'local' \}/)
  })
})