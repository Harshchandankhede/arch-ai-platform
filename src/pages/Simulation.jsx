import { Suspense, lazy, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, Boxes, CircleCheck, Gauge, Play, TrendingUp, Workflow } from 'lucide-react'
import { useApp, useDispatch } from '../store/AppContext.jsx'
import { defaultWorkload, workloadPresets } from '../store/reducer.js'
import { useResults } from '../store/useResults.js'
import { isClient, nodeTypes } from '../data/nodeTypes.js'
import { categoryColor, colors, utilizationColor } from '../theme/tokens.js'
import { NodeGlyph, boundsOf } from '../components/NodeShapes.jsx'
import {
  Badge,
  Button,
  Card,
  DataTable,
  Empty,
  Field,
  PageHead,
  RangeField,
  Spinner,
  StatCard,
  Tabs,
  UtilBar,
  inputClass,
} from '../components/ui.jsx'
import { LatencyChart, MemoryChart, QueueChart } from '../components/charts.jsx'

const TwinScene = lazy(() => import('../features/three/TwinScene.jsx'))

const MEAN_LATENCY_S = 0.2
const EVENT_ROWS = 40

const linkBtn =
  'inline-flex items-center gap-2 rounded-[7px] border border-accent bg-accent px-3.5 py-2 text-[13px] font-semibold text-[#1a1206] transition hover:brightness-110'

const utilBands = [
  { label: 'under 65%', value: 40 },
  { label: '65 to 85%', value: 75 },
  { label: 'over 85%', value: 95 },
]

function presetRate(users) {
  return Math.round(users / MEAN_LATENCY_S)
}

function toPct(value) {
  const v = Number(value)
  if (!Number.isFinite(v)) return 0
  return v <= 1 ? v * 100 : v
}

function canSimulate(arch) {
  const nodes = arch?.nodes || []
  if (!nodes.length) return false
  if (!(arch?.edges || []).length) return false
  return nodes.some((n) => isClient(n))
}

