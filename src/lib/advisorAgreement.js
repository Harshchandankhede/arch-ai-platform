import { dimensionMeta } from '../theme/tokens.js'

/**
 * Compares the deterministic rule-based advisor against the Gemini advisor over the
 * same evaluation evidence. This is the measurement the two-arm comparison reports, so
 * it is kept pure and dependency-free: no React, no network, no clock.
 */

const SEVERITY_RANK = { high: 3, med: 2, low: 1 }

const pct = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 10 : null)

function dimensionSet(items) {
  const set = new Set()
  for (const item of Array.isArray(items) ? items : []) {
    const key = item?.dimension
    if (typeof key === 'string' && key) set.add(key)
  }
  return set
}

function intersect(a, b) {
  return [...a].filter((k) => b.has(k))
}

function subtract(a, b) {
  return [...a].filter((k) => !b.has(k))
}

/** Ranks 1..n with ties resolved to the average rank, so tied severities get equal weight. */
function averageRanks(values) {
  const order = values.map((v, i) => ({ v, i }))
  order.sort((a, b) => a.v - b.v)
  const ranks = new Array(values.length)
  let i = 0
  while (i < order.length) {
    let j = i
    while (j + 1 < order.length && order[j + 1].v === order[i].v) j += 1
    const average = (i + j) / 2 + 1
    for (let k = i; k <= j; k += 1) ranks[order[k].i] = average
    i = j + 1
  }
  return ranks
}

/**
 * Spearman rank correlation over the dimensions both arms flagged, using the reported
 * severity as the rank. Returns null when there is too little overlap to be meaningful,
 * because a correlation over one or two shared items is noise, not a finding.
 */
export function severityCorrelation(baseline, gemini) {
  const base = new Map((Array.isArray(baseline) ? baseline : []).map((i) => [i?.dimension, i?.severity]))
  const gen = new Map((Array.isArray(gemini) ? gemini : []).map((i) => [i?.dimension, i?.severity]))
  const shared = intersect(new Set(base.keys()), new Set(gen.keys())).filter((k) => base.get(k) && gen.get(k))

  if (shared.length < 3) return null

  const pairs = shared.map((key) => [SEVERITY_RANK[base.get(key)] || 0, SEVERITY_RANK[gen.get(key)] || 0])
  const rx = averageRanks(pairs.map((p) => p[0]))
  const ry = averageRanks(pairs.map((p) => p[1]))

  const n = rx.length
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length
  const mx = mean(rx)
  const my = mean(ry)

  let num = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i += 1) {
    const a = rx[i] - mx
    const b = ry[i] - my
    num += a * b
    dx += a * a
    dy += b * b
  }
  // Zero variance on one side means every shared item had the same severity, which
  // leaves the correlation undefined rather than zero.
  if (dx === 0 || dy === 0) return null
  return Math.round((num / Math.sqrt(dx * dy)) * 1000) / 1000
}

export function computeAgreement(baseline, gemini) {
  const base = Array.isArray(baseline) ? baseline : []
  const gen = Array.isArray(gemini) ? gemini : []

  const baseDims = dimensionSet(base)
  const genDims = dimensionSet(gen)
  const shared = intersect(baseDims, genDims)
  const union = new Set([...baseDims, ...genDims])

  const baseMap = new Map(base.map((i) => [i?.dimension, i?.severity]))
  const genMap = new Map(gen.map((i) => [i?.dimension, i?.severity]))
  const severityMatches = shared.filter((k) => baseMap.get(k) === genMap.get(k)).length

  const recall = baseDims.size ? shared.length / baseDims.size : null
  const precision = genDims.size ? shared.length / genDims.size : null
  const jaccard = union.size ? shared.length / union.size : null

  return {
    baselineCount: base.length,
    geminiCount: gen.length,
    baselineDimensions: [...baseDims],
    geminiDimensions: [...genDims],
    sharedDimensions: shared,
    onlyBaseline: subtract(baseDims, genDims),
    onlyGemini: subtract(genDims, baseDims),
    sharedCount: shared.length,
    unionCount: union.size,
    recall: pct(recall),
    precision: pct(precision),
    jaccard: pct(jaccard),
    severityAgreement: shared.length ? pct(severityMatches / shared.length) : null,
    severityCorrelation: severityCorrelation(base, gen),
  }
}

/**
 * Plain-language reading of the numbers. Kept beside the maths so the UI cannot drift
 * into describing a score the data does not support.
 */
export function describeAgreement(agreement) {
  if (!agreement || !agreement.unionCount) return 'No comparison available.'
  const { sharedCount, unionCount, onlyGemini, onlyBaseline } = agreement

  if (sharedCount === unionCount) {
    return `Both advisors raised the same ${sharedCount} dimension${sharedCount === 1 ? '' : 's'}.`
  }
  if (sharedCount === 0) {
    return 'The two advisors flagged no dimension in common.'
  }

  const parts = [
    `The two advisors agreed on ${sharedCount} of ${unionCount} dimension${unionCount === 1 ? '' : 's'}.`,
  ]
  if (onlyGemini.length) {
    parts.push(
      `Gemini raised ${onlyGemini.map((k) => dimensionMeta[k]?.label || k).join(', ')}, which the rules did not.`,
    )
  }
  if (onlyBaseline.length) {
    parts.push(
      `The rules raised ${onlyBaseline.map((k) => dimensionMeta[k]?.label || k).join(', ')}, which Gemini did not.`,
    )
  }
  return parts.join(' ')
}