// Backs the topbar search. The index is derived from state already in memory, so search
// never issues a request and never waits on the network.

/**
 * Flattens the sidebar nav into searchable page entries.
 *
 * Takes the whole group list, not one group: it is easy to hand this to `flatMap`, which
 * invokes its callback per element and would then pass a single group here.
 */
export function pageEntries(navGroups) {
  const out = []
  for (const group of Array.isArray(navGroups) ? navGroups : []) {
    for (const item of group?.items || []) {
      out.push({
        kind: 'page',
        title: item.label,
        subtitle: group.label,
        to: item.to,
        terms: `${item.label} ${group.label}`,
      })
    }
  }
  return out
}

/**
 * Everything searchable: projects, the components inside the open project, and the pages
 * themselves. Projects come from the context, which already returns an empty list unless it
 * was loaded for the signed-in account, so search cannot surface another user's work.
 */
export function buildSearchIndex({ projects = [], currentProject = null, pages = [] } = {}) {
  const entries = []

  for (const project of projects) {
    if (!project?.id) continue
    entries.push({
      kind: 'project',
      title: project.name || 'Untitled Project',
      subtitle: project.description || 'Project',
      detail: `${project.arch?.nodes?.length ?? 0} components · ${project.arch?.edges?.length ?? 0} connections`,
      to: '/projects',
      projectId: project.id,
      terms: `${project.name || ''} ${project.description || ''}`,
    })
  }

  for (const node of currentProject?.arch?.nodes || []) {
    const name = node?.name || node?.id
    if (!name) continue
    entries.push({
      kind: 'component',
      title: name,
      subtitle: `${node.type || 'component'}${node.category ? ` · ${node.category}` : ''}`,
      detail: `in ${currentProject.name || 'the open project'}`,
      to: '/builder',
      terms: `${name} ${node.id || ''} ${node.type || ''} ${node.category || ''}`,
    })
  }

  entries.push(...pages)
  return entries
}

/**
 * Ranks an entry against a query. Higher is better; 0 means no match.
 *
 * Ranking is deliberately ordered by how sure we are: an exact title beats a title prefix,
 * which beats a word boundary, which beats a loose substring somewhere in the text. Without
 * that, searching "server" would rank a component merely containing the letters above the
 * one actually named "Server".
 */
function score(entry, needle) {
  const title = (entry.title || '').toLowerCase()
  const terms = (entry.terms || '').toLowerCase()

  if (title === needle) return 100
  if (title.startsWith(needle)) return 80
  if (title.includes(needle)) return 60
  if (new RegExp(`\\b${escapeRegExp(needle)}`).test(terms)) return 40
  if (terms.includes(needle)) return 20
  return 0
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Short, ordered result list. An empty or one-character query returns nothing. */
export function searchEntries(entries, query, limit = 8) {
  const needle = String(query || '').trim().toLowerCase()
  if (needle.length < 2) return []
  const scored = []
  for (const entry of entries) {
    const value = score(entry, needle)
    if (value > 0) scored.push({ entry, value })
  }
  scored.sort((a, b) => b.value - a.value || a.entry.title.localeCompare(b.entry.title))
  return scored.slice(0, limit).map((s) => s.entry)
}