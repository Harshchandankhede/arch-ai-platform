import { expect, test } from '@playwright/test'

import { createProject, register } from './support/helpers.js'

/**
 * Opens a simulatable project. The engine refuses an architecture with no edges or no
 * client node, so the starter template is used rather than a blank canvas.
 */
async function openSimulation(page) {
  await register(page, { name: 'Sim Tester' })
  await createProject(page, 'Sim Target', { template: 'starter' })
  await page.goto('/simulation')
  await expect(page.getByRole('heading', { name: /Simulation —/ })).toBeVisible()
}

/** Presses Start and waits for the summary to appear. */
async function runSimulation(page) {
  await page.getByRole('button', { name: /Start Simulation|Run Simulation Again/ }).click()
  const summary = page.getByRole('region', { name: 'Run summary' })
  await expect(summary).toBeVisible({ timeout: 60000 })
  return summary
}

test.describe('simulation results are presented first', () => {
  test('shows an explicit empty state before anything has run', async ({ page }) => {
    await openSimulation(page)
    await expect(page.getByText('No simulation has been run yet.')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Run summary' })).toHaveCount(0)
  })

  test('puts the summary above the diagram, not below it', async ({ page }) => {
    await openSimulation(page)
    const summary = await runSimulation(page)

    // The point of this pass: the answer must not be two screens under the button that
    // produces it. Compared by position, so a future reorder fails the test.
    const summaryBox = await summary.boundingBox()
    const diagramBox = await page.getByText('Architecture & live request flow').boundingBox()
    expect(summaryBox).not.toBeNull()
    expect(diagramBox).not.toBeNull()
    expect(summaryBox.y).toBeLessThan(diagramBox.y)
  })

  test('the summary is visible without scrolling on a laptop viewport', async ({ page }) => {
    await openSimulation(page)
    await runSimulation(page)

    const box = await page.getByRole('region', { name: 'Run summary' }).boundingBox()
    // 900px is the viewport configured for the suite.
    expect(box.y + box.height).toBeLessThan(900)
  })

  test('reports all four headline metrics', async ({ page }) => {
    await openSimulation(page)
    const summary = await runSimulation(page)

    for (const label of ['Avg Latency (p50)', 'Throughput', 'Success Rate', 'Peak Utilisation']) {
      await expect(summary.getByText(label)).toBeVisible()
    }
  })
})

test.describe('run identity is traceable', () => {
  test('names the rate, duration and seed the engine actually used', async ({ page }) => {
    await openSimulation(page)
    const summary = await runSimulation(page)

    // Read from the run result, so this stays true after the sliders are moved.
    await expect(summary.getByText('run', { exact: true })).toBeVisible()
    await expect(summary.getByText('seed', { exact: false })).toBeVisible()
    await expect(summary.getByText('req/s', { exact: false }).first()).toBeVisible()
    // The identity keys share a span with their value ("simulated 60 s"), so this one is
    // matched loosely while the standalone `run` and `capacity` labels are exact.
    await expect(summary.getByText('simulated', { exact: false })).toBeVisible()
  })

  test('surfaces the capacity verdict beside the results', async ({ page }) => {
    await openSimulation(page)
    const summary = await runSimulation(page)

    await expect(summary.getByText('capacity', { exact: true })).toBeVisible()
    // One of these, depending on the design measured.
    await expect(
      summary.getByText(/sustainable|at risk|over capacity|headroom/).first(),
    ).toBeVisible()
  })
})

test.describe('the run panel reflects the run, not the controls', () => {
  test('discloses when the workload no longer matches the run on screen', async ({ page }) => {
    await openSimulation(page)
    await runSimulation(page)

    await expect(page.getByText('What the engine used')).toBeVisible()

    // Moving a slider makes the controls disagree with the run. That must be said out loud,
    // or a reader could attribute the figures to a workload that never produced them.
    const rate = page.getByRole('slider').first()
    await rate.focus()
    for (let i = 0; i < 12; i += 1) await page.keyboard.press('ArrowRight')

    await expect(page.getByText(/The workload panel now says/)).toBeVisible()
  })
})

test.describe('capacity detail is collapsed but its conclusion is not', () => {
  test('starts collapsed with the verdict still reachable', async ({ page }) => {
    await openSimulation(page)
    await runSimulation(page)

    await expect(page.getByRole('button', { name: 'Show' }).first()).toBeVisible()
    await expect(page.getByText(/The verdict is shown in the run summary above\./)).toBeVisible()

    await page.getByRole('button', { name: 'Show' }).first().click()
    await expect(page.getByRole('button', { name: 'Hide' }).first()).toBeVisible()
  })
})

test.describe('playback controls', () => {
  test('labels the length control and exposes it as a radio group', async ({ page }) => {
    await openSimulation(page)
    await runSimulation(page)

    const group = page.getByRole('radiogroup', { name: 'Playback length for the whole run' })
    await expect(group).toBeVisible()
    await expect(page.getByText('play in', { exact: false })).toBeVisible()

    // Exactly one option is selected, and it is announced rather than only coloured. The
    // default is the 20s target, which is the third button, not the first.
    const checked = group.getByRole('radio', { checked: true })
    await expect(checked).toHaveCount(1)
    await expect(checked).toHaveText('20s')
  })

  test('shows elapsed playback time against the total', async ({ page }) => {
    await openSimulation(page)
    await runSimulation(page)

    // Previously a 1px bar with only a static "stops at 60 s" caption and no position.
    await expect(page.getByText(/\d+\.\d \/ \d+ s/)).toBeVisible()
  })

  test('space pauses and resumes, and R replays', async ({ page }) => {
    await openSimulation(page)
    await runSimulation(page)

    // Playback starts by itself once a requested run returns, so the button reads Pause.
    await expect(page.getByRole('button', { name: /^Pause$/ })).toBeVisible()

    await page.getByRole('heading', { name: /Simulation —/ }).click()
    await page.keyboard.press('Space')
    await expect(page.getByRole('button', { name: /^(Play|Resume)$/ })).toBeVisible()

    await page.keyboard.press('Space')
    await expect(page.getByRole('button', { name: /^Pause$/ })).toBeVisible()
  })

  test('the shortcut does not hijack typing in a form field', async ({ page }) => {
    await openSimulation(page)
    await runSimulation(page)

    // A number field cannot itself demonstrate a typed space, so the observable proof is
    // that pressing Space while a field has focus leaves playback alone.
    await expect(page.getByRole('button', { name: /^Pause$/ })).toBeVisible()

    const seed = page.locator('input[type="number"]')
    await seed.click()
    await page.keyboard.press('Space')

    await expect(page.getByRole('button', { name: /^Pause$/ })).toBeVisible()
    await expect(seed).toHaveValue(/\d+/)
  })
})

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('holds the diagram still, explains why, and still offers playback', async ({ page }) => {
    await openSimulation(page)
    const summary = await runSimulation(page)

    // The run and every metric still happen; only the animation is withheld.
    await expect(summary.getByText('Success Rate')).toBeVisible()
    await expect(page.getByText(/Your system asks for reduced motion/)).toBeVisible()
    await expect(page.getByRole('button', { name: /^Play$/ })).toBeVisible()
  })
})

