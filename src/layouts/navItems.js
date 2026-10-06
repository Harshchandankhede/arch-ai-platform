import {
  Activity,
  Award,
  FileText,
  FolderKanban,
  GitBranch,
  GitCompareArrows,
  GraduationCap,
  LayoutDashboard,
  MessagesSquare,
  Settings,
  Sparkles,
  Workflow,
} from 'lucide-react'

/**
 * The sidebar's navigation, in one place.
 *
 * It lives apart from AppLayout so the topbar search can index the same list. Duplicating it
 * would let the two drift, and the search would quietly stop finding pages.
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
      { to: '/comparison', label: 'Compare Architectures', icon: GitCompareArrows },
      { to: '/reports', label: 'Reports', icon: FileText },
    ],
  },
  {
    label: 'Learning',
    items: [
      { to: '/interview', label: 'Interview Prep', icon: MessagesSquare },
      { to: '/learning', label: 'Learning Path', icon: GraduationCap },
    ],
  },
  {
    label: 'System',
    items: [{ to: '/settings', label: 'Settings', icon: Settings }],
  },
]