import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const page = read('src/pages/Evaluation.jsx')

describe('the health score shows a speedometer and the number', () => {
  it('renders the speedometer dial', () => {
    // Asked for explicitly: the dial is a useful at-a-glance read, and the score beside it
    // is the precise one.
    assert.match(page, /<Gauge score=\{healthScore\}/)
  })

  it('passes the animated number into the gauge as its centre readout', () => {
    // `children` replaces the gauge's built-in figure, so the dial is not followed by a
    // second, duplicate number.
    assert.match(page, /<Gauge score=\{healthScore\}[\s\S]*?ref=\{scoreRef\}/)
    assert.match(page, /label=""/)
  })

  it('keeps the real score as the rendered content', () => {
    assert.match(page, /const healthScore = Math\.round\(Number\(evaluation\.healthScore\) \|\| 0\)/)
    // The ref writes text imperatively, so the JSX must hold the correct value for the
    // first paint and for anyone without JS.
    assert.match(page, /ref=\{scoreRef\}[\s\S]*?\{healthScore\}\s*<\/span>/)
  })

  it('shows the grade inside the gauge', () => {
    assert.match(page, /out of 100 · \{verdict\.label\}/)
    assert.match(page, /style=\{\{ color: scoreColor\(healthScore\) \}\}/)
  })

  it('still reports the strongest and weakest dimension as numbers', () => {
    assert.match(page, /Strongest dimension/)
    assert.match(page, /Weakest dimension/)
  })
})

describe('the two top cards line up', () => {
  // The page explains in a comment why items-start was removed, so assertions here run
  // against the markup with comments stripped.
  const markup = page.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

  it('the grid stretches its cards instead of pinning them to the top', () => {
    // `items-start` made the shorter card keep its own height and left a dead gap beneath
    // it while the neighbouring radar card ran taller.
    assert.doesNotMatch(markup, /items-start/)
  })

  it('both cards sit in one stretch-aligned two-column grid', () => {
    assert.match(markup, /className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2"/)
  })

  it('the score card is a flex column so its body can fill the height', () => {
    // Without flex-1 on the body, centring the dial does nothing: the body would still be
    // its natural height and the dial would sit at the top of a mostly empty card.
    assert.match(markup, /className="flex flex-col"/)
    assert.match(markup, /bodyClass="flex flex-1 flex-col p-5"/)
  })

  it('the dial is centred in the space the card has', () => {
    assert.match(markup, /className="flex flex-1 items-center justify-center"/)
  })
})

describe('the formula block is gone', () => {
  it('no longer renders a Health score formula section', () => {
    assert.doesNotMatch(page, /Health score formula/)
  })

  it('no longer declares the FORMULA constant', () => {
    assert.doesNotMatch(page, /const FORMULA/)
    assert.doesNotMatch(page, /0\.25 x Performance/)
  })

  it('keeps the per-dimension derivation table, which is the useful part', () => {
    assert.match(page, /How the health score is produced/)
    assert.match(page, /Justification/)
    assert.match(page, /contributionTotal\.toFixed\(2\)/)
  })
})

describe('the raw evaluation object card is gone', () => {
  it('no longer renders it', () => {
    assert.doesNotMatch(page, /Raw evaluation object/)
    assert.doesNotMatch(page, /<JsonPreview value=\{evaluation\}/)
  })

  it('no longer imports JsonPreview', () => {
    assert.doesNotMatch(page, /JsonPreview/)
  })

  it('no longer imports utilizationColor, which only that card used', () => {
    assert.doesNotMatch(page, /utilizationColor/)
  })

  it('keeps the note about weights and deterministic scoring', () => {
    assert.match(page, /Weights are normalised to sum to 1\.00/)
    assert.match(page, /deterministic thresholded checks/)
  })

  it('does not leave the bottom grid half empty', () => {
    // The removed card shared a grid with "Where this came from"; that card now stands
    // alone rather than beside empty space.
    assert.doesNotMatch(page, /<Card title="Where this came from"[\s\S]*?<Card/)
  })
})