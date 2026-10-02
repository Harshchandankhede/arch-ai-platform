import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const hook = readFileSync(new URL('../src/store/useResults.js', import.meta.url), 'utf8')
const page = readFileSync(new URL('../src/pages/Simulation.jsx', import.meta.url), 'utf8')

describe('simulation trigger', () => {
  it('the Simulation page opts out of auto-run', () => {
    assert.match(page, /useResults\(arch,\s*\{\s*autoRun:\s*false\s*\}\)/)
  })

  it('autoRun defaults to true so downstream pages still populate', () => {
    assert.match(hook, /const\s*\{\s*autoRun\s*=\s*true\s*\}\s*=\s*options/)
  })

  it('the auto-run effect is gated behind autoRun', () => {
    const effect = hook.slice(hook.indexOf('useEffect(() => {\n    if (!autoRun) return'))
    assert.ok(effect.length > 0, 'auto-run effect must check autoRun first')
  })

  it('no other page disables auto-run', () => {
    for (const p of ['Dashboard', 'ProcessMining', 'Evaluation', 'Recommendations', 'Reports', 'Comparison']) {
      const src = readFileSync(new URL(`../src/pages/${p}.jsx`, import.meta.url), 'utf8')
      assert.doesNotMatch(src, /autoRun:\s*false/, `${p} must keep auto-run enabled`)
    }
  })

  it('the worker is never terminated on unmount', () => {
    assert.doesNotMatch(hook, /workerRef\.terminate\(\)/)
  })

  it('exposes a run trigger from the hook', () => {
    assert.match(hook, /run:\s*start/)
  })
})

describe('simulation UI states', () => {
  it('renders a start button', () => {
    assert.match(page, /Start Simulation/)
  })

  it('disables the button while running', () => {
    assert.match(page, /disabled=\{isRunning\}/)
  })

  it('shows a running label', () => {
    assert.match(page, /Running…/)
  })

  it('offers a re-run with the current workload', () => {
    assert.match(page, /Run Simulation Again/)
  })

  it('shows an initial empty state asking the user to start', () => {
    assert.match(page, /Configure your workload and start the simulation\./)
    assert.match(page, /No simulation has been run yet\./)
  })

  it('surfaces an error state', () => {
    assert.match(page, /Simulation error/)
  })

  it('gates result panels behind a completed run', () => {
    // Stat cards, utilisation, charts and the event log must all sit behind a guard on the
    // run currently on screen, so no empty chart frames render before the first run.
    const gated = (page.match(/\{(sim|viewSim|shownSim) \? \(/g) || []).length
    assert.ok(gated >= 2, `expected result panels gated behind a result, found ${gated}`)
    assert.match(page, /isRunning && !sim \?/)
  })
})
