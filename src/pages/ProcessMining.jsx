import { Link } from 'react-router-dom'
import { Award, GitBranch, Lightbulb, ListTree, Route, Timer, TrendingUp } from 'lucide-react'
import { useApp } from '../store/AppContext.jsx'
import { useResults } from '../store/useResults.js'
import { colors, severityColor, scoreColor } from '../theme/tokens.js'
import {
  Badge,
  Card,
  DataTable,
  Empty,
  PageHead,
  Spinner,
  StatCard,
  UtilBar,
} from '../components/ui.jsx'
import { BottleneckChart, PathSupportChart } from '../components/charts.jsx'

const ARROW = ' → '
const REAL_DEVIATION = 'none'

const linkBtn =
  'inline-flex items-center gap-2 rounded-[7px] border border-accent bg-accent px-3.5 py-2 text-[13px] font-semibold text-[#1a1206] transition hover:brightness-110'

function toPct(value) {
  const v = Number(value)
  if (!Number.isFinite(v)) return 0
  return v <= 1 ? v * 100 : v
}

function severityTone(severity) {
  if (severity === 'high') return 'red'
  if (severity === 'med') return 'amber'
  return 'blue'
}

function PathList({ names }) {
  return (
    <div className="font-mono text-[12px] leading-relaxed break-words text-ink">
      {names.map((name, i) => (
        <span key={`${name}-${i}`}>
          {i > 0 ? <span className="text-ink-faint">{ARROW}</span> : null}
          <span className={i === 0 || i === names.length - 1 ? 'text-accent' : 'text-ink-dim'}>{name}</span>
        </span>
      ))}
    </div>
  )
}

