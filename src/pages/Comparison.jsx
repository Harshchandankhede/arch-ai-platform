import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, GitCompare, GitBranch, History, TrendingUp } from 'lucide-react'
import { useApp } from '../store/AppContext.jsx'
import { useResults } from '../store/useResults.js'
import { getVersion, listVersions } from '../services/architectures.js'
import { isServerProjectId } from '../services/projects.js'
import { dimensionMeta, dimensionOrder, scoreColor, utilizationColor } from '../theme/tokens.js'
import { utilPct } from '../lib/metrics.js'
import {
  Badge,
  Card,
  DataTable,
  Empty,
  Gauge,
  PageHead,
  Spinner,
  inputClass,
} from '../components/ui.jsx'
import { CompareChart } from '../components/charts.jsx'

const linkBtn =
  'inline-flex items-center gap-2 rounded-[7px] border border-accent bg-accent px-3.5 py-2 text-[13px] font-semibold text-[#1a1206] transition hover:brightness-110'

function toPct(value) {
  const v = Number(value)
  if (!Number.isFinite(v)) return 0
  return v <= 1 ? v * 100 : v
}

function peakUtilisation(components) {
  return Object.values(components || {}).reduce((max, c) => Math.max(max, utilPct(c.utilization)), 0)
}

function realDeviations(mining) {
  return (mining?.deviations || []).filter((d) => d && d.type !== 'none').length
}

function metricRows(label, result) {
  const sim = result?.sim
  const metrics = sim?.metrics || {}
  return [
    { key: `${label}-p95`, cells: ['Latency p95', `${Math.round(Number(metrics.p95) || 0)} ms`] },
    {
      key: `${label}-throughput`,
      cells: ['Throughput', `${(Number(metrics.throughputPerSec) || 0).toFixed(1)} req/s`],
    },
    { key: `${label}-success`, cells: ['Success rate', `${toPct(metrics.successRate).toFixed(1)}%`] },
    {
      key: `${label}-util`,
      cells: ['Peak utilisation', `${peakUtilisation(sim?.components).toFixed(1)}%`],
    },
    {
      key: `${label}-dropped`,
      cells: ['Dropped requests', `${Number(metrics.droppedRequests || 0).toLocaleString()}`],
    },
    {
      key: `${label}-cases`,
      cells: ['Cases mined', `${Number(result?.mining?.statistics?.totalCases || 0).toLocaleString()}`],
    },
    {
      key: `${label}-bottlenecks`,
      cells: ['Bottlenecks', `${(result?.mining?.bottlenecks || []).length}`],
    },
    { key: `${label}-deviations`, cells: ['Deviations', `${realDeviations(result?.mining)}`] },
    { key: `${label}-health`, cells: ['Health score', `${Math.round(Number(result?.evaluation?.healthScore) || 0)} / 100`] },
  ]
}

function dimensionRows(label, result) {
  const dims = result?.evaluation?.dimensions || {}
  const weights = result?.evaluation?.weights || {}
  return dimensionOrder.map((key) => ({
    key: `${label}-${key}`,
    cells: [
      dimensionMeta[key]?.label || key,
      `${toPct(weights[key] ?? dimensionMeta[key]?.weight ?? 0).toFixed(0)}%`,
      `${Math.round(Number(dims[key]) || 0)}`,
    ],
  }))
}

const EMPTY_VERSIONS = []

function failureMessage(err, fallback) {
  return err?.response?.data?.error?.message || err?.message || fallback
}

function versionKey(projectId, versionId) {
  return projectId && versionId ? `${projectId}:${versionId}` : null
}

function versionTitle(version) {
  const number = version?.versionNumber
  const label = (version?.label || '').trim()
  const head = number ? `v${number}` : 'Unnamed version'
  return label ? `${head} · ${label}` : head
}

function versionCounts(version) {
  const nodes = version?.nodeCount ?? version?.arch?.nodes?.length ?? 0
  const edges = version?.edgeCount ?? version?.arch?.edges?.length ?? 0
  return `${nodes} nodes · ${edges} edges`
}

