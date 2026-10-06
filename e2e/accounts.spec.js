import { expect, test } from '@playwright/test'

import { login, register, signOut, uniqueEmail, PASSWORD } from './support/helpers.js'

test.describe('account journey', () => {
  test('a new account registers and lands on the dashboard', async ({ page }) => {
    await register(page, { name: 'Journey One' })

    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
    // No project exists yet, so the dashboard must say so rather than show a stale list.
    await expect(page.getByText('No project selected')).toBeVisible()
  })

  test('the password field is masked and can be revealed', async ({ page }) => {
    await page.goto('/login')
    const password = page.getByPlaceholder('Your password')
    await expect(password).toHaveAttribute('type', 'password')

    await page.getByRole('button', { name: 'Show password' }).click()
    await expect(password).toHaveAttribute('type', 'text')
  })

  test('a wrong password is refused and does not sign anyone in', async ({ page }) => {
    const email = uniqueEmail('wrongpw')
    await register(page, { email })

    await signOut(page)
    await page.goto('/login')
    await page.getByPlaceholder('Enter your email').fill(email)
    await page.getByPlaceholder('Your password').fill('not-the-right-password')
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page.getByText(/Invalid email or password/i)).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })

  test('registering an email that already exists is refused', async ({ page }) => {
    const email = uniqueEmail('dupe')
    await register(page, { email })
    await signOut(page)

    await page.goto('/register')
    await page.getByPlaceholder('Your full name').fill('Second Try')
    await page.getByPlaceholder('Enter your email').fill(email)
    await page.getByPlaceholder('Your password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Create account' }).click()

    await expect(page.getByText(/already exists/i)).toBeVisible()
    await expect(page).toHaveURL(/\/register/)
  })
})

test.describe('session restore', () => {
  test('a reload keeps the user signed in and on the same page', async ({ page }) => {
    await register(page, { name: 'Session User' })

    // A deep link, so the assertion covers more than the dashboard.
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    await page.reload()

    // The regression this guards: a refresh used to bounce to /login.
    await expect(page).toHaveURL(/\/settings/)
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  })

  test('a reload does not issue a repeating /auth/me request loop', async ({ page }) => {
    await register(page)

    const meCalls = []
    const onRequest = (request) => {
      if (request.url().includes('/auth/me')) meCalls.push(request.url())
    }
    page.on('request', onRequest)

    await page.reload()
    await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
    // Allow any burst to arrive before judging the count.
    await page.waitForTimeout(2000)

    // One hydration per load is correct; an unbounded repeat is the bug that was fixed.
    expect(meCalls.length).toBeLessThanOrEqual(2)
  })

  test('signing out clears the session and protects protected routes', async ({ page }) => {
    await register(page)
    await signOut(page)

    // The token is gone, so a protected route must not render.
    await page.goto('/projects')
    await expect(page).toHaveURL(/\/login/)
  })

test('signing in again returns the same account and its data', async ({ page }) => {
  const { email } = await register(page, { name: 'Returner' })
  await signOut(page)
  await login(page, email)

  // The banner shows "R Returner <email>"; Settings repeats both the name and the email in
  // its own fields, so both matches are scoped to the banner.
  const banner = page.locator('header')
  await expect(banner.getByText('Returner')).toBeVisible()
  await expect(banner.getByText(email)).toBeVisible()
})

test('signing in returns the user to the page they were bounced off', async ({ page }) => {
  const { email } = await register(page, { name: 'Deep Link' })
  await signOut(page)

  // Visit a protected deep link while signed out, so the guard records it as the origin.
  await page.goto('/evaluation')
  await expect(page).toHaveURL(/\/login/)

  await login(page, email)

  // The guard records /evaluation, so signing in returns there instead of a generic
  // dashboard. This is the behaviour an earlier version of the helper wrongly denied.
  await expect(page).toHaveURL(/\/evaluation/)
})
})