export default function ProcessMining() {
  const { currentProject } = useApp()
  const { mining, status, error, sim } = useResults(currentProject?.arch)

  if (!currentProject) {
    return (
      <Card>
        <Empty
          icon={<GitBranch size={26} />}
          title="No project is open."
          hint="Traces are derived from a project's architecture, so open or create a project first."
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
          eyebrow="Process Mining"
          title={`Process Mining — ${currentProject.name}`}
          desc="Traces are reconstructed from the simulation event log and compared against the expected paths derived from the architecture graph."
        />
        <Card className="border-red">
          <div className="font-mono text-[12px] text-red">Process mining error</div>
          <div className="mt-1 text-[13px] text-ink">{error || 'Unknown mining failure.'}</div>
        </Card>
      </div>
    )
  }

  if (status === 'running' && !mining) {
    return (
      <div>
        <PageHead
          eyebrow="Process Mining"
          title={`Process Mining — ${currentProject.name}`}
          desc="Traces are reconstructed from the simulation event log and compared against the expected paths derived from the architecture graph."
        />
        <Card>
          <Spinner label="Reconstructing traces from the event log…" />
        </Card>
      </div>
    )
  }

  if (!mining) {
    return (
      <div>
        <PageHead
          eyebrow="Process Mining"
          title={`Process Mining — ${currentProject.name}`}
          desc="Traces are reconstructed from the simulation event log and compared against the expected paths derived from the architecture graph."
        />
        <Card>
          <Empty
            icon={<GitBranch size={26} />}
            title="No mined traces yet."
            hint="Process mining runs on the simulation event log. Run a simulation to produce one."
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

  const stats = mining.statistics || {}
  const deviations = (mining.deviations || []).filter((d) => d && d.type !== REAL_DEVIATION)
  const realDeviationCount = deviations.length
  const conformance = toPct(stats.conformanceRate)
  const expectedPaths = mining.expectedPaths || []
  const frequentPaths = (mining.frequentPaths || []).slice(0, 8)
  const variants = mining.variants || []
  const bottlenecks = [...(mining.bottlenecks || [])].sort((a, b) => (b.waitRatio || 0) - (a.waitRatio || 0))
  const waitingEntries = Object.entries(mining.waitingTimes || {})
  const entryCount = (sim?.entryIds || []).length
  const terminalCount = (sim?.terminalIds || []).length

  const frequentRows = frequentPaths.map((p, i) => ({
    key: `${i}-${(p.path || []).join('|')}`,
    cells: [
      <span key="path" className="font-mono text-[12px] text-ink">
        {(p.path || []).join(ARROW)}
      </span>,
      `${Number(p.count || 0).toLocaleString()}`,
      `${toPct(p.support).toFixed(1)}%`,
    ],
  }))

  const bottleneckRows = bottlenecks.map((b, i) => ({
    key: b.componentId || `${b.component}-${i}`,
    cells: [
      b.component,
      `${Math.round(Number(b.waitingMs) || 0)} ms`,
      `${Math.round(Number(b.processingMs) || 0)} ms`,
      `${toPct(b.waitRatio).toFixed(2)}`,
      `${Number(b.queueDepthMax) || 0}`,
      <Badge key="sev" tone={severityTone(b.severity)}>
        {b.severity || 'low'}
      </Badge>,
    ],
  }))

  const waitingRows = waitingEntries.map(([name, w]) => ({
    key: name,
    cells: [
      name,
      `${Math.round(Number(w?.total) || 0).toLocaleString()} ms`,
      `${Math.round(Number(w?.avg) || 0)} ms`,
      `${Math.round(Number(w?.max) || 0)} ms`,
      `${Number(w?.count) || 0}`,
    ],
  }))

  return (
    <div>
      <PageHead
        eyebrow="Process Mining"
        title={`Process Mining — ${currentProject.name}`}
        desc="Traces are reconstructed from the simulation event log, grouped into case variants, and compared against the expected paths derived from the architecture graph."
        actions={
          <div className="flex items-center gap-2">
            <Badge tone="dim">{Number(stats.totalCases || 0).toLocaleString()} cases</Badge>
            <Badge tone="dim">{variants.length} variants</Badge>
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Cases Analysed"
          value={Number(stats.totalCases || 0).toLocaleString()}
          icon={<GitBranch size={14} />}
          delta={`${Number(stats.completedCases || 0).toLocaleString()} completed · ${Number(stats.droppedCases || 0).toLocaleString()} dropped`}
        />
        <StatCard
          label="Conformance"
          value={`${conformance.toFixed(1)}%`}
          tone={scoreColor(conformance)}
          icon={<Route size={14} />}
          delta={`${Number(stats.loggedCases || 0).toLocaleString()} cases were logged for mining`}
        />
        <StatCard
          label="Real Deviations"
          value={realDeviationCount}
          tone={realDeviationCount > 0 ? colors.accent : undefined}
          icon={<TrendingUp size={14} />}
          delta={`of ${(mining.deviations || []).length} checks, ${REAL_DEVIATION}-type findings excluded`}
        />
        <StatCard
          label="Variants"
          value={Number(stats.variants ?? variants.length)}
          icon={<ListTree size={14} />}
          delta={`average case length ${(Number(stats.avgCaseLength) || 0).toFixed(1)} activities`}
        />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card
          title="Expected paths"
          sub={`Enumerated by breadth-first walk from the ${entryCount} entry node(s) to the ${terminalCount} terminal node(s).`}
        >
          {expectedPaths.length ? (
            <div className="space-y-2">
              {expectedPaths.map((path, i) => (
                <div key={`exp-${i}`} className="rounded-[7px] border border-line-soft bg-raised px-3 py-2">
                  <PathList names={(path || []).map((step) => (typeof step === 'string' ? step : step?.name))} />
                </div>
              ))}
            </div>
          ) : (
            <div className="py-6 text-center text-[12.5px] text-ink-faint">
              No expected path could be enumerated from this graph.
            </div>
          )}
        </Card>

        <Card title="Observed frequent paths" sub="Collapsed case variants ranked by case count and support.">
          {frequentPaths.length ? (
            <div className="mb-4">
              <DataTable headers={['Trace', 'Cases', 'Support']} rows={frequentRows} empty="No traces observed." />
            </div>
          ) : (
            <div className="py-6 text-center text-[12.5px] text-ink-faint">No traces observed.</div>
          )}
          <div className="border-t border-line-soft pt-3.5">
            <div className="mb-2 font-mono text-[10.5px] tracking-wider text-ink-faint uppercase">
              Variant case counts
            </div>
            <PathSupportChart paths={variants} height={170} />
          </div>
        </Card>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Bottlenecks" sub="Components ranked by the ratio of waiting time to processing time.">
          <div className="mb-4">
            <BottleneckChart bottlenecks={bottlenecks} height={190} />
          </div>
          <DataTable
            headers={['Component', 'Waiting', 'Processing', 'Wait ratio', 'Max queue', 'Severity']}
            rows={bottleneckRows}
            empty="No queueing bottleneck detected."
          />
        </Card>

        <Card title="Deviations" sub="Behaviour of the executed traces that the expected model does not predict.">
          {deviations.length ? (
            <div className="space-y-3">
              {deviations.map((d, i) => (
                <div
                  key={`${d.type}-${i}`}
                  className="rounded-[8px] border border-line bg-raised p-3.5"
                  style={{ borderLeft: `3px solid ${severityColor(d.severity)}` }}
                >
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <Badge tone={severityTone(d.severity)}>{d.severity || 'low'}</Badge>
                    <span className="font-mono text-[10.5px] tracking-wide text-ink-faint uppercase">{d.type}</span>
                    <span className="font-mono text-[10.5px] text-ink-faint">· {Number(d.caseCount) || 0} cases</span>
                  </div>
                  <div className="mb-1 text-[13px] text-ink">{d.component}</div>
                  <div className="text-[12.5px] text-ink-dim">{d.detail}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-6 text-center text-[12.5px] text-ink-faint">
              No real deviations were detected. Executed traces conform to the expected model.
            </div>
          )}
        </Card>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Waiting times" sub="Aggregated queue residence time per component across all sampled cases.">
          <DataTable
            headers={['Component', 'Total', 'Average', 'Max', 'Count']}
            rows={waitingRows}
            empty="No waiting time recorded."
          />
        </Card>

        <Card title="How this was derived" sub="Method statement for reproducibility.">
          <ol className="mb-3.5 space-y-2 text-[13px] text-ink-dim">
            {[
              'Events from the discrete event engine were grouped by caseId, discarding the sampling step so each request is one case.',
              'Within a case, events were sorted by timestamp to reconstruct the executed activity sequence.',
              'Sequences were collapsed to unique variants; each variant was counted and its support computed against the sampled case total.',
              'Expected paths were enumerated by breadth-first walk of the architecture graph from every entry node to every terminal node.',
              'A case conforms when its sequence matches an expected path exactly; any other sequence is reported as a deviation.',
              'Bottlenecks are ranked by waitingMs / processingMs, with severity assigned from the wait ratio and the observed maximum queue depth.',
            ].map((step, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="font-mono text-[11px] text-accent">{String(i + 1).padStart(2, '0')}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <div className="rounded-[8px] border border-line-soft bg-raised p-3">
            <div className="mb-1 flex items-center gap-2 font-mono text-[10.5px] tracking-wider text-ink-faint uppercase">
              <Lightbulb size={12} />
              Sampling caveat
            </div>
            <p className="text-[12.5px] text-ink-dim">
              The engine emits a deterministic sample of the event log, capped at 400 cases. The sample is chosen
              by seed, so repeating a run with the same seed reproduces exactly the same traces, but the mined
              figures describe the sample rather than every simulated case. Counts on this page are therefore
              reported against the sampled cases, not the {Number(stats.totalCases || 0).toLocaleString()} total
              simulated cases.
            </p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-[8px] border border-line-soft bg-raised p-3">
              <div className="mb-1 font-mono text-[10.5px] tracking-wider text-ink-faint uppercase">Max wait</div>
              <div className="font-mono text-[17px] text-ink">{Math.round(Number(stats.maxWaitMs) || 0)} ms</div>
            </div>
            <div className="rounded-[8px] border border-line-soft bg-raised p-3">
              <div className="mb-1 font-mono text-[10.5px] tracking-wider text-ink-faint uppercase">Avg case length</div>
              <div className="font-mono text-[17px] text-ink">{(Number(stats.avgCaseLength) || 0).toFixed(1)}</div>
            </div>
          </div>
        </Card>
      </div>

      {bottlenecks.length ? (
        <Card title="Bottleneck share of total waiting time" sub="Relative contribution of each queue to end-to-end delay.">
          {bottlenecks.map((b) => (
            <UtilBar
              key={b.componentId || b.component}
              value={toPct(b.waitRatio)}
              label={b.component}
              right={`${toPct(b.waitRatio).toFixed(1)}% wait ratio`}
            />
          ))}
        </Card>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Link
          to="/simulation"
          className="inline-flex items-center gap-2 rounded-[7px] border border-line bg-raised px-3.5 py-2 text-[13px] font-semibold text-ink"
        >
          <Timer size={14} />
          Change the workload
        </Link>
        <span className="flex items-center gap-1.5 text-[11.5px] text-ink-faint">
          <Award size={12} />
          These findings feed the Process Efficiency dimension of the health score.
        </span>
      </div>
    </div>
  )
}
