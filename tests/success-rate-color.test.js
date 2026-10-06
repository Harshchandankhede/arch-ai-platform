import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { colors, successRateColor, utilizationColor } from '../src/theme/tokens.js'

describe('successRateColor', () => {
  // The Simulation page previously passed colors.green unconditionally, so a run that
  // dropped most of its requests was displayed in the same colour as a flawless one.
  it('is not green for a rate that means the run failed', () => {
    assert.equal(successRateColor(0), colors.red)
    assert.equal(successRateColor(40), colors.red)
    assert.equal(successRateColor(94.9), colors.red)
  })

  it('is amber for a rate that is untidy but not failing', () => {
    assert.equal(successRateColor(95), colors.accent)
    assert.equal(successRateColor(99.4), colors.accent)
  })

  it('is green only once essentially everything completed', () => {
    assert.equal(successRateColor(99.5), colors.green)
    assert.equal(successRateColor(100), colors.green)
  })

  it('is monotonic, so a worsening run never looks better', () => {
    const order = [colors.red, colors.accent, colors.green]
    for (let i = 1; i < 100; i += 0.5) {
      const current = order.indexOf(successRateColor(i))
      const worse = order.indexOf(successRateColor(i - 0.5))
      assert.ok(current >= worse, `rate ${i} must not be shown as better than ${i - 0.5}`)
    }
  })

  it('uses the same visual language as utilisation', () => {
    // Both helpers decide "problem / warning / fine", so a reviewer learns one scale.
    assert.equal(successRateColor(50), utilizationColor(95))
    assert.equal(successRateColor(100), utilizationColor(10))
  })
})