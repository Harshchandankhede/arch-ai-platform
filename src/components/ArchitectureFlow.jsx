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
import { edgeTraffic, chooseReplayWindow, locateAt, statsAt } from '../lib/trajectories.js'
import { colors, utilizationColor, withAlpha } from '../theme/tokens.js'

export const CARD_W = 132
export const CARD_H = 88
const GAP = 34
const LABEL_H = 40
const MAX_DOTS = 40

// Playback speeds. Each step is a multiple of real time: 0.1 plays the run ten times
// slower than the engine executed it, which is what makes an individual request traceable
// as it hops between components.
export const FLOW_SPEEDS = [
  { key: 0.02, label: '0.02×' },
  { key: 0.05, label: '0.05×' },
  { key: 0.1, label: '0.1×' },
  { key: 0.25, label: '0.25×' },
  { key: 0.5, label: '0.5×' },
  { key: 1, label: '1×' },
  { key: 2, label: '2×' },
]

export const DEFAULT_SPEED = 0.25

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
  readout,
}) {
  const nodes = useMemo(() => arch?.nodes || [], [arch])
  const edges = useMemo(
    () => (arch?.edges || []).filter((e) => e.source && e.target),
    [arch],
  )
  const cards = useMemo(() => new Map(nodes.map((n) => [n.id, cardOf(n)])), [nodes])

  const traffic = useMemo(() => edgeTraffic(trajectories), [trajectories])

  // Replay the busiest part of the run, wrapping where traffic is thinnest so the loop does
  // not visibly snap. The window shrinks at slow speeds so one loop always takes the same
  // wall-clock time, which slows the motion down rather than stretching a long stretch.
  const window = useMemo(() => {
    const win = chooseReplayWindow(trajectories, { windowMs: Math.max(150, 8 * speed * 1000) })
    return { ...win, span: Math.max(1, win.end - win.start) }
  }, [trajectories, speed])

  // Hottest connection sets the dash speed so relative load between links is visible.
  const maxCount = useMemo(() => {
    let max = 0
    for (const entry of traffic.values()) max = Math.max(max, entry.count)
    return max || 1
  }, [traffic])

  const edgeRefs = useRef([])
  const dotRefs = useRef([])

  useEffect(() => {
    if (!running) return undefined

    let raf = 0
    let previous = performance.now()
    let elapsed = 0

    const tick = (now) => {
      const dt = Math.min(64, now - previous)
      previous = now
      elapsed += dt * speed

      // Each connection's dashes advance in proportion to the traffic it actually carried,
      // so a busy link visibly streams and an idle one barely moves.
      const { span } = window
      for (let i = 0; i < edgeRefs.current.length; i += 1) {
        const el = edgeRefs.current[i]
        if (!el) continue
        const load = Number(el.dataset.load || 0)
        el.setAttribute('stroke-dashoffset', String(-elapsed * (6 + load * 90)))
      }

      // Individual requests, positioned from their real hop timings. Fading near the loop
      // edges keeps the wrap from looking like traffic teleporting backwards.
      const position = (elapsed % span) / span
      const edgeFade = Math.min(1, Math.min(position, 1 - position) / 0.06)
      const at = window.start + position * span

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
        const stats = statsAt(trajectories, at)
        readout.current.textContent =
          `in flight ${stats.inFlight} · completed ${stats.completed} · ` +
          `failed ${stats.failed} · dropped ${stats.dropped}`
      }

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [running, speed, trajectories, cards, window, readout])

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