function ArchitectureSvg({ arch, components, height = 460 }) {
  const nodes = arch?.nodes || []
  const edges = (arch?.edges || []).filter((e) => e.source && e.target)
  const stats = components || {}
  const byId = new Map(nodes.map((n) => [n.id, boundsOf(n)]))
  const boxes = [...byId.values()]
  const pad = 60

  let viewBox = `0 0 900 ${height}`
  if (boxes.length) {
    const x0 = Math.min(...boxes.map((b) => b.x))
    const y0 = Math.min(...boxes.map((b) => b.y))
    const x1 = Math.max(...boxes.map((b) => b.x + b.w))
    const y1 = Math.max(...boxes.map((b) => b.y + b.h))
    viewBox = `${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`
  }

  return (
    <div>
      <svg
        width="100%"
        height={height}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Architecture diagram coloured by component utilisation"
      >
        <defs>
          <marker
            id="sim-arrow"
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
              strokeWidth={1.4}
              markerEnd="url(#sim-arrow)"
            />
          )
        })}
        {nodes.map((n) => {
          const b = byId.get(n.id)
          const type = nodeTypes[n.type]
          const stat = stats[n.id]
          const util = Number(stat?.utilization ?? 0)
          const measured = Boolean(stat)
          const color = measured ? utilizationColor(util) : categoryColor[type?.cat] || colors.inkDim
          return (
            <g key={n.id} transform={`translate(${b.x}, ${b.y})`}>
              <NodeGlyph
                name={n.name || type?.name || n.id}
                sub={measured ? `${util.toFixed(0)}% util` : n.type}
                shape={type?.shape}
                color={color}
              />
            </g>
          )
        })}
      </svg>
      <div className="mt-1 flex flex-wrap items-center gap-4 px-1 font-mono text-[10.5px] tracking-wide text-ink-faint uppercase">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: colors.inkDim }} />
          not measured
        </span>
        {utilBands.map((b) => (
          <span key={b.label} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: utilizationColor(b.value) }} />
            utilisation {b.label}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function Simulation() {
  const { currentProject, workload } = useApp()
  const dispatch = useDispatch()
  const arch = currentProject?.arch
  const { sim, status, error, rerun } = useResults(arch)
  const [view, setView] = useState('2d')

  if (!currentProject) {
    return (
      <Card>
        <Empty
          icon={<Boxes size={26} />}
          title="No project is open."
          hint="Open or create a project before running a simulation."
          action={
            <Link to="/projects" className={linkBtn}>
              Go to My Projects
            </Link>
          }
        />
      </Card>
    )
  }

  if (!canSimulate(arch)) {
    return (
      <div>
        <PageHead
          eyebrow="Discrete Event Simulation"
          title={`Simulation — ${currentProject.name}`}
          desc="Apply a workload to the current architecture and measure latency, throughput, resource utilisation and memory."
        />
        <Card>
          <Empty
            icon={<Workflow size={26} />}
            title="This architecture cannot be simulated yet."
            hint="The engine needs at least one edge and a client node to generate an arrival stream. Add them in the Architecture Builder."
            action={
              <Link to="/builder" className={linkBtn}>
                Open Architecture Builder
              </Link>
            }
          />
        </Card>
      </div>
    )
  }

  const setWorkload = (patch) => dispatch({ type: 'SET_WORKLOAD', workload: patch })
  const arrivalRate = workload.arrivalRate ?? defaultWorkload.arrivalRate
  const duration = workload.duration ?? defaultWorkload.duration
  const seed = workload.seed ?? defaultWorkload.seed
  const isRunning = status === 'running'
  const metrics = sim?.metrics || {}
  const logging = sim?.loggingStats || {}
  const components = Object.values(sim?.components || {})
  const measured = components.filter((c) => typeof c.capacity === 'number' && c.capacity < 1000)
  const byUtil = [...measured].sort((a, b) => (b.utilization || 0) - (a.utilization || 0))
  const peakUtil = components.reduce((max, c) => Math.max(max, Number(c.utilization) || 0), 0)
  const activePreset = workloadPresets.find((p) => presetRate(p.concurrentUsers) === arrivalRate)

  const eventRows = (sim?.eventLog || []).slice(0, EVENT_ROWS).map((e, i) => ({
    key: e.eventId || `${e.caseId || 'case'}-${i}`,
    cells: [e.caseId, e.activity, e.componentName || e.componentId, `${Math.round(Number(e.timestamp) || 0)} ms`],
  }))

  let hint = 'Idle. Adjust the workload and run the engine.'
  let hintTone = 'text-ink-faint'
  if (isRunning) {
    hint = 'Simulating…'
    hintTone = 'text-accent'
  } else if (status === 'error') {
    hint = error || 'The simulation engine reported an error.'
    hintTone = 'text-red'
  } else if (sim) {
    hint = `Complete — ${Number(metrics.totalRequests || 0).toLocaleString()} requests over ${sim.duration}s`
    hintTone = 'text-green'
  }

  const derivedConcurrency = (Number(metrics.throughputPerSec) || 0) * (Number(metrics.avgLatencyMs) || 0)

  return (
    <div>
      <PageHead
        eyebrow="Discrete Event Simulation"
        title={`Simulation — ${currentProject.name}`}
        desc="Apply a workload to the current architecture and measure latency, throughput, resource utilisation and memory."
        actions={
          <div className="flex items-center gap-2">
            <Badge tone="dim">seed {seed}</Badge>
            <Badge tone="dim">{arch.nodes.length} nodes</Badge>
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-1 items-start gap-5 min-[1100px]:grid-cols-[2fr_320px]">
        <div className="min-w-0">
          <Tabs
            tabs={[
              { key: '2d', label: '2D' },
              { key: '3d', label: '3D · Digital Twin' },
            ]}
            value={view}
            onChange={setView}
          />
          {view === '3d' ? (
            <Card
              title="Digital Twin"
              sub="Interactive three-dimensional view of the same architecture and the same simulation result."
            >
              <div style={{ height: 460 }}>
                <Suspense fallback={<Spinner label="Loading Digital Twin…" />}>
                  <TwinScene architecture={arch} sim={sim} running={isRunning} />
                </Suspense>
              </div>
            </Card>
          ) : (
            <Card
              title="2D Architecture"
              sub="Nodes sit at their authored coordinates. Colour encodes measured utilisation from the last run."
              actions={<Badge tone="dim">2D</Badge>}
            >
              <ArchitectureSvg arch={arch} components={sim?.components} />
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card title="Workload" sub="Arrival profile handed to the engine.">
            <RangeField
              label="Arrival rate"
              value={arrivalRate}
              min={10}
              max={500}
              step={5}
              onChange={(v) => setWorkload({ arrivalRate: v })}
              format={(v) => `${v} req/s`}
            />
            <RangeField
              label="Duration"
              value={duration}
              min={10}
              max={300}
              step={5}
              onChange={(v) => setWorkload({ duration: v })}
              format={(v) => `${v} s`}
            />
            <Field label="Random seed" hint="Same seed plus same architecture reproduces the run exactly.">
              <input
                type="number"
                className={inputClass}
                value={seed}
                onChange={(e) => setWorkload({ seed: Number(e.target.value) || 0 })}
              />
            </Field>

            <div className="border-t border-line-soft pt-3.5">
              <div className="mb-1 font-mono text-[11.5px] tracking-wide text-ink-dim uppercase">
                Report presets
              </div>
              <div className="mb-1.5 text-[11px] text-ink-faint">
                Arrival rate derived from Little&apos;s Law, λ = L / W, with a 200 ms assumed mean
                latency.
              </div>
              <div className="flex flex-col gap-2">
                {workloadPresets.map((preset) => {
                  const rate = presetRate(preset.concurrentUsers)
                  const on = rate === arrivalRate
                  return (
                    <Button
                      key={preset.label}
                      size="sm"
                      variant={on ? 'primary' : 'default'}
                      onClick={() =>
                        setWorkload({ arrivalRate: rate, concurrentUsers: preset.concurrentUsers })
                      }
                      className="w-full justify-between"
                    >
                      <span>{preset.label}</span>
                      <span className="font-mono text-[11px] opacity-70">{rate} req/s</span>
                    </Button>
                  )
                })}
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {activePreset ? (
                  <Badge tone="amber">{activePreset.label}</Badge>
                ) : (
                  <Badge tone="dim">custom rate</Badge>
                )}
                <span className="text-[11px] text-ink-faint">
                  {activePreset
                    ? `λ = ${activePreset.concurrentUsers} / 0.2 s = ${presetRate(activePreset.concurrentUsers)} req/s`
                    : 'Between the three report scenarios.'}
                </span>
              </div>
              <div className="mt-2 text-[11px] text-ink-faint">
                The 10,000-user preset sits above the slider range and is applied directly.
              </div>
            </div>

            <div className="mt-4 border-t border-line-soft pt-3.5">
              <Button
                variant="primary"
                className="w-full justify-center"
                onClick={rerun}
                disabled={isRunning}
                icon={<Play size={14} />}
              >
                Run Simulation
              </Button>
              <div className={`mt-2.5 font-mono text-[11.5px] ${hintTone}`}>{hint}</div>
            </div>
          </Card>

          <Card title="Run configuration" sub="Read-only view of what the engine used.">
            <dl className="space-y-1.5 text-[12.5px]">
              {[
                ['Mode', workload.mode || 'rate'],
                ['Arrival rate', `${arrivalRate} req/s`],
                ['Duration', `${duration} s`],
                ['Seed', String(seed)],
                ['Concurrent users', String(workload.concurrentUsers ?? '—')],
                ['Reported concurrency', String(sim?.concurrentUsers ?? '—')],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3">
                  <dt className="text-ink-faint">{k}</dt>
                  <dd className="truncate font-mono text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>

      {status === 'error' ? (
        <Card className="mb-5 border-red">
          <div className="font-mono text-[12px] text-red">Simulation error</div>
          <div className="mt-1 text-[13px] text-ink">{error || 'Unknown simulation failure.'}</div>
        </Card>
      ) : null}

      {isRunning && !sim ? (
        <Card className="mb-5">
          <Spinner label="Running the discrete event engine in a Web Worker…" />
        </Card>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Avg Latency (p50)"
          value={`${Math.round(Number(metrics.p50) || 0)} ms`}
          icon={<Gauge size={14} />}
          delta={`p95 ${Math.round(Number(metrics.p95) || 0)} ms · p99 ${Math.round(Number(metrics.p99) || 0)} ms`}
        />
        <StatCard
          label="Throughput"
          value={`${(Number(metrics.throughputPerSec) || 0).toFixed(1)} req/s`}
          icon={<Activity size={14} />}
          delta={`${Number(metrics.completedRequests || 0).toLocaleString()} completed of ${Number(metrics.totalRequests || 0).toLocaleString()}`}
        />
        <StatCard
          label="Success Rate"
          value={`${toPct(metrics.successRate).toFixed(1)}%`}
          tone={colors.green}
          icon={<CircleCheck size={14} />}
          delta={`${Number(metrics.failedRequests || 0).toLocaleString()} failed · ${Number(metrics.droppedRequests || 0).toLocaleString()} dropped`}
        />
        <StatCard
          label="Peak Utilisation"
          value={`${peakUtil.toFixed(1)}%`}
          tone={utilizationColor(peakUtil)}
          icon={<TrendingUp size={14} />}
          delta={`Little's Law L = λW ≈ ${Math.round(derivedConcurrency)} concurrent`}
        />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card
          title="Component utilisation"
          sub="Sorted by utilisation. Components with a capacity of 1000 or more are treated as unbounded buffers and excluded."
        >
          {byUtil.length ? (
            byUtil.map((c) => (
              <UtilBar
                key={c.id}
                value={Number(c.utilization) || 0}
                label={c.name || c.id}
                right={`${(Number(c.utilization) || 0).toFixed(1)}% · ${c.visits ?? 0} visits`}
              />
            ))
          ) : (
            <div className="py-6 text-center text-[12.5px] text-ink-faint">
              Run the simulation to populate utilisation.
            </div>
          )}
        </Card>

        <Card title="Memory footprint" sub="Per-component resident memory against its configured limit.">
          <MemoryChart components={components} />
        </Card>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Response time trend" sub="Latency percentiles sampled across the run window.">
          <LatencyChart series={sim?.latencySeries} />
        </Card>
        <Card title="Queue depth" sub="Waiting requests held at each queueing component over time.">
          <QueueChart series={sim?.queueSeries} />
        </Card>
      </div>

      <Card
        title="Event log"
        sub="Ordered simulation events used as the input to the process mining stage."
        actions={<Badge tone="dim">{Number(logging.loggedEvents || 0).toLocaleString()} logged</Badge>}
      >
        <div className="mb-3 text-[12px] text-ink-faint">
          {Number(logging.loggedEvents || 0).toLocaleString()} events are a deterministic sample of{' '}
          {Number(logging.totalEvents || 0).toLocaleString()} total events, covering{' '}
          {Number(logging.sampledCases || 0).toLocaleString()} of {Number(logging.totalCases || 0).toLocaleString()}{' '}
          simulated cases. Showing the first {Math.min(EVENT_ROWS, eventRows.length)} rows.
        </div>
        <div className="max-h-[200px] overflow-auto">
          <DataTable headers={['Case', 'Activity', 'Component', 't']} rows={eventRows} empty="No events logged yet." />
        </div>
      </Card>
    </div>
  )
}
