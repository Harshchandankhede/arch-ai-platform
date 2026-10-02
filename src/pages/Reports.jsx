import { Link } from 'react-router-dom'
import { useState } from 'react'
import { FileText, Info, Printer } from 'lucide-react'
import { useApp, useDispatch } from '../store/AppContext.jsx'
import { useResults } from '../store/useResults.js'
import { toContract } from '../lib/contract.js'
import { utilPct } from '../lib/metrics.js'
import { nodeTypes } from '../data/nodeTypes.js'
import { categoryColor, colors, scoreColor, utilizationColor } from '../theme/tokens.js'
import { NodeGlyph, boundsOf } from '../components/NodeShapes.jsx'
import {
  Badge,
  Button,
  Card,
  DataTable,
  Empty,
  JsonPreview,
  PageHead,
  Spinner,
  inputClass,
} from '../components/ui.jsx'

const linkBtn =
  'inline-flex items-center gap-2 rounded-[7px] border border-accent bg-accent px-3.5 py-2 text-[13px] font-semibold text-[#1a1206] transition hover:brightness-110'

function toPct(value) {
  const v = Number(value)
  if (!Number.isFinite(v)) return 0
  return v <= 1 ? v * 100 : v
}

function num(value, digits = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0'
  return digits ? n.toFixed(digits) : Math.round(n).toLocaleString()
}

function Section({ title, children }) {
  return (
    <section className="mb-7 last:mb-0">
      <h2 className="mb-3.5 border-b border-line pb-2 text-[15px]">{title}</h2>
      {children}
    </section>
  )
}

function DefinitionList({ items }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-3 border-b border-line-soft pb-1.5">
          <dt className="text-[12.5px] text-ink-dim">{k}</dt>
          <dd className="truncate text-right font-mono text-[12.5px] text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function ReportDiagram({ arch, components, height = 260 }) {
  const nodes = arch?.nodes || []
  const edges = (arch?.edges || []).filter((e) => e.source && e.target)
  const stats = components || {}
  const byId = new Map(nodes.map((n) => [n.id, boundsOf(n)]))
  const boxes = [...byId.values()]
  const pad = 70

  let viewBox = `0 0 900 ${height}`
  if (boxes.length) {
    const x0 = Math.min(...boxes.map((b) => b.x))
    const y0 = Math.min(...boxes.map((b) => b.y))
    const x1 = Math.max(...boxes.map((b) => b.x + b.w))
    const y1 = Math.max(...boxes.map((b) => b.y + b.h))
    viewBox = `${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`
  }

  return (
    <svg
      width="100%"
      height={height}
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Architecture diagram"
    >
      <defs>
        <marker
          id="report-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={colors.inkFaint} />
        </marker>
      </defs>
      {edges.map((e) => {
        const a = byId.get(e.source)
        const b = byId.get(e.target)
        if (!a || !b) return null
        return (
          <line
            key={e.id || `${e.source}->${e.target}`}
            x1={a.cx}
            y1={a.cy}
            x2={b.cx}
            y2={b.cy}
            stroke={colors.line}
            strokeWidth={1.3}
            markerEnd="url(#report-arrow)"
          />
        )
      })}
      {nodes.map((n) => {
        const b = byId.get(n.id)
        const type = nodeTypes[n.type]
        const stat = stats[n.id]
        const measured = Boolean(stat)
        const color = measured
          ? utilizationColor(utilPct(stat.utilization))
          : categoryColor[type?.cat] || colors.inkDim
        return (
          <g key={n.id} transform={`translate(${b.x}, ${b.y})`}>
            <NodeGlyph
              name={n.name || type?.name || n.id}
              sub={measured ? `${Math.round(utilPct(stat.utilization))}%` : n.type}
              shape={type?.shape}
              color={color}
            />
          </g>
        )
      })}
    </svg>
  )
}

