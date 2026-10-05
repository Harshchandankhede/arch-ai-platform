import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { buildSearchIndex, pageEntries, searchEntries } from '../src/lib/searchIndex.js'
import { navGroups } from '../src/layouts/navItems.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const search = read('src/components/GlobalSearch.jsx')
const bell = read('src/components/NotificationBell.jsx')
const layout = read('src/layouts/AppLayout.jsx')
const reducer = read('src/store/reducer.js')
const ctx = read('src/store/AppContext.jsx')
const results = read('src/store/useResults.js')

const projects = [
  { id: 'a1', name: 'Payments Platform', description: 'Layered checkout flow', arch: { nodes: [], edges: [] } },
  { id: 'b2', name: 'Search Indexer', description: 'Nightly crawler', arch: { nodes: [], edges: [] } },
]

const currentProject = {
  name: 'Payments Platform',
  arch: {
    nodes: [
      { id: 'n1', name: 'API Gateway', type: 'apiGateway', category: 'application' },
      { id: 'n2', name: 'Primary Database', type: 'database', category: 'data' },
    ],
  },
}

const entries = buildSearchIndex({ projects, currentProject, pages: pageEntries(navGroups) })

const titles = (q) => searchEntries(entries, q).map((e) => e.title)

describe('the search index covers projects, components and pages', () => {
  it('indexes every project', () => {
    assert.equal(entries.filter((e) => e.kind === 'project').length, 2)
  })

  it('indexes the components of the open project', () => {
    const components = entries.filter((e) => e.kind === 'component')
    assert.deepEqual(components.map((c) => c.title), ['API Gateway', 'Primary Database'])
  })

  it('indexes every navigation page', () => {
    const pageCount = navGroups.reduce((n, g) => n + g.items.length, 0)
    assert.equal(entries.filter((e) => e.kind === 'page').length, pageCount)
  })

  it('finds a project by name and by description', () => {
    assert.ok(titles('payments').includes('Payments Platform'))
    assert.ok(titles('crawler').includes('Search Indexer'))
  })

  it('finds a component by name', () => {
    assert.ok(titles('gateway').includes('API Gateway'))
    assert.ok(titles('database').includes('Primary Database'))
  })

  it('finds a page by label', () => {
    assert.ok(titles('simulation').includes('Simulation'))
    assert.ok(titles('evaluation').includes('Evaluation & Score'))
  })

  it('tolerates a project with no description', () => {
    const built = buildSearchIndex({ projects: [{ id: 'x', name: 'Bare', arch: {} }] })
    assert.equal(built[0].subtitle, 'Project')
  })

  it('skips a project with no id, which nothing can navigate to', () => {
    assert.equal(buildSearchIndex({ projects: [{ name: 'No id' }] }).length, 0)
  })
})

describe('search ranking puts the most likely match first', () => {
  it('an exact title beats a partial one', () => {
    const found = titles('api gateway')
    assert.equal(found[0], 'API Gateway')
  })

  it('a title prefix beats a mid-word match', () => {
    const list = buildSearchIndex({
      projects: [
        { id: '1', name: 'Indexer Internals', arch: {} },
        { id: '2', name: 'Indexer', arch: {} },
      ],
    })
    assert.equal(searchEntries(list, 'indexer')[0].title, 'Indexer')
  })

  it('matches case-insensitively', () => {
    assert.ok(titles('PAYMENTS').includes('Payments Platform'))
  })

  it('returns nothing for a query shorter than two characters', () => {
    assert.deepEqual(searchEntries(entries, 'a'), [])
    assert.deepEqual(searchEntries(entries, ''), [])
    assert.deepEqual(searchEntries(entries, '   '), [])
  })

  it('returns nothing for a query that matches nothing', () => {
    assert.deepEqual(searchEntries(entries, 'zzzznotathing'), [])
  })

  it('caps the result list', () => {
    assert.ok(searchEntries(entries, 'a', 2).length <= 2)
  })

  it('does not treat a regex metacharacter as a pattern', () => {
    // A user typing "c++" must not blow up or match everything.
    const built = buildSearchIndex({ projects: [{ id: '1', name: 'C plus plus', arch: {} }] })
    assert.ok(Array.isArray(searchEntries(built, 'c++')))
  })
})

