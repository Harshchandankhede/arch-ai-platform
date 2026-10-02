import { toContract } from '../../lib/contract.js'
import { runSimulation } from '../../lib/engine.js'
import { mineEventLog, miningOptions } from '../../lib/mining.js'
import { evaluateArchitecture } from '../../lib/evaluation.js'
import { buildRecommendations } from '../../lib/recommendations.js'
import { analyzeCapacity } from '../../lib/capacity.js'

// Two jobs: the full simulation pipeline, and the capacity sweep. The sweep runs the DES
// engine ~20 times, so it lives here rather than on the main thread.

function simulate({ architecture, workload, options }) {
  const contract = toContract(architecture)
  const sim = runSimulation(contract, workload, options)
  const mining = mineEventLog(sim.eventLog, contract, miningOptions(sim))
  const evaluation = evaluateArchitecture(contract, sim, mining)
  const recommendations = buildRecommendations(contract, sim, mining, evaluation)
  return { sim, mining, evaluation, recommendations }
}

self.onmessage = (event) => {
  const message = event.data || {}
  const { id, kind } = message
  if (!id) return

  try {
    if (kind === 'CAPACITY') {
      const capacity = analyzeCapacity(message.architecture, message.options)
      self.postMessage({ type: 'CAPACITY', id, payload: capacity })
      return
    }

    const { architecture, workload, options } = message
    const payload = simulate({ architecture, workload, options })
    self.postMessage({ type: 'RESULT', id, payload })
  } catch (error) {
    self.postMessage({
      type: 'ERROR',
      id,
      message: error?.message || 'Simulation failed.',
      kind: kind || 'SIMULATE',
    })
  }
}