export default function Reports() {
  const { currentProject, projects, workload } = useApp()
  const dispatch = useDispatch()
  const [selectedId, setSelectedId] = useState(() => currentProject?.id || '')
  const project = projects.find((p) => p.id === selectedId) || currentProject
  const { sim, mining, evaluation, recommendations, status, error } = useResults(project?.arch)

  if (!currentProject) {
    return (
      <Card>
        <Empty
          icon={<FileText size={26} />}
          title="No project is open."
          hint="A report is generated for a specific architecture. Open or create a project first."
          action={
            <Link to="/projects" className={linkBtn}>
              Go to My Projects
            </Link>
          }
        />
      </Card>
    )
  }

  const generatedAt = new Date().toLocaleString()

  const metrics = sim?.metrics || {}
  const logging = sim?.loggingStats || {}
  const statistics = mining?.statistics || {}
  const dimensions = evaluation?.dimensions || {}
  const weights = evaluation?.weights || {}
  const notes = evaluation?.notes || {}
  const recs = recommendations || []
  const nodes = project?.arch?.nodes || []
  const edges = project?.arch?.edges || []
  const realDeviations = (mining?.deviations || []).filter((d) => d && d.type !== 'none')

  const infoRows = [
    ['Project name', project?.name || '—'],
    ['Description', project?.description || '—'],
    ['Nodes', num(nodes.length)],
    ['Edges', num(edges.length)],
    ['Last updated', project?.updatedAt ? new Date(project.updatedAt).toLocaleString() : '—'],
    ['Generated', generatedAt],
    ['Arrival rate', `${workload.arrivalRate ?? 0} req/s`],
    ['Duration', `${workload.duration ?? 0} s`],
    ['Concurrent users', num(workload.concurrentUsers)],
    ['Random seed', num(workload.seed)],
  ]

  const metricRows = [
    { key: 'total', cells: ['Total requests', num(metrics.totalRequests)] },
    { key: 'completed', cells: ['Completed requests', num(metrics.completedRequests)] },
    { key: 'dropped', cells: ['Dropped requests', num(metrics.droppedRequests)] },
    { key: 'failed', cells: ['Failed requests', num(metrics.failedRequests)] },
    { key: 'avg', cells: ['Average latency', `${num(metrics.avgLatencyMs)} ms`] },
    { key: 'p50', cells: ['Latency p50', `${num(metrics.p50)} ms`] },
    { key: 'p90', cells: ['Latency p90', `${num(metrics.p90)} ms`] },
    { key: 'p95', cells: ['Latency p95', `${num(metrics.p95)} ms`] },
    { key: 'p99', cells: ['Latency p99', `${num(metrics.p99)} ms`] },
    { key: 'max', cells: ['Maximum latency', `${num(metrics.maxLatencyMs)} ms`] },
    { key: 'thr', cells: ['Throughput', `${num(metrics.throughputPerSec, 2)} req/s`] },
    { key: 'succ', cells: ['Success rate', `${toPct(metrics.successRate).toFixed(2)}%`] },
    { key: 'failrate', cells: ['Failure rate', `${toPct(metrics.failureRate).toFixed(2)}%`] },
    { key: 'droprate', cells: ['Drop rate', `${toPct(metrics.dropRate).toFixed(2)}%`] },
    { key: 'll', cells: ["Little's Law concurrency", num(metrics.littleLawConcurrency)] },
    { key: 'simms', cells: ['Engine wall clock', `${num(metrics.simulatedMs)} ms`] },
  ]

  const logRows = [
    { key: 'total', cells: ['Total events', num(logging.totalEvents)] },
    { key: 'logged', cells: ['Logged events', num(logging.loggedEvents)] },
    { key: 'sampled', cells: ['Sampled cases', num(logging.sampledCases)] },
    { key: 'cases', cells: ['Total cases', num(logging.totalCases)] },
  ]

  const miningRows = [
    { key: 'tc', cells: ['Total cases', num(statistics.totalCases)] },
    { key: 'cc', cells: ['Completed cases', num(statistics.completedCases)] },
    { key: 'dc', cells: ['Dropped cases', num(statistics.droppedCases)] },
    { key: 'lc', cells: ['Logged cases', num(statistics.loggedCases)] },
    { key: 'acl', cells: ['Average case length', num(statistics.avgCaseLength, 2)] },
    { key: 'v', cells: ['Distinct variants', num(statistics.variants)] },
    { key: 'cr', cells: ['Conformance rate', `${toPct(statistics.conformanceRate).toFixed(2)}%`] },
    { key: 'mw', cells: ['Maximum wait', `${num(statistics.maxWaitMs)} ms`] },
  ]

  const bottleneckRows = [...(mining?.bottlenecks || [])]
    .sort((a, b) => (b.waitRatio || 0) - (a.waitRatio || 0))
    .map((b, i) => ({
      key: b.componentId || `${b.component}-${i}`,
      cells: [
        b.component,
        `${num(b.waitingMs)} ms`,
        `${num(b.processingMs)} ms`,
        toPct(b.waitRatio).toFixed(2),
        num(b.queueDepthMax),
        num(b.visits),
        b.severity || 'low',
      ],
    }))

  const evaluationRows = [
    ...Object.keys(dimensions).map((key) => ({
      key,
      cells: [
        key,
        `${toPct(weights[key] ?? 0).toFixed(0)}%`,
        num(dimensions[key]),
        notes[key] || '—',
      ],
    })),
  ]

  return (
    <div>
      <PageHead
        eyebrow="Report Generation"
        title={`Report — ${project?.name || currentProject.name}`}
        desc="A consolidated report covering the architecture, simulation evidence, mined process findings, evaluation and advisory layer."
        actions={
          <div className="no-print flex flex-wrap items-center gap-2">
            <select
              className={`${inputClass} w-[220px]`}
              value={project?.id || ''}
              onChange={(e) => {
                setSelectedId(e.target.value)
                dispatch({ type: 'SET_CURRENT_PROJECT', id: e.target.value })
              }}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <Button variant="primary" icon={<Printer size={14} />} onClick={() => window.print()}>
              Export / Print
            </Button>
          </div>
        }
      />

      {status === 'error' ? (
        <Card className="no-print mb-5 border-red">
          <div className="font-mono text-[12px] text-red">Report generation error</div>
          <div className="mt-1 text-[13px] text-ink">{error || 'Unknown simulation failure.'}</div>
        </Card>
      ) : null}

      {status === 'running' ? (
        <Card className="no-print mb-5">
          <Spinner label="Regenerating report evidence…" />
        </Card>
      ) : null}

      <div className="print-doc mx-auto max-w-[820px] rounded-panel border border-line bg-surface p-9">
        <div className="mb-6 border-b border-line pb-5">
          <div className="mb-1.5 font-mono text-[11px] tracking-widest text-accent uppercase">
            Architecture Simulation Report
          </div>
          <h1 className="text-[21px] leading-tight">{project?.name || currentProject.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone={scoreColor(Number(evaluation?.healthScore) || 0)}>
              Health {num(evaluation?.healthScore)}/100
            </Badge>
            <Badge tone="dim">seed {num(workload.seed)}</Badge>
            <Badge tone="dim">generated {generatedAt}</Badge>
          </div>
        </div>

        <Section title="1. Project information">
          <DefinitionList items={infoRows} />
          <div className="mt-4">
            <div className="mb-2 font-mono text-[10.5px] tracking-wider text-ink-faint uppercase">
              Architecture diagram
            </div>
            <div className="rounded-[8px] border border-line-soft bg-raised p-2">
              <ReportDiagram arch={project?.arch} components={sim?.components} />
            </div>
            <div className="mt-2 text-[11.5px] text-ink-faint">
              Node colour encodes measured utilisation where the simulation produced a figure for that component, and
              node category otherwise.
            </div>
          </div>
        </Section>

        <Section title="2. Architecture JSON">
          <JsonPreview value={toContract(project?.arch)} maxHeight={320} />
        </Section>

        <Section title="3. Simulation results">
          {sim ? (
            <>
              <DefinitionList
                items={[
                  ['Arrival rate', `${sim.arrivalRate} req/s`],
                  ['Duration', `${sim.duration} s`],
                  ['Concurrent users', num(sim.concurrentUsers)],
                  ['Seed', num(sim.seed)],
                ]}
              />
              <div className="mt-4">
                <DataTable headers={['Metric', 'Value']} rows={metricRows} />
              </div>
            </>
          ) : (
            <div className="text-[13px] text-ink-dim">No simulation result is available for this project yet.</div>
          )}
        </Section>

        <Section title="4. Event log summary">
          <DataTable headers={['Field', 'Value']} rows={logRows} />
          <div className="mt-3 text-[12.5px] leading-relaxed text-ink-dim">
            The engine emits a deterministic, seed-selected sample of the event log. The process mining stage
            reconstructs traces from the logged subset, so mined counts describe the sample rather than every
            simulated case. Because the seed is fixed and recorded above, repeating the run reproduces the same
            sample.
          </div>
        </Section>

        <Section title="5. Process mining analysis">
          <DataTable headers={['Statistic', 'Value']} rows={miningRows} />
          <div className="mt-4">
            <div className="mb-2 font-mono text-[10.5px] tracking-wider text-ink-faint uppercase">Expected paths</div>
            <div className="space-y-1.5">
              {(mining?.expectedPaths || []).map((path, i) => (
                <div key={i} className="font-mono text-[11.5px] text-ink-dim">
                  {(path || []).map((s) => (typeof s === 'string' ? s : s?.name)).join(' → ')}
                </div>
              ))}
              {!(mining?.expectedPaths || []).length ? (
                <div className="text-[12.5px] text-ink-faint">No expected path could be enumerated.</div>
              ) : null}
            </div>
          </div>
          <div className="mt-4">
            <div className="mb-2 font-mono text-[10.5px] tracking-wider text-ink-faint uppercase">
              Observed frequent paths
            </div>
            <DataTable
              headers={['Trace', 'Cases', 'Support']}
              rows={(mining?.frequentPaths || []).slice(0, 8).map((p, i) => ({
                key: `fp-${i}`,
                cells: [
                  <span key="p" className="font-mono text-[11.5px]">
                    {(p.path || []).join(' → ')}
                  </span>,
                  num(p.count),
                  `${toPct(p.support).toFixed(1)}%`,
                ],
              }))}
              empty="No observed paths."
            />
          </div>
        </Section>

        <Section title="6. Bottlenecks">
          <DataTable
            headers={['Component', 'Waiting', 'Processing', 'Wait ratio', 'Max queue', 'Visits', 'Severity']}
            rows={bottleneckRows}
            empty="No bottleneck was detected."
          />
        </Section>

        <Section title="7. Deviations">
          {realDeviations.length ? (
            <ol className="space-y-2.5">
              {realDeviations.map((d, i) => (
                <li key={i} className="rounded-[8px] border border-line-soft bg-raised p-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge tone={d.severity === 'high' ? 'red' : d.severity === 'med' ? 'amber' : 'blue'}>
                      {d.severity || 'low'}
                    </Badge>
                    <span className="font-mono text-[10.5px] tracking-wide text-ink-faint uppercase">{d.type}</span>
                    <span className="font-mono text-[10.5px] text-ink-faint">
                      {num(d.caseCount)} cases
                    </span>
                  </div>
                  <div className="text-[12.5px] text-ink">{d.component}</div>
                  <div className="text-[12px] text-ink-dim">{d.detail}</div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="text-[13px] text-ink-dim">
              No real deviations were detected: executed traces conform to the expected model.
            </div>
          )}
        </Section>

        <Section title="8. Architecture evaluation">
          {evaluation ? (
            <>
              <div className="mb-4 rounded-[8px] border border-line bg-raised p-3.5">
                <div className="mb-1.5 font-mono text-[10.5px] tracking-wider text-ink-faint uppercase">
                  Health score
                </div>
                <div className="font-mono text-[30px] font-bold" style={{ color: scoreColor(Number(evaluation.healthScore) || 0) }}>
                  {num(evaluation.healthScore)} / 100
                </div>
                <pre className="mt-2 overflow-x-auto font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink-faint">
                  Health Score = 0.25 x Performance + 0.20 x Scalability + 0.15 x Reliability + 0.15 x Security + 0.15 x
                  Maintainability + 0.10 x ProcessEfficiency
                </pre>
              </div>
              <DataTable
                headers={['Dimension', 'Weight', 'Score', 'Note']}
                rows={evaluationRows}
                empty="No dimensions were scored."
              />
            </>
          ) : (
            <div className="text-[13px] text-ink-dim">No evaluation is available for this project yet.</div>
          )}
        </Section>

        <Section title="9. AI recommendations">
          {recs.length ? (
            <div className="space-y-3">
              {recs.map((rec) => (
                <div key={rec.id} className="rounded-[8px] border border-line-soft bg-raised p-3.5">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <Badge tone={rec.severity === 'high' ? 'red' : rec.severity === 'med' ? 'amber' : 'blue'}>
                      {rec.severity}
                    </Badge>
                    <span className="font-mono text-[10.5px] tracking-wide text-ink-faint uppercase">
                      {rec.dimension}
                    </span>
                  </div>
                  <div className="mb-2 text-[13.5px] font-semibold text-ink">{rec.title}</div>
                  {[
                    ['Issue', rec.issue],
                    ['Recommendation', rec.recommendation],
                    ['Expected effect', rec.effect],
                  ].map(([k, v]) =>
                    v ? (
                      <div key={k} className="mb-1.5 last:mb-0">
                        <span className="font-mono text-[10px] tracking-wider text-ink-faint uppercase">{k}: </span>
                        <span className="text-[12.5px] text-ink-dim">{v}</span>
                      </div>
                    ) : null,
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[13px] text-ink-dim">No recommendations were raised for this project.</div>
          )}
        </Section>

        <div className="mt-7 flex items-start gap-2.5 rounded-[8px] border border-line-soft bg-raised p-3.5 text-[12px] leading-relaxed text-ink-dim">
          <Info size={14} className="no-print mt-0.5 shrink-0 text-accent" />
          <span>
            The exported PDF reproduces everything in this document. The interactive 3D Digital Twin is not included,
            because a print target cannot render a WebGL canvas. The architecture diagram above is the static 2D
            rendering of the same graph and carries the same node, edge and utilisation information.
          </span>
        </div>
      </div>
    </div>
  )
}
