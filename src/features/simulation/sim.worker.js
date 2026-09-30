import { toContract } from '../../lib/contract.js'
import { runSimulation } from '../../lib/engine.js'
import { mineEventLog } from '../../lib/mining.js'
import { evaluateArchitecture } from '../../lib/evaluation.js'
import { buildRecommendations } from '../../lib/recommendations.js'

self.onmessage = (event) => {
  const { id, architecture, workload, options } = event.data || {}
  if (!id) return
  try {
    const contract = toContract(architecture)
    const sim = runSimulation(contract, workload, options)
    const mining = mineEventLog(sim.eventLog, contract)
    const evaluation = evaluateArchitecture(contract, sim, mining)
    const recommendations = buildRecommendations(contract, sim, mining, evaluation)
    self.postMessage({ type: 'RESULT', id, payload: { sim, mining, evaluation, recommendations } })
  } catch (error) {
    self.postMessage({ type: 'ERROR', id, message: error?.message || 'Simulation failed.' })
  }
}
