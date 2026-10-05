import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Boxes, FileText, Search, Workflow, X } from 'lucide-react'
import { useApp, useDispatch } from '../store/AppContext.jsx'
import { buildSearchIndex, pageEntries, searchEntries } from '../lib/searchIndex.js'
import { navGroups } from '../layouts/navItems.js'

const KIND_ICON = {
  project: FileText,
  component: Workflow,
  page: Boxes,
}

export default function GlobalSearch() {
  const { projects, currentProject } = useApp()
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef(null)
  const inputRef = useRef(null)

  // Rebuilt only when the searchable data changes, so typing stays cheap.
  const entries = useMemo(
    // pageEntries() takes the whole group list. Passing it to flatMap instead would call
    // it once per group with a single group as the argument, and iterating that object
    // threw "navGroups is not iterable" the moment the topbar rendered.
    () => buildSearchIndex({ projects, currentProject, pages: pageEntries(navGroups) }),
    [projects, currentProject],
  )

  const results = useMemo(() => searchEntries(entries, query), [entries, query])

  // Any new result set starts at the top, so Enter never jumps to a stale row.
  useEffect(() => setActive(0), [query])

  // Close on an outside click, and on Escape. A search panel that traps the user open is
  // worse than no search at all.
  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false)
        inputRef.current?.blur()
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function go(entry) {
    if (!entry) return
    // Selecting a project must also make it the current one, otherwise the destination page
    // would show whichever project happened to already be open.
    if (entry.projectId) dispatch({ type: 'SET_CURRENT_PROJECT', id: entry.projectId })
    navigate(entry.to)
    setQuery('')
    setOpen(false)
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive((i) => (results.length ? (i + 1) % results.length : 0))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      go(results[active])
    }
  }

  const showPanel = open && query.trim().length >= 2

  return (
    <div ref={rootRef} className="relative hidden max-w-[360px] flex-1 md:block">
      <div className="flex items-center gap-2 rounded-[7px] border border-line bg-raised px-3 py-1.5">
        <Search size={14} className="shrink-0 text-ink-faint" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          type="search"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="global-search-results"
          placeholder="Search projects, components, pages…"
          className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-faint"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
            aria-label="Clear search"
            className="cursor-pointer text-ink-faint hover:text-ink"
          >
            <X size={13} />
          </button>
        ) : null}
      </div>

      {showPanel ? (
        <div
          id="global-search-results"
          role="listbox"
          className="absolute top-full right-0 left-0 z-30 mt-1.5 overflow-hidden rounded-[8px] border border-line bg-raised shadow-2xl"
        >
          {results.length ? (
            results.map((entry, index) => {
              const Icon = KIND_ICON[entry.kind] || Search
              const on = index === active
              return (
                <button
                  key={`${entry.kind}-${entry.title}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => go(entry)}
                  className={`flex w-full items-start gap-2.5 px-3 py-2 text-left transition ${
                    on ? 'bg-overlay' : 'hover:bg-overlay/60'
                  }`}
                >
                  <Icon size={14} className="mt-0.5 shrink-0 text-ink-faint" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-ink">{entry.title}</span>
                    <span className="block truncate text-[11px] text-ink-faint">
                      {[entry.subtitle, entry.detail].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
              )
            })
          ) : (
            <div className="px-3 py-3 text-[12.5px] text-ink-faint">
              Nothing matches “{query.trim()}”.
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}