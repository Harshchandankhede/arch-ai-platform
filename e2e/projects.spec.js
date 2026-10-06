import { expect, test } from '@playwright/test'

import {
  createProject,
  expectProjectAbsent,
  expectProjectVisible,
  expectSignedIn,
  login,
  projectRow,
  register,
  signOut,
} from './support/helpers.js'

test.describe('project lifecycle', () => {
  test('a created project appears in the library and survives a reload', async ({ page }) => {
    await register(page, { name: 'Project Owner' })
    await createProject(page, 'Payments Platform')

    await page.reload()
    await expectProjectVisible(page, 'Payments Platform')
  })

  test('a new account sees the empty state, not another account’s projects', async ({ page }) => {
    await register(page, { name: 'First Owner' })
    await createProject(page, 'First Owner Project')
    await signOut(page)

    await register(page, { name: 'Second Owner' })
    await page.goto('/projects')

    await expect(page.getByText('No projects yet')).toBeVisible()
    await expect(projectRow(page, 'First Owner Project')).toHaveCount(0)
  })

  test('duplicating creates a second project that persists across a reload', async ({ page }) => {
    await register(page, { name: 'Duplicator' })
    await createProject(page, 'Checkout Service')

    const row = await gotoRow(page, 'Checkout Service')
    await row.getByRole('button', { name: 'Duplicate' }).click()

    // nextVersionName appends " v1" for the copy.
    await expectProjectVisible(page, 'Checkout Service v1')

    await page.reload()
    await expectProjectVisible(page, 'Checkout Service v1')
    await expectProjectVisible(page, 'Checkout Service')
  })

  test('a duplicated project carries the original architecture', async ({ page }) => {
    await register(page, { name: 'Arch Copier' })
    await createProject(page, 'Arch Source', { template: 'starter' })

    const sourceNodes = await nodeCountOf(page, 'Arch Source')
    expect(sourceNodes).toBeGreaterThan(0)

    const row = await gotoRow(page, 'Arch Source')
    await row.getByRole('button', { name: 'Duplicate' }).click()

    const copyNodes = await nodeCountOf(page, 'Arch Source v1')
    expect(copyNodes).toBe(sourceNodes)
  })

  test('deleting a project keeps it deleted after a reload', async ({ page }) => {
    await register(page, { name: 'Deleter' })
    await createProject(page, 'Doomed Project')
    await createProject(page, 'Survivor Project')

    page.once('dialog', (dialog) => dialog.accept())
    const row = await gotoRow(page, 'Doomed Project')
    await row.getByRole('button', { name: 'Delete' }).click()

    await expect(projectRow(page, 'Doomed Project')).toHaveCount(0)

    await page.reload()
    await expectProjectAbsent(page, 'Doomed Project')
    // The sibling must be untouched.
    await expectProjectVisible(page, 'Survivor Project')
  })

  test('cancelling the delete confirmation keeps the project', async ({ page }) => {
    await register(page, { name: 'Canceller' })
    await createProject(page, 'Kept Project')

    page.once('dialog', (dialog) => dialog.dismiss())
    const row = await gotoRow(page, 'Kept Project')
    await row.getByRole('button', { name: 'Delete' }).click()

    await page.reload()
    await expectProjectVisible(page, 'Kept Project')
  })
})

test.describe('two browsers, two accounts', () => {
  test('B never sees A’s projects, and A keeps them throughout', async ({ browser }) => {
    // Two independent contexts: separate localStorage, so this exercises real per-account
    // isolation rather than anything shared inside a single tab session.
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    const pageA = await contextA.newPage()
    const pageB = await contextB.newPage()

    try {
      const a = await register(pageA, { name: 'Account A' })
      await createProject(pageA, 'A Only Project')

      const b = await register(pageB, { name: 'Account B' })
      await createProject(pageB, 'B Only Project')

      await pageB.reload()
      await expectProjectAbsent(pageB, 'A Only Project')
      await expectProjectVisible(pageB, 'B Only Project')

      await pageA.reload()
      await expectProjectVisible(pageA, 'A Only Project')
      await expect(projectRow(pageA, 'B Only Project')).toHaveCount(0)

      // Switching A's session over to B in the same browser must show only B's data.
      await signOut(pageA)
      await login(pageA, b.email)
      await expectProjectAbsent(pageA, 'A Only Project')
      await expectProjectVisible(pageA, 'B Only Project')

      // Signing back into A restores A's project.
      await signOut(pageA)
      await login(pageA, a.email)
      await expectProjectVisible(pageA, 'A Only Project')
      await expect(projectRow(pageA, 'B Only Project')).toHaveCount(0)
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })

  test('B’s Builder shows no trace of A’s architecture', async ({ browser }) => {
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    const pageA = await contextA.newPage()
    const pageB = await contextB.newPage()

    try {
      await register(pageA, { name: 'Owner A' })
      await createProject(pageA, 'Guarded Project')
      await pageA.goto('/builder')
      await expect(pageA.getByText('Guarded Project').first()).toBeVisible()

      await register(pageB, { name: 'Owner B' })
      await pageB.goto('/builder')

      // B has no project selected, so the Builder must render its guarded empty state.
      await expect(pageB.getByText('No project selected')).toBeVisible()
      await expect(pageB.getByText('Guarded Project')).toHaveCount(0)
      await expect(pageB.locator('.react-flow__node')).toHaveCount(0)
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })
})

test.describe('sidebar navigation', () => {
  test('every sidebar page is reachable and keeps the session', async ({ page }) => {
    await register(page)

    const expected = [
      ['Dashboard', /\/dashboard$/],
      ['My Projects', /\/projects$/],
      ['Architecture Builder', /\/builder$/],
      ['Simulation', /\/simulation$/],
      ['Process Mining', /\/process-mining$/],
      ['Evaluation & Score', /\/evaluation$/],
      ['AI Recommendations', /\/recommendations$/],
      ['Compare Architectures', /\/comparison$/],
      ['Reports', /\/reports$/],
      ['Interview Prep', /\/interview$/],
      ['Learning Path', /\/learning$/],
      ['Settings', /\/settings$/],
    ]

    for (const [label, path] of expected) {
      const link = page.getByRole('link', { name: label })
      await expect(link).toBeVisible()
      await link.click()
      await expect(page).toHaveURL(path)
      await expectSignedIn(page)
    }
  })
})

// --- local helpers -------------------------------------------------------------------------

async function gotoRow(page, name) {
  await page.goto('/projects')
  const row = projectRow(page, name)
  await expect(row).toBeVisible()
  return row
}

/** Node count from the library table's second column. */
async function nodeCountOf(page, name) {
  await page.goto('/projects')
  const row = projectRow(page, name)
  await expect(row).toBeVisible()
  return Number(await row.locator('td').nth(1).innerText())
}