import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy, FolderKanban, Play, Plus, Trash2, Workflow, X } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  DataTable,
  Empty,
  Field,
  PageHead,
  inputClass,
} from '../components/ui.jsx'
import { useApp, useDispatch } from '../store/AppContext.jsx'
import { createProject, deleteProject, templates } from '../services/projects.js'

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

const UNITS = [
  ['year', 31536000000],
  ['month', 2592000000],
  ['week', 604800000],
  ['day', 86400000],
  ['hour', 3600000],
  ['minute', 60000],
]

function relativeTime(timestamp) {
  if (!timestamp) return '—'
  const diff = Number(timestamp) - Date.now()
  if (!Number.isFinite(diff)) return '—'
  const abs = Math.abs(diff)
  for (const [unit, ms] of UNITS) {
    if (abs >= ms) return rtf.format(Math.round(diff / ms), unit)
  }
  return 'just now'
}

function nextVersionName(name, projects) {
  const base = String(name || 'Untitled Project').replace(/\s+v\d+\s*$/i, '')
  const taken = new Set(projects.map((p) => p?.name).filter(Boolean))
  let n = 1
  let candidate = `${base} v${n}`
  while (taken.has(candidate)) {
    n += 1
    candidate = `${base} v${n}`
  }
  return candidate
}

