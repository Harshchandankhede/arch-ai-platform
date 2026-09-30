import { Link } from 'react-router-dom'
import { Award, CircleCheck, GitBranch, Info, Sparkles, TrendingUp, Workflow } from 'lucide-react'
import { useApp } from '../store/AppContext.jsx'
import { useResults } from '../store/useResults.js'
import { dimensionMeta, dimensionOrder } from '../theme/tokens.js'
import {
  Badge,
  Card,
  Empty,
  PageHead,
  RecommendationCard,
  Spinner,
} from '../components/ui.jsx'

const linkBtn =
  'inline-flex items-center gap-2 rounded-[7px] border border-accent bg-accent px-3.5 py-2 text-[13px] font-semibold text-[#1a1206] transition hover:brightness-110'

const SEVERITY_RANK = { high: 3, med: 2, low: 1 }

const PAGE_DESC =
  'These recommendations are generated from the objective evaluation findings produced by the simulation and process mining stages. They read that evidence and explain it in plain language, so they assist your judgement rather than replace it: every claim below is traceable to a number on the Evaluation page, and you remain free to disagree with it. The production system of this project calls the Google Gemini API with the same findings to produce this layer, with the deterministic rules used here as an offline fallback.'

function toPct(value) {
  const v = Number(value)
  if (!Number.isFinite(v)) return 0
  return v <= 1 ? v * 100 : v
}

function rank(severity) {
  return SEVERITY_RANK[severity] || 1
}

function severityTone(severity) {
  if (severity === 'high') return 'red'
  if (severity === 'med') return 'amber'
  return 'blue'
}

