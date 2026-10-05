import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createProjectArchWriter } from '../src/lib/archWriter.js'

const ID = 'a'.repeat(24)
// Mirrors isServerProjectId in services/projects.js: Mongo ObjectIds only.
const canWrite = (id) => /^[a-fA-F0-9]{24}$/.test(String(id || ''))

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))

describe('project id guard', () => {
  it('accepts Mongo ObjectIds and rejects local ids', () => {
    assert.equal(canWrite(ID), true)
    assert.equal(canWrite('p1'), false)
    assert.equal(canWrite(''), false)
    assert.equal(canWrite(null), false)
    assert.equal(canWrite(undefined), false)
  })
})

describe('autosave writer', () => {
  it('skips ids the server cannot resolve instead of issuing a doomed PUT', async () => {
    const calls = []
    const write = createProjectArchWriter({ canWrite, update: (a) => { calls.push(a); return Promise.resolve() } })
    write('p1', { nodes: [], edges: [] })
    await tick()
    assert.equal(calls.length, 0, 'short ids must not be sent')
  })

  it('sends a PUT for a server-backed project', async () => {
    const calls = []
    const write = createProjectArchWriter({ canWrite, update: (a) => { calls.push(a); return Promise.resolve() } })
    write(ID, { nodes: [{ id: 'n1' }], edges: [] })
    await tick()
    assert.equal(calls.length, 1)
    assert.equal(calls[0].id, ID)
    assert.deepEqual(calls[0].patch.arch, { nodes: [{ id: 'n1' }], edges: [] })
  })

  it('coalesces a burst of edits into one in-flight request plus a single trailing send', async () => {
    const calls = []
    let release
    const gate = new Promise((r) => { release = r })
    const write = createProjectArchWriter({ canWrite, update: (a) => { calls.push(a); return gate } })

    write(ID, { nodes: [{ id: 'a' }], edges: [] })
    write(ID, { nodes: [{ id: 'b' }], edges: [] })
    write(ID, { nodes: [{ id: 'c' }], edges: [] })
    write(ID, { nodes: [{ id: 'd' }], edges: [] })
    await tick()
    assert.equal(calls.length, 1, 'only one request may be in flight')

    release()
    await tick()
    await tick()
    // b and c were superseded before the first request completed, so only the newest
    // payload (d) needs a follow-up request.
    assert.equal(calls.length, 2)
    assert.deepEqual(calls[1].patch.arch, { nodes: [{ id: 'd' }], edges: [] })
  })

  it('persists the newest architecture when responses arrive out of order', async () => {
    const written = []
    const resolvers = []
    const write = createProjectArchWriter({
      canWrite,
      update: (a) => {
        written.push(a)
        return new Promise((r) => resolvers.push(r))
      },
    })

    write(ID, { nodes: [{ id: 'old' }], edges: [] })
    await tick()
    write(ID, { nodes: [{ id: 'new' }], edges: [] })
    await tick()

    // The trailing request starts only after the first settles, so resolve them in order.
    resolvers[0]()
    await tick()
    await tick()
    resolvers[1]()
    await tick()

    const last = written[written.length - 1]
    assert.deepEqual(last.patch.arch, { nodes: [{ id: 'new' }], edges: [] },
      'the final persisted payload must be the newest edit')
  })

  it('reports a failed save rather than leaving the canvas claiming it is saved', async () => {
    const errors = []
    const write = createProjectArchWriter({
      canWrite,
      update: () => Promise.reject(new Error('boom')),
      onError: (err) => errors.push(err.message),
    })
    write(ID, { nodes: [], edges: [] })
    await tick()
    await tick()
    assert.deepEqual(errors, ['boom'])
  })

  it('recovers after a failure so a later edit still saves', async () => {
    const errors = []
    const calls = []
    let failNext = true
    const write = createProjectArchWriter({
      canWrite,
      update: (a) => {
        calls.push(a)
        if (failNext) {
          failNext = false
          return Promise.reject(new Error('boom'))
        }
        return Promise.resolve()
      },
      onError: () => errors.push('err'),
    })

    write(ID, { nodes: [{ id: '1' }], edges: [] })
    await tick()
    await tick()
    write(ID, { nodes: [{ id: '2' }], edges: [] })
    await tick()
    await tick()

    assert.equal(errors.length, 1)
    assert.equal(calls.length, 2)
    assert.deepEqual(calls[1].patch.arch, { nodes: [{ id: '2' }], edges: [] })
  })

  it('keeps sending after an error rather than wedging the queue', async () => {
    const calls = []
    const write = createProjectArchWriter({
      canWrite,
      update: (a) => { calls.push(a); return Promise.reject(new Error('nope')) },
      onError: () => {},
    })
    write(ID, { nodes: [{ id: '1' }], edges: [] })
    write(ID, { nodes: [{ id: '2' }], edges: [] })
    await tick()
    await tick()
    await tick()
    assert.equal(calls.length, 2, 'the queued write must still be attempted after a failure')
  })
})