import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Activity,
  Award,
  Bell,
  FileText,
  FolderKanban,
  GitBranch,
  GitCompare,
  GraduationCap,
  LayoutDashboard,
  Menu,
  MessagesSquare,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Workflow,
  X,
} from 'lucide-react'
import { useApp } from '../store/AppContext.jsx'
import { resultKey } from '../store/useResults.js'
import { colors, scoreColor } from '../theme/tokens.js'
import { ToastHost } from '../components/ui.jsx'

const navGroups = [
  {
    label: 'Workspace',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/projects', label: 'My Projects', icon: FolderKanban },
    ],
  },
  {
    label: 'Core Pipeline',
    items: [
      { to: '/builder', label: 'Architecture Builder', icon: Workflow },
      { to: '/simulation', label: 'Simulation', icon: Activity },
      { to: '/process-mining', label: 'Process Mining', icon: GitBranch },
      { to: '/evaluation', label: 'Evaluation & Score', icon: Award },
    ],
  },
  {
    label: 'Insights',
    items: [
      { to: '/recommendations', label: 'AI Recommendations', icon: Sparkles },
      { to: '/comparison', label: 'Comparison', icon: GitCompare },
      { to: '/reports', label: 'Reports', icon: FileText },
    ],
  },
  {
    label: 'Learning',
    items: [
      { to: '/interview', label: 'AI Interview', icon: MessagesSquare },
      { to: '/learning', label: 'Learning Progress', icon: GraduationCap },
    ],
  },
  {
    label: 'System',
    items: [{ to: '/settings', label: 'Settings', icon: SettingsIcon }],
  },
]

function Sidebar({ open, onClose, health }) {
  const { currentProject } = useApp()
  return (
    <aside
      className={`no-print flex h-screen shrink-0 flex-col border-r border-line-soft bg-base-alt transition-[left] duration-200 lg:sticky lg:top-0 ${
        open ? 'left-0' : '-left-[230px] lg:left-0'
      } fixed z-30 w-[230px] lg:static lg:z-auto`}
    >
      <div className="flex items-center gap-2.5 border-b border-line-soft px-4 py-5">
        <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[7px] bg-gradient-to-br from-accent to-[#c98a2e] font-mono text-[15px] font-bold text-[#1a1206]">
          A
        </div>
        <div className="min-w-0">
          <div className="font-mono text-[15px] font-bold tracking-tight">Arch-AI</div>
          <div className="mt-0.5 font-mono text-[10px] tracking-wider text-ink-faint uppercase">
            Design · Simulate · Evaluate
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto cursor-pointer text-ink-faint lg:hidden"
          aria-label="Close navigation"
        >
          <X size={16} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 py-3.5">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-4 last:mb-0">
            <div className="px-2.5 pt-2 pb-1.5 font-mono text-[10px] tracking-widest text-ink-faint uppercase">
              {group.label}
            </div>
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onClose}
                className={({ isActive }) =>
                  `mb-0.5 flex items-center gap-2.5 rounded-[8px] border px-2.5 py-2 text-[13px] font-medium transition ${
                    isActive
                      ? 'border-line bg-raised text-accent'
                      : 'border-transparent text-ink-dim hover:bg-raised hover:text-ink'
                  }`
                }
              >
                <item.icon size={16} className="shrink-0" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="border-t border-line-soft p-3.5">
        <div className="rounded-[8px] border border-line bg-raised px-3 py-2.5">
          <div className="mb-1 font-mono text-[10px] tracking-wider text-ink-faint uppercase">
            {currentProject ? 'Current Health Score' : 'No project'}
          </div>
          <div
            className="font-mono text-[20px] font-bold"
            style={{ color: health === null ? colors.inkFaint : scoreColor(health) }}
          >
            {health === null ? '—' : health}
            <span className="text-[12px] text-ink-faint">/100</span>
          </div>
        </div>
      </div>
    </aside>
  )
}

function Topbar({ onMenu }) {
  const { currentProject, user, demoMode } = useApp()
  return (
    <header className="no-print sticky top-0 z-20 flex h-[58px] shrink-0 items-center gap-4 border-b border-line-soft bg-base/85 px-5 backdrop-blur">
      <button
        type="button"
        onClick={onMenu}
        className="cursor-pointer text-ink-dim lg:hidden"
        aria-label="Open navigation"
      >
        <Menu size={18} />
      </button>

      <div className="flex min-w-0 items-center gap-2 rounded-[7px] border border-line bg-raised px-3 py-1.5">
        <FolderKanban size={13} className="shrink-0 text-ink-dim" />
        <span className="truncate font-mono text-[12px] text-ink-dim">
          <b className="font-semibold text-ink">{currentProject?.name || 'No project'}</b>
        </span>
      </div>

      <div className="hidden max-w-[360px] flex-1 items-center gap-2 rounded-[7px] border border-line bg-raised px-3 py-1.5 text-ink-faint md:flex">
        <Search size={14} />
        <span className="text-[12.5px]">Search projects, components, reports…</span>
      </div>

      <div className="ml-auto flex items-center gap-3.5">
        {demoMode && (
          <span className="hidden rounded-[5px] border border-accent/40 bg-accent/10 px-2 py-0.5 font-mono text-[10px] tracking-wide text-accent uppercase sm:inline">
            Demo mode
          </span>
        )}
        <button type="button" className="relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-[7px] border border-line bg-raised text-ink-dim">
          <Bell size={15} />
          <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-base-alt bg-red" />
        </button>
        <div
          className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-teal to-blue font-mono text-[12px] font-bold text-[#04120e]"
          title={user?.email}
        >
          {user?.initials || '—'}
        </div>
      </div>
    </header>
  )
}

export default function AppLayout() {
  const { simCache, workload, currentProject } = useApp()
  const [open, setOpen] = useState(false)
  const location = useLocation()

  let health = null
  if (currentProject?.arch) {
    const key = resultKey(currentProject.arch, workload)
    const cached = simCache[key]
    if (cached?.evaluation) health = cached.evaluation.healthScore
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar key={location.pathname} open={open} onClose={() => setOpen(false)} health={health} />
      {open && (
        <div className="fixed inset-0 z-20 bg-black/60 lg:hidden" onClick={() => setOpen(false)} aria-hidden />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setOpen(true)} />
        <main className="flex-1 px-5 py-6 pb-14 lg:px-7">
          <Outlet />
        </main>
      </div>
      <ToastHost />
    </div>
  )
}
