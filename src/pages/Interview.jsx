import { useEffect, useMemo, useRef, useState } from 'react'
import { Eraser, MessagesSquare, Send, Sparkles } from 'lucide-react'
import { Badge, Button, Card, PageHead, StatCard, inputClass } from '../components/ui.jsx'
import { useApp, useDispatch } from '../store/AppContext.jsx'
import { feedbackFor, questionBank, scoreAnswer } from '../data/questionBank.js'
import { colors, scoreColor } from '../theme/tokens.js'

const BANK_SIZE = questionBank.length
const EMPTY = []

function wrapIndex(index) {
  if (!BANK_SIZE) return 0
  const safe = ((Number(index) || 0) % BANK_SIZE + BANK_SIZE) % BANK_SIZE
  return safe
}

function questionAt(index) {
  if (!BANK_SIZE) return null
  return questionBank[wrapIndex(index)] || null
}

function botMessage(question) {
  return {
    id: `bot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    role: 'bot',
    topic: question.topic,
    text: question.q,
  }
}

function bubbleClass(role) {
  if (role === 'user')
    return 'ml-auto flex max-w-[85%] flex-col rounded-[10px] rounded-br-[3px] bg-accent px-3.5 py-2.5 text-[13.5px] text-[#1a1206]'
  if (role === 'feedback')
    return 'flex max-w-[92%] flex-col rounded-[10px] rounded-bl-[3px] border border-green/40 bg-green/10 px-3.5 py-2.5 text-[13px] text-ink'
  return 'flex max-w-[92%] flex-col rounded-[10px] rounded-bl-[3px] border border-line bg-raised px-3.5 py-2.5 text-[13.5px] text-ink'
}

export default function Interview() {
  const { interview } = useApp()
  const dispatch = useDispatch()

  const log = Array.isArray(interview?.log) ? interview.log : EMPTY
  const history = Array.isArray(interview?.history) ? interview.history : EMPTY
  const index = Number(interview?.index) || 0
  const pending = questionAt(index)

  const [draft, setDraft] = useState('')
  const [thinking, setThinking] = useState(false)
  const listRef = useRef(null)
  const timerRef = useRef(null)

  const lastMessageId = log.length ? log[log.length - 1]?.id || '' : ''
  const scrollKey = `${lastMessageId}|${thinking ? 'typing' : 'idle'}`

  useEffect(() => {
    if (log.length || !BANK_SIZE) return
    const first = questionAt(0)
    if (!first) return
    dispatch({ type: 'SET_INTERVIEW', interview: { log: [botMessage(first)], index: 0 } })
  }, [log.length, dispatch])

  useEffect(() => {
    const el = listRef.current
    if (!el || !scrollKey) return
    el.scrollTop = el.scrollHeight
  }, [scrollKey])

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  const stats = useMemo(() => {
    const count = history.length
    const total = history.reduce((sum, h) => sum + (Number(h?.score) || 0), 0)
    return { count, average: count ? total / count : 0 }
  }, [history])

  function send() {
    const text = draft.trim()
    if (!text || thinking) return
    const question = pending
    if (!question) return

    const stamp = Date.now()
    const { score, missing } = scoreAnswer(question, text)
    const found = (question.keys || []).filter((k) => text.toLowerCase().includes(String(k).toLowerCase()))

    const answered = [
      { id: `user-${stamp}`, role: 'user', text },
      {
        id: `fb-${stamp}`,
        role: 'feedback',
        topic: question.topic,
        score,
        text: feedbackFor(score, question, missing),
      },
    ]

    const nextIndex = index + 1
    const nextQuestion = questionAt(nextIndex)
    const baseLog = log

    dispatch({
      type: 'SET_INTERVIEW',
      interview: {
        log: [...baseLog, ...answered],
        history: [
          ...history,
          {
            question: question.q,
            answer: text,
            score,
            topic: question.topic,
            keyTermsFound: found,
            keyTermsMissing: missing,
          },
        ],
        index: nextIndex,
      },
    })

    setDraft('')
    setThinking(true)
    timerRef.current = window.setTimeout(() => {
      if (nextQuestion) {
        dispatch({
          type: 'SET_INTERVIEW',
          interview: { log: [...baseLog, ...answered, botMessage(nextQuestion)] },
        })
      }
      setThinking(false)
    }, 350)
  }

  function resetSession() {
    window.clearTimeout(timerRef.current)
    setDraft('')
    setThinking(false)
    dispatch({ type: 'RESET_INTERVIEW' })
    const first = questionAt(0)
    if (first) {
      dispatch({ type: 'SET_INTERVIEW', interview: { log: [botMessage(first)], index: 0 } })
    }
  }

  return (
    <div>
      <PageHead
        eyebrow="AI Interview & Learning"
        title="AI Interview Practice"
        desc="Answer architecture questions and get scored, explanatory feedback on your reasoning."
        actions={
          <Button icon={<Eraser size={15} />} onClick={resetSession}>
            Reset session
          </Button>
        }
      />

      <div className="mb-3.5 grid grid-cols-1 gap-3.5 min-[1100px]:grid-cols-3">
        <StatCard
          label="Questions Attempted"
          icon={<MessagesSquare size={13} />}
          value={stats.count}
          tone={colors.ink}
          delta={BANK_SIZE ? `${BANK_SIZE} questions in the bank` : 'No questions loaded'}
        />
        <StatCard
          label="Average Score"
          icon={<Sparkles size={13} />}
          value={stats.count ? Math.round(stats.average) : '—'}
          tone={stats.count ? scoreColor(stats.average) : colors.inkFaint}
          delta={stats.count ? 'out of 100 across all attempts' : 'Answer a question to begin'}
        />
        <StatCard
          label="Current Topic"
          icon={<MessagesSquare size={13} />}
          value={pending?.topic || '—'}
          tone={colors.accent}
          delta={pending ? `Question ${wrapIndex(index) + 1} of ${BANK_SIZE}` : 'Session complete'}
        />
      </div>

      <Card
        title="Interviewer"
        sub="Enter sends · Shift+Enter inserts a newline"
        bodyClass="p-0"
      >
        <div className="flex h-[560px] flex-col">
          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
            {log.length === 0 && (
              <div className="py-10 text-center text-[12.5px] text-ink-faint">
                Loading the first question…
              </div>
            )}

            {log.map((message) => {
              const role = message?.role === 'user' || message?.role === 'feedback' ? message.role : 'bot'
              return (
                <div key={message?.id || `${role}-${message?.text}`} className={bubbleClass(role)}>
                  {role === 'feedback' && (
                    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge tone={message?.score >= 70 ? 'green' : message?.score >= 35 ? 'amber' : 'red'}>
                        {message?.score ?? 0}/100
                      </Badge>
                      {message?.topic && (
                        <span className="font-mono text-[10px] tracking-wide text-ink-faint uppercase">
                          {message.topic}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap">{message?.text}</div>
                </div>
              )
            })}

            {thinking && (
              <div className="max-w-[92%] rounded-[10px] rounded-bl-[3px] border border-line bg-raised px-3.5 py-2.5 text-[12.5px] text-ink-faint">
                Loading the next question…
              </div>
            )}
          </div>

          <div className="flex items-end gap-2.5 border-t border-line-soft px-4 py-3">
            <textarea
              className={`${inputClass} min-h-[76px] resize-none`}
              value={draft}
              rows={3}
              placeholder="Explain your reasoning in plain language — name the mechanism, not just the outcome."
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
            />
            <Button
              variant="primary"
              icon={<Send size={15} />}
              disabled={!draft.trim() || thinking}
              onClick={send}
              className="shrink-0"
            >
              Send
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