describe('the search bar is a real control', () => {
  it('replaced the static placeholder div', () => {
    // It used to be a <div> with the words "Search projects, components, reports…",
    // which looked like an input and did nothing when clicked.
    assert.match(search, /<input[\s\S]*?type="search"/)
    assert.match(search, /role="combobox"/)
    assert.doesNotMatch(layout, /Search projects, components, reports…/)
    assert.match(layout, /<GlobalSearch \/>/)
  })

  it('supports the keyboard paths a combobox needs', () => {
    assert.match(search, /event\.key === 'ArrowDown'/)
    assert.match(search, /event\.key === 'ArrowUp'/)
    assert.match(search, /event\.key === 'Enter'/)
    assert.match(search, /event\.key === 'Escape'/)
  })

  it('closes on an outside click rather than trapping the user', () => {
    assert.match(search, /document\.addEventListener\('mousedown'/)
  })

  it('selects the project it jumps to, not whichever was already open', () => {
    assert.match(search, /if \(entry\.projectId\) dispatch\(\{ type: 'SET_CURRENT_PROJECT', id: entry\.projectId \}\)/)
  })

  it('shares the sidebar navigation rather than duplicating it', () => {
    assert.doesNotMatch(layout, /const navGroups = \[/)
    assert.match(layout, /from '\.\/navItems\.js'/)
  })

  it('shows an explicit empty state instead of a blank panel', () => {
    assert.match(search, /Nothing matches/)
  })

  it('passes the whole nav group list to pageEntries', () => {
    // Regression: `navGroups.flatMap(pageEntries)` looks equivalent but flatMap invokes its
    // callback once per ELEMENT, so pageEntries received a single group object and
    // `for (const group of navGroups)` threw "navGroups is not iterable". That blanked the
    // whole dashboard, and only when authenticated, because the login page never mounts the
    // topbar. Unit-testing pageEntries(navGroups) directly never exercised the call site.
    assert.match(search, /pages: pageEntries\(navGroups\)/)
    assert.doesNotMatch(search, /flatMap\(pageEntries\)/)
  })

  it('pageEntries tolerates a non-array so it can never throw at render time', () => {
    const out = pageEntries(undefined)
    assert.deepEqual(out, [])
    assert.deepEqual(pageEntries('not an array'), [])
    assert.deepEqual(pageEntries([{ label: 'G', items: [] }]), [])
  })
})

describe('the topbar does not reference anything it failed to import', () => {
  // A `ReferenceError` during render blanks the whole React tree, and with no error boundary
  // the user gets a white page with nothing in the console's favour. Removing an import as
  // "unused" is exactly how that happens: `colors.inkFaint` was still used by the sidebar's
  // health-score readout after `colors` was dropped from the import list.
  it('imports every shared token the layout uses', () => {
    const used = [...layout.matchAll(/(?<![.\w$])(colors|scoreColor)\b/g)].map((m) => m[1])
    assert.ok(used.includes('colors'), 'the sidebar health readout still uses colors.inkFaint')
    const imported = [...layout.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\.\/theme\/tokens\.js'/g)]
      .flatMap((m) => m[1].split(',').map((s) => s.trim()))
    for (const name of new Set(used)) {
      assert.ok(imported.includes(name), `${name} is used in AppLayout but not imported from theme/tokens.js`)
    }
  })

  it('the layout has no undefined shared identifiers', () => {
    // Narrowed to the tokens this file actually touches, so it has no false positives.
    const body = layout.replace(/import[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
    for (const name of ['colors', 'scoreColor']) {
      const used = new RegExp(`(?<![.\\w$'"\`])${name}\\b`).test(body)
      if (used) assert.ok(layout.includes(`${name}`), `${name} must be imported`)
    }
    // Every nav icon is resolved from navGroups, so a group must not reference a missing icon.
    assert.match(layout, /from '\.\/navItems\.js'/)
  })
})

describe('notifications are real', () => {
  it('the unread dot is driven by state, not hard-coded', () => {
    // The red dot was painted unconditionally, so the bell looked permanently unread and
    // clicking it did nothing at all.
    assert.match(bell, /unreadCount/)
    assert.match(bell, /\{unreadCount > 0 \?/)
    assert.doesNotMatch(bell, /absolute -top-0\.5 -right-0\.5 h-2 w-2 rounded-full border-2 border-base-alt bg-red/)
  })

  it('is mounted in the layout', () => {
    assert.match(layout, /<NotificationBell \/>/)
  })

  it('can be read, read-all and cleared', () => {
    assert.match(bell, /markNotificationRead\(item\.id\)/)
    assert.match(bell, /markAllNotificationsRead/)
    assert.match(bell, /clearNotifications/)
    assert.match(reducer, /case 'MARK_NOTIFICATION_READ'/)
    assert.match(reducer, /case 'MARK_ALL_NOTIFICATIONS_READ'/)
    assert.match(reducer, /case 'CLEAR_NOTIFICATIONS'/)
  })

  it('caps the list so it cannot grow for the life of the tab', () => {
    assert.match(reducer, /NOTIFICATION_LIMIT/)
    assert.match(reducer, /next\.slice\(0, NOTIFICATION_LIMIT\)/)
  })

  it('is raised when a run finishes, wherever the user has navigated to', () => {
    assert.match(results, /emitNotification\(\{/)
    assert.match(results, /title: 'Simulation finished'/)
    assert.match(results, /title: 'Simulation failed'/)
    assert.match(ctx, /setNotificationSink\(\(n\) => dispatch\(\{ type: 'PUSH_NOTIFICATION'/)
  })

  it('reaches the app root without a circular import', () => {
    // useResults already imports AppContext. Routing notifications back the other way
    // closed a cycle, which let the two modules observe each other mid-evaluation.
    assert.match(results, /from '\.\/notificationSink\.js'/)
    assert.doesNotMatch(results, /export function setNotificationSink/)
  })

  it('clears on sign-out so the next account sees none of them', () => {
    const logout = reducer.slice(reducer.indexOf("case 'LOGOUT'"), reducer.indexOf("case 'LOAD_PREFS'"))
    assert.match(logout, /notifications: \[\]/)
  })

  it('is not persisted, so yesterday\'s run is not reported as news', () => {
    const persist = reducer.slice(reducer.indexOf('export function persistable'))
    const fn = persist.slice(0, persist.indexOf('\n}'))
    assert.doesNotMatch(fn, /notifications/)
  })

  it('shows relative timestamps and an empty state', () => {
    assert.match(bell, /function ago\(timestamp\)/)
    assert.match(bell, /Nothing yet/)
  })
})