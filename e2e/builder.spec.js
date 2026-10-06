import { expect, test } from '@playwright/test'

import {
  createProject,
  register,
  waitForAutosave,
} from './support/helpers.js'

/** Opens a project in the Builder via the library row. */
async function openInBuilder(page, projectName) {
  await page.goto('/projects')
  const row = page.locator('tr').filter({ has: page.getByText(projectName, { exact: true }) })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Open' }).click()
  await expect(page).toHaveURL(/\/builder$/)
  // The palette is always present. Nodes are not: a project created from the blank template
  // legitimately starts with an empty canvas.
  await expect(page.getByText('Component palette')).toBeVisible()
}

/** Component count currently rendered on the canvas. */
async function canvasNodeCount(page) {
  return page.locator('.react-flow__node').count()
}

/** Loads a template through the "Load template" select. */
async function loadTemplate(page, templateKey) {
  // The Builder asks for confirmation before replacing the canvas. Playwright dismisses
  // dialogs by default, which silently cancelled every template load, so the confirmation
  // is accepted explicitly for the duration of this call.
  const acceptDialog = (dialog) => dialog.accept()
  page.on('dialog', acceptDialog)
  try {
    await page.getByLabel('Load template').selectOption(templateKey)
    await expect(page.locator('.react-flow__node').first()).toBeVisible()
  } finally {
    page.off('dialog', acceptDialog)
  }
}

test.describe('builder autosave', () => {
  test('a project created from a template opens with components on the canvas', async ({ page }) => {
    await register(page, { name: 'Builder User' })
    await createProject(page, 'Autosave Target', { template: 'starter' })
    await openInBuilder(page, 'Autosave Target')

    const nodes = await canvasNodeCount(page)
    expect(nodes).toBeGreaterThan(1)
  })

  test('canvas edits survive a reload, proving autosave reached the server', async ({ page }) => {
    await register(page, { name: 'Autosave Editor' })
    await createProject(page, 'Persist Target', { template: 'blank' })

    await openInBuilder(page, 'Persist Target')
    // A blank canvas has nothing to lose, so the edit below is unambiguous.
    await loadTemplate(page, 'strong')
    await expect.poll(() => canvasNodeCount(page)).toBeGreaterThan(1)

    await waitForAutosave()

    // Reload: the architecture must come back from the database, not from memory.
    await page.reload()
    await expect(page.locator('.react-flow__node').first()).toBeVisible()

    const afterReload = await canvasNodeCount(page)
    expect(afterReload).toBeGreaterThan(1)
  })

  test('the reloaded architecture is the one that was saved, not the original blank one', async ({ page }) => {
    await register(page, { name: 'Strong Template' })
    await createProject(page, 'Resilient Build', { template: 'blank' })

    await openInBuilder(page, 'Resilient Build')
    await loadTemplate(page, 'strong')
    await expect.poll(() => canvasNodeCount(page)).toBeGreaterThan(1)
    const edited = await canvasNodeCount(page)
    await waitForAutosave()

    await page.reload()
    await expect(page.locator('.react-flow__node').first()).toBeVisible()

    expect(await canvasNodeCount(page)).toBe(edited)
  })

  test('the library reflects the saved node count after a reload', async ({ page }) => {
    await register(page, { name: 'Count Checker' })
    await createProject(page, 'Counted Build', { template: 'starter' })

    await openInBuilder(page, 'Counted Build')
    await loadTemplate(page, 'weak')
    await expect.poll(() => canvasNodeCount(page)).toBeGreaterThan(0)
    const onCanvas = await canvasNodeCount(page)
    await waitForAutosave()

    await page.goto('/projects')
    const row = page.locator('tr').filter({ has: page.getByText('Counted Build', { exact: true }) })
    await expect(row).toBeVisible()
    // Columns are name, nodes, edges, updated, actions.
    expect(Number(await row.locator('td').nth(1).innerText())).toBe(onCanvas)
  })

  test('switching to a different project loads that project, not the previous canvas', async ({ page }) => {
    await register(page, { name: 'Switcher' })
    await createProject(page, 'Small One', { template: 'blank' })
    await createProject(page, 'Big One', { template: 'strong' })

    await openInBuilder(page, 'Big One')
    const bigCount = await canvasNodeCount(page)
    expect(bigCount).toBeGreaterThan(1)

    // Selecting the other project must replace the canvas.
    await page.goto('/projects')
    const row = page.locator('tr').filter({ has: page.getByText('Small One', { exact: true }) })
    await row.getByRole('button', { name: 'Open' }).click()
    await expect(page).toHaveURL(/\/builder$/)

    await expect.poll(() => canvasNodeCount(page)).toBeLessThan(bigCount)
  })
})