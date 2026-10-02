import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  BaseEdge,
  Controls,
  getSmoothStepPath,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Camera,
  Check,
  CircleAlert,
  CircleCheck,
  Eraser,
  History,
  Link2,
  Pencil,
  Play,
  Redo2,
  RotateCcw,
  ShieldCheck,
  Trash,
  TriangleAlert,
  Undo2,
  Workflow,
  X,
} from 'lucide-react'
import {
  categories,
  categoryOrder,
  clientTypes,
  defaultParams,
  nodeTypes as typeCatalog,
  parameterMeta,
  paramsFor,
  resolveParams,
  typesByCategory,
} from '../data/nodeTypes.js'
import { archHash, toContract } from '../lib/contract.js'
import { canSimulate, validateArchitecture } from '../lib/validate.js'
import { Badge, Button, Empty, Field, JsonPreview, PageHead, Spinner, inputClass } from '../components/ui.jsx'
import { NODE_H, NODE_W, NodeGlyph } from '../components/NodeShapes.jsx'
import { useApp, useDispatch } from '../store/AppContext.jsx'
import { categoryColor, colors, withAlpha } from '../theme/tokens.js'
import { templates, isServerProjectId } from '../services/projects.js'
import { createVersion, deleteVersion, listVersions, renameVersion, restoreVersion } from '../services/architectures.js'

const DND_MIME = 'application/arch-ai-node'
const NODE_KIND = 'arch'
const EDGE_KIND = 'arch'
const MAX_HISTORY = 50
const SAVE_DEBOUNCE = 400
const LAST_VERSION_MESSAGE = 'A project must keep at least one version.'

const HANDLE_STYLE = {
  width: 9,
  height: 9,
  minWidth: 9,
  minHeight: 9,
  background: colors.base,
  border: `1.5px solid ${colors.accent}`,
}

const CANVAS_HINT = 'Drag from the palette to add · Click a node to configure · Drag from a node’s right handle to connect'

function toFlowNode(n) {
  return {
    id: n.id,
    type: NODE_KIND,
    position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
    data: { type: n.type, name: n.name, parameters: { ...(n.parameters || {}) } },
  }
}

function fromFlowNode(n) {
  return {
    id: n.id,
    type: n.data.type,
    name: n.data.name,
    position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
    parameters: { ...n.data.parameters },
  }
}

function toFlowEdge(e) {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    type: EDGE_KIND,
    markerEnd: { type: MarkerType.ArrowClosed, color: colors.inkFaint, width: 15, height: 15 },
  }
}

function fromFlowEdge(e) {
  return { id: e.id, source: e.source, target: e.target }
}

function toArch(graph) {
  return { nodes: graph.nodes.map(fromFlowNode), edges: graph.edges.map(fromFlowEdge) }
}

function makeNodeId(type, taken) {
  let i = 1
  let id = `${type}-${i}`
  while (taken.has(id)) {
    i += 1
    id = `${type}-${i}`
  }
  return id
}

function simulateHint(arch) {
  if (canSimulate(arch)) return ''
  if (!arch.nodes.length) return 'Add at least one component to the canvas.'
  if (!arch.nodes.some((n) => clientTypes.includes(n.type))) {
    return 'Add a User, Web Client or Mobile Client so the architecture has an entry point.'
  }
  if (!arch.edges.length) return 'Connect at least two components so requests can reach a data store.'
  return 'The architecture is not ready to simulate.'
}

function versionFailure(err, fallback) {
  const message = err?.response?.data?.error?.message || err?.message || ''
  if (err?.status === 400 && /at least one version/i.test(message)) return LAST_VERSION_MESSAGE
  return message || fallback
}

function versionNumber(version, index) {
  return version?.versionNumber ?? index + 1
}

function versionCounts(version) {
  const nodeCount = version?.nodeCount ?? version?.arch?.nodes?.length ?? 0
  const edgeCount = version?.edgeCount ?? version?.arch?.edges?.length ?? 0
  return `${nodeCount} node${nodeCount === 1 ? '' : 's'} · ${edgeCount} edge${edgeCount === 1 ? '' : 's'}`
}

