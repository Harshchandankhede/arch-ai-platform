/**
 * Coalescing writer for autosaved project architectures.
 *
 * Deliberately dependency-free and free of any `services/` import: `api.js` reads
 * `import.meta.env`, which does not exist under bare Node, so a writer living behind
 * that import cannot be unit tested. Injecting `update` keeps this module pure and lets
 * the caller decide how the write actually reaches the server.
 */

/**
 * @param {object}   options
 * @param {Function} options.update      Required. Performs one write, e.g. ({ id, patch }) => Promise.
 * @param {Function} [options.onError]   Called as (err, { id }) when a write rejects.
 * @param {Function} [options.canWrite]  Returns false for ids the server cannot resolve.
 */
export function createProjectArchWriter({ update, onError, canWrite = () => true } = {}) {
  if (typeof update !== 'function') {
    throw new TypeError('createProjectArchWriter requires an update function')
  }

  let inFlight = false
  let queued = null

  async function send(id, arch) {
    try {
      await update({ id, patch: { arch } })
    } catch (err) {
      // A rejected write must not be swallowed: the canvas would otherwise claim to be
      // saved while the server still holds the previous architecture.
      if (onError) onError(err, { id })
    } finally {
      // Reset before draining the queue so a write enqueued by onError still gets a slot.
      inFlight = false
      if (queued) {
        const next = queued
        queued = null
        void send(next.id, next.arch)
      }
    }
  }

  return function writeArch(id, arch) {
    if (!canWrite(id)) return Promise.resolve()
    // Only one request in flight at a time. Further edits overwrite the pending payload:
    // intermediate architectures are already superseded by the time it is sent.
    if (inFlight) {
      queued = { id, arch }
      return Promise.resolve()
    }
    inFlight = true
    return send(id, arch)
  }
}