import { buildRecommendations } from '../lib/recommendations.js'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

export async function generateRecommendations({ architecture, sim, mining, evaluation }) {
  await wait(180)
  return buildRecommendations(architecture, sim, mining, evaluation)
}