function ArchNode({ data, selected }) {
  const meta = typeCatalog[data.type] || { name: data.type, cat: 'application', shape: 'rect' }
  const color = categoryColor[meta.cat] || colors.inkDim
  const label = data.name.length > 18 ? `${data.name.slice(0, 17)}…` : data.name
  return (
    <div className="relative" style={{ width: NODE_W, height: NODE_H }}>
      <Handle type="target" position={Position.Left} id="in" isConnectableStart={false} style={HANDLE_STYLE} />
      <svg
        width={NODE_W}
        height={NODE_H}
        viewBox={`0 0 ${NODE_W} ${NODE_H}`}
        className="block overflow-visible"
        aria-label={data.name}
      >
        {selected && (
          <rect
            x={-6}
            y={-6}
            width={NODE_W + 12}
            height={NODE_H + 12}
            rx={13}
            fill="none"
            stroke={colors.accent}
            strokeWidth={3}
          />
        )}
        <NodeGlyph name={label} sub={meta.name} shape={meta.shape} color={color} selected={selected} />
      </svg>
      <Handle type="source" position={Position.Right} id="out" isConnectableEnd={false} style={HANDLE_STYLE} />
    </div>
  )
}

function ArchEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, animated, style }) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 14,
    offset: 18,
  })
  const active = Boolean(selected || animated)
  const stroke = active ? colors.accent : colors.inkFaint
  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={{ type: MarkerType.ArrowClosed, color: stroke, width: 15, height: 15 }}
      style={{ stroke, strokeWidth: active ? 2.2 : 1.4, ...style }}
    />
  )
}

const NODE_TYPES = { [NODE_KIND]: ArchNode }
const EDGE_TYPES = { [EDGE_KIND]: ArchEdge }

