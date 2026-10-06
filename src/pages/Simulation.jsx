import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, Boxes, CircleCheck, Gauge, Pause, Play, RotateCcw, TrendingUp, TriangleAlert, Workflow } from 'lucide-react'
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
import { colors, successRateColor, utilizationColor } from '../theme/tokens.js'
import { usePrefersReducedMotion } from '../lib/useReducedMotion.js'
import { readSummary } from '../lib/simSummary.js'
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
  const { currentProject, workload, simSummaries } = useApp()
  const dispatch = useDispatch()
  const arch = currentProject?.arch
  const { sim, status, error, run, runCapacity, key: resultKey } = useResults(arch, { autoRun: false })
  // How many real seconds the whole run should take while it animates.
  const [wallClock, setWallClock] = useState(DEFAULT_WALL_CLOCK)
  const [capacity, setCapacity] = useState(null)
  const [capacityBusy, setCapacityBusy] = useState(false)
  // Capacity is a background sweep rather than part of the run, so its detail is collapsed
  // by default. The verdict is always visible in the run summary.
  const [capacityOpen, setCapacityOpen] = useState(false)
  const [lastSim, setLastSim] = useState(null)
  const [lastTrajectories, setLastTrajectories] = useState([])
  // Wall-clock time the run on screen was received. The engine reports no timestamp of its
  // own, and this is only used to label the run. Recorded alongside the other result
  // bookkeeping rather than in an effect of its own, to avoid an extra render per result.
  const [runReceivedAt, setRunReceivedAt] = useState(null)
  // A reader who has asked the system for less motion gets the diagram static. The run is
  // still fully described by the metrics and charts below, so nothing is lost.
  const reducedMotion = usePrefersReducedMotion()
  // A completed run is kept visible while a newer one is being computed, so adjusting the
  // load never blanks the page back to the empty state.
  const shownSim = sim ?? lastSim
  // Declared ahead of the playback block below, which reads the duration.
  const arrivalRate = workload.arrivalRate ?? defaultWorkload.arrivalRate
  const duration = workload.duration ?? defaultWorkload.duration
  const seed = workload.seed ?? defaultWorkload.seed

  // Run summaries survive a reload; the full result does not, because it holds the event log.
  // Read back for this project and this exact configuration, so a moved slider never shows
  // figures from a workload the reader is not looking at.
  const projectId = currentProject?.id || null
  const restoredSummary = useMemo(
    () => (sim ? null : readSummary(simSummaries, projectId, resultKey)),
    [sim, simSummaries, projectId, resultKey],
  )

  // What the summary section renders: a live result if there is one, otherwise the restored
  // record. Never both, so a re-run replaces the restored figures rather than merging with
  // them.
  const summarySim = sim ?? restoredSummary
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

  // Elapsed playback time, polled rather than read from the animation. The animation writes
  // into refs to avoid re-rendering every frame, so there is nothing to render from without a
  // timer of our own. 100 ms is frequent enough to feel live and cheap enough to ignore.
  const [flowElapsed, setFlowElapsed] = useState(0)
  const flowStartedAt = useRef(0)
  useEffect(() => {
    if (!flowPlaying) return undefined
    flowStartedAt.current = Date.now()
    setFlowElapsed(0)
    const id = setInterval(() => {
      setFlowElapsed((Date.now() - flowStartedAt.current) / 1000)
    }, 100)
    return () => clearInterval(id)
  }, [flowPlaying, replayKey])

  // A finished run reads as the full duration rather than wherever the last tick landed.
  useEffect(() => {
    if (flowDone) setFlowElapsed(duration)
  }, [flowDone, duration])

  const toggleFlow = useCallback(() => {
    if (flowDone) {
      setFlowDone(false)
      setPlayRequested(true)
      setReplayKey((k) => k + 1)
      return
    }
    setPlayRequested((v) => !v)
  }, [flowDone])

  const replayFlow = useCallback(() => {
    setFlowDone(false)
    setPlayRequested(true)
    setReplayKey((k) => k + 1)
  }, [])

  // Space toggles playback and R replays, matching the two buttons on the card. Ignored while
  // a form control has focus, so it cannot hijack typing or nudge a slider.
