import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Award, CircleCheck, GitBranch, Info, Sparkles, TrendingUp, Workflow } from 'lucide-react'
import { useApp } from '../store/AppContext.jsx'
import { useResults } from '../store/useResults.js'
import { dimensionMeta, dimensionOrder } from '../theme/tokens.js'
import { computeAgreement, describeAgreement } from '../lib/advisorAgreement.js'
import { getAdvisorStatus, requestGeminiRecommendations } from '../services/advisor.js'
import {
  Badge,
  Button,
  Card,
  Empty,
  PageHead,
  RecommendationCard,
  Spinner,
} from '../components/ui.jsx'

const linkBtn =
  'inline-flex items-center gap-2 rounded-[7px] border border-accent bg-accent px-3.5 py-2 text-[13px] font-semibold text-[#1a1206] transition hover:brightness-110'

const SEVERITY_RANK = { high: 3, med: 2, low: 1 }
const PAGE_EYEBROW = 'Architecture Advisor'

// Describes what the page actually does. The previous copy claimed Gemini generated
// these recommendations, but no model was ever called: every card came from
// src/lib/recommendations.js. Gemini is now a real, separately-labelled second arm.
const PAGE_DESC =
  'Two independent advisors read the same simulation, mining and evaluation evidence. The baseline is a set of deterministic rules that run entirely in this browser tab, so its output is identical on every machine and every run. The Gemini arm sends the same evidence to the Google Gemini API through this project’s own backend and returns a second opinion. Comparing them shows where a language model adds judgement and where it simply restates the numbers.'

/** Assembles the evidence payload. Only measured fields are sent; nothing is inferred. */
function buildEvidence({ evaluation, mining, sim, arch }) {
  return {
    healthScore: Number(evaluation?.healthScore) || 0,
    dimensions: evaluation?.dimensions || {},
    metrics: sim?.metrics || {},
    bottlenecks: mining?.bottlenecks || [],
    deviations: mining?.deviations || [],
    nodeCount: Array.isArray(arch?.nodes) ? arch.nodes.length : 0,
  }
}

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

function sorted(list) {
  return [...(list || [])].sort((a, b) => rank(b.severity) - rank(a.severity))
}

function AgreementMetrics({ agreement }) {
  const show = (value, suffix = '') => (value === null || value === undefined ? 'n/a' : `${value}${suffix}`)
  const rows = [
    ['Dimensions in common', `${agreement.sharedCount} of ${agreement.unionCount}`],
    ['Jaccard overlap', show(agreement.jaccard, '%')],
    ['Severity agreement', show(agreement.severityAgreement, '%')],
    [
      'Severity rank correlation',
      agreement.severityCorrelation === null ? 'n/a (needs 3+ shared)' : agreement.severityCorrelation.toFixed(3),
    ],
  ]
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded-[8px] border border-line-soft bg-raised p-3">
          <div className="mb-1 font-mono text-[10px] tracking-wider text-ink-faint uppercase">{label}</div>
          <div className="font-mono text-[16px] font-semibold text-ink">{value}</div>
        </div>
      ))}
    </div>
  )
}

