import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChartLine, GraduationCap, Target, TrendingDown, TrendingUp } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  DataTable,
  Empty,
  PageHead,
  StatCard,
  UtilBar,
} from '../components/ui.jsx'
import { ScoreTrendChart } from '../components/charts.jsx'
import { useApp } from '../store/AppContext.jsx'
import { colors, scoreColor } from '../theme/tokens.js'

const EM_DASH = '—'
const EMPTY_HISTORY = []

function toneForScore(score) {
  if (score >= 70) return 'green'
  if (score >= 35) return 'amber'
  return 'red'
}

function topicBreakdown(history) {
  const map = new Map()
  for (const entry of history) {
    const topic = entry?.topic || 'General'
    const bucket = map.get(topic) || { topic, total: 0, count: 0 }
    bucket.total += Number(entry?.score) || 0
    bucket.count += 1
    map.set(topic, bucket)
  }
  return [...map.values()]
    .map((t) => ({ topic: t.topic, count: t.count, average: t.count ? t.total / t.count : 0 }))
    .sort((a, b) => a.average - b.average)
}

export default function Learning() {
  const { interview } = useApp()
  const navigate = useNavigate()

  const history = useMemo(() => {
    const list = interview?.history
    return Array.isArray(list) ? list.filter(Boolean) : EMPTY_HISTORY
  }, [interview])

  const stats = useMemo(() => {
    const count = history.length
    const total = history.reduce((sum, h) => sum + (Number(h?.score) || 0), 0)
    const topics = topicBreakdown(history)
    const weakest = topics.length ? topics[0] : null
    const strongest = topics.length ? topics[topics.length - 1] : null
    return {
      count,
      average: count ? total / count : null,
      topics,
      strongest,
      weakest,
    }
  }, [history])

  const rows = useMemo(
    () =>
      history.map((entry, i) => ({
        key: `${i}-${entry?.question || 'q'}`,
        cells: [
          <span key="n" className="font-mono text-ink-faint">
            {i + 1}
          </span>,
          <span key="q" className="block max-w-[420px]">
            {entry?.question || '—'}
          </span>,
          <span key="t" className="font-mono text-ink-dim">
            {entry?.topic || 'General'}
          </span>,
          <Badge key="s" tone={toneForScore(Number(entry?.score) || 0)}>
            {Number(entry?.score) || 0}
          </Badge>,
          <span key="m" className="block max-w-[320px] text-[12px] text-ink-faint">
            {Array.isArray(entry?.keyTermsMissing) && entry.keyTermsMissing.length
              ? entry.keyTermsMissing.join(', ')
              : 'None — full coverage'}
          </span>,
        ],
      })),
    [history],
  )

  if (!stats.count) {
    return (
      <div>
        <PageHead
          eyebrow="Learning Analytics"
          title="Learning Progress"
          desc="Topic mastery derived from your AI interview answers, so you can see which architecture concepts need more work."
        />
        <Card>
          <Empty
            icon={<GraduationCap size={30} />}
            title="No answers recorded yet"
            hint="Start a practice session — every answer is scored against a key-term rubric and rolled up per topic here."
            action={
              <Button
                variant="primary"
                icon={<GraduationCap size={15} />}
                onClick={() => navigate('/interview')}
              >
                Start practicing
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
        eyebrow="Learning Analytics"
        title="Learning Progress"
        desc={`Based on ${stats.count} answered question${stats.count === 1 ? '' : 's'}. Weakest topics are listed first so you know where to revise.`}
        actions={
          <Button icon={<GraduationCap size={15} />} onClick={() => navigate('/interview')}>
            Practice more
          </Button>
        }
      />

      <div className="mb-3.5 grid grid-cols-2 gap-3.5 min-[1100px]:grid-cols-4">
        <StatCard
          label="Questions Attempted"
          icon={<GraduationCap size={13} />}
          value={stats.count}
          tone={colors.ink}
          delta={`${stats.topics.length} topic${stats.topics.length === 1 ? '' : 's'} covered`}
        />
        <StatCard
          label="Average Score"
          icon={<Target size={13} />}
          value={Math.round(stats.average ?? 0)}
          tone={scoreColor(stats.average ?? 0)}
          delta="out of 100 across all attempts"
        />
        <StatCard
          label="Strongest Topic"
          icon={<TrendingUp size={13} />}
          value={stats.strongest?.topic || EM_DASH}
          tone={colors.green}
          delta={
            stats.strongest
              ? `${Math.round(stats.strongest.average)}/100 · ${stats.strongest.count} attempt${stats.strongest.count === 1 ? '' : 's'}`
              : EM_DASH
          }
        />
        <StatCard
          label="Weakest Topic"
          icon={<TrendingDown size={13} />}
          value={stats.weakest?.topic || EM_DASH}
          tone={colors.red}
          delta={
            stats.weakest
              ? `${Math.round(stats.weakest.average)}/100 · ${stats.weakest.count} attempt${stats.weakest.count === 1 ? '' : 's'}`
              : EM_DASH
          }
        />
      </div>

      <Card title="Score trend" sub="One point per answered question, in order" className="mb-3.5">
        <ScoreTrendChart history={history} height={210} />
      </Card>

      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
        <Card
          title="Topic mastery"
          sub="Ascending by average score — revise the top of this list first"
        >
          {stats.topics.map((t) => (
            <UtilBar
              key={t.topic}
              value={t.average}
              label={t.topic}
              right={`${Math.round(t.average)}/100 · ${t.count} attempt${t.count === 1 ? '' : 's'}`}
            />
          ))}
        </Card>

        <Card title="Attempt history" sub="Every question you have answered so far" bodyClass="px-5 pb-5">
          <DataTable headers={['#', 'Question', 'Topic', 'Score', 'Key terms missed']} rows={rows} />
        </Card>
      </div>

      <div className="mt-3.5 flex items-center gap-2.5 rounded-panel border border-line-soft bg-raised px-4 py-3">
        <ChartLine size={15} className="shrink-0 text-ink-faint" />
        <p className="text-[12.5px] text-ink-dim">
          Scores come from keyword coverage against a fixed rubric, not from a language model. They are
          reproducible and offline — useful for revision, not as a measure of professional judgement.
        </p>
      </div>
    </div>
  )
}
