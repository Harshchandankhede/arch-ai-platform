import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  validateReportProfile,
} from '../backend/src/services/auth.service.js'

describe('report profile validation', () => {
  it('accepts a display name with no affiliation', () => {
    const { valid, errors } = validateReportProfile({ displayName: 'Aditi Sharma', affiliation: '' })
    assert.equal(valid, true)
    assert.deepEqual(errors, {})
  })

  it('trims whitespace before validating length', () => {
    // ' A ' is three characters but only one once trimmed, so it must fail the 2-char rule.
    const { valid, errors } = validateReportProfile({ displayName: ' A ', affiliation: '' })
    assert.equal(valid, false)
    assert.ok(errors.displayName)
  })

  it('rejects a blank display name', () => {
    const { valid, errors } = validateReportProfile({ displayName: '   ', affiliation: 'MIT' })
    assert.equal(valid, false)
    assert.match(errors.displayName, /required/i)
  })

  it('rejects a display name that is only one character', () => {
    const { valid, errors } = validateReportProfile({ displayName: 'A', affiliation: '' })
    assert.equal(valid, false)
    assert.match(errors.displayName, /at least 2/i)
  })

  it('accepts an undefined affiliation', () => {
    // The UI can send an absent field; affiliation is optional so this must not fail.
    const { valid } = validateReportProfile({ displayName: 'Aditi Sharma', affiliation: undefined })
    assert.equal(valid, true)
  })

  it('rejects an affiliation over the maximum length', () => {
    const { valid, errors } = validateReportProfile({
      displayName: 'Aditi Sharma',
      affiliation: 'x'.repeat(121),
    })
    assert.equal(valid, false)
    assert.match(errors.affiliation, /at most 120/i)
  })

  it('accepts an affiliation exactly at the maximum length', () => {
    const { valid } = validateReportProfile({
      displayName: 'Aditi Sharma',
      affiliation: 'x'.repeat(120),
    })
    assert.equal(valid, true)
  })

  it('rejects a display name over the maximum length', () => {
    const { valid, errors } = validateReportProfile({
      displayName: 'n'.repeat(81),
      affiliation: '',
    })
    assert.equal(valid, false)
    assert.match(errors.displayName, /at most 80/i)
  })

  it('reports every invalid field at once rather than stopping at the first', () => {
    const { valid, errors } = validateReportProfile({ displayName: '', affiliation: 'y'.repeat(200) })
    assert.equal(valid, false)
    assert.ok(errors.displayName)
    assert.ok(errors.affiliation)
  })
})

describe('report profile cannot carry the login identity', () => {
  it('ignores an email supplied alongside the profile', () => {
    // The validator has no branch that reads email, so passing one must not change the
    // outcome. This is the guard that keeps the Settings form from touching credentials.
    const clean = validateReportProfile({ displayName: 'Aditi Sharma', affiliation: 'MIT' })
    const withEmail = validateReportProfile({
      displayName: 'Aditi Sharma',
      affiliation: 'MIT',
      email: 'attacker@example.com',
    })
    assert.deepEqual(withEmail, clean)
    assert.equal(Object.keys(withEmail.errors).includes('email'), false)
  })

  it('does not surface an error for a name field, which belongs to the account', () => {
    const { errors } = validateReportProfile({
      displayName: 'Aditi Sharma',
      affiliation: '',
      name: 'Someone Else',
      role: 'admin',
    })
    assert.equal(Object.keys(errors).length, 0)
  })
})