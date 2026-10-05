import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCheck, CircleCheck, TriangleAlert, Trash2, X } from 'lucide-react'
import { useApp } from '../store/AppContext.jsx'

const TONE_ICON = {
  ok: CircleCheck,
  error: TriangleAlert,
  info: Bell,
}

function ago(timestamp) {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export default function NotificationBell() {
  const { notifications, unreadCount, markNotificationRead, markAllNotificationsRead, clearNotifications } =
    useApp()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function openItem(item) {
    markNotificationRead(item.id)
    if (item.to) navigate(item.to)
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-expanded={open}
        className="relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-[7px] border border-line bg-raised text-ink-dim transition hover:text-ink"
      >
        <Bell size={15} />
        {/* The dot was previously hard-coded, so the bell looked permanently unread. */}
        {unreadCount > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2 items-center justify-center">
            <span className="absolute h-2 w-2 rounded-full border-2 border-base-alt bg-red" />
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute top-full right-0 z-30 mt-2 w-[330px] overflow-hidden rounded-[8px] border border-line bg-raised shadow-2xl">
          <div className="flex items-center justify-between gap-2 border-b border-line-soft px-3 py-2.5">
            <span className="font-mono text-[12px] font-semibold text-ink">Notifications</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={markAllNotificationsRead}
                disabled={unreadCount === 0}
                title="Mark all as read"
                className="flex cursor-pointer items-center gap-1 rounded-[5px] px-1.5 py-1 text-[11px] text-ink-faint transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                <CheckCheck size={12} />
                Read all
              </button>
              <button
                type="button"
                onClick={clearNotifications}
                disabled={notifications.length === 0}
                title="Clear all"
                className="flex cursor-pointer items-center gap-1 rounded-[5px] px-1.5 py-1 text-[11px] text-ink-faint transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 size={12} />
                Clear
              </button>
            </div>
          </div>

          {notifications.length ? (
            <ul className="max-h-[320px] overflow-y-auto">
              {notifications.map((item) => {
                const Icon = TONE_ICON[item.tone] || Bell
                const tone = item.tone === 'error' ? 'text-red' : item.tone === 'ok' ? 'text-green' : 'text-accent'
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => openItem(item)}
                      className={`flex w-full items-start gap-2.5 border-b border-line-soft px-3 py-2.5 text-left transition last:border-b-0 hover:bg-overlay ${
                        item.read ? 'opacity-60' : ''
                      }`}
                    >
                      <Icon size={14} className={`mt-0.5 shrink-0 ${tone}`} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="truncate text-[12.5px] font-semibold text-ink">{item.title}</span>
                          <span className="ml-auto shrink-0 font-mono text-[10px] text-ink-faint">
                            {ago(item.at)}
                          </span>
                        </span>
                        {item.body ? (
                          <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-dim">
                            {item.body}
                          </span>
                        ) : null}
                      </span>
                      {!item.read ? <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" /> : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
              <X size={18} className="text-ink-faint" />
              <span className="text-[12.5px] text-ink-faint">
                Nothing yet. A finished simulation will show up here.
              </span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}