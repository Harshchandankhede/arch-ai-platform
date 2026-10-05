import { Link } from 'react-router-dom'
import { Award, Gauge as GaugeIcon, GitBranch, ShieldCheck, Workflow } from 'lucide-react'
import { useApp } from '../store/AppContext.jsx'
import { useResults } from '../store/useResults.js'
import { useCountUp } from '../lib/useCountUp.js'
import { dimensionMeta, dimensionOrder, scoreColor } from '../theme/tokens.js'
import {
  Badge,
  Card,
  Empty,
  Gauge,
  PageHead,
  Spinner,
  UtilBar,
} from '../components/ui.jsx'
import { HealthRadar } from '../components/charts.jsx'

const linkBtn =
  'inline-flex items-center gap-2 rounded-[7px] border border-accent bg-accent px-3.5 py-2 text-[13px] font-semibold text-[#1a1206] transition hover:brightness-110'

const PAGE_DESC =
  'Six weighted dimensions are scored from objective simulation and mining evidence, then combined into a single health score. The table below is the full derivation, not a summary.'

function toPct(value) {
  const v = Number(value)
  if (!Number.isFinite(v)) return 0
  return v <= 1 ? v * 100 : v
}

function grade(score) {
  if (score >= 75) return { label: 'Healthy', tone: 'green' }
  if (score >= 55) return { label: 'Acceptable', tone: 'amber' }
  return { label: 'Needs work', tone: 'red' }
}

