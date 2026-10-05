import { useMemo } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import {
  Activity,
  ArrowRight,
  Clock,
  FileText,
  FolderKanban,
  Gauge,
  GitBranch,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  Workflow,
} from 'lucide-react'
import { useApp } from '../store/AppContext.jsx'
import { useResults } from '../store/useResults.js'
import { utilPct } from '../lib/metrics.js'
import {
  Badge,
  Button,
  Card,
  Empty,
  PageHead,
  Spinner,
  StatCard,
  UtilBar,
} from '../components/ui.jsx'
import { HealthRadar, LatencyChart } from '../components/charts.jsx'
import { colors, scoreColor } from '../theme/tokens.js'

function num(value, digits = 0) {
  const n = Number(value)
  if (value === null || value === undefined || !Number.isFinite(n)) return '—'
  return n.toFixed(digits)
}

function recList(recommendations) {
  if (Array.isArray(recommendations)) return recommendations.filter(Boolean)
  if (Array.isArray(recommendations?.items)) return recommendations.items.filter(Boolean)
  if (Array.isArray(recommendations?.recommendations)) return recommendations.recommendations.filter(Boolean)
  return []
}

const severityRank = { high: 0, med: 1, low: 2 }

function toneFor(severity) {
  if (severity === 'high') return 'red'
  if (severity === 'med') return 'amber'
  return 'blue'
}

function Placeholder({ children }) {
  return <div className="py-6 text-center text-[12.5px] text-ink-faint">{children}</div>
}