export default function Recommendations() {
  const { currentProject } = useApp()
  const { recommendations, evaluation, mining, sim, status, error } = useResults(currentProject?.arch)

  const [advisor, setAdvisor] = useState({ state: 'idle', recommendations: null, error: null, model: null })

  // Availability is a cheap authenticated GET, so it is safe to run on mount. The
  // generation call is not: it spends paid quota and stays behind an explicit click.
  useEffect(() => {
    let active = true
    getAdvisorStatus()
      .then((info) => {
        if (!active) return
        setAdvisor((prev) => ({
          ...prev,
          state: info.configured ? 'ready' : 'unconfigured',
          model: info.model || null,
        }))
      })
      .catch(() => {
        if (active) setAdvisor((prev) => ({ ...prev, state: 'unavailable' }))
      })
    return () => {
      active = false
    }
  }, [])

  const evidence = useMemo(
    () => buildEvidence({ evaluation, mining, sim, arch: currentProject?.arch }),
    [evaluation, mining, sim, currentProject?.arch],
  )

  const askGemini = useCallback(async () => {
    setAdvisor((prev) => ({ ...prev, state: 'loading', error: null }))
    try {
      const result = await requestGeminiRecommendations(evidence)
      setAdvisor({
        state: 'done',
        recommendations: result.recommendations || [],
        error: null,
        model: result.model || null,
      })
    } catch (err) {
      setAdvisor((prev) => ({ ...prev, state: 'error', error: err.message || 'The advisor request failed.' }))
    }
  }, [evidence])

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
        <PageHead eyebrow={PAGE_EYEBROW} title={`Recommendations — ${currentProject.name}`} desc={PAGE_DESC} />
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
        <PageHead eyebrow={PAGE_EYEBROW} title={`Recommendations — ${currentProject.name}`} desc={PAGE_DESC} />
        <Card>
          <Spinner label="Composing the advisory layer…" />
        </Card>
      </div>
    )
  }

  if (!recommendations) {
    return (
      <div>
        <PageHead eyebrow={PAGE_EYEBROW} title={`Recommendations — ${currentProject.name}`} desc={PAGE_DESC} />
        <Card>
          <Empty
            icon={<Sparkles size={26} />}
            title="No recommendations yet."
            hint="The advisors read simulation and mining findings, so the pipeline needs to run at least once."
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

  const baseline = sorted(recommendations)
  const geminiRecs = advisor.recommendations ? sorted(advisor.recommendations) : null
  const agreement = geminiRecs ? computeAgreement(recommendations, advisor.recommendations) : null

  const dims = evaluation?.dimensions || {}
  const healthScore = Math.round(Number(evaluation?.healthScore) || 0)
  const worst = [...dimensionOrder]
    .map((key) => ({ key, label: dimensionMeta[key]?.label || key, score: Number(dims[key]) || 0 }))
    .sort((a, b) => a.score - b.score)[0]
  const bottleneckCount = (mining?.bottlenecks || []).length
  const deviationCount = (mining?.deviations || []).filter((d) => d && d.type !== 'none').length
  const highCount = baseline.filter((r) => r.severity === 'high').length
  const medCount = baseline.filter((r) => r.severity === 'med').length
  const lowCount = baseline.length - highCount - medCount
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
        eyebrow={PAGE_EYEBROW}
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

      <Card
        title="Evidence handed to both advisors"
        sub="The identical measurement set each advisor reasons over."
        className="mb-5"
      >
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
            Both advisors also receive the raw simulation metrics, currently p{' '}
            {Math.round(Number(metrics.p50) || 0)} ms and p95 {Math.round(Number(metrics.p95) || 0)} ms with a
            success rate of {toPct(metrics.successRate).toFixed(1)}%. The baseline cites a measurement for every
            claim it makes, because each rule is generated directly from the numbers it fires on.
          </span>
        </div>
      </Card>

      <Card
        title="Advisor comparison"
        sub="The baseline runs locally and deterministically; Gemini runs server-side."
        className="mb-5"
        actions={
          <Button
            onClick={askGemini}
            disabled={advisor.state === 'loading' || advisor.state === 'unconfigured'}
            icon={<Sparkles size={14} />}
          >
            {advisor.state === 'loading' ? 'Asking Gemini…' : geminiRecs ? 'Ask Gemini again' : 'Ask Gemini'}
          </Button>
        }
      >
        {advisor.state === 'unconfigured' && (
          <p className="text-[13px] text-ink-dim">
            The Gemini arm is switched off because <code className="font-mono text-[12px]">GEMINI_API_KEY</code> is
            not set on the backend. The baseline below is unaffected, because it never leaves this browser tab.
          </p>
        )}

        {advisor.state === 'unavailable' && (
          <p className="text-[13px] text-ink-dim">
            The backend could not be reached, so only the local baseline is shown. Start the backend and reload to
            enable the Gemini arm.
          </p>
        )}

        {advisor.state === 'ready' && !geminiRecs && (
          <p className="text-[13px] text-ink-dim">
            Gemini is configured on the server{advisor.model ? ` (${advisor.model})` : ''}. Nothing is sent until you
            press the button, because each call spends API quota.
          </p>
        )}

        {advisor.state === 'loading' && <Spinner label="Waiting for Gemini…" />}

        {advisor.state === 'error' && (
          <p className="text-[13px] text-red">
            The Gemini arm failed: {advisor.error} The baseline below is unaffected.
          </p>
        )}

        {agreement && (
          <div className="mt-1">
            <AgreementMetrics agreement={agreement} />
            <p className="mt-3 text-[12.5px] leading-relaxed text-ink-dim">{describeAgreement(agreement)}</p>
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-faint">
              Jaccard overlap is the share of distinct dimensions raised by either advisor that both raised. Severity
              agreement compares the high/med/low verdict on shared dimensions, and the rank correlation measures
              whether the two advisors order those dimensions the same way. All three are reported only where the
              overlap is large enough to be meaningful.
            </p>
          </div>
        )}
      </Card>

      {geminiRecs ? (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <section>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-[15px]">Baseline — deterministic rules</h2>
              <Badge tone="dim">{baseline.length}</Badge>
            </div>
            {baseline.length ? (
              baseline.map((rec) => <RecommendationCard key={rec.id} rec={rec} />)
            ) : (
              <Card>
                <Empty icon={<CircleCheck size={22} />} title="No baseline findings." />
              </Card>
            )}
          </section>

          <section>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-[15px]">Gemini — {advisor.model || 'language model'}</h2>
              <Badge tone="dim">{geminiRecs.length}</Badge>
            </div>
            {geminiRecs.length ? (
              geminiRecs.map((rec) => <RecommendationCard key={rec.id} rec={rec} />)
            ) : (
              <Card>
                <Empty icon={<CircleCheck size={22} />} title="Gemini returned no usable findings." />
              </Card>
            )}
          </section>
        </div>
      ) : (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-[15px]">Baseline — deterministic rules</h2>
            <Badge tone="dim">{baseline.length}</Badge>
          </div>
          {baseline.length ? (
            baseline.map((rec) => <RecommendationCard key={rec.id} rec={rec} />)
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
        </section>
      )}

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[2fr_320px]">
        <Card title="Severity scale" sub="How both advisors rank urgency.">
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
              Each card separates the observed issue, why it matters, the proposed change, and the effect expected
              from making it. Expected impact tags are directional estimates, not measurements.
            </p>
            <p>
              Applying a change to the architecture and re-running the simulation produces new evidence, and both
              advisors are rewritten from it. Nothing here is persisted, so no finding can drift away from the
              architecture that produced it.
            </p>
          </div>
        </Card>

        <Card title="Reading the volume" sub="How many findings to expect from a healthy design.">
          <div className="flex items-start gap-2.5">
            <CircleCheck size={15} className="mt-0.5 shrink-0 text-green" />
            <p className="text-[12.5px] leading-relaxed text-ink-dim">
              This architecture produced {baseline.length} baseline finding{baseline.length === 1 ? '' : 's'} from a
              health score of {healthScore} and {deviationCount} real deviation{deviationCount === 1 ? '' : 's'}. A
              healthy architecture is expected to yield a short list; a long list usually signals that the simulated
              workload is undersized rather than that the design is sound.
            </p>
          </div>
        </Card>
      </div>
    </div>
  )
}