/**
 * A one-way channel from the simulation runner to the app's notification list.
 *
 * It lives in its own module on purpose. useResults already imports from AppContext, so
 * having AppContext import a sink back out of useResults closed a cycle
 * (AppContext -> useResults -> AppContext). Beyond being fragile, a cycle means the two
 * modules can observe each other mid-evaluation, and the app root ended up re-running
 * session hydration far more often than it should.
 *
 * A standalone module with no imports has no such problem.
 */

let sink = null

/** Register who receives notifications. Pass null to detach. */
export function setNotificationSink(fn) {
  sink = typeof fn === 'function' ? fn : null
}

/** Raise a notification, if anyone is listening. */
export function emitNotification(notification) {
  if (sink) sink(notification)
}