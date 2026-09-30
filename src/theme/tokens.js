export const colors = {
  base: '#0A0E14',
  baseAlt: '#0D1219',
  surface: '#10161F',
  raised: '#151C27',
  overlay: '#1A222E',
  line: '#212B38',
  lineSoft: '#182028',
  ink: '#E7EDF4',
  inkDim: '#8996A6',
  inkFaint: '#5B6675',
  accent: '#FFB454',
  teal: '#52E5C7',
  purple: '#C792EA',
  blue: '#7DA6FF',
  red: '#FF6B6B',
  green: '#7EE787',
}

export const fonts = {
  sans: "'IBM Plex Sans', system-ui, sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
}

export const gridSizes = { shell: 28, canvas: 22 }

export const categoryColor = {
  client: colors.teal,
  application: colors.accent,
  data: colors.purple,
  infrastructure: colors.blue,
  security: colors.red,
}

export function withAlpha(hex, alpha) {
  const c = hex.replace('#', '')
  const r = parseInt(c.slice(0, 2), 16)
  const g = parseInt(c.slice(2, 4), 16)
  const b = parseInt(c.slice(4, 6), 16)
  if ([r, g, b].some(Number.isNaN)) return hex
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function scoreColor(score) {
  if (score >= 75) return colors.green
  if (score >= 55) return colors.accent
  return colors.red
}

export function severityColor(severity) {
  if (severity === 'high') return colors.red
  if (severity === 'med') return colors.accent
  return colors.blue
}

export function utilizationColor(utilization) {
  if (utilization > 85) return colors.red
  if (utilization > 65) return colors.accent
  return colors.green
}

export const dimensionMeta = {
  performance: { label: 'Performance', weight: 0.25 },
  scalability: { label: 'Scalability', weight: 0.2 },
  reliability: { label: 'Reliability', weight: 0.15 },
  security: { label: 'Security', weight: 0.15 },
  maintainability: { label: 'Maintainability', weight: 0.15 },
  processEfficiency: { label: 'Process Efficiency', weight: 0.1 },
}

export const dimensionOrder = [
  'performance',
  'scalability',
  'reliability',
  'security',
  'maintainability',
  'processEfficiency',
]

export const chartAxis = {
  tick: { fill: colors.inkFaint, fontSize: 10, fontFamily: fonts.mono },
  axisLine: { stroke: colors.line },
  grid: { stroke: colors.lineSoft },
}

export const tierOrder = ['client', 'security', 'application', 'infrastructure', 'data']

export const tierY = {
  client: 0,
  security: 2.2,
  application: 4.4,
  infrastructure: 6.6,
  data: 8.8,
}
