import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp, useDispatch } from './AppContext.jsx'
import { archHash } from '../lib/contract.js'

let workerRef = null
let seq = 0

function getWorker() {
  if (typeof Worker === 'undefined') return null
  if (workerRef) return workerRef
  workerRef = new Worker(new URL('../features/simulation/sim.worker.js', import.meta.url), {
    type: 'module',
  })
  return workerRef
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

export function useResults(architecture) {
  const { workload, simCache, notify } = useApp()
  const dispatch = useDispatch()
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)
  const pending = useRef(new Map())
  const startedFor = useRef(null)

  const key = useMemo(() => (architecture ? resultKey(architecture, workload) : null), [architecture, workload])
  const cached = key ? simCache[key] : null

  const run = useCallback(
    (targetKey) => {
      if (!architecture) return
      const k = targetKey || resultKey(architecture, workload)
      setStatus('running')
      setError(null)
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
          .then((sim) => {
            dispatch({ type: 'CACHE_RESULT', key: k, value: { sim } })
            setStatus('done')
          })
          .catch((e) => {
            setError(e.message)
            setStatus('error')
          })
        return
      }

      const id = ++seq
      pending.current.set(id, k)
      worker.postMessage({ id, ...payload })
    },
    [architecture, workload, dispatch],
  )

  useEffect(() => {
    if (!key || cached) return
    if (startedFor.current === key) return
    startedFor.current = key
    run(key)
  }, [key, cached, run])

  useEffect(() => {
    const worker = workerRef
    if (!worker) return undefined
    const onMessage = (event) => {
      const { type, id, payload, message } = event.data || {}
      if (type === 'RESULT') {
        const k = pending.current.get(id)
        if (k) dispatch({ type: 'CACHE_RESULT', key: k, value: payload })
        setStatus('done')
      } else if (type === 'ERROR') {
        setError(message)
        setStatus('error')
        notify(message, 'error')
      }
    }
    worker.addEventListener('message', onMessage)
    return () => worker.removeEventListener('message', onMessage)
  }, [dispatch, notify])

  useEffect(
    () => () => {
      if (workerRef) {
        workerRef.terminate()
        workerRef = null
      }
    },
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
    run: () => run(),
    rerun: () => {
      dispatch({ type: 'CLEAR_CACHE' })
      startedFor.current = null
      run(key)
    },
    ready: Boolean(cached),
  }
}
