import { useEffect, useMemo, useRef } from 'react'
import {
  Boxes,
  Cloud,
  Database,
  Folder,
  Globe,
  ListOrdered,
  Lock,
  Network,
  Radio,
  Server,
  ShieldAlert,
  ShieldCheck,
  Shuffle,
  Smartphone,
  User,
  Zap,
} from 'lucide-react'
import { edgeTraffic, locateAt, statsAt } from '../lib/trajectories.js'
import { colors, utilizationColor, withAlpha } from '../theme/tokens.js'

export const CARD_W = 132
export const CARD_H = 88
const GAP = 34
const LABEL_H = 40
const MAX_DOTS = 40

// Playback timing lives in lib/playback.js. It used to sit here as a bare 0.02x-2x
// multiplier, which cannot express "play the whole run in N seconds".
export { REAL_TIME, WALL_CLOCK_TARGETS, DEFAULT_WALL_CLOCK, resolveSpeed, speedLabel } from '../lib/playback.js'

// Real measurements drive every visual: the dashes travel at the measured throughput on
// that connection, the LOAD badge is the component's utilisation, CONN is how many requests
// are inside it right now, and the alert marker appears when it is genuinely saturated.
const ICONS = {
  user: User,
  webClient: Globe,
  mobileClient: Smartphone,
  apiGateway: ShieldCheck,
  loadBalancer: Shuffle,
  server: Server,
  microservice: Boxes,
  database: Database,
  cache: Zap,
  fileStorage: Folder,
  queue: ListOrdered,
  messageBroker: Radio,
  externalService: Cloud,
  authentication: Lock,
  firewall: ShieldAlert,
}

const FALLBACK_ICON = Network

export function cardOf(node) {
  const x = node?.position?.x ?? 0
  const y = node?.position?.y ?? 0
  return {
    x,
    y,
    w: CARD_W,
    h: CARD_H,
    cx: x + CARD_W / 2,
    cy: y + CARD_H / 2,
    right: x + CARD_W,
    left: x,
    bottom: y + CARD_H,
  }
}

export function boundsOfFlow(node) {
  return cardOf(node)
}

/** Elbow connector between two cards, with the arrowhead landing on the target edge. */
function edgePath(from, to) {
  const sx = from.right
  const sy = from.cy
  const tx = to.left - 10
  const ty = to.cy

  if (tx - sx < 24) {
    // Target sits behind the source: route around it.
    const midX = (sx + tx) / 2
    return `M ${sx} ${sy} C ${sx + 40} ${sy}, ${midX} ${sy - 60}, ${midX} ${sy - 60} L ${midX} ${ty - 60} C ${midX} ${ty - 60}, ${tx - 40} ${ty}, ${tx} ${ty}`
  }

  const dx = Math.max(36, (tx - sx) * 0.5)
  return `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`
}