function newestFirst(a, b) {
  const an = Number(a?.versionNumber) || 0
  const bn = Number(b?.versionNumber) || 0
  if (bn !== an) return bn - an
  return String(b?.createdAt || '').localeCompare(String(a?.createdAt || ''))
}

function ProjectPicker({ label, value, projects, onChange }) {
  return (
    <label className="flex min-w-0 flex-1 items-center gap-2.5">
      <span className="font-mono text-[11.5px] tracking-wide text-ink-dim uppercase">{label}</span>
      <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function VersionPicker({ side, value, versions, onChange }) {
  return (
    <label className="flex min-w-0 flex-1 items-center gap-2.5">
      <span className="font-mono text-[11.5px] tracking-wide text-ink-dim uppercase">{side}</span>
      <select
        className={`${inputClass} min-w-[190px] max-w-[280px]`}
        aria-label={`Version for side ${side}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {versions.map((v) => (
          <option key={v.id} value={v.id}>
            {versionTitle(v)}
          </option>
        ))}
      </select>
    </label>
  )
}

function VersionSide({ projectId, versionId, summary, side, onResult }) {
  const { notify } = useApp()
  const notifyRef = useRef(notify)
  const [fetched, setFetched] = useState(null)
  const fetchKey = versionKey(projectId, versionId)
  const load =
    fetched && fetched.key === fetchKey ? fetched : { version: null, error: null, loading: Boolean(fetchKey) }
  const { sim, mining, evaluation, status, error } = useResults(load.version?.arch)

  useEffect(() => {
    notifyRef.current = notify
  }, [notify])

  useEffect(() => {
    if (!projectId || !versionId) return undefined
    let cancelled = false

    ;(async () => {
      try {
        const full = await getVersion(projectId, versionId)
        if (cancelled) return
        if (!full?.arch) {
          setFetched({ key: fetchKey, version: null, error: 'That version came back without an architecture.' })
          return
        }
        setFetched({ key: fetchKey, version: full, error: null })
      } catch (err) {
        if (cancelled) return
        const message = failureMessage(err, `Could not load the version for side ${side}.`)
        setFetched({ key: fetchKey, version: null, error: message })
        notifyRef.current(message, 'error')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [projectId, versionId, side, fetchKey])

  useEffect(() => {
    onResult(side, { sim, mining, evaluation, status, error, loading: load.loading, loadError: load.error })
  }, [onResult, side, sim, mining, evaluation, status, error, load.loading, load.error])

  const health = evaluation?.healthScore ?? 0
  const dims = evaluation?.dimensions || {}
  const weakest = [...dimensionOrder].sort((a, b) => (Number(dims[a]) || 0) - (Number(dims[b]) || 0))[0]

  return (
    <Card
      title={`${side} · ${versionTitle(summary)}`}
      sub={versionCounts(load.version || summary)}
      actions={<Badge tone="dim">{side}</Badge>}
    >
      {load.error ? (
        <div className="rounded-[8px] border border-red bg-red/5 p-3.5">
          <div className="font-mono text-[11.5px] text-red">Side {side} could not load its version</div>
          <div className="mt-1 text-[12.5px] text-ink">{load.error}</div>
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="rounded-[8px] border border-red bg-red/5 p-3.5">
          <div className="font-mono text-[11.5px] text-red">Side {side} failed</div>
          <div className="mt-1 text-[12.5px] text-ink">{error || 'Unknown simulation failure.'}</div>
        </div>
      ) : null}

      {load.loading ? <Spinner label={`Loading version ${side}…`} /> : null}

      {status === 'running' && !sim ? <Spinner label={`Simulating version ${side}…`} /> : null}

      {evaluation ? (
        <>
          <div className="flex flex-col items-center">
            <Gauge score={Math.round(Number(health) || 0)} size={200} />
            <div className="-mt-2 text-center text-[12px] text-ink-dim">
              Weakest dimension: <span className="text-ink">{dimensionMeta[weakest]?.label}</span> (
              {Math.round(Number(dims[weakest]) || 0)}/100)
            </div>
          </div>
          <div className="mt-4 mb-3 font-mono text-[10.5px] tracking-wider text-ink-faint uppercase">
            Dimensions
          </div>
          <DataTable headers={['Dimension', 'Weight', 'Score']} rows={dimensionRows(side, { evaluation })} />
          <div className="mt-4 mb-3 font-mono text-[10.5px] tracking-wider text-ink-faint uppercase">
            Key metrics
          </div>
          <DataTable headers={['Metric', 'Value']} rows={metricRows(side, { sim, mining, evaluation })} />
        </>
      ) : null}

      {!evaluation && status !== 'running' && status !== 'error' && !load.loading ? (
        <div className="py-6 text-center text-[12.5px] text-ink-faint">No result yet for this version.</div>
      ) : null}
    </Card>
  )
}

export default function Comparison() {
  const { currentProject, notify, projects, projectById } = useApp()
  const notifyRef = useRef(notify)
  const [chosenProjectId, setChosenProjectId] = useState('')
  const [chosenA, setChosenA] = useState('')
  const [chosenB, setChosenB] = useState('')
  const [listed, setListed] = useState(null)
  const [sides, setSides] = useState({ A: null, B: null })

  useEffect(() => {
    notifyRef.current = notify
  }, [notify])

  const collect = useCallback((side, payload) => {
    setSides((prev) => {
      const current = prev[side]
      if (
        current &&
        current.sim === payload.sim &&
        current.mining === payload.mining &&
        current.evaluation === payload.evaluation &&
        current.status === payload.status &&
        current.error === payload.error
      ) {
        return prev
      }
      return { ...prev, [side]: payload }
    })
  }, [])

  const projectId = chosenProjectId || currentProject?.id || projects[0]?.id || ''

  // Seed/local ids ("p2") are not Mongo ObjectIds, so the versions route can only ever
  // answer 404. Derive the empty result during render instead of requesting it.
  const isServerProject = isServerProjectId(projectId)

  useEffect(() => {
    if (!projectId || !isServerProject) return undefined
    let cancelled = false

    ;(async () => {
      try {
        const list = await listVersions(projectId)
        if (cancelled) return
        const items = Array.isArray(list) ? [...list].sort(newestFirst) : EMPTY_VERSIONS
        setListed({ projectId, versions: items, error: null })
      } catch (err) {
        if (cancelled) return
        const message = failureMessage(err, 'Could not load the version history for that project.')
        setListed({ projectId, versions: EMPTY_VERSIONS, error: message })
        notifyRef.current(message, 'error')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [projectId, isServerProject])

  const listedHere = listed && listed.projectId === projectId
  const versions = !isServerProject ? EMPTY_VERSIONS : listedHere ? listed.versions : EMPTY_VERSIONS
  const listError = listedHere ? listed.error : null
  const versionsLoading = Boolean(projectId) && isServerProject && !listedHere

  const aId = versions.some((v) => v.id === chosenA) ? chosenA : versions[0]?.id || ''
  const bId = versions.some((v) => v.id === chosenB) ? chosenB : versions[1]?.id || versions[0]?.id || ''

  const project = projectById(projectId) || null
  const summaryA = versions.find((v) => v.id === aId) || null
  const summaryB = versions.find((v) => v.id === bId) || null

  const head = (
    <PageHead
      eyebrow="Architecture Comparison"
      title="Architecture Comparison"
      desc="Two versions of the same project are simulated under the same workload and scored on the same six dimensions, so the comparison is like for like."
      actions={
        <div className="no-print flex flex-wrap items-center gap-2">
          <ProjectPicker label="Project" value={projectId} projects={projects} onChange={setChosenProjectId} />
        </div>
      }
    />
  )

  if (!projects.length) {
    return (
      <Card>
        <Empty
          icon={<GitCompare size={26} />}
          title="No project is available."
          hint="Comparison needs a project whose version history can be read. Open or create one first."
          action={
            <Link to="/projects" className={linkBtn}>
              Go to My Projects
            </Link>
          }
        />
      </Card>
    )
  }

  if (!versions.length) {
    return (
      <div>
        {head}
        <Card>
          {versionsLoading ? (
            <Spinner label="Loading version history…" />
          ) : (
            <Empty
              icon={<History size={26} />}
              title={listError ? 'The version history could not be read.' : 'This project has no saved versions.'}
              hint={
                listError ||
                'Save a snapshot of the canvas in the Builder to start a history, then compare it against another version here.'
              }
              action={
                <Link to="/builder" className={linkBtn}>
                  Open the Builder
                </Link>
              }
            />
          )}
        </Card>
      </div>
    )
  }

  const sideA = sides.A
  const sideB = sides.B
  const scoreA = sideA?.evaluation ? Math.round(Number(sideA.evaluation.healthScore) || 0) : null
  const scoreB = sideB?.evaluation ? Math.round(Number(sideB.evaluation.healthScore) || 0) : null
  const loadingSides = ['A', 'B'].some((s) => sides[s]?.loading)
  const running = ['A', 'B'].some((s) => sides[s]?.status === 'running')
  const busy = loadingSides || running

  const chartRows = [
    {
      metric: 'Latency p95',
      a: Math.round(Number(sideA?.sim?.metrics?.p95) || 0),
      b: Math.round(Number(sideB?.sim?.metrics?.p95) || 0),
      better: 'Lower',
    },
    {
      metric: 'Throughput',
      a: Number(Number(sideA?.sim?.metrics?.throughputPerSec) || 0).toFixed(1),
      b: Number(Number(sideB?.sim?.metrics?.throughputPerSec) || 0).toFixed(1),
      better: 'Higher',
    },
    {
      metric: 'Peak util %',
      a: Number(peakUtilisation(sideA?.sim?.components).toFixed(1)),
      b: Number(peakUtilisation(sideB?.sim?.components).toFixed(1)),
      better: 'Lower',
    },
    {
      metric: 'Success %',
      a: Number(toPct(sideA?.sim?.metrics?.successRate).toFixed(1)),
      b: Number(toPct(sideB?.sim?.metrics?.successRate).toFixed(1)),
      better: 'Higher',
    },
    { metric: 'Health score', a: scoreA ?? 0, b: scoreB ?? 0, better: 'Higher' },
    {
      metric: 'Deviations',
      a: realDeviations(sideA?.mining),
      b: realDeviations(sideB?.mining),
      better: 'Lower',
    },
  ]

  const directionRows = chartRows.map((r) => ({
    key: r.metric,
    cells: [
      r.metric,
      r.better,
      <span key="a">{typeof r.a === 'number' ? r.a.toLocaleString() : r.a}</span>,
      <span key="b">{typeof r.b === 'number' ? r.b.toLocaleString() : r.b}</span>,
    ],
  }))

  const winner = scoreA === null || scoreB === null ? null : scoreA === scoreB ? 'tie' : scoreA > scoreB ? 'A' : 'B'
  const delta = scoreA === null || scoreB === null ? null : Math.abs(scoreA - scoreB)

  return (
    <div>
      <PageHead
        eyebrow="Architecture Comparison"
        title="Architecture Comparison"
        desc="Two versions of the same project are simulated under the same workload and scored on the same six dimensions, so the comparison is like for like."
        actions={
          <div className="no-print flex flex-wrap items-center gap-2">
            <ProjectPicker label="Project" value={projectId} projects={projects} onChange={setChosenProjectId} />
            <VersionPicker side="A" value={aId} versions={versions} onChange={setChosenA} />
            <VersionPicker side="B" value={bId} versions={versions} onChange={setChosenB} />
          </div>
        }
      />

      {aId && aId === bId ? (
        <div className="mb-5 rounded-[8px] border border-line-soft bg-raised px-3.5 py-2.5 text-[12px] text-ink-dim">
          Both sides hold {versionTitle(summaryA)} — pick a different version on one side to see a real change.
        </div>
      ) : null}

      <div className="mb-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        {summaryA ? (
          <VersionSide
            key={versionKey(projectId, summaryA.id)}
            projectId={projectId}
            versionId={summaryA.id}
            summary={summaryA}
            side="A"
            onResult={collect}
          />
        ) : null}
        {summaryB ? (
          <VersionSide
            key={versionKey(projectId, summaryB.id)}
            projectId={projectId}
            versionId={summaryB.id}
            summary={summaryB}
            side="B"
            onResult={collect}
          />
        ) : null}
      </div>

      <Card
        title="Side by side"
        sub={`${project?.name || 'This project'} — latency, peak utilisation and deviations are costs, so a shorter bar is the better result there.`}
        className="mb-5"
      >
        {busy && !sideA?.sim && !sideB?.sim ? (
          <Spinner label={loadingSides ? 'Loading both versions…' : 'Simulating both versions…'} />
        ) : null}
        <CompareChart rows={chartRows} height={240} />
        <div className="mt-4">
          <DataTable headers={['Metric', 'Better', 'A', 'B']} rows={directionRows} empty="No comparison available yet." />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-[11.5px] text-ink-faint">
          {[
            ['Lower is better', 'Latency p95, Peak util %, Deviations'],
            ['Higher is better', 'Throughput, Success %, Health score'],
          ].map(([k, v]) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className="font-mono text-ink-dim">{k}</span>
              {v}
            </span>
          ))}
        </div>
      </Card>

      <Card title="Verdict" sub="Decided on the health score, which is the only single comparable figure.">
        {winner === null ? (
          <div className="flex items-center gap-2.5 text-[13px] text-ink-dim">
            <Activity size={15} className="text-accent" />
            Both sides must finish before a verdict can be issued.
          </div>
        ) : winner === 'tie' ? (
          <div className="text-[13px] text-ink-dim">
            The two versions score identically at {scoreA} out of 100. Neither is healthier on the objective
            evidence; use the dimension tables to see whether they are unhealthy for the same reason.
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <div
              className="rounded-[8px] border border-line bg-raised px-4 py-3"
              style={{ borderLeft: `3px solid ${scoreColor(winner === 'A' ? scoreA : scoreB)}` }}
            >
              <div className="mb-1 flex items-center gap-2 font-mono text-[10.5px] tracking-wider text-ink-faint uppercase">
                <TrendingUp size={12} />
                Healthier version
              </div>
              <div className="text-[14px] text-ink">
                {winner === 'A' ? versionTitle(summaryA) : versionTitle(summaryB)}
              </div>
              <div className="mt-1 font-mono text-[12.5px]" style={{ color: scoreColor(winner === 'A' ? scoreA : scoreB) }}>
                {winner === 'A' ? scoreA : scoreB} / 100 against {winner === 'A' ? scoreB : scoreA} / 100
              </div>
            </div>
            <div className="rounded-[8px] border border-line-soft bg-raised px-4 py-3">
              <div className="mb-1 font-mono text-[10.5px] tracking-wider text-ink-faint uppercase">Delta</div>
              <div className="font-mono text-[20px] font-semibold" style={{ color: utilizationColor(delta) }}>
                {delta} points
              </div>
              <div className="mt-0.5 text-[11.5px] text-ink-faint">on a 0 to 100 scale</div>
            </div>
            <div className="flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-dim">
              <GitBranch size={14} className="mt-0.5 shrink-0 text-accent" />
              <span>
                The delta is small enough that it should be read alongside the mined traces. Both sides share the same
                workload and the same seed, so the difference is attributable to the version itself rather than to
                the experiment.
              </span>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