export default function Evaluation() {
  const { currentProject } = useApp()
  const { evaluation, mining, sim, status, error } = useResults(currentProject?.arch)

  // Sweeps up to the score like the old speedometer needle did. The number is the answer
  // here, so the number itself is what moves. Declared at the top of the component, before
  // the early returns, because a hook called after one would be conditional.
  const scoreRef = useCountUp(evaluation ? Math.round(Number(evaluation.healthScore) || 0) : 0)

  if (!currentProject) {
    return (
      <Card>
        <Empty
          icon={<Award size={26} />}
          title="No project is open."
          hint="Evaluation scores an architecture, so open or create a project first."
          action={
            <Link to="/projects" className={linkBtn}>
              Go to My Projects
            </Link>
          }
        />
      </Card>
    )
  }

  if (status === 'error') {
    return (
      <div>
        <PageHead
          eyebrow="Evaluation & Health Score"
          title={`Evaluation — ${currentProject.name}`}
          desc={PAGE_DESC}
        />
        <Card className="border-red">
          <div className="font-mono text-[12px] text-red">Evaluation error</div>
          <div className="mt-1 text-[13px] text-ink">{error || 'Unknown evaluation failure.'}</div>
        </Card>
      </div>
    )
  }

  if (status === 'running' && !evaluation) {
    return (
      <div>
        <PageHead
          eyebrow="Evaluation & Health Score"
          title={`Evaluation — ${currentProject.name}`}
          desc={PAGE_DESC}
        />
        <Card>
          <Spinner label="Scoring the six dimensions…" />
        </Card>
      </div>
    )
  }

  if (!evaluation) {
    return (
      <div>
        <PageHead
          eyebrow="Evaluation & Health Score"
          title={`Evaluation — ${currentProject.name}`}
          desc={PAGE_DESC}
        />
        <Card>
          <Empty
            icon={<Award size={26} />}
            title="No evaluation available yet."
            hint="The health score is derived from simulation metrics and mined traces. Run the simulation first."
            action={
              <Link to="/simulation" className={linkBtn}>
                Go to Simulation
              </Link>
            }
          />
        </Card>
      </div>
    )
  }

  const dims = evaluation.dimensions || {}
  const weights = evaluation.weights || {}
  const notes = evaluation.notes || {}
  const healthScore = Math.round(Number(evaluation.healthScore) || 0)
  const verdict = grade(healthScore)
  const byScoreAsc = [...dimensionOrder].sort((a, b) => (Number(dims[a]) || 0) - (Number(dims[b]) || 0))
  const weakest = byScoreAsc[0]
  const strongest = byScoreAsc[byScoreAsc.length - 1]

  const rows = dimensionOrder.map((key) => {
    const meta = dimensionMeta[key] || { label: key, weight: 0 }
    const weight = Number(weights[key] ?? meta.weight) || 0
    const score = Math.round(Number(dims[key]) || 0)
    return {
      key,
      label: meta.label,
      weight,
      score,
      contribution: score * weight,
      note: notes[key] || 'No note was produced for this dimension.',
    }
  })
  const weightTotal = rows.reduce((sum, r) => sum + r.weight, 0)
  const contributionTotal = rows.reduce((sum, r) => sum + r.contribution, 0)

  const metrics = sim?.metrics || {}
  const bottleneckCount = (mining?.bottlenecks || []).length
  const deviationCount = (mining?.deviations || []).filter((d) => d && d.type !== 'none').length
  const nodes = currentProject.arch?.nodes || []
  const edges = currentProject.arch?.edges || []

  const inputs = [
    {
      icon: <Workflow size={14} />,
      title: 'Architecture',
      detail: `${nodes.length} nodes and ${edges.length} edges. Node category, replica count, security placement and tier depth drive the structural dimensions.`,
    },
    {
      icon: <GaugeIcon size={14} />,
      title: 'Simulation metrics',
      detail: `Latency percentiles, success rate ${toPct(metrics.successRate).toFixed(1)}%, throughput ${(Number(metrics.throughputPerSec) || 0).toFixed(1)} req/s, peak utilisation, dropped and failed requests.`,
    },
    {
      icon: <GitBranch size={14} />,
      title: 'Process mining findings',
      detail: `${bottleneckCount} bottleneck(s) and ${deviationCount} real deviation(s) recovered from the event log, together with case conformance and mean waiting time.`,
    },
    {
      icon: <ShieldCheck size={14} />,
      title: 'Rule checks',
      detail: 'Deterministic structural rules covering authentication and firewall presence, redundancy, caching and single points of failure.',
    },
  ]

  return (
    <div>
      <PageHead
        eyebrow="Evaluation & Health Score"
        title={`Evaluation — ${currentProject.name}`}
        desc={PAGE_DESC}
        actions={<Badge tone={verdict.tone}>{verdict.label}</Badge>}
      />

      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* `items-start` was dropped from this grid: it left the shorter card floating at its
            own height with a large dead gap underneath while its neighbour ran taller.
            Default stretch makes both cards the same height. */}
        <Card
          title="Health Score"
          sub="Weighted mean of the six dimension scores."
          className="flex flex-col"
          bodyClass="flex flex-1 flex-col p-5"
        >
          <div className="flex flex-1 items-center justify-center">
            {/* The speedometer sweep and the number are driven by the same easing, so the
                arc and the figure arrive together. */}
            <Gauge score={healthScore} size={280} label="">
              <span
                ref={scoreRef}
                className="font-mono text-[46px] leading-none font-bold tabular-nums"
                style={{ color: scoreColor(healthScore) }}
              >
                {healthScore}
              </span>
              <span className="mt-1 block font-mono text-[10.5px] tracking-wider text-ink-faint uppercase">
                out of 100 · {verdict.label}
              </span>
            </Gauge>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-[8px] border border-line-soft bg-raised p-3">
              <div className="mb-1 font-mono text-[10.5px] tracking-wider text-ink-faint uppercase">
                Strongest dimension
              </div>
              <div className="text-[13px] text-ink">{dimensionMeta[strongest]?.label || '—'}</div>
              <div className="font-mono text-[15px] text-green">{Math.round(Number(dims[strongest]) || 0)}/100</div>
            </div>
            <div className="rounded-[8px] border border-line-soft bg-raised p-3">
              <div className="mb-1 font-mono text-[10.5px] tracking-wider text-ink-faint uppercase">
                Weakest dimension
              </div>
              <div className="text-[13px] text-ink">{dimensionMeta[weakest]?.label || '—'}</div>
              <div className="font-mono text-[15px] text-red">{Math.round(Number(dims[weakest]) || 0)}/100</div>
            </div>
          </div>
        </Card>

        <Card title="Dimension profile" sub="Same six scores, plotted as a radar.">
          <HealthRadar evaluation={evaluation} height={300} />
        </Card>
      </div>

      <Card
        title="How the health score is produced"
        sub="Every dimension, its weight, its score, its contribution and the sentence that justifies it."
        className="mb-5"
      >
        <div className="mb-4 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {['Dimension', 'Weight', 'Score', 'Meter', 'Weighted', 'Justification'].map((h) => (
                  <th
                    key={h}
                    className="px-2.5 pb-2.5 text-left font-mono text-[10.5px] font-semibold tracking-wide text-ink-faint uppercase"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="align-top hover:bg-white/[0.015]">
                  <td className="border-t border-line-soft px-2.5 py-2.5 text-[13px] whitespace-nowrap">
                    {r.label}
                  </td>
                  <td className="border-t border-line-soft px-2.5 py-2.5 font-mono text-[12.5px] whitespace-nowrap">
                    {toPct(r.weight).toFixed(0)}%
                  </td>
                  <td
                    className="border-t border-line-soft px-2.5 py-2.5 font-mono text-[12.5px] whitespace-nowrap"
                    style={{ color: scoreColor(r.score) }}
                  >
                    {r.score}/100
                  </td>
                  <td className="w-[150px] border-t border-line-soft px-2.5 py-2.5">
                    <div className="mb-0">
                      <UtilBar value={r.score} label="" right="" />
                    </div>
                  </td>
                  <td className="border-t border-line-soft px-2.5 py-2.5 font-mono text-[12.5px] whitespace-nowrap text-ink-dim">
                    {r.score} x {r.weight.toFixed(2)} = {r.contribution.toFixed(2)}
                  </td>
                  <td className="border-t border-line-soft px-2.5 py-2.5 text-[12.5px] leading-relaxed text-ink-dim">
                    {r.note}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="border-t border-line px-2.5 py-2.5 font-mono text-[12px] text-ink-faint uppercase">
                  Total
                </td>
                <td className="border-t border-line px-2.5 py-2.5 font-mono text-[12.5px] text-ink">
                  {toPct(weightTotal).toFixed(0)}%
                </td>
                <td className="border-t border-line px-2.5 py-2.5 font-mono text-[12.5px] text-ink-faint">—</td>
                <td className="border-t border-line px-2.5 py-2.5" />
                <td className="border-t border-line px-2.5 py-2.5 font-mono text-[12.5px] text-ink">
                  {contributionTotal.toFixed(2)}
                </td>
                <td className="border-t border-line px-2.5 py-2.5 text-[12.5px] text-ink-dim">
                  Sum of the weighted contributions listed above.
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <Card title="Where this came from" sub="The four inputs the evaluator reads.">
          <div className="space-y-3">
            {inputs.map((item) => (
              <div key={item.title} className="flex gap-3 rounded-[8px] border border-line-soft bg-raised p-3">
                <span className="mt-0.5 shrink-0 text-accent">{item.icon}</span>
                <div>
                  <div className="text-[13px] font-semibold text-ink">{item.title}</div>
                  <div className="mt-0.5 text-[12.5px] leading-relaxed text-ink-dim">{item.detail}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3.5 border-t border-line-soft pt-3 text-[12px] text-ink-faint">
            Weights are normalised to sum to 1.00; the current set sums to{' '}
            {toPct(weightTotal).toFixed(0)}%. Dimension scores are integers on a 0 to 100
            scale produced by deterministic thresholded checks, not by a model.
          </div>
        </Card>
    </div>
  )
}
