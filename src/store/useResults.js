import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp, useDispatch } from './AppContext.jsx'
import { archHash, toContract } from '../lib/contract.js'
import { emitNotification } from './notificationSink.js'

// The worker is module-scoped and deliberately outlives any single page. Previously
// it was terminated on unmount, which silently discarded an in-flight run whenever
// the user navigated away mid-simulation.
let workerRef = null
let seq = 0
const pending = new Map()
const listeners = new Set()

let sharedStatus = 'idle'
let sharedError = null

function setSharedStatus(next, error = null) {
  sharedStatus = next
  sharedError = error
  for (const listener of [...listeners]) listener(next, error)
}

function onWorkerMessage(event) {
  const { type, id, payload, message } = event.data || {}
  const key = pending.get(id)
  pending.delete(id)
  if (type === 'RESULT') {
    if (key) cacheSink.current?.({ type: 'CACHE_RESULT', key, value: payload })
    setSharedStatus('done')
    // A run can finish while the user is on another page, or on this one with the tab
    // unfocused. Raising a bell notification means the result is still discoverable
    // instead of silently landing in a cache nobody is looking at.
    emitNotification({
      title: 'Simulation finished',
      body: summariseResult(payload),
      tone: 'ok',
      to: '/simulation',
    })
  } else if (type === 'ERROR') {
    setSharedStatus('error', message)
    notifySink.current?.(message, 'error')
    emitNotification({
      title: 'Simulation failed',
      body: message || 'The engine reported an error.',
      tone: 'error',
      to: '/simulation',
    })
  }
}

/** One line describing what the run produced, for the notification body. */
function summariseResult(payload) {
  const m = payload?.sim?.metrics
  if (!m) return 'The run finished and its results are ready.'
  const health = payload?.evaluation?.healthScore
  const parts = [`${Number(m.totalRequests || 0).toLocaleString()} requests`]
  if (Number.isFinite(Number(health))) parts.push(`health ${Math.round(health)}/100`)
  if (m.p95 !== undefined) parts.push(`p95 ${Math.round(Number(m.p95))} ms`)
  return `${parts.join(' · ')}.`
}

// The reducer dispatch and toast notifier are read at message time, so a result
// that lands while no page is mounted is still written to the store and picked up
// by whichever page mounts next.
const cacheSink = { current: null }
const notifySink = { current: null }

function getWorker() {
  if (typeof Worker === 'undefined') return null
  if (workerRef) return workerRef
  workerRef = new Worker(new URL('../features/simulation/sim.worker.js', import.meta.url), {
    type: 'module',
  })
  workerRef.addEventListener('message', onWorkerMessage)
  return workerRef
}

// The capacity sweep runs the engine dozens of times. Sharing the simulation worker made
// Start Simulation wait behind it, so capacity gets its own worker and can never delay a run.
let capacityWorkerRef = null

function getCapacityWorker() {
  if (typeof Worker === 'undefined') return null
  if (capacityWorkerRef) return capacityWorkerRef
  capacityWorkerRef = new Worker(new URL('../features/simulation/sim.worker.js', import.meta.url), {
    type: 'module',
  })
  return capacityWorkerRef
}

export function resultKey(arch, workload) {
  return [
    archHash(arch),
    workload.mode,
    workload.arrivalRate,
    workload.duration,
    workload.seed,
  ].join('::')
}

export function useResults(architecture, options = {}) {
  const { autoRun = true } = options
  const { workload, simCache, notify } = useApp()
  const dispatch = useDispatch()
  const [status, setStatus] = useState(sharedStatus)
  const [error, setError] = useState(sharedError)
  const startedFor = useRef(null)

  // Sinks are assigned in an effect rather than during render so the module-level
  // values are only written as a side effect, not mutated while rendering.
  useEffect(() => {
    cacheSink.current = dispatch
    notifySink.current = notify
  }, [dispatch, notify])

  const key = useMemo(() => (architecture ? resultKey(architecture, workload) : null), [architecture, workload])
  const cached = key ? simCache[key] : null

  const run = useCallback(
    (targetKey) => {
      if (!architecture) return
      const k = targetKey || resultKey(architecture, workload)
      setStatus('running')
      setError(null)
      setSharedStatus('running')
      const worker = getWorker()
      const payload = {
        architecture,
        workload: {
          arrivalRate: workload.arrivalRate,
          duration: workload.duration,
          seed: workload.seed,
        },
        options: { maxLoggedCases: 400 },
      }

      if (!worker) {
        import('../lib/engine.js')
          .then(({ runSimulation }) => runSimulation(payload.architecture, payload.workload, payload.options))
          .then(async (sim) => {
            const [{ mineEventLog, miningOptions }, { evaluateArchitecture }, { buildRecommendations }] =
              await Promise.all([
                import('../lib/mining.js'),
                import('../lib/evaluation.js'),
                import('../lib/recommendations.js'),
              ])
            const contract = toContract(payload.architecture)
            const mining = mineEventLog(sim.eventLog, contract, miningOptions(sim))
            const evaluation = evaluateArchitecture(contract, sim, mining)
            const recommendations = buildRecommendations(contract, sim, mining, evaluation)
            dispatch({ type: 'CACHE_RESULT', key: k, value: { sim, mining, evaluation, recommendations } })
            setStatus('done')
            setSharedStatus('done')
          })
          .catch((e) => {
            setError(e.message)
            setStatus('error')
            setSharedStatus('error', e.message)
          })
        return
      }

      const id = ++seq
      pending.set(id, k)
      worker.postMessage({ id, ...payload })
    },
    [architecture, workload, dispatch],
  )

  // Keep this hook's local state aligned with a run that started on another page.
  useEffect(() => {
    const listener = (next, nextError) => {
      setStatus(next)
      setError(nextError)
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  useEffect(() => {
    if (!autoRun) return
    if (!key || cached) return
    if (startedFor.current === key) return
    startedFor.current = key
    run(key)
  }, [autoRun, key, cached, run])

  const start = useCallback(() => {
    startedFor.current = key
    run(key)
  }, [key, run])

  // Capacity sweeps the DES engine many times, so it runs on its own worker. It answers
  // with a different message type and must not disturb the simulation status.
  const runCapacity = useCallback(
    (targetArch, options) =>
      new Promise((resolve, reject) => {
        const worker = getCapacityWorker()
        if (!worker) {
          import('../lib/capacity.js')
            .then(({ analyzeCapacity }) => resolve(analyzeCapacity(targetArch, options)))
            .catch(reject)
          return
        }
        const id = ++seq
        const onMessage = (event) => {
          const data = event.data || {}
          if (data.id !== id) return
          worker.removeEventListener('message', onMessage)
          if (data.type === 'CAPACITY') resolve(data.payload)
          else reject(new Error(data.message || 'Capacity analysis failed.'))
        }
        worker.addEventListener('message', onMessage)
        worker.postMessage({ id, kind: 'CAPACITY', architecture: targetArch, options })
      }),
    [],
  )

  return {
    key,
    sim: cached?.sim || null,
    mining: cached?.mining || null,
    evaluation: cached?.evaluation || null,
    recommendations: cached?.recommendations || null,
    status: cached ? 'done' : status,
    error,
    run: start,
    rerun: start,
    runCapacity,
    ready: Boolean(cached),
  }
}
