import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { chartAxis, colors, dimensionMeta, dimensionOrder } from '../theme/tokens.js'

function PanelTooltip({ active, payload, label, unit = '' }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-[7px] border border-line bg-overlay px-2.5 py-1.5 font-mono text-[11px] shadow-xl">
      {label !== undefined && <div className="mb-1 text-ink-faint">{label}</div>}
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color || p.fill }}>
          {p.name}: {typeof p.value === 'number' ? Math.round(p.value * 10) / 10 : p.value}
          {unit}
        </div>
      ))}
    </div>
  )
}

const axis = { tick: chartAxis.tick, axisLine: false, tickLine: false }
const gridProps = { stroke: colors.lineSoft, strokeDasharray: '2 3' }

export function HealthRadar({ evaluation, height = 240 }) {
  const dims = evaluation?.dimensions || {}
  const data = dimensionOrder.map((key) => ({
    key,
    name: dimensionMeta[key].label,
    score: Math.round(dims[key] ?? 0),
    fullMark: 100,
  }))
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke={colors.lineSoft} />
          <PolarAngleAxis dataKey="name" tick={{ fill: colors.inkDim, fontSize: 10.5, fontFamily: 'IBM Plex Mono' }} />
          <PolarRadiusAxis domain={[0, 100]} tick={{ fill: colors.inkFaint, fontSize: 9 }} tickCount={5} axisLine={false} />
          <Radar
            name="Score"
            dataKey="score"
            stroke={colors.accent}
            fill={colors.accent}
            fillOpacity={0.22}
            strokeWidth={2}
          />
          <Tooltip content={<PanelTooltip unit="/100" />} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function LatencyChart({ series, height = 190 }) {
  const data = (series || []).map((s) => ({
    t: `${s.t}s`,
    p50: Math.round(s.p50),
    p95: Math.round(s.p95),
    p99: Math.round(s.p99),
  }))
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="latP50" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colors.accent} stopOpacity={0.34} />
              <stop offset="100%" stopColor={colors.accent} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid {...gridProps} vertical={false} />
          <XAxis dataKey="t" {...axis} interval="preserveStartEnd" />
          <YAxis {...axis} width={46} unit="ms" />
          <Tooltip content={<PanelTooltip unit="ms" />} />
          <Area
            type="monotone"
            dataKey="p95"
            name="p95"
            stroke={colors.red}
            fill="none"
            strokeWidth={1.6}
            dot={false}
          />
          <Area
            type="monotone"
            dataKey="p50"
            name="p50"
            stroke={colors.accent}
            fill="url(#latP50)"
            strokeWidth={2}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export function QueueChart({ series, height = 180 }) {
  const data = (series || []).map((s) => ({ t: `${s.t}s`, ...s.queues }))
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid {...gridProps} vertical={false} />
          <XAxis dataKey="t" {...axis} interval="preserveStartEnd" />
          <YAxis {...axis} width={40} />
          <Tooltip content={<PanelTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 10.5, fontFamily: 'IBM Plex Mono', color: colors.inkDim }}
            iconSize={8}
          />
          {Object.keys(data[0] || {})
            .filter((k) => k !== 't')
            .map((key, i) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={key}
                stroke={[colors.teal, colors.accent, colors.purple, colors.blue, colors.red][i % 5]}
                strokeWidth={1.5}
                dot={false}
              />
            ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function BottleneckChart({ bottlenecks, height = 200 }) {
  const data = (bottlenecks || []).slice(0, 8).map((b) => ({
    name: b.component,
    waiting: Math.round(b.waitingMs),
    processing: Math.round(b.processingMs),
  }))
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid {...gridProps} vertical={false} />
          <XAxis dataKey="name" {...axis} angle={-18} textAnchor="end" height={54} interval={0} />
          <YAxis {...axis} width={46} unit="ms" />
          <Tooltip content={<PanelTooltip unit="ms" />} />
          <Legend wrapperStyle={{ fontSize: 10.5, fontFamily: 'IBM Plex Mono', color: colors.inkDim }} iconSize={8} />
          <Bar dataKey="waiting" name="Waiting" fill={colors.accent} radius={[3, 3, 0, 0]} />
          <Bar dataKey="processing" name="Processing" fill={colors.blue} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function PathSupportChart({ paths, height = 200 }) {
  const data = (paths || []).slice(0, 8).map((p, i) => ({
    name: `Variant ${i + 1}`,
    cases: p.count,
    support: Number((p.support * 100).toFixed(1)),
  }))
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid {...gridProps} vertical={false} />
          <XAxis dataKey="name" {...axis} />
          <YAxis {...axis} width={46} />
          <Tooltip content={<PanelTooltip />} />
          <Bar dataKey="cases" name="Cases" fill={colors.teal} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function CompareChart({ rows, height = 230 }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid {...gridProps} vertical={false} />
          <XAxis dataKey="metric" {...axis} />
          <YAxis {...axis} width={46} />
          <Tooltip content={<PanelTooltip />} />
          <Legend wrapperStyle={{ fontSize: 10.5, fontFamily: 'IBM Plex Mono', color: colors.inkDim }} iconSize={8} />
          <Bar dataKey="a" name="A" fill={colors.blue} radius={[3, 3, 0, 0]} />
          <Bar dataKey="b" name="B" fill={colors.teal} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ScoreTrendChart({ history, height = 190 }) {
  const data = (history || []).map((h, i) => ({ i: i + 1, score: h.score }))
  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center text-[12px] text-ink-faint" style={{ height }}>
        Answer at least two questions to see a trend.
      </div>
    )
  }
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 8, left: -22, bottom: 0 }}>
          <CartesianGrid {...gridProps} vertical={false} />
          <XAxis dataKey="i" {...axis} />
          <YAxis {...axis} domain={[0, 100]} width={40} />
          <Tooltip content={<PanelTooltip unit="/100" />} />
          <Line type="monotone" dataKey="score" name="Score" stroke={colors.accent} strokeWidth={2} dot={{ r: 2.5 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function MemoryChart({ components, height = 190 }) {
  const data = (components || [])
    .filter((c) => c.memoryLimitMb > 0)
    .slice(0, 10)
    .map((c) => ({ name: c.name, used: Math.round(c.memoryUsedMb), limit: Math.round(c.memoryLimitMb) }))
  if (!data.length) {
    return (
      <div className="flex items-center justify-center text-[12px] text-ink-faint" style={{ height }}>
        No memory data.
      </div>
    )
  }
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
          <CartesianGrid {...gridProps} vertical={false} />
          <XAxis dataKey="name" {...axis} angle={-18} textAnchor="end" height={54} interval={0} />
          <YAxis {...axis} width={46} unit="MB" />
          <Tooltip content={<PanelTooltip unit=" MB" />} />
          <Legend wrapperStyle={{ fontSize: 10.5, fontFamily: 'IBM Plex Mono', color: colors.inkDim }} iconSize={8} />
          <Bar dataKey="used" name="Used" fill={colors.purple} radius={[3, 3, 0, 0]} />
          <Bar dataKey="limit" name="Limit" fill={colors.overlay} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