function Palette() {
  const startDrag = (event, type) => {
    event.dataTransfer.setData(DND_MIME, type)
    event.dataTransfer.setData('text/plain', type)
    event.dataTransfer.effectAllowed = 'move'
  }
  return (
    <aside className="flex h-full w-[220px] shrink-0 flex-col overflow-hidden rounded-panel border border-line bg-surface">
      <div className="border-b border-line-soft px-3.5 py-3">
        <div className="font-mono text-[12.5px] font-semibold text-ink">Component palette</div>
        <div className="mt-0.5 text-[11px] text-ink-faint">Drag a component onto the canvas</div>
      </div>
      <div className="flex-1 overflow-y-auto px-2.5 py-3">
        {categoryOrder.map((cat) => (
          <div key={cat} className="mb-3.5 last:mb-0">
            <div className="flex items-center gap-1.5 px-1.5 pb-1.5 font-mono text-[10px] tracking-widest text-ink-faint uppercase">
              <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ background: categoryColor[cat] }} />
              {categories[cat].label}
            </div>
            {typesByCategory(cat).map((type) => (
              <div
                key={type}
                draggable
                onDragStart={(event) => startDrag(event, type)}
                className="mb-1 flex cursor-grab items-center gap-2.5 rounded-[7px] border border-line-soft bg-raised px-2.5 py-2 transition hover:border-ink-faint active:cursor-grabbing"
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-[3px]"
                  style={{ background: withAlpha(categoryColor[cat], 0.22), border: `1px solid ${categoryColor[cat]}` }}
                />
                <span className="truncate text-[12.5px] text-ink">{typeCatalog[type].name}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </aside>
  )
}

function CanvasPane({
  nodes,
  edges,
  linking,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodeClick,
  onPaneClick,
  onDropNode,
  onClear,
  onValidate,
  onCancelLink,
}) {
  const { screenToFlowPosition } = useReactFlow()

  const handleDragOver = useCallback((event) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const handleDrop = useCallback(
    (event) => {
      event.preventDefault()
      const type = event.dataTransfer.getData(DND_MIME)
      if (!type || !typeCatalog[type]) return
      onDropNode(type, screenToFlowPosition({ x: event.clientX, y: event.clientY }))
    },
    [onDropNode, screenToFlowPosition],
  )

  return (
    <div className="blueprint-canvas relative h-full min-w-0 flex-1 overflow-hidden rounded-panel border border-line bg-surface">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        deleteKeyCode={['Backspace', 'Delete']}
        minZoom={0.25}
        maxZoom={2}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        className="h-full w-full"
      >
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>

      <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
        <Button size="sm" icon={<Eraser size={13} />} onClick={onClear} disabled={!nodes.length && !edges.length}>
          Clear canvas
        </Button>
        <Button size="sm" variant="primary" icon={<ShieldCheck size={13} />} onClick={onValidate}>
          Validate
        </Button>
      </div>

      {linking && (
        <div className="pointer-events-none absolute top-3 left-1/2 z-10 -translate-x-1/2">
          <div className="pointer-events-auto flex items-center gap-2 rounded-[8px] border border-accent bg-raised px-3 py-2 font-mono text-[11.5px] text-accent">
            <Link2 size={13} />
            <span>Click a component to connect from {linking.name}</span>
            <button type="button" onClick={onCancelLink} className="cursor-pointer text-ink-faint hover:text-ink">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-[7px] border border-line-soft bg-base-alt/85 px-3 py-1.5 text-center font-mono text-[10.5px] text-ink-faint backdrop-blur">
        {CANVAS_HINT}
      </div>
    </div>
  )
}

function useDraft(initial) {
  const [draft, setDraft] = useState(String(initial))
  const [source, setSource] = useState(initial)
  if (source !== initial) {
    setSource(initial)
    setDraft(String(initial))
  }
  return [draft, setDraft]
}

function ParamField({ paramKey, value, onCommit, onBeginEdit }) {
  const meta = parameterMeta[paramKey] || {}
  const [draft, setDraft] = useDraft(value)
  const min = meta.min
  const max = meta.max

  const handleChange = (event) => {
    const raw = event.target.value
    setDraft(raw)
    if (raw === '') return
    const next = Number(raw)
    if (Number.isNaN(next)) return
    if (min !== undefined && next < min) return
    if (max !== undefined && next > max) return
    onCommit(next)
  }

  return (
    <Field label={meta.label || paramKey} hint={meta.unit ? `Unit: ${meta.unit}` : null}>
      <div className="relative">
        <input
          type="number"
          className={`${inputClass} pr-16 font-mono`}
          min={min}
          max={max}
          step={meta.step ?? 1}
          value={draft}
          onFocus={onBeginEdit}
          onChange={handleChange}
        />
        <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded-[4px] bg-overlay px-1.5 py-0.5 font-mono text-[10px] text-ink-faint">
          {meta.unit || '—'}
        </span>
      </div>
    </Field>
  )
}

function TypePill({ type }) {
  const meta = typeCatalog[type] || { name: type, cat: 'application' }
  const color = categoryColor[meta.cat] || colors.inkDim
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-[5px] px-2 py-1 font-mono text-[10.5px] font-semibold tracking-wide uppercase"
      style={{ background: withAlpha(color, 0.12), color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {categories[meta.cat]?.label || meta.cat} · {meta.name}
    </span>
  )
}

function PropertyPanel({ node, onRename, onParam, onBeginEdit, onConnectFrom, onDelete }) {
  if (!node) {
    return (
      <div className="mb-4 rounded-[8px] border border-line-soft bg-raised px-3 py-3 text-[12px] text-ink-dim">
        Select a component on the canvas to configure its name and parameters.
      </div>
    )
  }
  const params = resolveParams(node)
  const keys = paramsFor(node.type)
  return (
    <div className="mb-4">
      <TypePill type={node.type} />
      <div className="mt-3">
        <NameField node={node} onRename={onRename} onBeginEdit={onBeginEdit} />
      </div>
      <Field label="Component ID">
        <input className={`${inputClass} font-mono text-ink-faint`} value={node.id} readOnly />
      </Field>
      {keys.length === 0 ? (
        <div className="rounded-[8px] border border-line-soft bg-raised px-3 py-2.5 text-[11.5px] text-ink-faint">
          Client components have no tunable parameters — they only inject traffic.
        </div>
      ) : (
        keys.map((key) => (
          <ParamField
            key={key}
            paramKey={key}
            value={params[key]}
            onCommit={(next) => onParam(node.id, key, next)}
            onBeginEdit={onBeginEdit}
          />
        ))
      )}
      <div className="mt-4 flex gap-2">
        <Button size="sm" className="flex-1 justify-center" icon={<Link2 size={13} />} onClick={onConnectFrom}>
          Connect from here
        </Button>
        <Button size="sm" variant="danger" icon={<Trash size={13} />} onClick={onDelete}>
          Delete
        </Button>
      </div>
    </div>
  )
}

function NameField({ node, onRename, onBeginEdit }) {
  const [draft, setDraft] = useDraft(node.name)
  return (
    <Field label="Name">
      <input
        className={inputClass}
        value={draft}
        onFocus={onBeginEdit}
        onChange={(event) => {
          const next = event.target.value
          setDraft(next)
          if (!next.trim()) return
          onRename(node.id, next)
        }}
      />
    </Field>
  )
}

function ValidationPanel({ result }) {
  const { valid, errors, warnings } = result
  return (
    <div className="rounded-panel border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line-soft px-3.5 py-2.5">
        <span className="font-mono text-[12px] font-semibold text-ink">Validation</span>
        {valid ? <Badge tone="green">pass</Badge> : <Badge tone="red">{`${errors.length} error${errors.length === 1 ? '' : 's'}`}</Badge>}
      </div>
      <div className="p-3">
        {errors.map((err, i) => (
          <div key={`err-${i}`} className="mb-1.5 flex gap-1.5 text-[11.5px] text-red">
            <CircleAlert size={13} className="mt-0.5 shrink-0" />
            <span>{err}</span>
          </div>
        ))}
        {warnings.map((warn, i) => (
          <div key={`warn-${i}`} className="mb-1.5 flex gap-1.5 text-[11.5px] text-accent">
            <TriangleAlert size={13} className="mt-0.5 shrink-0" />
            <span>{warn}</span>
          </div>
        ))}
        {valid && !warnings.length && (
          <div className="flex items-center gap-1.5 text-[11.5px] text-green">
            <CircleCheck size={13} />
            No issues found — ready to simulate.
          </div>
        )}
        {valid && !!warnings.length && (
          <div className="mt-1 font-mono text-[11px] text-ink-faint">{`${warnings.length} warning${warnings.length === 1 ? '' : 's'}`}</div>
        )}
      </div>
    </div>
  )
}

function VersionRow({
  version,
  index,
  busy,
  editing,
  draft,
  onDraftChange,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onRestore,
  onDelete,
}) {
  const number = versionNumber(version, index)
  const locked = busy === version.id
  const compact = 'px-2 py-1 font-mono text-[11px]'
  return (
    <div className="border-t border-line-soft px-3.5 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              className={`${inputClass} ${compact}`}
              value={draft}
              autoFocus
              aria-label={`Rename version ${number}`}
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onCommitRename(version.id)
                if (event.key === 'Escape') onCancelRename()
              }}
            />
          ) : (
            <div className="truncate text-[12.5px] text-ink">{version.label || `Version ${number}`}</div>
          )}
          <div className="mt-0.5 font-mono text-[10.5px] text-ink-faint">{`v${number} · ${versionCounts(version)}`}</div>
        </div>
        {version.isCurrent ? <Badge tone="amber">current</Badge> : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button size="sm" icon={<RotateCcw size={12} />} disabled={locked || version.isCurrent} onClick={() => onRestore(version.id)}>
          Restore
        </Button>
        {editing ? (
          <>
            <Button size="sm" icon={<Check size={12} />} onClick={() => onCommitRename(version.id)}>
              Save
            </Button>
            <Button size="sm" icon={<X size={12} />} onClick={onCancelRename}>
              Cancel
            </Button>
          </>
        ) : (
          <Button size="sm" icon={<Pencil size={12} />} onClick={() => onStartRename(version)}>
            Rename
          </Button>
        )}
        <Button size="sm" variant="danger" icon={<Trash size={12} />} disabled={locked} onClick={() => onDelete(version.id)}>
          Delete
        </Button>
      </div>
    </div>
  )
}

function VersionPanel({
  versions,
  loading,
  busy,
  label,
  editingId,
  draft,
  onLabelChange,
  onSave,
  onRestore,
  onDelete,
  onStartRename,
  onDraftChange,
  onCommitRename,
  onCancelRename,
}) {
  return (
    <div className="mt-4 rounded-panel border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line-soft px-3.5 py-2.5">
        <span className="flex items-center gap-1.5 font-mono text-[12px] font-semibold text-ink">
          <History size={13} className="text-ink-faint" />
          Version history
        </span>
        <span className="font-mono text-[10.5px] text-ink-faint">{`${versions.length} saved`}</span>
      </div>
      <div className="p-3">
        <div className="flex gap-1.5">
          <input
            className={`${inputClass} px-2 py-1.5 font-mono text-[11.5px]`}
            value={label}
            placeholder="Snapshot"
            aria-label="New version label"
            onChange={(event) => onLabelChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              onSave()
            }}
          />
          <Button size="sm" variant="primary" icon={<Camera size={12} />} disabled={busy === 'save'} onClick={onSave}>
            Save
          </Button>
        </div>
        <div className="mt-1 text-[11px] text-ink-faint">
          Captures the canvas exactly as drawn — component positions included.
        </div>
        {loading ? (
          <Spinner label="Loading versions…" />
        ) : versions.length ? (
          <div className="mt-2">
            {versions.map((version, i) => (
              <VersionRow
                key={version.id}
                version={version}
                index={i}
                busy={busy}
                editing={editingId === version.id}
                draft={draft}
                onDraftChange={onDraftChange}
                onStartRename={onStartRename}
                onCommitRename={onCommitRename}
                onCancelRename={onCancelRename}
                onRestore={onRestore}
                onDelete={onDelete}
              />
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-[8px] border border-line-soft bg-raised px-3 py-2.5 text-[11.5px] text-ink-faint">
            No saved versions yet — save a snapshot to start a history you can roll back to.
          </div>
        )}
      </div>
    </div>
  )
}

export default function Builder() {
  const { currentProject, notify } = useApp()
  const dispatch = useDispatch()
  const navigate = useNavigate()

  const projectId = currentProject?.id || null

  const seedArch = currentProject?.arch || { nodes: [], edges: [] }
  const [nodes, setNodes] = useState(() => seedArch.nodes.map(toFlowNode))
  const [edges, setEdges] = useState(() => seedArch.edges.map(toFlowEdge))
  const [result, setResult] = useState(() => validateArchitecture(seedArch))
  const [linkFrom, setLinkFrom] = useState(null)
  const [hist, setHist] = useState({ past: 0, future: 0 })
  const [versions, setVersions] = useState([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [versionBusy, setVersionBusy] = useState(null)
  const [versionLabel, setVersionLabel] = useState('')
  const [editingVersionId, setEditingVersionId] = useState(null)
  const [versionDraft, setVersionDraft] = useState('')

  const historyRef = useRef({ past: [], future: [] })
  const projectRef = useRef(currentProject?.id || null)
  const savedRef = useRef(currentProject ? `${currentProject.id}:${archHash(seedArch)}` : '')
  const pendingRef = useRef(null)
  const liveRef = useRef({ nodes, edges })
  const versionsProjectRef = useRef(null)

  useEffect(() => {
    liveRef.current = { nodes, edges }
  })

  useEffect(() => {
    if (!currentProject) return
    if (projectRef.current === currentProject.id) return
    projectRef.current = currentProject.id
    const next = currentProject.arch || { nodes: [], edges: [] }
    setNodes(next.nodes.map(toFlowNode))
    setEdges(next.edges.map(toFlowEdge))
    setResult(validateArchitecture(next))
    setLinkFrom(null)
    historyRef.current = { past: [], future: [] }
    setHist({ past: 0, future: 0 })
    pendingRef.current = null
    savedRef.current = `${currentProject.id}:${archHash(next)}`
  }, [currentProject])

  const structureKey = JSON.stringify([
    nodes.map((n) => [n.id, n.data.type, n.data.name, n.data.parameters]),
    edges.map((e) => [e.id, e.source, e.target]),
  ])

  useEffect(() => {
    setResult(validateArchitecture(toArch(liveRef.current)))
  }, [structureKey])

  useEffect(() => {
    if (!currentProject) return
    const arch = toArch({ nodes, edges })
    const key = `${currentProject.id}:${archHash(arch)}`
    if (savedRef.current === key) return
    pendingRef.current = { projectId: currentProject.id, arch }
    const timer = setTimeout(() => {
      savedRef.current = key
      pendingRef.current = null
      dispatch({ type: 'SET_ARCH', projectId: currentProject.id, arch })
    }, SAVE_DEBOUNCE)
    return () => clearTimeout(timer)
  }, [nodes, edges, currentProject, dispatch])

  useEffect(
    () => () => {
      const pending = pendingRef.current
      if (!pending) return
      pendingRef.current = null
      savedRef.current = `${pending.projectId}:${archHash(pending.arch)}`
      dispatch({ type: 'SET_ARCH', projectId: pending.projectId, arch: pending.arch })
    },
    [dispatch],
  )

  const refreshVersions = useCallback(
    async (isStale) => {
      if (!projectId) {
        versionsProjectRef.current = null
        return
      }
      // Seed/local projects carry short ids ("p2") that the server cannot resolve.
      // Asking anyway produced a guaranteed 404 and, before the notify-identity fix,
      // an unbounded request loop. Skip the call instead.
      if (!isServerProjectId(projectId)) {
        versionsProjectRef.current = projectId
        setVersions([])
        setVersionsLoading(false)
        return
      }
      if (versionsProjectRef.current !== projectId) {
        versionsProjectRef.current = projectId
        setVersions([])
      }
      setVersionsLoading(true)
      try {
        const list = await listVersions(projectId)
        if (isStale?.()) return
        setVersions(Array.isArray(list) ? list : [])
      } catch (err) {
        if (isStale?.()) return
        setVersions([])
        notify(versionFailure(err, 'Could not load version history.'), 'error')
      } finally {
        if (!isStale?.()) setVersionsLoading(false)
      }
    },
    [projectId, notify],
  )

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      await refreshVersions(() => cancelled)
    })()

    return () => {
      cancelled = true
    }
  }, [refreshVersions, projectId])

  const recordHistory = useCallback(() => {
    const snap = toArch({ nodes, edges })
    const h = historyRef.current
    const last = h.past[h.past.length - 1]
    if (!last || JSON.stringify(last) !== JSON.stringify(snap)) {
      h.past.push(snap)
      if (h.past.length > MAX_HISTORY) h.past.shift()
    }
    h.future = []
    setHist({ past: h.past.length, future: 0 })
  }, [nodes, edges])

  const undo = useCallback(() => {
    const h = historyRef.current
    if (!h.past.length) return
    const prev = h.past[h.past.length - 1]
    h.past = h.past.slice(0, -1)
    h.future = [toArch({ nodes, edges }), ...h.future].slice(0, MAX_HISTORY)
    setNodes(prev.nodes.map(toFlowNode))
    setEdges(prev.edges.map(toFlowEdge))
    setLinkFrom(null)
    setHist({ past: h.past.length, future: h.future.length })
  }, [nodes, edges])

  const redo = useCallback(() => {
    const h = historyRef.current
    if (!h.future.length) return
    const next = h.future[0]
    h.future = h.future.slice(1)
    h.past = [...h.past, toArch({ nodes, edges })].slice(-MAX_HISTORY)
    setNodes(next.nodes.map(toFlowNode))
    setEdges(next.edges.map(toFlowEdge))
    setLinkFrom(null)
    setHist({ past: h.past.length, future: h.future.length })
  }, [nodes, edges])

  useEffect(() => {
    const onKey = (event) => {
      const target = event.target
      const typing =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable === true)
      if (event.key === 'Escape' && linkFrom) {
        setLinkFrom(null)
        return
      }
      if (typing) return
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      if (key === 'z' && event.shiftKey) {
        event.preventDefault()
        redo()
      } else if (key === 'z') {
        event.preventDefault()
        undo()
      } else if (key === 'y') {
        event.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, linkFrom])

  const patchNode = useCallback((id, patch) => {
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)))
  }, [])

  const handleRename = useCallback(
    (id, name) => patchNode(id, { name }),
    [patchNode],
  )

  const handleParam = useCallback(
    (id, key, value) => patchNode(id, { parameters: { ...(nodes.find((n) => n.id === id)?.data.parameters || {}), [key]: value } }),
    [nodes, patchNode],
  )

  const onNodesChange = useCallback(
    (changes) => {
      if (changes.some((c) => c.type === 'remove' || c.type === 'add')) recordHistory()
      setNodes((nds) => applyNodeChanges(changes, nds))
    },
    [recordHistory],
  )

  const onEdgesChange = useCallback(
    (changes) => {
      if (changes.some((c) => c.type === 'remove' || c.type === 'add')) recordHistory()
      setEdges((eds) => applyEdgeChanges(changes, eds))
    },
    [recordHistory],
  )

  const onConnect = useCallback(
    (conn) => {
      if (conn.source === conn.target) {
        notify('A component cannot connect to itself.', 'error')
        return
      }
      recordHistory()
      setEdges((eds) =>
        addEdge(toFlowEdge({ id: `e-${conn.source}-${conn.target}`, source: conn.source, target: conn.target }), eds),
      )
    },
    [notify, recordHistory],
  )

  const connect = useCallback(
    (source, target) => {
      if (source === target) {
        notify('A component cannot connect to itself.', 'error')
        return
      }
      if (edges.some((e) => e.source === source && e.target === target)) {
        notify('Those components are already connected.', 'error')
        return
      }
      recordHistory()
      setEdges((eds) => [...eds, toFlowEdge({ id: `e-${source}-${target}`, source, target })])
      notify('Connection added')
    },
    [edges, notify, recordHistory],
  )

  const onNodeClick = useCallback(
    (event, node) => {
      if (!linkFrom) return
      if (linkFrom.id !== node.id) connect(linkFrom.id, node.id)
      setLinkFrom(null)
    },
    [linkFrom, connect],
  )

  const onDropNode = useCallback(
    (type, position) => {
      const id = makeNodeId(type, new Set(nodes.map((n) => n.id)))
      const created = toFlowNode({
        id,
        type,
        name: typeCatalog[type].name,
        position: { x: Math.round(position.x - NODE_W / 2), y: Math.round(position.y - NODE_H / 2) },
        parameters: defaultParams(type),
      })
      recordHistory()
      setNodes((nds) => [...nds.map((n) => (n.selected ? { ...n, selected: false } : n)), { ...created, selected: true }])
      notify(`${typeCatalog[type].name} added to the canvas`)
    },
    [nodes, notify, recordHistory],
  )

  const deleteNode = useCallback(
    (id) => {
      recordHistory()
      setNodes((nds) => nds.filter((n) => n.id !== id))
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id))
      setLinkFrom(null)
      notify('Component removed')
    },
    [notify, recordHistory],
  )

  const clearCanvas = useCallback(() => {
    if (!window.confirm('Clear the canvas? Every component and connection will be removed.')) return
    recordHistory()
    setNodes([])
    setEdges([])
    setLinkFrom(null)
    notify('Canvas cleared')
  }, [notify, recordHistory])

  const loadTemplate = useCallback(
    (key) => {
      const template = templates.find((t) => t.key === key)
      if (!template) return
      if (!window.confirm(`Replace the current canvas with “${template.label}”?`)) return
      const built = template.build() || { nodes: [], edges: [] }
      recordHistory()
      setNodes(built.nodes.map(toFlowNode))
      setEdges(built.edges.map(toFlowEdge))
      setLinkFrom(null)
      notify(`Loaded template: ${template.label}`)
    },
    [notify, recordHistory],
  )

  const runValidate = useCallback(() => {
    const arch = toArch({ nodes, edges })
    const next = validateArchitecture(arch)
    setResult(next)
    if (!next.valid) notify(`${next.errors.length} error(s) found — see the validation panel.`, 'error')
    else if (next.warnings.length) notify(`Valid, with ${next.warnings.length} warning(s).`)
    else notify('Architecture is valid and ready to simulate.')
  }, [nodes, edges, notify])

  const saveSnapshot = useCallback(async () => {
    if (!projectId) return
    setVersionBusy('save')
    try {
      await createVersion(projectId, { label: versionLabel.trim(), arch: toArch({ nodes, edges }) })
      setVersionLabel('')
      notify('Snapshot saved to version history')
      await refreshVersions()
    } catch (err) {
      notify(versionFailure(err, 'Could not save the snapshot.'), 'error')
    } finally {
      setVersionBusy(null)
    }
  }, [projectId, versionLabel, nodes, edges, notify, refreshVersions])

  const restoreSnapshot = useCallback(
    async (versionId) => {
      if (!projectId) return
      setVersionBusy(versionId)
      try {
        const res = await restoreVersion(projectId, versionId)
        const restored = res?.project?.arch || res?.arch
        if (!restored) {
          notify('That version came back without an architecture — nothing was restored.', 'error')
          return
        }
        const restoredFlow = {
          nodes: (restored.nodes || []).map(toFlowNode),
          edges: (restored.edges || []).map(toFlowEdge),
        }
        const next = toArch(restoredFlow)
        recordHistory()
        setNodes(restoredFlow.nodes)
        setEdges(restoredFlow.edges)
        setResult(validateArchitecture(next))
        setLinkFrom(null)
        pendingRef.current = null
        savedRef.current = `${projectId}:${archHash(next)}`
        dispatch({ type: 'SET_ARCH', projectId, arch: next })
        notify('Version restored — the canvas now matches that snapshot')
        await refreshVersions()
      } catch (err) {
        notify(versionFailure(err, 'Could not restore that version.'), 'error')
      } finally {
        setVersionBusy(null)
      }
    },
    [projectId, dispatch, notify, recordHistory, refreshVersions],
  )

  const startRenameVersion = useCallback((version) => {
    setEditingVersionId(version.id)
    setVersionDraft(version.label || '')
  }, [])

  const cancelRenameVersion = useCallback(() => {
    setEditingVersionId(null)
    setVersionDraft('')
  }, [])

  const commitRenameVersion = useCallback(
    async (versionId) => {
      if (!projectId) return
      const nextLabel = versionDraft.trim()
      setVersionBusy(versionId)
      try {
        await renameVersion(projectId, versionId, nextLabel)
        setEditingVersionId(null)
        setVersionDraft('')
        notify('Version renamed')
        await refreshVersions()
      } catch (err) {
        notify(versionFailure(err, 'Could not rename that version.'), 'error')
      } finally {
        setVersionBusy(null)
      }
    },
    [projectId, versionDraft, notify, refreshVersions],
  )

  const removeVersion = useCallback(
    async (versionId) => {
      if (!projectId) return
      if (!window.confirm('Delete this version? This cannot be undone.')) return
      setVersionBusy(versionId)
      try {
        await deleteVersion(projectId, versionId)
        notify('Version deleted')
        await refreshVersions()
      } catch (err) {
        notify(versionFailure(err, 'Could not delete that version.'), 'error')
      } finally {
        setVersionBusy(null)
      }
    },
    [projectId, notify, refreshVersions],
  )

  const arch = toArch({ nodes, edges })
  const contract = toContract(arch)
  const simReady = canSimulate(arch)
  const simHint = simulateHint(arch)
  const selectedFlow = nodes.find((n) => n.selected) || null
  const selectedNode = selectedFlow ? fromFlowNode(selectedFlow) : null

  if (!currentProject) {
    return (
      <div className="rounded-panel border border-line bg-surface">
        <Empty
          icon={<Workflow size={30} />}
          title="No project selected"
          hint="Open a project before designing an architecture."
          action={
            <Button variant="primary" onClick={() => navigate('/projects')}>
              Go to my projects
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div>
      <PageHead
        eyebrow="Architecture Builder"
        title={currentProject.name}
        desc="Drag components onto the canvas, wire them together and tune their parameters. Every structural change is validated and persisted to the project."
        actions={
          <>
            <Button size="sm" icon={<Undo2 size={14} />} onClick={undo} disabled={!hist.past}>
              Undo
            </Button>
            <Button size="sm" icon={<Redo2 size={14} />} onClick={redo} disabled={!hist.future}>
              Redo
            </Button>
            <Button size="sm" icon={<ShieldCheck size={14} />} onClick={runValidate}>
              Validate
            </Button>
            <select
              aria-label="Load template"
              className={`${inputClass} w-[200px] py-1.5 font-mono text-[12px]`}
              value=""
              onChange={(event) => loadTemplate(event.target.value)}
            >
              <option value="" disabled>
                Load template…
              </option>
              {templates.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="primary"
              icon={<Play size={14} />}
              disabled={!simReady}
              title={simHint || 'Run the simulation for this architecture'}
              onClick={() => navigate('/simulation')}
            >
              Run Simulation
            </Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-panel border border-line-soft bg-surface px-3.5 py-2">
        <div className="font-mono text-[11.5px] text-ink-dim">
          {`${nodes.length} component${nodes.length === 1 ? '' : 's'} · ${edges.length} connection${
            edges.length === 1 ? '' : 's'
          }`}
          {result.valid ? (
            <span className="text-green"> · valid</span>
          ) : (
            <span className="text-red">{` · ${result.errors.length} error${result.errors.length === 1 ? '' : 's'}`}</span>
          )}
        </div>
        {simHint ? <div className="text-[11.5px] text-ink-faint">{`Simulation unavailable: ${simHint}`}</div> : null}
      </div>

      <div className="flex h-[calc(100vh-140px)] min-h-[560px] gap-3">
        <Palette />

        <ReactFlowProvider>
          <CanvasPane
            nodes={nodes}
            edges={edges}
            linking={linkFrom}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={() => setLinkFrom(null)}
            onDropNode={onDropNode}
            onClear={clearCanvas}
            onValidate={runValidate}
            onCancelLink={() => setLinkFrom(null)}
          />
        </ReactFlowProvider>

        <aside className="h-full w-[280px] shrink-0 overflow-y-auto rounded-panel border border-line bg-surface">
          <div className="border-b border-line-soft px-3.5 py-3">
            <div className="font-mono text-[12.5px] font-semibold text-ink">Properties</div>
            <div className="mt-0.5 text-[11px] text-ink-faint">
              {selectedNode ? 'Editing the selected component' : 'Nothing selected'}
            </div>
          </div>
          <div className="p-3.5">
            <PropertyPanel
              node={selectedNode}
              onRename={handleRename}
              onParam={handleParam}
              onBeginEdit={recordHistory}
              onConnectFrom={() => setLinkFrom({ id: selectedNode.id, name: selectedNode.name })}
              onDelete={() => deleteNode(selectedNode.id)}
            />
            <div className="mb-4">
              <div className="mb-1.5 font-mono text-[11.5px] tracking-wide text-ink-dim uppercase">Architecture JSON</div>
              <JsonPreview value={contract} maxHeight={240} />
            </div>
            <ValidationPanel result={result} />
            <VersionPanel
              versions={versions}
              loading={versionsLoading}
              busy={versionBusy}
              label={versionLabel}
              editingId={editingVersionId}
              draft={versionDraft}
              onLabelChange={setVersionLabel}
              onSave={saveSnapshot}
              onRestore={restoreSnapshot}
              onDelete={removeVersion}
              onStartRename={startRenameVersion}
              onDraftChange={setVersionDraft}
              onCommitRename={commitRenameVersion}
              onCancelRename={cancelRenameVersion}
            />
          </div>
        </aside>
      </div>
    </div>
  )
}