export default function Projects() {
  const { projects, currentProjectId, notify, user, ownsProjects } = useApp()
  const dispatch = useDispatch()
  const navigate = useNavigate()

  // Only ever work with a list that was fetched for the account that is signed in.
  // While it is loading, or if ownership does not match, this is empty and the page
  // shows the empty state rather than another account's projects.
  const visibleProjects = useMemo(
    () => (ownsProjects && Array.isArray(projects) ? projects.filter(Boolean) : []),
    [ownsProjects, projects],
  )

  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [templateKey, setTemplateKey] = useState('starter')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [busyIds, setBusyIds] = useState(() => new Set())

  const markBusy = useCallback((id, on) => {
    setBusyIds((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  // Duplicate and Delete now go through the server rather than editing the reducer alone.
  //
  // Both previously dispatched locally, which made them look like they worked while
  // changing nothing on disk: projects are server-owned and are not written to
  // localStorage, so the row vanished on reload. The architecture is sent to POST rather
  // than read back from the source project, which keeps the copy independent.
  const onDuplicate = useCallback(
    async (project) => {
      markBusy(project.id, true)
      try {
        const copy = await createProject({
          name: nextVersionName(project.name, visibleProjects),
          description: project.description || '',
          templateKey: 'blank',
          arch: project.arch,
        })
        dispatch({ type: 'CREATE_PROJECT', project: copy })
        notify(`Created “${copy.name}” as a new version`)
      } catch (err) {
        notify(err?.message || 'Could not duplicate that project.', 'error')
      } finally {
        markBusy(project.id, false)
      }
    },
    [dispatch, markBusy, notify, visibleProjects],
  )

  const onDelete = useCallback(
    async (project) => {
      const ok = window.confirm(
        `Delete “${project.name}”? This permanently removes the project and its saved architectures.`,
      )
      if (!ok) return
      markBusy(project.id, true)
      try {
        await deleteProject({ id: project.id })
        dispatch({ type: 'DELETE_PROJECT', id: project.id })
        notify(`Deleted “${project.name}”`)
      } catch (err) {
        notify(err?.message || 'Could not delete that project.', 'error')
      } finally {
        markBusy(project.id, false)
      }
    },
    [dispatch, markBusy, notify],
  )

  const rows = useMemo(() => {
    const list = visibleProjects
    return list.map((project) => {
      const isCurrent = project.id === currentProjectId
      const open = (target) => {
        dispatch({ type: 'SET_CURRENT_PROJECT', id: project.id })
        navigate(target)
      }
      return {
        key: project.id,
        cells: [
          <div key="name" className="min-w-[180px]">
            <div className="flex items-center gap-2 font-semibold">
              <span className="truncate">{project.name || 'Untitled Project'}</span>
              {isCurrent && <Badge tone="amber">Current</Badge>}
            </div>
            <div className="mt-0.5 line-clamp-2 max-w-[380px] text-[12px] text-ink-faint">
              {project.description || 'No description.'}
            </div>
          </div>,
          <span key="nodes" className="font-mono">
            {project.arch?.nodes?.length ?? 0}
          </span>,
          <span key="edges" className="font-mono">
            {project.arch?.edges?.length ?? 0}
          </span>,
          <span key="updated" className="font-mono whitespace-nowrap text-ink-dim">
            {relativeTime(project.updatedAt)}
          </span>,
          <div key="actions" className="flex flex-wrap justify-end gap-1.5">
            <Button size="sm" icon={<Workflow size={13} />} onClick={() => open('/builder')}>
              Open
            </Button>
            <Button size="sm" icon={<Play size={13} />} onClick={() => open('/simulation')}>
              Simulate
            </Button>
            <Button
              size="sm"
              icon={<Copy size={13} />}
              disabled={busyIds.has(project.id)}
              onClick={() => onDuplicate(project)}
            >
              Duplicate
            </Button>
            <Button
              size="sm"
              variant="danger"
              icon={<Trash2 size={13} />}
              disabled={busyIds.has(project.id)}
              onClick={() => onDelete(project)}
            >
              Delete
            </Button>
          </div>,
        ],
      }
    })
  }, [visibleProjects, currentProjectId, dispatch, navigate, onDuplicate, onDelete])

  async function onCreate(event) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setFormError('')
    try {
      const project = await createProject({ name, description, templateKey })
      dispatch({ type: 'CREATE_PROJECT', project })
      notify(`Created “${project.name}”`)
      setName('')
      setDescription('')
      setTemplateKey('starter')
      setFormOpen(false)
    } catch (err) {
      setFormError(err?.message || 'Could not create the project.')
    } finally {
      setBusy(false)
    }
  }

  const hasProjects = visibleProjects.length > 0

  return (
    <div>
      <PageHead
        eyebrow="Workspace"
        title="My Projects"
        desc="Each project holds one or more architectures you can build, simulate, mine and evaluate independently."
        actions={
          <Button
            variant={formOpen ? 'ghost' : 'primary'}
            icon={formOpen ? <X size={15} /> : <Plus size={15} />}
            onClick={() => setFormOpen((v) => !v)}
          >
            {formOpen ? 'Close form' : 'Create Project'}
          </Button>
        }
      />

      {formOpen && (
        <Card title="Create project" sub="Pick a starting template — you can change every node afterwards" className="mb-3.5">
          <form onSubmit={onCreate}>
            <div className="grid grid-cols-1 gap-x-4 md:grid-cols-2">
              <Field label="Project name">
                <input
                  className={inputClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Payments Platform — v1"
                />
              </Field>
              <Field label="Template">
                <select
                  className={inputClass}
                  value={templateKey}
                  onChange={(e) => setTemplateKey(e.target.value)}
                >
                  {templates.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Description" hint="What question is this architecture meant to answer?">
              <input
                className={inputClass}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Layered checkout flow with cache and authentication tier."
              />
            </Field>

            {formError && (
              <div className="mb-3.5 rounded-[7px] border border-red bg-red/10 px-3 py-2.5 text-[12.5px] text-red">
                {formError}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" disabled={busy} icon={<Plus size={15} />}>
                {busy ? 'Creating…' : 'Create project'}
              </Button>
              <Button onClick={() => setFormOpen(false)}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      <Card
        title="Project library"
        sub={`${visibleProjects.length} project${visibleProjects.length === 1 ? '' : 's'} owned by ${
          user?.email || 'your account'
        }`}
      >
        {hasProjects ? (
          <DataTable
            headers={['Project', 'Nodes', 'Edges', 'Updated', '']}
            rows={rows}
            empty="No projects yet."
          />
        ) : (
          <Empty
            icon={<FolderKanban size={30} />}
            title="No projects yet"
            hint="Create your first architecture workspace from a template or a blank canvas."
            action={
              <Button variant="primary" icon={<Plus size={15} />} onClick={() => setFormOpen(true)}>
                Create Project
              </Button>
            }
          />
        )}
      </Card>
    </div>
  )
}