export default function ArchitectureFlow({
  arch,
  components,
  trajectories = [],
  running = false,
  speed = 1,
  // The configured workload duration in seconds. Playback covers exactly this span and
  // then stops, instead of looping.
  durationSec = 0,
  // True when the engine stopped at its event budget before the duration elapsed.
  truncated = false,
  // The engine's logging stride. Counters read off the sampled log are multiplied by it so
  // the live read-out reflects real concurrency instead of the sample size.
  sampleEvery = 1,
  onComplete,
  // Direct DOM refs so the frame loop can paint progress without re-rendering the page.
  progressBarRef,
  resetKey = 0,
  readout,
}) {
  const nodes = useMemo(() => arch?.nodes || [], [arch])
  const edges = useMemo(
    () => (arch?.edges || []).filter((e) => e.source && e.target),
    [arch],
  )
  const cards = useMemo(() => new Map(nodes.map((n) => [n.id, cardOf(n)])), [nodes])

  const traffic = useMemo(() => edgeTraffic(trajectories), [trajectories])

  // The playback timeline is the configured workload duration, so the run stops exactly
  // where the user asked it to. The one exception is a run the engine had to cut short at
  // its event budget: replaying to the full duration there would leave a long empty tail,
  // so the timeline ends with the data instead.
  const timeline = useMemo(() => {
    const configuredMs = Math.max(0, Number(durationSec) || 0) * 1000
    if (!trajectories.length) {
      return { start: 0, span: Math.max(1, configuredMs), coversRun: false }
    }
    const dataStart = trajectories[0].start
    const dataEnd = trajectories[trajectories.length - 1].end
    const useDataEnd = truncated && dataEnd < configuredMs - 1
    const end = configuredMs > 0 ? (useDataEnd ? dataEnd : configuredMs) : dataEnd
    return {
      start: dataStart,
      span: Math.max(1, end - dataStart),
      coversRun: !(configuredMs > 0 && end < configuredMs - 1),
    }
  }, [trajectories, durationSec, truncated])

  // Hottest connection sets the dash speed so relative load between links is visible.
  const maxCount = useMemo(() => {
    let max = 0
    for (const entry of traffic.values()) max = Math.max(max, entry.count)
    return max || 1
  }, [traffic])

  const edgeRefs = useRef([])
  const dotRefs = useRef([])
  // Playback position lives in a ref so changing speed, pausing or a new result can
  // restart the effect without snapping the run back to zero.
  const clockRef = useRef(0)
  const finishedRef = useRef(false)

  // A new run, or an explicit Replay, restarts from the beginning.
  useEffect(() => {
    clockRef.current = 0
    finishedRef.current = false
    // `progressBarRef` is a ref object owned by the parent, and the element it points at
    // is only rendered once a result exists. Checking the ref object instead of its
    // `current` threw a TypeError on first mount and took the whole page down.
    if (progressBarRef?.current) progressBarRef.current.style.width = '0%'
  }, [resetKey, timeline, progressBarRef])

  useEffect(() => {
    if (!running) return undefined

    let raf = 0
    let previous = performance.now()
    const { span, start } = timeline

    const finish = () => {
      // The completion callback flips parent state, which re-renders and re-runs this
      // effect. Guard so the parent is told about the end of the run exactly once.
      if (finishedRef.current) return
      finishedRef.current = true
      cancelAnimationFrame(raf)
      onComplete?.()
    }

    const tick = (now) => {
      const dt = Math.min(64, now - previous)
      previous = now

      // Clamp to the span rather than wrapping. `% span` is what made the run loop
      // forever; the run must finish on the configured duration and then stop.
      const elapsed = Math.min(span, clockRef.current + dt * speed)
      clockRef.current = elapsed
      const position = span > 0 ? elapsed / span : 1

      // Each connection's dashes advance in proportion to the traffic it actually carried,
      // so a busy link visibly streams and an idle one barely moves.
      for (let i = 0; i < edgeRefs.current.length; i += 1) {
        const el = edgeRefs.current[i]
        if (!el) continue
        const load = Number(el.dataset.load || 0)
        el.setAttribute('stroke-dashoffset', String(-elapsed * (6 + load * 90)))
      }

      // Individual requests, positioned from their real hop timings. Only the tail fades,
      // so requests drain away as the run ends instead of blinking out at a wrap point.
      const at = start + position * span
      const edgeFade = position >= 1 ? 0 : Math.min(1, (1 - position) / 0.05)

      let slot = 0
      for (const traj of trajectories) {
        if (slot >= MAX_DOTS) break
        const where = locateAt(traj, at)
        if (!where) continue
        const from = cards.get(where.kind === 'service' ? where.nodeId : where.fromId)
        const to = cards.get(where.kind === 'service' ? where.nodeId : where.toId)
        if (!from || !to) continue
        const dot = dotRefs.current[slot]
        if (!dot) break

        let x
        let y
        if (where.kind === 'service') {
          // Sitting in a component: hold on the card, rising as its measured service runs.
          x = from.cx
          y = from.cy
        } else {
          x = from.right + (to.left - from.right) * where.progress
          y = from.cy + (to.cy - from.cy) * where.progress
        }
        dot.setAttribute('cx', x.toFixed(1))
        dot.setAttribute('cy', y.toFixed(1))
        dot.setAttribute(
          'fill',
          traj.outcome === 'dropped'
            ? colors.red
            : traj.outcome === 'failed'
              ? colors.accent
              : traj.outcome === 'retried'
                ? colors.purple
                : colors.teal,
        )
        dot.setAttribute('opacity', (0.9 * Math.max(0, edgeFade)).toFixed(2))
        slot += 1
      }
      for (let i = slot; i < MAX_DOTS; i += 1) {
        dotRefs.current[i]?.setAttribute('opacity', '0')
      }

      if (readout?.current && slot > 0) {
        const stats = statsAt(trajectories, at, { scale: sampleEvery })
        // Mark extrapolated numbers so a sampled count is never read as an exact one.
        const approx = stats.estimated ? '~' : ''
        readout.current.textContent =
          `t ${(at / 1000).toFixed(1)}s · in flight ${approx}${stats.inFlight.toLocaleString()} · ` +
          `completed ${approx}${stats.completed.toLocaleString()} · ` +
          `failed ${approx}${stats.failed.toLocaleString()} · dropped ${approx}${stats.dropped.toLocaleString()}`
      }

      // Progress is written straight to the DOM. Calling setState here would re-render the
      // page on every frame.
      if (progressBarRef?.current) progressBarRef.current.style.width = `${(position * 100).toFixed(2)}%`

      // The run has reached the configured duration: stop for good.
      if (elapsed >= span) {
        finish()
        return
      }

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [running, speed, trajectories, cards, timeline, readout, progressBarRef, onComplete, sampleEvery])

  const boxes = nodes.map((n) => cards.get(n.id))
  let viewBox = '0 0 900 460'
  if (boxes.length) {
    const x0 = Math.min(...boxes.map((b) => b.x))
    const y0 = Math.min(...boxes.map((b) => b.y))
    const x1 = Math.max(...boxes.map((b) => b.right))
    const y1 = Math.max(...boxes.map((b) => b.bottom + LABEL_H))
    viewBox = `${x0 - GAP} ${y0 - GAP} ${x1 - x0 + GAP * 2} ${y1 - y0 + GAP * 2}`
  }

  return (
    <svg
      width="100%"
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Architecture diagram with live request flow"
      style={{ height: 430 }}
    >
      <defs>
        <marker
          id="flow-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={colors.inkDim} />
        </marker>
        <filter id="flow-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Connections: a static base line plus an animated dashed overlay. */}
      {edges.map((e, i) => {
        const from = cards.get(e.source)
        const to = cards.get(e.target)
        if (!from || !to) return null
        const d = edgePath(from, to)
        const entry = traffic.get(`${e.source}->${e.target}`)
        const load = entry ? entry.count / maxCount : 0
        return (
          <g key={e.id || `${e.source}->${e.target}`}>
            <path d={d} fill="none" stroke={colors.line} strokeWidth={1.6} markerEnd="url(#flow-arrow)" />
            <path
              ref={(el) => {
                if (el) edgeRefs.current[i] = el
              }}
              d={d}
              fill="none"
              stroke={entry ? colors.teal : colors.inkFaint}
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeDasharray="2 16"
              opacity={entry ? 0.25 + load * 0.7 : 0.12}
              data-load={load}
              data-dir="1"
            />
          </g>
        )
      })}

      {/* Individual requests mid-flight between components. */}
      {Array.from({ length: 40 }).map((_, i) => (
        <circle
          key={`d-${i}`}
          ref={(el) => {
            if (el) dotRefs.current[i] = el
          }}
          r="2.8"
          fill={colors.teal}
          opacity="0"
          style={{ filter: 'drop-shadow(0 0 3px currentColor)' }}
        />
      ))}

      {/* Component cards. */}
      {nodes.map((n) => {
        const card = cards.get(n.id)
        const stat = components?.[n.id]
        const util = stat ? Math.min(100, Math.max(0, (Number(stat.utilization) || 0) * 100)) : null
        const tone = util == null ? colors.inkDim : utilizationColor(util)
        const Icon = ICONS[n.type] || FALLBACK_ICON
        const connections = edges.filter((e) => e.source === n.id || e.target === n.id).length
        const alert = util != null && util >= 85
        return (
          <g key={n.id} transform={`translate(${card.x}, ${card.y})`}>
            <rect
              x={0}
              y={0}
              width={CARD_W}
              height={CARD_H}
              rx={12}
              fill={withAlpha(tone, 0.1)}
              stroke={tone}
              strokeWidth={alert ? 2 : 1.4}
              filter={alert ? 'url(#flow-glow)' : undefined}
            />
            <g transform={`translate(${CARD_W / 2 - 11}, 14)`} style={{ color: tone }}>
              <Icon width={22} height={22} strokeWidth={1.7} />
            </g>

            {/* Utilisation bar along the bottom of the card. */}
            <rect x={10} y={CARD_H - 14} width={CARD_W - 20} height={5} rx={2.5} fill={colors.overlay} />
            {util != null && (
              <rect
                x={10}
                y={CARD_H - 14}
                width={Math.max(2, ((CARD_W - 20) * util) / 100)}
                height={5}
                rx={2.5}
                fill={tone}
              />
            )}

            {alert && (
              <g transform={`translate(${CARD_W - 14}, -14)`}>
                <circle r={9} fill={colors.red} />
                <text
                  textAnchor="middle"
                  y={3.5}
                  style={{ fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 700, fill: '#0A0E14' }}
                >
                  !
                </text>
              </g>
            )}

            <text
              x={CARD_W / 2}
              y={CARD_H + 18}
              textAnchor="middle"
              style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 600, fill: colors.ink }}
            >
              {n.name || n.id}
            </text>

            <g transform={`translate(${CARD_W / 2 - 33}, ${CARD_H + 26})`}>
              <rect
                width={66}
                height={15}
                rx={7.5}
                fill={withAlpha(tone, 0.14)}
                stroke={withAlpha(tone, 0.4)}
                strokeWidth={1}
              />
              <text
                x={33}
                y={10.5}
                textAnchor="middle"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: '0.03em',
                  fill: util == null ? colors.inkDim : tone,
                }}
              >
                {util == null ? `${connections} LINKS` : `LOAD ${util.toFixed(0)}%`}
              </text>
            </g>
          </g>
        )
      })}
    </svg>
  )
}

export function FlowLegend({ readoutRef }) {
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-ink-faint">
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: colors.teal }} />
        request travelling
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: colors.purple }} />
        retried
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: colors.accent }} />
        failed
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: colors.red }} />
        dropped
      </span>
      <span ref={readoutRef} className="font-mono">
        waiting for the replay…
      </span>
    </div>
  )
}