export default function Dashboard() {
  const { user, currentProject, settings, isAuthed, ownsProjects, hydrated } = useApp()
  const navigate = useNavigate()
  const arch = currentProject?.arch
  const { sim, mining, evaluation, recommendations, status, error, ready } = useResults(arch)

  const metrics = sim?.metrics || null
  const health = evaluation?.healthScore ?? null
  const threshold = Number(settings?.alertThreshold ?? 60)

  const stats = useMemo(() => {
    const m = metrics || {}
    return {
      p95: m.p95 ?? null,
      throughput: m.throughputPerSec ?? null,
      success: m.successRate ?? null,
      deviations: Array.isArray(mining?.deviations) ? mining.deviations.length : null,
      bottlenecks: Array.isArray(mining?.bottlenecks) ? mining.bottlenecks.length : null,
    }
  }, [metrics, mining])

  const componentByName = useMemo(() => {
    const map = new Map()
    for (const entry of Object.values(sim?.components || {})) {
      if (entry?.name) map.set(entry.name, entry)
    }
    return map
  }, [sim])

  const topBottlenecks = useMemo(() => {
    const list = Array.isArray(mining?.bottlenecks) ? mining.bottlenecks.filter(Boolean) : []
    return list.slice(0, 5)
  }, [mining])

  const topRec = useMemo(() => {
    const list = recList(recommendations)
    if (!list.length) return null
    return [...list].sort(
      (a, b) => (severityRank[a?.severity] ?? 3) - (severityRank[b?.severity] ?? 3),
    )[0]
  }, [recommendations])

  const firstName = String(user?.name || '').trim().split(/\s+/)[0] || 'there'

  // Signed out: never render workspace data, even for a frame. `Protected` already
  // redirects, but this is the check that keeps the guarantee local to the data itself.
  if (!isAuthed) {
    return <Navigate to="/login" replace />
  }

  // The account's projects are still loading, or the list on hand was not fetched for
  // this account. Show a loader instead of another user's numbers.
  if (!hydrated || !ownsProjects) {
    return (
      <div>
        <PageHead eyebrow="Overview" title={`Welcome back, ${firstName}`} />
        <Card>
          <Spinner label="Loading your projects…" />
        </Card>
      </div>
    )
  }

  if (!currentProject) {
    return (
      <div>
        <PageHead
          eyebrow="Overview"
          title={`Welcome back, ${firstName}`}
          desc="Pick a project to see its simulation health, latency trend and evaluation summary."
        />
        <Card>
          <Empty
            icon={<FolderKanban size={30} />}
            title="No project selected"
            hint="Create or open a project to unlock the dashboard."
            action={
              <Button variant="primary" icon={<FolderKanban size={15} />} onClick={() => navigate('/projects')}>
                Go to My Projects
              </Button>
            }
          />
        </Card>
      </div>
    )
  }

  return (
    <div>
      <PageHead
        eyebrow="Overview"
        title={`Welcome back, ${firstName}`}
        desc={`Live summary of “${currentProject.name}” — ${arch?.nodes?.length ?? 0} components, ${
          arch?.edges?.length ?? 0
        } connections, evaluated across six quality dimensions.`}
        actions={
          <Button icon={<Workflow size={15} />} onClick={() => navigate('/builder')}>
            Open builder
          </Button>
        }
      />

      {status === 'error' && (
        <div className="mb-3.5 rounded-panel border border-red bg-red/10 px-4 py-3.5">
          <div className="mb-1 flex items-center gap-2 font-mono text-[12px] font-semibold text-red uppercase">
            <TriangleAlert size={14} />
            Simulation failed
          </div>
          <div className="text-[13px] text-ink-dim">{error || 'The worker returned an unknown error.'}</div>
        </div>
      )}

      {status === 'running' && !ready && (
        <Card className="mb-3.5">
          <Spinner label="Running discrete-event simulation…" />
        </Card>
      )}

      <div className="mb-3.5 grid grid-cols-2 gap-3.5 min-[1100px]:grid-cols-3 2xl:grid-cols-6">
        <StatCard
          label="Health Score"
          icon={<Gauge size={13} />}
          value={health === null ? '—' : Math.round(health)}
          tone={health === null ? colors.inkFaint : scoreColor(health)}
          delta={health === null ? 'Awaiting run' : `${Math.round(health)}/100 · threshold ${threshold}`}
        />
        <StatCard
          label="p95 Latency"
          icon={<Clock size={13} />}
          value={stats.p95 === null ? '—' : num(stats.p95)}
          tone={stats.p95 === null ? colors.inkFaint : colors.ink}
          delta={stats.p95 === null ? 'Awaiting run' : `ms · avg ${num(metrics?.avgLatencyMs, 1)} ms`}
        />
        <StatCard
          label="Throughput"
          icon={<Activity size={13} />}
          value={stats.throughput === null ? '—' : num(stats.throughput, 1)}
          tone={stats.throughput === null ? colors.inkFaint : colors.ink}
          delta={stats.throughput === null ? 'Awaiting run' : 'requests / sec'}
        />
        <StatCard
          label="Success Rate"
          icon={<TrendingUp size={13} />}
          value={stats.success === null ? '—' : num(stats.success, 1)}
          tone={stats.success === null ? colors.inkFaint : scoreColor(Number(stats.success))}
          delta={stats.success === null ? 'Awaiting run' : `% · drop ${num(metrics?.dropRate, 1)}%`}
        />
        <StatCard
          label="Deviations"
          icon={<TriangleAlert size={13} />}
          value={stats.deviations === null ? '—' : stats.deviations}
          tone={stats.deviations === null ? colors.inkFaint : colors.purple}
          delta={stats.deviations === null ? 'Awaiting mining' : 'vs expected paths'}
        />
        <StatCard
          label="Bottlenecks"
          icon={<GitBranch size={13} />}
          value={stats.bottlenecks === null ? '—' : stats.bottlenecks}
          tone={stats.bottlenecks === null ? colors.inkFaint : colors.accent}
          delta={stats.bottlenecks === null ? 'Awaiting mining' : 'ranked by wait time'}
        />
      </div>

      <div className="mb-3.5 grid grid-cols-1 gap-3.5 xl:grid-cols-2">
        <Card title="Quality dimensions" sub="Normalised 0–100 per dimension, weighted into the health score">
          {evaluation ? (
            <HealthRadar evaluation={evaluation} height={252} />
          ) : (
            <Placeholder>Dimension scores appear once the simulation completes.</Placeholder>
          )}
        </Card>

        <Card title="Latency trend" sub="p50 and p95 across the simulated window">
          {sim?.latencySeries?.length ? (
            <LatencyChart series={sim.latencySeries} height={252} />
          ) : (
            <Placeholder>Latency samples appear once the simulation completes.</Placeholder>
          )}
        </Card>
      </div>

      <div className="mb-3.5 grid grid-cols-1 gap-3.5 xl:grid-cols-2">
        <Card
          title="Top bottlenecks"
          sub="Bar length is utilisation; the label is share of time spent waiting"
          actions={
            <Button size="sm" icon={<ArrowRight size={13} />} onClick={() => navigate('/process-mining')}>
              Process mining
            </Button>
          }
        >
          {topBottlenecks.length ? (
            topBottlenecks.map((b, i) => {
              const name = b?.component || b?.nodeId || `Component ${i + 1}`
              const entry = componentByName.get(name) || null
              const util = utilPct(entry?.utilization)
              const waiting = Number(b?.waitingMs) || 0
              const processing = Number(b?.processingMs) || 0
              const total = waiting + processing
              const waitRatio = total > 0 ? (waiting / total) * 100 : 0
              return (
                <UtilBar
                  key={b?.id || `${name}-${i}`}
                  value={Number.isFinite(util) ? util : 0}
                  label={name}
                  right={`${waitRatio.toFixed(0)}% wait time`}
                />
              )
            })
          ) : (
            <Placeholder>No bottlenecks detected yet.</Placeholder>
          )}
        </Card>

        <Card
          title="Highest-priority recommendation"
          sub="Worst finding from the advisory pass"
          actions={
            <Button size="sm" icon={<Sparkles size={13} />} onClick={() => navigate('/recommendations')}>
              View all
            </Button>
          }
        >
          {topRec ? (
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge tone={toneFor(topRec.severity)}>{topRec.severity || 'info'}</Badge>
                {topRec.dimension && (
                  <span className="font-mono text-[10.5px] tracking-wide text-ink-faint uppercase">
                    {topRec.dimension}
                  </span>
                )}
              </div>
              <h3 className="mb-2.5 text-[14.5px]">{topRec.title || 'Untitled finding'}</h3>
              {topRec.issue && (
                <div className="mb-2">
                  <div className="mb-0.5 font-mono text-[10px] tracking-wider text-ink-faint uppercase">Issue</div>
                  <div className="text-[13.5px] text-ink">{topRec.issue}</div>
                </div>
              )}
              {topRec.recommendation && (
                <div>
                  <div className="mb-0.5 font-mono text-[10px] tracking-wider text-ink-faint uppercase">
                    Recommendation
                  </div>
                  <div className="text-[13.5px] text-ink">{topRec.recommendation}</div>
                </div>
              )}
            </div>
          ) : (
            <Placeholder>No recommendations generated yet.</Placeholder>
          )}
        </Card>
      </div>

      <Card title="Quick actions" sub="Jump straight into the next phase of the pipeline">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <Button icon={<Workflow size={15} />} onClick={() => navigate('/builder')}>
            Edit architecture
          </Button>
          <Button icon={<Activity size={15} />} onClick={() => navigate('/simulation')}>
            Configure simulation
          </Button>
          <Button icon={<FileText size={15} />} onClick={() => navigate('/reports')}>
            Generate report
          </Button>
        </div>
      </Card>
    </div>
  )
}
