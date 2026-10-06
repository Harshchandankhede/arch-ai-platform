import { expect } from '@playwright/test'

// Shared page helpers. Selectors are written against the accessible names the UI actually
// exposes (placeholders, button text, aria-labels) rather than CSS classes, so a styling
// change does not break the suite.

let counter = 0

/** A fresh email per call, so tests never collide on the unique email index. */
export function uniqueEmail(prefix = 'e2e') {
  counter += 1
  return `${prefix}.${Date.now().toString(36)}.${counter}@example.com`
}

export const PASSWORD = 'E2eJourney!Pass123'

/**
 * Asserts the app is in a signed-in state.
 *
 * Deliberately does NOT assert a specific landing route. The route guard passes the
 * attempted path through as `state.from` and Login navigates back to it, so signing in
 * after being bounced off /settings returns to /settings. That is the intended
 * return-to-origin behaviour, and asserting /dashboard here would be wrong.
 */
export async function expectSignedIn(page) {
  await expect(page).not.toHaveURL(/\/login/)
  // The sidebar only renders inside the protected layout.
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
}

export async function register(page, { name = 'E2E User', email = uniqueEmail() } = {}) {
  await page.goto('/register')
  await page.getByPlaceholder('Your full name').fill(name)
  await page.getByPlaceholder('Enter your email').fill(email)
  await page.getByPlaceholder('Your password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expectSignedIn(page)
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
  return { email, password: PASSWORD }
}

export async function login(page, email, password = PASSWORD) {
  await page.goto('/login')
  await page.getByPlaceholder('Enter your email').fill(email)
  await page.getByPlaceholder('Your password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expectSignedIn(page)
}

export async function signOut(page) {
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login/)
}

export async function createProject(page, name, { template = 'starter' } = {}) {
  await page.goto('/projects')
  // The empty state also renders a "Create Project" button, so the page-header one is
  // addressed explicitly to avoid a strict-mode violation.
  await page.getByRole('button', { name: 'Create Project' }).first().click()

  const form = page.locator('form').filter({ hasText: 'Create project' })
  await expect(form).toBeVisible()
  await form.getByPlaceholder('Payments Platform — v1').fill(name)
  // The template select carries no label, so it is addressed within the form.
  await form.locator('select').first().selectOption(template)
  // Scoped to the form, because the empty-state button carries the same label.
  await form.getByRole('button', { name: 'Create project' }).click()

  // Asserted against the table row: the confirmation toast also quotes the project name,
  // so a page-wide text match resolves to two elements.
  await expect(page.locator('tr').filter({ hasText: name })).toBeVisible()
  return name
}

/**
 * Row locator for a project in the library table.
 *
 * Always prefer this over a page-wide text match: the confirmation toast quotes the
 * project name too, so `getByText(name)` resolves to two elements and trips strict mode.
 * The match is exact on purpose — a substring filter would also match "Checkout Service v1"
 * when asked for "Checkout Service".
 */
export function projectRow(page, name) {
  return page.locator('tr').filter({ has: page.getByText(name, { exact: true }) })
}

/** Asserts a project row is present in the library. */
export async function expectProjectVisible(page, name) {
  await page.goto('/projects')
  await expect(projectRow(page, name)).toBeVisible()
}

/** Asserts a project name appears nowhere in the library. */
export async function expectProjectAbsent(page, name) {
  await page.goto('/projects')
  await expect(projectRow(page, name)).toHaveCount(0)
}

/** Waits for autosave to flush: the Builder debounces for 400 ms before writing. */
export async function waitForAutosave() {
  await new Promise((r) => setTimeout(r, 1200))
}

/** Every architecture node name currently rendered on the Builder canvas. */
export async function canvasNodeNames(page) {
  return page.locator('.react-flow__node').allInnerTexts()
}

/** Waits for autosave to flush and returns nothing; see waitForAutosave below. */
export async function gotoProjectsAndFindRow(page, projectName) {
  await page.goto('/projects')
  const row = projectRow(page, projectName)
  await expect(row).toBeVisible()
  return row
}