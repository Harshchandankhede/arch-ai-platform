import { withAlpha } from '../theme/tokens.js'

export const NODE_W = 132
export const NODE_H = 56

export function NodeShape({ shape = 'rect', w = NODE_W, h = NODE_H, color, selected = false, fillAlpha = 0.1 }) {
  const stroke = selected ? 'var(--color-accent)' : color
  const strokeWidth = selected ? 2 : 1.4
  const common = { fill: withAlpha(color, fillAlpha), stroke, strokeWidth }

  switch (shape) {
    case 'pill':
      return <rect x={0} y={0} width={w} height={h} rx={h / 2} {...common} />
    case 'cylinder':
      return (
        <g>
          <ellipse cx={w / 2} cy={10} rx={w / 2 - 4} ry={8} fill={withAlpha(color, fillAlpha + 0.06)} stroke={stroke} strokeWidth={strokeWidth} />
          <rect x={4} y={10} width={w - 8} height={h - 18} fill={withAlpha(color, fillAlpha)} />
          <line x1={4} y1={10} x2={4} y2={h - 8} stroke={stroke} strokeWidth={strokeWidth} />
          <line x1={w - 4} y1={10} x2={w - 4} y2={h - 8} stroke={stroke} strokeWidth={strokeWidth} />
          <ellipse cx={w / 2} cy={h - 8} rx={w / 2 - 4} ry={8} fill={withAlpha(color, fillAlpha + 0.06)} stroke={stroke} strokeWidth={strokeWidth} />
        </g>
      )
    case 'cloud':
      return (
        <g>
          <ellipse cx={w * 0.3} cy={h * 0.55} rx={22} ry={16} fill={withAlpha(color, fillAlpha + 0.04)} />
          <ellipse cx={w * 0.55} cy={h * 0.35} rx={26} ry={18} fill={withAlpha(color, fillAlpha + 0.04)} />
          <ellipse cx={w * 0.75} cy={h * 0.55} rx={22} ry={16} fill={withAlpha(color, fillAlpha + 0.04)} />
          <rect x={2} y={2} width={w - 4} height={h - 4} rx={18} fill="none" stroke={stroke} strokeWidth={strokeWidth} />
        </g>
      )
    case 'shield':
      return (
        <path
          d={`M ${w / 2} 2 L ${w - 4} 12 V ${h * 0.55} C ${w - 4} ${h - 6} ${w / 2} ${h - 2} ${w / 2} ${h - 2} C ${w / 2} ${h - 2} 4 ${h - 6} 4 ${h * 0.55} V 12 Z`}
          {...common}
        />
      )
    case 'folder':
      return (
        <path
          d={`M 2 14 h 34 l 8 -8 h ${w - 52} a 4 4 0 0 1 4 4 v ${h - 14} a 4 4 0 0 1 -4 4 H 6 a 4 4 0 0 1 -4 -4 Z`}
          fill={withAlpha(color, fillAlpha + 0.02)}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      )
    case 'stack':
      return (
        <g>
          <rect x={0} y={0} width={w} height={h} rx={6} {...common} />
          <line x1={8} y1={h * 0.33} x2={w - 8} y2={h * 0.33} stroke={stroke} strokeWidth={1} />
          <line x1={8} y1={h * 0.66} x2={w - 8} y2={h * 0.66} stroke={stroke} strokeWidth={1} />
        </g>
      )
    default:
      return <rect x={0} y={0} width={w} height={h} rx={8} {...common} />
  }
}

export function NodeGlyph({ name, sub, shape = 'rect', color, w = NODE_W, h = NODE_H, selected = false, mono = true }) {
  return (
    <g>
      <NodeShape shape={shape} color={color} selected={selected} w={w} h={h} />
      <text
        x={w / 2}
        y={h / 2 - 3}
        textAnchor="middle"
        style={{ fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600, fill: 'var(--color-ink)' }}
      >
        {name}
      </text>
      {sub !== undefined && sub !== null && (
        <text
          x={w / 2}
          y={h / 2 + 11}
          textAnchor="middle"
          style={{ fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)', fontSize: 9, fill: 'var(--color-ink-faint)' }}
        >
          {sub}
        </text>
      )}
    </g>
  )
}

export function boundsOf(node) {
  return {
    x: node.position?.x ?? 0,
    y: node.position?.y ?? 0,
    cx: (node.position?.x ?? 0) + NODE_W / 2,
    cy: (node.position?.y ?? 0) + NODE_H / 2,
    w: NODE_W,
    h: NODE_H,
  }
}
