import { expect, test } from '@playwright/test'

import { login, register, signOut } from './support/helpers.js'

/** Opens the report profile form. */
async function openSettings(page) {
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
}

function displayNameField(page) {
  // Field renders the label and the input as siblings, so the input is located relative to
  // its label text rather than by accessible name.
  return page.getByPlaceholder('Aditi Sharma')
}

function affiliationField(page) {
  return page.getByPlaceholder('Department of Computer Science, MIT')
}

async function saveProfile(page, displayName, affiliation) {
  await displayNameField(page).fill(displayName)
  await affiliationField(page).fill(affiliation)
  await page.getByRole('button', { name: 'Save report profile' }).click()
}

test.describe('report profile', () => {
  test('a saved profile is reflected after a reload', async ({ page }) => {
    await register(page, { name: 'Profile Owner' })
    await openSettings(page)

    await saveProfile(page, 'Dr. A Sharma', 'University A')
    await expect(page.getByText('Report profile saved')).toBeVisible()

    await page.reload()
    await expect(displayNameField(page)).toHaveValue('Dr. A Sharma')
    await expect(affiliationField(page)).toHaveValue('University A')
  })

  test('a new profile starts from the login name', async ({ page }) => {
    await register(page, { name: 'Fresh Profile' })
    await openSettings(page)

    // The server defaults displayName to the login name rather than blank.
    await expect(displayNameField(page)).toHaveValue('Fresh Profile')
    await expect(affiliationField(page)).toHaveValue('')
  })

  test('the login email and role are shown read-only and cannot be edited', async ({ page }) => {
    const { email } = await register(page, { name: 'Identity Holder' })
    await openSettings(page)

    // The banner and the Account panel both show the email, so it is scoped to the panel.
    await expect(page.locator('main').getByText(email)).toBeVisible()
    await expect(page.locator('main').getByText('student')).toBeVisible()

    // Neither identity field is an input, so there is nothing to type into.
    await expect(page.locator('input[type="email"]')).toHaveCount(0)
  })

  test('a one-character display name is refused with an inline message', async ({ page }) => {
    await register(page, { name: 'Validator' })
    await openSettings(page)

    await displayNameField(page).fill('X')
    await affiliationField(page).fill('Somewhere')
    await page.getByRole('button', { name: 'Save report profile' }).click()

    await expect(page.getByText(/at least 2 characters/i)).toBeVisible()

    // The rejected value must not have been persisted.
    await page.reload()
    await expect(displayNameField(page)).not.toHaveValue('X')
  })

  test('an empty affiliation is allowed, since only the name is required', async ({ page }) => {
    await register(page, { name: 'No Affiliation' })
    await openSettings(page)

    await saveProfile(page, 'Solo Researcher', '')
    await expect(page.getByText('Report profile saved')).toBeVisible()

    await page.reload()
    await expect(displayNameField(page)).toHaveValue('Solo Researcher')
    await expect(affiliationField(page)).toHaveValue('')
  })
})

test.describe('report profile isolation', () => {
  test('two accounts keep separate profiles and neither affects the other', async ({ browser }) => {
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    const pageA = await contextA.newPage()
    const pageB = await contextB.newPage()

    try {
      await register(pageA, { name: 'User A' })
      await register(pageB, { name: 'User B' })

      await openSettings(pageA)
      await saveProfile(pageA, 'User A', 'University A')
      await expect(pageA.getByText('Report profile saved')).toBeVisible()

      await openSettings(pageB)
      await saveProfile(pageB, 'User B', 'University B')
      await expect(pageB.getByText('Report profile saved')).toBeVisible()

      // A changes again; B must be unaffected.
      await openSettings(pageA)
      await saveProfile(pageA, 'User A Renamed', 'University A2')
      await expect(pageA.getByText('Report profile saved')).toBeVisible()

      await pageB.reload()
      await expect(displayNameField(pageB)).toHaveValue('User B')
      await expect(affiliationField(pageB)).toHaveValue('University B')
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })

  test('switching accounts in one browser swaps the profile, with no stale value', async ({ page }) => {
    const a = await register(page, { name: 'Switch A' })
    await openSettings(page)
    await saveProfile(page, 'Profile A', 'Institute A')
    await expect(page.getByText('Report profile saved')).toBeVisible()

    // Signed out first: the register route is only reachable while signed out, so a second
    // register while authenticated left the original session in place.
    await signOut(page)
    const b = await register(page, { name: 'Switch B' })
    await openSettings(page)
    await saveProfile(page, 'Profile B', 'Institute B')
    await expect(page.getByText('Report profile saved')).toBeVisible()

    await signOut(page)
    await login(page, a.email)
    await openSettings(page)
    await expect(displayNameField(page)).toHaveValue('Profile A')
    await expect(affiliationField(page)).toHaveValue('Institute A')

    await signOut(page)
    await login(page, b.email)
    await openSettings(page)
    await expect(displayNameField(page)).toHaveValue('Profile B')
    await expect(affiliationField(page)).toHaveValue('Institute B')
  })
})