export default function Recommendations() {
  const { currentProject } = useApp()
  const { recommendations, evaluation, mining, sim, status, error } = useResults(currentProject?.arch)

  if (!currentProject) {
    return (
      <Card>
        <Empty
          icon={<Sparkles size={26} />}
          title="No project is open."
          hint="Recommendations are written for a specific architecture. Open or create a project first."
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
          eyebrow="Explainable AI Recommendations"
          title={`Recommendations — ${currentProject.name}`}
          desc={PAGE_DESC}
        />
        <Card className="border-red">
          <div className="font-mono text-[12px] text-red">Recommendation error</div>
          <div className="mt-1 text-[13px] text-ink">{error || 'Unknown recommendation failure.'}</div>
        </Card>
      </div>
    )
  }

  if (status === 'running' && !recommendations) {
    return (
      <div>
        <PageHead
          eyebrow="Explainable AI Recommendations"
          title={`Recommendations — ${currentProject.name}`}
          desc={PAGE_DESC}
        />
        <Card>
          <Spinner label="Composing the advisory layer…" />
        </Card>
      </div>
    )
  }

  if (!recommendations) {
    return (
      <div>
        <PageHead
          eyebrow="Explainable AI Recommendations"
          title={`Recommendations — ${currentProject.name}`}
          desc={PAGE_DESC}
        />
        <Card>
          <Empty
            icon={<Sparkles size={26} />}
            title="No recommendations yet."
            hint="The advisor reads simulation and mining findings, so the pipeline needs to run at least once."
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

  const recs = [...recommendations].sort((a, b) => rank(b.severity) - rank(a.severity))
  const dims = evaluation?.dimensions || {}
  const healthScore = Math.round(Number(evaluation?.healthScore) || 0)
  const worst = [...dimensionOrder]
    .map((key) => ({ key, label: dimensionMeta[key]?.label || key, score: Number(dims[key]) || 0 }))
    .sort((a, b) => a.score - b.score)[0]
  const bottleneckCount = (mining?.bottlenecks || []).length
  const deviationCount = (mining?.deviations || []).filter((d) => d && d.type !== 'none').length
  const highCount = recs.filter((r) => r.severity === 'high').length
  const medCount = recs.filter((r) => r.severity === 'med').length
  const lowCount = recs.filter((r) => r.severity !== 'high' && r.severity !== 'med').length
  const metrics = sim?.metrics || {}

  const inputs = [
    {
      icon: <Award size={14} />,
      label: 'Health score',
      value: `${healthScore} / 100`,
      hint: 'Weighted mean of the six evaluation dimensions.',
    },
    {
      icon: <TrendingUp size={14} />,
      label: 'Worst dimension',
      value: `${worst?.label || '—'} (${worst?.score ?? 0})`,
      hint: 'The dimension that most limited the overall score.',
    },
    {
      icon: <Workflow size={14} />,
      label: 'Bottlenecks',
      value: String(bottleneckCount),
      hint: 'Components whose waiting time dominates processing time.',
    },
    {
      icon: <GitBranch size={14} />,
      label: 'Deviations',
      value: String(deviationCount),
      hint: 'Executed traces that the expected model does not predict.',
    },
  ]

  return (
    <div>
      <PageHead
        eyebrow="Explainable AI Recommendations"
        title={`Recommendations — ${currentProject.name}`}
        desc={PAGE_DESC}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone="red">{highCount} high</Badge>
            <Badge tone="amber">{medCount} medium</Badge>
            <Badge tone="blue">{lowCount} low</Badge>
          </div>
        }
      />

      <Card title="Inputs handed to the advisor" sub="The complete evidence set the recommendation layer reasons over." className="mb-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {inputs.map((item) => (
            <div key={item.label} className="rounded-[8px] border border-line-soft bg-raised p-3.5">
              <div className="mb-1.5 flex items-center gap-2 font-mono text-[10.5px] tracking-wider text-ink-faint uppercase">
                <span className="text-accent">{item.icon}</span>
                {item.label}
              </div>
              <div className="font-mono text-[17px] font-semibold text-ink">{item.value}</div>
              <div className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">{item.hint}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-[8px] border border-line-soft bg-raised p-3 text-[12px] text-ink-dim">
          <Info size={13} className="mt-0.5 shrink-0 text-accent" />
          <span>
            The advisor also receives the raw simulation metrics, currently p50{' '}
            {Math.round(Number(metrics.p50) || 0)} ms and p95 {Math.round(Number(metrics.p95) || 0)} ms with a success
            rate of {toPct(metrics.successRate).toFixed(1)}%, so it can cite a measurement rather than a
            qualitative opinion. Nothing is invented: every recommendation below names the finding that triggered it.
          </span>
        </div>
      </Card>

      {recs.length ? (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[2fr_320px]">
          <div>
            {recs.map((rec) => (
              <RecommendationCard key={rec.id} rec={rec} />
            ))}
          </div>

          <div className="space-y-5">
            <Card title="Severity scale" sub="How the advisor ranks urgency.">
              <div className="space-y-2.5">
                {[
                  ['high', 'Directly harms the current objective metrics. Fix before the next review.'],
                  ['med', 'Visible in the evidence but bounded. Schedule it.'],
                  ['low', 'Structural or maintainability improvement. Consider it.'],
                ].map(([sev, text]) => (
                  <div key={sev} className="flex items-start gap-2.5">
                    <Badge tone={severityTone(sev)}>{sev}</Badge>
                    <span className="text-[12.5px] leading-relaxed text-ink-dim">{text}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="How to read these" sub="They are advice, not verdicts.">
              <div className="space-y-2.5 text-[12.5px] leading-relaxed text-ink-dim">
                <p>
                  Each card separates the observed issue, why that issue matters, the proposed change, and the effect
                  expected from making it. Expected impact tags are directional estimates, not measurements.
                </p>
                <p>
                  Applying a change to the architecture and re-running the simulation will produce new evidence, and
                  the advisor will be rewritten from that evidence. Nothing here is persisted, so no recommendation
                  can drift away from the architecture that produced it.
                </p>
              </div>
            </Card>

            <Card title="Reading the volume" sub="How many findings to expect from a healthy design.">
              <div className="flex items-start gap-2.5">
                <CircleCheck size={15} className="mt-0.5 shrink-0 text-green" />
                <p className="text-[12.5px] leading-relaxed text-ink-dim">
                  This architecture produced {recs.length} recommendation{recs.length === 1 ? '' : 's'} from a health
                  score of {healthScore} and {deviationCount} real deviation{deviationCount === 1 ? '' : 's'}. A healthy
                  architecture is expected to yield a short list; a long list is a signal that the simulation workload
                  is undersized rather than that the design is sound.
                </p>
              </div>
            </Card>
          </div>
        </div>
      ) : (
        <Card>
          <Empty
            icon={<CircleCheck size={26} />}
            title="No recommendations were raised."
            hint={`The evaluator found no issue worth flagging on this architecture at a health score of ${healthScore}. Try raising the workload to stress the design further.`}
            action={
              <Link to="/simulation" className={linkBtn}>
                Adjust the workload
              </Link>
            }
          />
        </Card>
      )}
    </div>
  )
}
