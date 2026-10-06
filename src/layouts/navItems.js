import {
  Activity,
  Award,
  FileText,
  FolderKanban,
  GitBranch,
  LayoutDashboard,
  Settings,
  Sparkles,
  Workflow,
} from 'lucide-react'

/**
 * The sidebar's navigation, in one place.
 *
 * It lives apart from AppLayout so the topbar search can index the same list. Duplicating it
 * would let the two drift, and the search would quietly stop finding pages.
 *
 * Compare Architectures, Interview Prep and Learning Path are deliberately absent. Their
 * routes, pages, components and state are all still present and reachable by URL; only the
 * navigation entries were withdrawn while they sit outside the current scope. Restoring them
 * means re-adding the entries below plus their three lucide icon imports.
 */
export const navGroups = [
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
      { to: '/reports', label: 'Reports', icon: FileText },
    ],
  },
  {
    label: 'System',
    items: [{ to: '/settings', label: 'Settings', icon: Settings }],
  },
]