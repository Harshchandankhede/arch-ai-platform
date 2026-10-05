import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, Boxes, CircleCheck, Gauge, Pause, Play, RotateCcw, TrendingUp, Workflow } from 'lucide-react'
import { useApp, useDispatch } from '../store/AppContext.jsx'
import { defaultWorkload, workloadPresets } from '../store/reducer.js'
import { useResults } from '../store/useResults.js'
import { isClient } from '../data/nodeTypes.js'
import { utilPct } from '../lib/metrics.js'
import { buildTrajectories } from '../lib/trajectories.js'
import { assessLoad } from '../lib/capacity.js'
import ArchitectureFlow, { FlowLegend } from '../components/ArchitectureFlow.jsx'
import {
  resolveSpeed,
  speedLabel,
  WALL_CLOCK_TARGETS,
  REAL_TIME,
  DEFAULT_WALL_CLOCK,
} from '../lib/playback.js'
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
  UtilBar,
  inputClass,
} from '../components/ui.jsx'
import { LatencyChart, MemoryChart, QueueChart } from '../components/charts.jsx'

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
  // How many real seconds the whole run should take while it animates.
  const [wallClock, setWallClock] = useState(DEFAULT_WALL_CLOCK)
  const [capacity, setCapacity] = useState(null)
  const [capacityBusy, setCapacityBusy] = useState(false)
  const [lastSim, setLastSim] = useState(null)
  const [lastTrajectories, setLastTrajectories] = useState([])
  // A completed run is kept visible while a newer one is being computed, so adjusting the
  // load never blanks the page back to the empty state.
  const shownSim = sim ?? lastSim
  // The animation is NEVER automatic. It starts for exactly one reason: the user pressed
  // Start Simulation and the engine result for that request came back. Opening the page
  // with a cached result must not start anything by itself.
  const [playRequested, setPlayRequested] = useState(false)
  // Set by the Start button, consumed by the result effect. A ref, so pressing Start cannot
  // itself trigger a render.
  const runRequested = useRef(false)
  const [flowDone, setFlowDone] = useState(false)
  // Bumping this restarts playback from the beginning.
  const [replayKey, setReplayKey] = useState(0)
  const flowPlaying = playRequested && !flowDone
  // Written directly by the animation each frame, so the page never re-renders while it plays.
  const flowReadout = useRef(null)
  const flowProgress = useRef(null)

  const arrivalRate = workload.arrivalRate ?? defaultWorkload.arrivalRate
  const duration = workload.duration ?? defaultWorkload.duration
  const seed = workload.seed ?? defaultWorkload.seed

  // Speed is a pure function of the chosen target: the run always animates over exactly
  // that many real seconds, whatever the arrival rate.
  const flowSpeed = useMemo(
    () => resolveSpeed({ durationSec: duration, wallClockSec: wallClock }),
    [duration, wallClock],
  )

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
    // Start the animation only for a result the user actually asked for. This effect also
    // runs on mount, where `sim` may already hold a cached result from an earlier session;
    // without the ref check, opening the page would autoplay it.
    if (!sim || !runRequested.current) return
    runRequested.current = false
    setFlowDone(false)
    setPlayRequested(true)
    setReplayKey((k) => k + 1)
  }, [sim, flowTrajectories])

  // Changing the workload does not run anything. It only edits the controls; the engine
  // runs when the user presses Start Simulation. The previous version re-ran the engine on
  // a 420 ms debounce, which meant results could appear without the user ever asking.
  function startRun() {
    runRequested.current = true
    setFlowDone(false)
    setPlayRequested(false)
    run()
  }

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
          <Card
            title="Architecture & live request flow"
            sub={`Dashes travel along each connection at the rate that connection actually carried traffic, measured from the run. Playback covers the ${duration} s workload and then stops.`}
            actions={
              <div className="flex flex-wrap items-center gap-1.5">
                <div className="flex items-center gap-0.5 rounded-[6px] border border-line-soft bg-raised p-0.5">
                  {WALL_CLOCK_TARGETS.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setWallClock(s.key)}
                      title={`Animate the whole run in ${s.label}`}
                      className={`rounded-[4px] px-1.5 py-0.5 font-mono text-[10.5px] transition ${
                        wallClock === s.key ? 'bg-accent text-[#1a1206]' : 'text-ink-faint hover:text-ink'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setWallClock(REAL_TIME)}
                    title="Animate at the rate the engine actually used"
                    className={`rounded-[4px] px-1.5 py-0.5 font-mono text-[10.5px] transition ${
                      wallClock === REAL_TIME ? 'bg-accent text-[#1a1206]' : 'text-ink-faint hover:text-ink'
                    }`}
                  >
                    1:1
                  </button>
                </div>
                {shownSim ? (
                  flowDone ? (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => {
                        setFlowDone(false)
                        setPlayRequested(true)
                        setReplayKey((k) => k + 1)
                      }}
                      icon={<RotateCcw size={13} />}
                    >
                      Replay
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant={flowPlaying ? 'default' : 'primary'}
                      onClick={() => setPlayRequested((v) => !v)}
                      icon={flowPlaying ? <Pause size={13} /> : <Play size={13} />}
                    >
                      {flowPlaying ? 'Pause' : 'Resume'}
                    </Button>
                  )
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
              durationSec={duration}
              truncated={Boolean(viewSim?.truncated)}
              sampleEvery={Number(viewSim?.loggingStats?.sampleEvery) || 1}
              onComplete={() => setFlowDone(true)}
              progressBarRef={flowProgress}
              resetKey={replayKey}
              readout={flowReadout}
            />
            {shownSim ? (
              <>
                <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-overlay">
                  <div
                    ref={flowProgress}
                    className="h-full rounded-full bg-accent"
                    style={{ width: '0%', transition: 'none' }}
                  />
                </div>
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 font-mono text-[10.5px] text-ink-faint">
                  <span>{speedLabel(flowSpeed)}</span>
                  <span>
                    {flowDone ? 'Run complete' : `stops at ${duration} s`}
                    {viewSim?.truncated
                      ? ` · engine stopped early at ${((viewSim.simulatedMs || 0) / 1000).toFixed(0)} s (event budget)`
                      : ''}
                  </span>
                </div>
                <FlowLegend readoutRef={flowReadout} />
              </>
            ) : null}
          </Card>
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
                onClick={startRun}
                disabled={isRunning}
                icon={isRunning ? <SpinnerIcon /> : <Play size={14} />}
              >
                {isRunning ? 'Running…' : viewSim ? 'Run Simulation Again' : 'Start Simulation'}
              </Button>
              <div className="mt-1 text-[11px] text-ink-faint">
                Nothing runs on its own. This button runs the engine and then animates the
                result for the duration set above.
              </div>
              <div className={`mt-2 font-mono text-[11.5px] ${hintTone}`}>{hint}</div>
            </div>
          </Card>

          <Card
            title="Run configuration"
            sub={
              viewSim
                ? 'Exactly what the engine used for the run shown below.'
                : 'What will be handed to the engine. Nothing has run yet.'
            }
          >
            <dl className="space-y-1.5 text-[12.5px]">
              {[
                ['Mode', workload.mode || 'rate'],
                ['Arrival rate', `${arrivalRate} req/s`],
                ['Duration', `${duration} s`],
                ['Seed', String(seed)],
                ['Concurrent users', String(workload.concurrentUsers ?? '—')],
                // Engine-derived, so it stays pending until a run has actually happened.
                ['Reported concurrency', sim ? String(sim.concurrentUsers) : 'awaiting first run'],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3">
                  <dt className="text-ink-faint">{k}</dt>
                  <dd className="truncate font-mono text-ink">{v}</dd>
                </div>
              ))}
            </dl>
            {viewSim?.truncated ? (
              <div className="mt-2.5 rounded-[7px] border border-amber/50 bg-amber/8 px-3 py-2 text-[12px]">
                The engine&apos;s event budget stopped this run at{' '}
                {((viewSim.simulatedMs || 0) / 1000).toFixed(0)} s, before the{' '}
                {((Number(duration) || 0)).toFixed(0)} s requested.
              </div>
            ) : null}
          </Card>

          <Card
            title="Capacity"
            sub="Sweeps the engine upward until the design breaks. Independent of the run above."
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