test.describe('results survive a reload', () => {
  test('restores the figures and says so', async ({ page }) => {
    await openSimulation(page)
    const before = await runSimulation(page)
    const p95Before = await before.getByText(/p95 \d+ ms/).innerText()

    await page.reload()

    const summary = page.getByRole('region', { name: 'Run summary' })
    await expect(summary).toBeVisible()
    // The figures are back, which is the point: before this, a reload discarded them.
    await expect(summary.getByText(/p95 \d+ ms/)).toHaveText(p95Before)
    await expect(summary.getByText('Success Rate')).toBeVisible()
    await expect(summary.getByText('Throughput')).toBeVisible()
  })

  test('labels a restored summary rather than implying a live run', async ({ page }) => {
    await openSimulation(page)
    await runSimulation(page)
    await page.reload()

    await expect(page.getByRole('region', { name: 'Run summary' })).toBeVisible()
    await expect(page.getByText('restored', { exact: true })).toBeVisible()
    await expect(page.getByText(/saved on this device/)).toBeVisible()
    // It must not pretend the animation is available: there is no event log to animate.
    await expect(page.getByRole('button', { name: /^(Play|Resume|Pause|Replay)$/ })).toHaveCount(0)
  })

  test('does not restore figures for a workload that was never run', async ({ page }) => {
    await openSimulation(page)
    await runSimulation(page)
    await page.reload()
    await expect(page.getByRole('region', { name: 'Run summary' })).toBeVisible()

    // Changing the configuration must invalidate the saved figures rather than showing
    // numbers from a workload the reader is no longer looking at.
    const rate = page.getByRole('slider').first()
    await rate.focus()
    for (let i = 0; i < 10; i += 1) await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(400)

    await expect(page.getByText('restored', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Run summary' })).toHaveCount(0)
    await expect(page.getByText('No simulation has been run yet.')).toBeVisible()
  })

  test('does not restore one account’s figures under another', async ({ browser }) => {
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    const pageA = await contextA.newPage()
    const pageB = await contextB.newPage()

    try {
      await register(pageA, { name: 'Summary A' })
      await createProject(pageA, 'A Sim', { template: 'starter' })
      await pageA.goto('/simulation')
      await runSimulation(pageA)
      await pageA.reload()
      await expect(pageA.getByText('restored', { exact: true })).toBeVisible()

      // A second account on this machine starts from nothing: preferences are namespaced.
      await register(pageB, { name: 'Summary B' })
      await createProject(pageB, 'B Sim', { template: 'starter' })
      await pageB.goto('/simulation')
      await expect(pageB.getByText('No simulation has been run yet.')).toBeVisible()
      await expect(pageB.getByText('restored', { exact: true })).toHaveCount(0)
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })
})