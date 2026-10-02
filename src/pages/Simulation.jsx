import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, Boxes, CircleCheck, Gauge, Pause, Play, TrendingUp, Workflow } from 'lucide-react'
import { useApp, useDispatch } from '../store/AppContext.jsx'
import { defaultWorkload, workloadPresets } from '../store/reducer.js'
import { useResults } from '../store/useResults.js'
import { isClient } from '../data/nodeTypes.js'
import { utilPct } from '../lib/metrics.js'
import { buildTrajectories } from '../lib/trajectories.js'
import { assessLoad } from '../lib/capacity.js'
import ArchitectureFlow, {
  FlowLegend,
  FLOW_SPEEDS,
  DEFAULT_SPEED,
} from '../components/ArchitectureFlow.jsx'
import { colors, utilizationColor } from '../theme/tokens.js'
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

function SpinnerIcon() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  )
}

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

export default function Simulation() {
  const { currentProject, workload } = useApp()
  const dispatch = useDispatch()
  const arch = currentProject?.arch
  const { sim, status, error, run, runCapacity } = useResults(arch, { autoRun: false })
  const [view, setView] = useState('2d')
  const [flowSpeed, setFlowSpeed] = useState(DEFAULT_SPEED)
  const [capacity, setCapacity] = useState(null)
  const [capacityBusy, setCapacityBusy] = useState(false)
  const [lastSim, setLastSim] = useState(null)
  const [lastTrajectories, setLastTrajectories] = useState([])
  const lastRunKey = useRef(null)
  // A completed run is kept visible while a newer one is being computed, so adjusting the
  // load never blanks the page back to the empty state.
  const shownSim = sim ?? lastSim
  // `null` means "not overridden": the flow autoplays whenever a completed run exists, and
  // only an explicit Pause sticks. Deriving it avoids a state write on every new result.
  const [flowOverride, setFlowOverride] = useState(null)
  const flowPlaying = flowOverride ?? Boolean(shownSim)
  // Written directly by the animation each frame, so the page never re-renders while it plays.
  const flowReadout = useRef(null)

  const arrivalRate = workload.arrivalRate ?? defaultWorkload.arrivalRate
  const duration = workload.duration ?? defaultWorkload.duration
  const seed = workload.seed ?? defaultWorkload.seed

  // Capacity depends only on the architecture, so measure it once per design rather than
  // on every workload tweak.
  useEffect(() => {
    if (!arch) return undefined
    let cancelled = false
    setCapacityBusy(true)
    runCapacity(arch)
      .then((result) => {
        if (cancelled) return
        setCapacity(result)
      })
      .catch((err) => {
        // Never leave the card spinning forever, and never hide why: a silent catch made
        // a failing sweep look identical to one still running.
        if (cancelled) return
        setCapacity({ ok: false, reason: err?.message || 'Capacity analysis failed.' })
      })
      .finally(() => {
        if (!cancelled) setCapacityBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [arch, runCapacity])

  const flowTrajectories = useMemo(
    () => buildTrajectories(sim?.eventLog, { maxCases: 400 }),
    [sim],
  )

  const shownTrajectories = sim ? flowTrajectories : lastTrajectories
  useEffect(() => {
    if (sim) {
      setLastSim(sim)
      setLastTrajectories(flowTrajectories)
    }
  }, [sim, flowTrajectories])

  // Live load: once a run exists, moving the arrival rate re-runs the engine after a short
  // pause so the diagram keeps animating instead of stalling on the new workload.
  const runKey = `${arrivalRate}|${duration}|${seed}`
  useEffect(() => {
    if (!sim) return undefined
    if (runKey === lastRunKey.current) return undefined
    const timer = setTimeout(() => {
      lastRunKey.current = runKey
      run()
    }, 420)
    return () => clearTimeout(timer)
  }, [runKey, sim, run])

  const assessment = useMemo(
    () => assessLoad(capacity, arrivalRate, capacity?.latencyBudgetMs),
    [capacity, arrivalRate],
  )

  const verdictTone =
    assessment.verdict === 'over'
      ? 'red'
      : assessment.verdict === 'at-risk'
        ? 'amber'
        : assessment.verdict === 'sustainable'
          ? 'green'
          : 'dim'
  const verdictLabel =
    assessment.verdict === 'over'
      ? 'over capacity'
      : assessment.verdict === 'at-risk'
        ? 'at risk'
        : assessment.verdict === 'sustainable'
          ? 'sustainable'
          : assessment.verdict === 'underused'
            ? 'headroom'
            : 'unknown'

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
  const isRunning = status === 'running'
  // Prefer the run currently on screen so the diagram keeps its measurements while a newer
  // workload is being simulated.
  const viewSim = shownSim ?? sim
  const metrics = viewSim?.metrics || {}
  const logging = viewSim?.loggingStats || {}
  const components = Object.values(viewSim?.components || {})
  const measured = components.filter((c) => typeof c.capacity === 'number' && c.capacity < 1000)
  const byUtil = [...measured].sort((a, b) => (b.utilization || 0) - (a.utilization || 0))
  const peakUtil = components.reduce((max, c) => Math.max(max, utilPct(c.utilization)), 0)
  const activePreset = workloadPresets.find((p) => presetRate(p.concurrentUsers) === arrivalRate)

  const eventRows = (sim?.eventLog || []).slice(0, EVENT_ROWS).map((e, i) => ({
    key: e.eventId || `${e.caseId || 'case'}-${i}`,
    cells: [e.caseId, e.activity, e.componentName || e.componentId, `${Math.round(Number(e.timestamp) || 0)} ms`],
  }))

  let hint = 'Configure your workload and start the simulation.'
  let hintTone = 'text-ink-faint'
  if (isRunning) {
    hint = 'Simulating…'
    hintTone = 'text-accent'
  } else if (status === 'error') {
    hint = error || 'The simulation engine reported an error.'
    hintTone = 'text-red'
  } else if (viewSim) {
    // Keyed on the run currently on screen, not the raw result, so the readout stays
    // truthful while a new workload is being simulated in the background.
    const stale = viewSim !== sim
    hint = stale
      ? `Showing the previous run — ${Number(metrics.totalRequests || 0).toLocaleString()} requests at ${arrivalRate} req/s. Re-running…`
      : `Complete — ${Number(metrics.totalRequests || 0).toLocaleString()} requests over ${viewSim.duration}s at ${arrivalRate} req/s`
    hintTone = stale ? 'text-accent' : 'text-green'
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
              title="Architecture & live request flow"
              sub="Dashes travel along each connection at the rate that connection actually carried traffic, measured from the run."
              actions={
                <div className="flex flex-wrap items-center gap-1.5">
                  <div className="flex items-center gap-0.5 rounded-[6px] border border-line-soft bg-raised p-0.5">
                    {FLOW_SPEEDS.map((s) => (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => setFlowSpeed(s.key)}
                        className={`rounded-[4px] px-1.5 py-0.5 font-mono text-[10.5px] transition ${
                          flowSpeed === s.key ? 'bg-accent text-[#1a1206]' : 'text-ink-faint hover:text-ink'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {shownSim ? (
                    <Button
                      size="sm"
                      variant={flowPlaying ? 'default' : 'primary'}
                      onClick={() => setFlowOverride(!flowPlaying)}
                      icon={flowPlaying ? <Pause size={13} /> : <Play size={13} />}
                    >
                      {flowPlaying ? 'Pause' : 'Play'}
                    </Button>
                  ) : null}
                </div>
              }
            >
              <ArchitectureFlow
                arch={arch}
                components={viewSim?.components}
                trajectories={shownTrajectories}
                running={flowPlaying}
                speed={flowSpeed}
                readout={flowReadout}
              />
              {shownSim ? <FlowLegend readoutRef={flowReadout} /> : null}
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
                onClick={run}
                disabled={isRunning}
                icon={isRunning ? <SpinnerIcon /> : <Play size={14} />}
              >
                {isRunning ? 'Running…' : viewSim ? 'Run Simulation Again' : 'Start Simulation'}
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

          <Card
            title="Capacity"
            sub="Measured by sweeping the engine upward until the design breaks."
            actions={<Badge tone={verdictTone}>{verdictLabel}</Badge>}
          >
            {capacityBusy ? (
              <div className="py-3">
                <Spinner label="Probing the engine for its ceiling…" />
              </div>
            ) : capacity?.ok ? (
              <>
                <div className="mb-3 grid grid-cols-2 gap-2.5">
                  <StatCard
                    label="Sustainable load"
                    value={`${capacity.sustainableRate.toLocaleString()}${capacity.atCeilingLimit ? '+' : ''}`}
                    tone={colors.teal}
                    icon={<Gauge size={13} />}
                    delta="req/s with no drops, p95 in budget"
                  />
                  <StatCard
                    label="Concurrent users"
                    value={`~${capacity.concurrentUsers.toLocaleString()}`}
                    tone={colors.blue}
                    icon={<TrendingUp size={13} />}
                    delta="Little's Law at that rate"
                  />
                </div>
                <div
                  className={`rounded-panel border px-3.5 py-2.5 text-[12.5px] ${
                    assessment.verdict === 'over'
                      ? 'border-red/50 bg-red/8 text-ink'
                      : assessment.verdict === 'at-risk'
                        ? 'border-amber/50 bg-amber/8 text-ink'
                        : 'border-green/40 bg-green/8 text-ink'
                  }`}
                >
                  {assessment.text}
                </div>
                <dl className="mt-2.5 space-y-1 text-[12px]">
                  {[
                    ['Budget', `p95 ≤ ${capacity.latencyBudgetMs} ms`],
                    ['First rate to break', capacity.breakingRate ? `${capacity.breakingRate} req/s` : 'above the 6,000 req/s search limit'],
                    ['Capped by', capacity.limitedBy || '—'],
                    ['Headroom now', `${Math.max(0, capacity.sustainableRate - arrivalRate).toLocaleString()} req/s`],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-3">
                      <dt className="text-ink-faint">{k}</dt>
                      <dd className="truncate font-mono text-ink">{v}</dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : (
              <div className="py-3 text-[12.5px] text-ink-faint">
                {capacity?.reason || 'Capacity has not been measured for this architecture.'}
              </div>
            )}
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

      {viewSim ? (
        <>
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
        </>
      ) : (
        <Card className="mb-5">
          <Empty
            icon={<Activity size={26} />}
            title="No simulation has been run yet."
            hint="Set the arrival rate, duration and seed on the right, then press Start Simulation. The engine runs the discrete event model, and the results below are produced from that single run."
          />
        </Card>
      )}

      {sim ? (
        <>
          <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card
              title="Component utilisation"
              sub="Sorted by utilisation. Components with a capacity of 1000 or more are treated as unbounded buffers and excluded."
            >
              {byUtil.length ? (
                byUtil.map((c) => (
                  <UtilBar
                    key={c.id}
                    value={utilPct(c.utilization)}
                    label={c.name || c.id}
                    right={`${utilPct(c.utilization).toFixed(1)}% · ${c.visits ?? 0} visits`}
                  />
                ))
              ) : (
                <div className="py-6 text-center text-[12.5px] text-ink-faint">
                  No component was saturated during this run.
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
              {Number(logging.sampledCases || 0).toLocaleString()} of{' '}
              {Number(logging.totalCases || 0).toLocaleString()} simulated cases. Showing the first{' '}
              {Math.min(EVENT_ROWS, eventRows.length)} rows.
            </div>
            <div className="max-h-[200px] overflow-auto">
              <DataTable headers={['Case', 'Activity', 'Component', 't']} rows={eventRows} empty="No events logged yet." />
            </div>
          </Card>
        </>
      ) : null}
    </div>
  )
}
