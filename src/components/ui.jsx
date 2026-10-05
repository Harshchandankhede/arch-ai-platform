import { useEffect, useRef } from 'react'
import { colors, scoreColor, severityColor, utilizationColor, withAlpha } from '../theme/tokens.js'
import { useApp } from '../store/AppContext.jsx'
import { usePrefersReducedMotion } from '../lib/useReducedMotion.js'

export const inputClass =
  'w-full rounded-[7px] border border-line bg-raised px-3 py-2 text-[13.5px] text-ink outline-none focus:border-accent'

export const cardClass = 'rounded-panel border border-line bg-surface'

export function Card({ title, sub, actions, children, className = '', bodyClass = 'p-5' }) {
  return (
    <div className={`${cardClass} ${className}`}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-3 border-b border-line-soft px-5 py-3.5">
          <div>
            {title && <div className="font-mono text-[13px] font-semibold text-ink">{title}</div>}
            {sub && <div className="mt-0.5 text-[11.5px] text-ink-faint">{sub}</div>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </div>
  )
}

const buttonVariants = {
  default: 'border-line bg-raised text-ink hover:border-ink-faint',
  primary: 'border-accent bg-accent text-[#1a1206] hover:brightness-110',
  danger: 'border-red bg-transparent text-red hover:bg-red/10',
  ghost: 'border-transparent bg-transparent text-ink-dim hover:bg-raised hover:text-ink',
}

export function Button({ variant = 'default', size = 'md', icon, children, className = '', ...rest }) {
  const sizing = size === 'sm' ? 'px-2.5 py-1.5 text-[12px]' : 'px-3.5 py-2 text-[13px]'
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-2 rounded-[7px] border font-semibold whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-40 ${buttonVariants[variant]} ${sizing} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}

const badgeTones = {
  green: 'bg-green/12 text-green',
  amber: 'bg-accent/12 text-accent',
  red: 'bg-red/12 text-red',
  blue: 'bg-blue/12 text-blue',
  purple: 'bg-purple/12 text-purple',
  dim: 'bg-overlay text-ink-dim',
}

export function Badge({ tone = 'dim', children, className = '' }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[5px] px-2 py-0.5 font-mono text-[10.5px] font-semibold tracking-wide uppercase ${badgeTones[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <div className={`mb-3.5 ${className}`}>
      {label && (
        <label className="mb-1.5 block font-mono text-[11.5px] tracking-wide text-ink-dim uppercase">{label}</label>
      )}
      {children}
      {hint && <div className="mt-1 text-[11px] text-ink-faint">{hint}</div>}
    </div>
  )
}

export function RangeField({ label, value, onChange, min, max, step = 1, format }) {
  return (
    <div className="mb-3.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[11.5px] tracking-wide text-ink-dim uppercase">{label}</span>
        <span className="font-mono text-[13px] text-accent">{format ? format(value) : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent"
      />
    </div>
  )
}

export function StatCard({ label, value, delta, tone, icon }) {
  const color = tone || colors.ink
  return (
    <div className={`${cardClass} p-4`}>
      <div className="flex items-center justify-between font-mono text-[11px] tracking-wide text-ink-faint uppercase">
        <span>{label}</span>
        {icon}
      </div>
      <div className="mt-2 font-mono text-[26px] font-bold" style={{ color }}>
        {value}
      </div>
      {delta && <div className="mt-1.5 text-[11.5px] text-ink-dim">{delta}</div>}
    </div>
  )
}

export function PageHead({ eyebrow, title, desc, actions }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 font-mono text-[11px] tracking-widest text-accent uppercase">{eyebrow}</div>}
        <h1 className="text-[23px] leading-tight">{title}</h1>
        {desc && <p className="mt-1.5 max-w-2xl text-[13.5px] text-ink-dim">{desc}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Empty({ icon, title, hint, action }) {
  return (
    <div className="px-5 py-12 text-center text-ink-faint">
      {icon && <div className="mb-3 flex justify-center opacity-40">{icon}</div>}
      <div className="text-[13px] text-ink-dim">{title}</div>
      {hint && <div className="mt-1 text-[12px]">{hint}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line-soft">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={`cursor-pointer border-b-2 px-3.5 py-2 font-mono text-[13px] font-semibold whitespace-nowrap ${
            value === t.key ? 'border-accent text-accent' : 'border-transparent text-ink-faint hover:text-ink'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function DataTable({ headers, rows, empty = 'No rows yet.' }) {
  if (!rows.length) {
    return <div className="py-8 text-center text-[12.5px] text-ink-faint">{empty}</div>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                className="px-2.5 pb-2.5 text-left font-mono text-[10.5px] font-semibold tracking-wide text-ink-faint uppercase"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.key || i} className="hover:bg-white/[0.015]">
              {row.cells.map((cell, j) => (
                <td key={j} className="border-t border-line-soft px-2.5 py-2.5 text-[13px]">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function UtilBar({ value, label, right }) {
  const pct = Math.max(0, Math.min(100, value || 0))
  return (
    <div className="mb-3">
      <div className="mb-1.5 flex items-center justify-between text-[12.5px]">
        <span className="truncate">{label}</span>
        <span className="font-mono" style={{ color: utilizationColor(pct) }}>
          {right ?? `${pct.toFixed(1)}%`}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-overlay">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, background: utilizationColor(pct) }}
        />
      </div>
    </div>
  )
}

export function Gauge({ score, label = 'Health Score', size = 220, children, durationMs = 900 }) {
  const value = Math.max(0, Math.min(100, score ?? 0))
  const stroke = size * 0.075
  const radius = (size - stroke) / 2 - 6
  const circumference = Math.PI * radius
  const filled = (value / 100) * circumference
  const color = scoreColor(value)
  const prefersReduced = usePrefersReducedMotion()
  const arcRef = useRef(null)
  // Fraction of the arc already drawn, so a retarget sweeps from where the needle stands
  // rather than snapping back to zero.
  const drawnRef = useRef(0)

  // The arc is driven by hand rather than by a CSS transition. A transition cannot animate
  // the first paint, because React writes the final stroke-dasharray on the very first
  // frame, so the sweep has to start from an explicit 0 and be advanced frame by frame.
  useEffect(() => {
    const el = arcRef.current
    if (!el) return undefined
    const to = value / 100
    const paint = (fraction) => {
      el.setAttribute('stroke-dasharray', `${fraction * circumference} ${circumference}`)
    }

    if (prefersReduced || durationMs <= 0) {
      drawnRef.current = to
      paint(to)
      return undefined
    }

    const from = drawnRef.current
    if (Math.abs(from - to) < 1e-6) return undefined

    let raf = 0
    let startedAt = null
    const step = (now) => {
      if (startedAt === null) startedAt = now
      const t = Math.min(1, (now - startedAt) / durationMs)
      const eased = 1 - (1 - t) ** 3
      const current = from + (to - from) * eased
      paint(current)
      if (t < 1) {
        raf = requestAnimationFrame(step)
      } else {
        // Land exactly on target so repeated updates cannot accumulate rounding drift.
        drawnRef.current = to
        paint(to)
      }
    }

    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, circumference, durationMs, prefersReduced])

  return (
    <div className="flex flex-col items-center justify-center">
      <svg width={size} height={size * 0.62} viewBox={`0 0 ${size} ${size * 0.62}`} role="img" aria-label={`${label || 'Score'}: ${Math.round(value)} of 100`}>
        <path
          d={`M ${stroke / 2 + 6} ${size * 0.62 - 6} A ${radius} ${radius} 0 0 1 ${size - stroke / 2 - 6} ${size * 0.62 - 6}`}
          fill="none"
          stroke={colors.overlay}
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <path
          ref={arcRef}
          d={`M ${stroke / 2 + 6} ${size * 0.62 - 6} A ${radius} ${radius} 0 0 1 ${size - stroke / 2 - 6} ${size * 0.62 - 6}`}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
        />
      </svg>
      <div className="-mt-[38%] text-center">
        {children ?? (
          <div className="font-mono text-[34px] font-bold" style={{ color }}>
            {Math.round(value)}
          </div>
        )}
        {label ? (
          <div className="font-mono text-[10.5px] tracking-wider text-ink-faint uppercase">{label}</div>
        ) : null}
      </div>
    </div>
  )
}

export function RecommendationCard({ rec }) {
  const color = severityColor(rec.severity)
  return (
    <div className={`${cardClass} relative mb-3.5 overflow-hidden p-4`}>
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: color }} />
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone={rec.severity === 'high' ? 'red' : rec.severity === 'med' ? 'amber' : 'blue'}>{rec.severity}</Badge>
        <span className="font-mono text-[10.5px] tracking-wide text-ink-faint uppercase">{rec.dimension}</span>
      </div>
      <h3 className="mb-2.5 text-[14.5px]">{rec.title}</h3>
      {[
        ['Issue', rec.issue],
        ['Why it matters', rec.why],
        ['Recommendation', rec.recommendation],
        ['Expected effect', rec.effect],
      ].map(([k, v]) =>
        v ? (
          <div key={k} className="mb-2 last:mb-0">
            <div className="mb-0.5 font-mono text-[10px] tracking-wider text-ink-faint uppercase">{k}</div>
            <div className="text-[13.5px] text-ink">{v}</div>
          </div>
        ) : null,
      )}
      {rec.expectedImpact && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {rec.expectedImpact.map((e) => (
            <span
              key={e}
              className="rounded-[5px] px-2 py-0.5 font-mono text-[10.5px]"
              style={{ background: withAlpha(color, 0.12), color }}
            >
              {e}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function JsonPreview({ value, maxHeight = 220 }) {
  return (
    <pre
      className="overflow-auto rounded-[8px] border border-line bg-base-alt p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-teal"
      style={{ maxHeight }}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

export function Spinner({ label = 'Working…' }) {
  return (
    <div className="flex items-center gap-2.5 py-8 justify-center text-[12.5px] text-ink-dim">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-accent" />
      {label}
    </div>
  )
}

export function ToastHost() {
  const { toast } = useApp()
  if (!toast) return null
  const color = toast.tone === 'error' ? colors.red : colors.accent
  return (
    <div
      className="fixed right-5 bottom-5 z-50 flex items-center gap-2.5 rounded-[8px] border bg-raised px-4 py-3 font-mono text-[13px] shadow-2xl"
      style={{ borderColor: color, color }}
      role="status"
    >
      {toast.message}
    </div>
  )
}