useEffect(() => {
      // shownSim rather than viewSim: this block sits above where viewSim is declared, and
      // the two are the same value.
      if (!shownSim) return undefined
    const onKey = (event) => {
      const el = event.target
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
      if (event.key === ' ') {
        event.preventDefault()
        toggleFlow()
      } else if (event.key === 'r' || event.key === 'R') {
        event.preventDefault()
        replayFlow()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shownSim, toggleFlow, replayFlow])

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

  // Guards against saving the same result twice. The store returns a fresh object on every
  // write, so without this the effect below re-ran itself and drove an update loop.
  const savedSimRef = useRef(null)

  const shownTrajectories = sim ? flowTrajectories : lastTrajectories
  useEffect(() => {
    if (sim) {
      setLastSim(sim)
      setLastTrajectories(flowTrajectories)
      setRunReceivedAt(Date.now())
      // Keep a compact record so these figures survive a reload. The full result, with its
      // event log, is deliberately not stored.
      if (projectId && savedSimRef.current !== sim) {
        savedSimRef.current = sim
        dispatch({ type: 'STORE_SIM_SUMMARY', projectId, resultKey, sim, now: Date.now() })
      }
    }
    // Start the animation only for a result the user actually asked for. This effect also
    // runs on mount, where `sim` may already hold a cached result from an earlier session;
    // without the ref check, opening the page would autoplay it.
    if (!sim || !runRequested.current) return
    runRequested.current = false
    setFlowDone(false)
    // Skipped under reduced motion: the diagram stays static and the Play button remains
    // available, so the choice stays the reader's rather than being taken away.
    setPlayRequested(!reducedMotion)
    setReplayKey((k) => k + 1)
  }, [sim, flowTrajectories, reducedMotion, dispatch, projectId, resultKey])

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
  // True when a newer run is still being computed and the numbers on screen belong to the
  // previous run. Previously signalled only by text colour, which is easy to miss and easy
  // to mistake for the current run when reading results.
  const showingStaleRun = Boolean(viewSim) && viewSim !== sim
  const summarySource = summarySim ?? viewSim
  const metrics = summarySource?.metrics || {}
  const logging = summarySource?.loggingStats || {}
  const components = Object.values(summarySource?.components || {})
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
    // truthful while a new workload is being simulated.
    hint = showingStaleRun
      ? `Showing the previous run — ${Number(metrics.totalRequests || 0).toLocaleString()} requests at ${arrivalRate} req/s. Re-running…`
      : `Complete — ${Number(metrics.totalRequests || 0).toLocaleString()} requests over ${viewSim.duration}s at ${arrivalRate} req/s`
    hintTone = showingStaleRun ? 'text-accent' : 'text-green'
  }

  const derivedConcurrency = (Number(metrics.throughputPerSec) || 0) * (Number(metrics.avgLatencyMs) || 0)

  const successRate = toPct(metrics.successRate)

  // The engine records the configuration the run actually used, so the identity strip reads
  // from the result rather than from the controls. After the sliders are moved, the two
  // disagree, and it is the result that is authoritative for the numbers on screen.
  const runIdentity = summarySource
    ? [
        ['rate', `${Number(summarySource.arrivalRate ?? arrivalRate).toLocaleString()} req/s`],
        ['duration', `${Number(summarySource.duration ?? duration).toFixed(0)} s`],
        ['seed', String(summarySource.seed ?? seed)],
        [
          'simulated',
          `${(Number(summarySource.simulatedMs || 0) / 1000).toFixed(0)} s${summarySource.truncated ? ' (truncated)' : ''}`,
        ],
        // A restored summary keeps when it was produced; a live run is stamped on arrival.
        ...(restoredSummary && !sim
          ? [['recorded', new Date(restoredSummary.savedAt).toLocaleString()]]
          : runReceivedAt
            ? [['recorded', new Date(runReceivedAt).toLocaleTimeString()]]
            : []),
      ]
    : []

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

      {/*
        The summary is placed above the diagram and the control column on purpose. It used to
        render underneath both, which meant the answer to "how did this design perform?" was
        roughly two screens below the button that produces it.
      */}
      {summarySource ? (
        <section aria-label="Run summary" className="mb-5">
          {/*
            A restored summary is labelled as such. It carries the figures and the charts but
            not the event log, so it is presented as a record of a past run rather than as a
            live result, and playback is unavailable rather than silently broken.
          */}
          {restoredSummary && !sim ? (
            <div
              role="status"
              className="mb-3 flex flex-wrap items-center gap-2 rounded-[8px] border border-line-soft bg-raised px-3.5 py-2.5 text-[12.5px] text-ink-dim"
            >
              <Badge tone="dim">restored</Badge>
              <span>
                These figures are from your last session and were saved on this device. Press
                Run Simulation again to re-run the engine and animate the request flow.
              </span>
            </div>
          ) : null}
          {showingStaleRun ? (
            <div
              role="status"
              className="mb-3 flex flex-wrap items-center gap-2 rounded-[8px] border border-accent/50 bg-accent/8 px-3.5 py-2.5 text-[12.5px] text-ink"
            >
              <Badge tone="amber">previous run</Badge>
              <span>
                These numbers belong to the run below, not to the workload currently set in the
                controls. A new run is being computed.
              </span>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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
              value={`${successRate.toFixed(1)}%`}
              // Was hard-coded green, so a run that dropped most of its requests read as a
              // healthy one. Now derived from the same thresholds as utilisation.
              tone={successRateColor(successRate)}
              icon={successRate >= 95 ? <CircleCheck size={14} /> : <TriangleAlert size={14} />}
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

          {/*
            Run identity. Read from the engine result, so it always describes the numbers on
            screen even after the sliders have been moved. This is what makes a figure
            traceable when it is quoted in the write-up.
          */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-[8px] border border-line-soft bg-raised px-3.5 py-2 font-mono text-[11px] text-ink-faint">
            <span className="text-ink-dim">run</span>
            {runIdentity.map(([k, v]) => (
              <span key={k}>
                {k} <span className="text-ink">{v}</span>
              </span>
            ))}
            <span className="ml-auto flex items-center gap-2">
              {/* The capacity verdict was computed and displayed only inside the Capacity
                  card. It is the judgement on this design, so it belongs beside the results. */}
              <span className="text-ink-dim">capacity</span>
              <Badge tone={verdictTone}>{verdictLabel}</Badge>
            </span>
          </div>
        </section>
      ) : (
        <Card className="mb-5">
          <Empty
            icon={<Activity size={26} />}
            title="No simulation has been run yet."
            hint="Set the arrival rate, duration and seed in the Workload panel, then press Start Simulation. The engine runs the discrete event model, and every figure below is produced from that single run."
          />
        </Card>
      )}

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

      <div className="mb-5 grid grid-cols-1 items-start gap-5 min-[1100px]:grid-cols-[2fr_320px]">
        <div className="min-w-0">
          <Card
            title="Architecture & live request flow"
            sub={`Dashes travel along each connection at the rate that connection actually carried traffic, measured from the run. Playback covers the ${duration} s workload and then stops.`}
            actions={
              <div className="flex flex-wrap items-center gap-1.5">
                {/*
                  Playback length. The buttons used to read "5s 10s 20s" with only a tooltip,
                  which reads as a speed rather than a duration the whole run is squeezed
                  into. Labelled explicitly, exposed as a radio group, and each option states
                  the multiplier it produces for the run currently configured.
                */}
                <span className="mr-0.5 font-mono text-[10.5px] text-ink-faint">play in</span>
                <div
                  role="radiogroup"
                  aria-label="Playback length for the whole run"
                  className="flex items-center gap-0.5 rounded-[6px] border border-line-soft bg-raised p-0.5"
                >
                  {WALL_CLOCK_TARGETS.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      role="radio"
                      aria-checked={wallClock === s.key}
                      onClick={() => setWallClock(s.key)}
                      title={`Animate the whole ${duration} s run in ${s.label} (${speedLabel(
                        resolveSpeed({ durationSec: duration, wallClockSec: s.key }),
                      )})`}
                      className={`rounded-[4px] px-1.5 py-0.5 font-mono text-[10.5px] transition ${
                        wallClock === s.key ? 'bg-accent text-[#1a1206]' : 'text-ink-faint hover:text-ink'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={wallClock === REAL_TIME}
                    onClick={() => setWallClock(REAL_TIME)}
                    title="Animate at the rate the engine actually used, with no time compression"
                    className={`rounded-[4px] px-1.5 py-0.5 font-mono text-[10.5px] transition ${
                      wallClock === REAL_TIME ? 'bg-accent text-[#1a1206]' : 'text-ink-faint hover:text-ink'
                    }`}
                  >
                    1:1
                  </button>
                </div>
                {shownSim ? (
                  flowDone ? (
                    <Button size="sm" variant="primary" onClick={replayFlow} icon={<RotateCcw size={13} />}>
                      Replay
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant={flowPlaying ? 'default' : 'primary'}
                      onClick={toggleFlow}
                      icon={flowPlaying ? <Pause size={13} /> : <Play size={13} />}
                    >
                      {flowPlaying ? 'Pause' : flowElapsed > 0 ? 'Resume' : 'Play'}
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
                {reducedMotion ? (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-[7px] border border-line-soft bg-raised px-3 py-2 text-[12px] text-ink-dim">
                    <Badge tone="dim">reduced motion</Badge>
                    <span>
                      Your system asks for reduced motion, so the diagram is held still. Press
                      Play to animate it anyway, or read the metrics and charts below.
                    </span>
                  </div>
                ) : null}

                {/* Was a 1px sliver with only a static "stops at 60 s" caption, which gave no
                    sense of position during a 40s animation. */}
                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-overlay">
                  <div
                    ref={flowProgress}
                    className="h-full rounded-full bg-accent"
                    style={{ width: '0%', transition: 'none' }}
                  />
                </div>
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 font-mono text-[10.5px] text-ink-faint">
                  <span>{speedLabel(flowSpeed)}</span>
                  <span aria-live="off">
                    <span className="text-ink">
                      {flowDone ? `${duration.toFixed(0)} s` : flowElapsed.toFixed(1)} / {duration.toFixed(0)} s
                    </span>
                    {viewSim?.truncated
                      ? ` · engine stopped early at ${((viewSim.simulatedMs || 0) / 1000).toFixed(0)} s (event budget)`
                      : ''}
                  </span>
                </div>
                <div className="mt-1 text-[10.5px] text-ink-faint">
                  Space plays or pauses · R replays
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

          {/*
            "What the engine used", as opposed to the editable Workload panel above it. Both
            listed arrival rate, duration and seed, which read as a duplicate of the
            controls. The panel now reads from the result itself and is titled to say so, so
            the two cannot be confused after the sliders have been moved.
          */}
          <Card
            title="What the engine used"
            sub={
              viewSim
                ? 'Read from the run on screen. Differs from the workload panel once you change it.'
                : 'Nothing has run yet, so this shows what will be handed to the engine.'
            }
          >
            <dl className="space-y-1.5 text-[12.5px]">
              {[
                ['Mode', workload.mode || 'rate'],
                [
                  'Arrival rate',
                  viewSim ? `${Number(viewSim.arrivalRate).toLocaleString()} req/s` : `${arrivalRate} req/s`,
                ],
                ['Duration', viewSim ? `${Number(viewSim.duration).toFixed(0)} s` : `${duration} s`],
                ['Seed', String(viewSim?.seed ?? seed)],
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
            {viewSim && Number(viewSim.arrivalRate) !== arrivalRate ? (
              <div className="mt-2.5 rounded-[7px] border border-accent/50 bg-accent/8 px-3 py-2 text-[12px]">
                The workload panel now says {arrivalRate} req/s. The run above used{' '}
                {Number(viewSim.arrivalRate).toLocaleString()} req/s.
              </div>
            ) : null}
            {viewSim?.truncated ? (
              <div className="mt-2.5 rounded-[7px] border border-amber/50 bg-amber/8 px-3 py-2 text-[12px]">
                The engine&apos;s event budget stopped this run at{' '}
                {((viewSim.simulatedMs || 0) / 1000).toFixed(0)} s, before the{' '}
                {((Number(duration) || 0)).toFixed(0)} s requested.
              </div>
            ) : null}
          </Card>

          {/*
            Capacity is a separate, slower sweep of the engine against this design, not part
            of the run. It is collapsed by default so the control column stays about the run
            the user is doing; the verdict it produces is surfaced in the summary above, so
            collapsing this hides detail without hiding the conclusion.
          */}
          <Card
            title="Capacity analysis"
            sub="Sweeps the engine upward until the design breaks. Independent of the run."
            actions={
              <div className="flex items-center gap-2">
                <Badge tone={verdictTone}>{verdictLabel}</Badge>
                <Button
                  size="sm"
                  onClick={() => setCapacityOpen((v) => !v)}
                  aria-expanded={capacityOpen}
                >
                  {capacityOpen ? 'Hide' : 'Show'}
                </Button>
              </div>
            }
          >
            {!capacityOpen ? (
              <div className="py-1 text-[12.5px] text-ink-faint">
                Collapsed. The verdict is shown in the run summary above.
              </div>
            ) : capacityBusy ? (
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

      {/* Charts and the event log. Kept below the diagram, since they are detail to be read
          after the headline figures and the architecture that produced them. */}
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
