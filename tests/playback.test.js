import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import {
  resolveSpeed,
  speedLabel,
  REAL_TIME,
  DEFAULT_WALL_CLOCK,
} from '../src/lib/playback.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const flow = read('src/components/ArchitectureFlow.jsx')
const playback = read('src/lib/playback.js')
const engine = read('src/lib/engine.js')
const page = read('src/pages/Simulation.jsx')

describe('playback covers the workload duration and then stops', () => {
  it('never wraps the replay position back to the start', () => {
    // `(elapsed % span)` is what made the run loop forever.
    assert.doesNotMatch(flow, /elapsed\s*%\s*span/)
    assert.doesNotMatch(flow, /window\.start/)
  })

  it('clamps elapsed to the span and finishes when it is reached', () => {
    assert.match(flow, /const elapsed = Math\.min\(span, clockRef\.current \+ dt \* speed\)/)
    assert.match(flow, /if \(elapsed >= span\) \{\s*finish\(\)\s*return/)
  })

  it('tells the parent exactly once per run, and never mid-tick again', () => {
    assert.match(flow, /const finishedRef = useRef\(false\)/)
    const finish = flow.slice(flow.indexOf('const finish = ()'))
    assert.match(finish.slice(0, finish.indexOf('}')), /if \(finishedRef\.current\) return/)
  })

  it('builds its timeline from the configured duration, not a looping window', () => {
    assert.match(flow, /durationSec = 0/)
    const timeline = flow.slice(flow.indexOf('const timeline = useMemo'), flow.indexOf('// Hottest connection'))
    assert.match(timeline, /Number\(durationSec\) \|\| 0\) \* 1000/)
    // A full-length run ends exactly on the configured duration, not on the last dot.
    assert.match(timeline, /useDataEnd \? dataEnd : configuredMs/)
  })

  it('ends with the data only when the engine cut the run short', () => {
    const timeline = flow.slice(flow.indexOf('const timeline = useMemo'), flow.indexOf('// Hottest connection'))
    assert.match(timeline, /const useDataEnd = truncated && dataEnd < configuredMs - 1/)
    assert.match(flow, /truncated = false/)
  })
})

describe('resolveSpeed', () => {
  it('plays the whole run inside the chosen number of real seconds', () => {
    // 100 s of simulated time compressed into a 20 s wall-clock target = 5x.
    assert.equal(resolveSpeed({ durationSec: 100, wallClockSec: 20 }), 5)
    assert.equal(resolveSpeed({ durationSec: 60, wallClockSec: 20 }), 3)
  })

  it('1:1 means real time', () => {
    assert.equal(resolveSpeed({ durationSec: 100, wallClockSec: REAL_TIME }), 1)
  })

  it('ignores the arrival rate entirely', () => {
    // An "Auto" mode once scaled the multiplier by arrivalRate / 120, so the readout showed
    // values like "1.3x faster" that the user never asked for. Speed is now a pure function
    // of the chosen target.
    const speeds = [1, 30, 120, 156, 300, 500, 100000].map((arrivalRate) =>
      resolveSpeed({ durationSec: 100, wallClockSec: 20, arrivalRate }),
    )
    assert.deepEqual(speeds, speeds.map(() => 5))
  })

  it('does not accept a rate coupling at all', () => {
    // Strip comments first: the file explains in prose why the rate coupling was removed.
    const code = playback.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    assert.doesNotMatch(code, /coupleToRate/)
    assert.doesNotMatch(code, /REFERENCE_RATE/)
    assert.doesNotMatch(code, /RATE_FACTOR/)
    assert.doesNotMatch(code, /arrivalRate/)
  })

  it('never returns a zero or negative multiplier', () => {
    for (const durationSec of [0, 1, 10, 300]) {
      assert.ok(resolveSpeed({ durationSec, wallClockSec: 20 }) > 0)
      assert.ok(resolveSpeed({ durationSec, wallClockSec: 0 }) > 0)
    }
  })

  it('defaults to the 20 second target when nothing is chosen', () => {
    assert.equal(DEFAULT_WALL_CLOCK, 20)
    assert.equal(
      resolveSpeed({ durationSec: 100 }),
      resolveSpeed({ durationSec: 100, wallClockSec: DEFAULT_WALL_CLOCK }),
    )
  })

  it('labels the multiplier honestly', () => {
    assert.equal(speedLabel(1), 'real time')
    assert.match(speedLabel(5), /faster than real time/)
    assert.match(speedLabel(0.25), /slower than real time/)
  })
})

describe('the engine logs a sample spread across the whole run', () => {
  it('samples every Nth arrival instead of the first N', () => {
    assert.doesNotMatch(engine, /if \(loggedCaseSlots < maxLoggedCases\) \{\s*simCase\.logged = true/)
    assert.match(engine, /nextCaseId % sampleEvery === 0/)
  })

  it('derives the stride from the expected arrival count', () => {
    assert.match(engine, /const sampleEvery = Math\.max\(1, Math\.floor\(expectedCases \/ maxLoggedCases\)\)/)
  })

  it('reports the stride and the logged window so the UI can be honest', () => {
    assert.match(engine, /sampleEvery,/)
    assert.match(engine, /expectedCases,/)
    assert.match(engine, /loggedWindowMs:/)
  })

  it('reports the span it actually simulated, not the span it was asked for', () => {
    // Using windowMs here understated utilisation on any run that hit the event budget.
    assert.match(engine, /const simulatedRaw = Math\.max\(lastEventTime > 0 \? lastEventTime : windowMs, 0\)/)
    assert.match(engine, /truncated,/)
  })
})

describe('the Simulation page', () => {
  it('no longer offers the 3D digital twin', () => {
    assert.doesNotMatch(page, /TwinScene/)
    assert.doesNotMatch(page, /Digital Twin/)
    assert.doesNotMatch(page, /setView/)
  })

  it('passes the duration, sampling stride and completion callback to the flow', () => {
    assert.match(page, /durationSec=\{duration\}/)
    assert.match(page, /sampleEvery=\{Number\(viewSim\?\.loggingStats\?\.sampleEvery\) \|\| 1\}/)
    assert.match(page, /onComplete=\{\(\) => setFlowDone\(true\)\}/)
  })

  it('offers replay instead of looping forever', () => {
    assert.match(page, /Replay/)
    assert.match(page, /setReplayKey\(\(k\) => k \+ 1\)/)
  })

  it('shows progress and the effective speed', () => {
    assert.match(page, /progressBarRef=\{flowProgress\}/)
    assert.match(page, /speedLabel\(flowSpeed\)/)
  })

  it('discloses a run that the engine cut short', () => {
    assert.match(page, /viewSim\?\.truncated/)
  })

  it('has no Auto speed option', () => {
    // Auto scaled the multiplier by arrivalRate / 120 and produced readouts like "1.3x
    // faster" that the user never chose.
    assert.doesNotMatch(page, /setWallClock\(null\)/)
    assert.doesNotMatch(page, /wallClock === null/)
    assert.doesNotMatch(page, />\s*Auto\s*</)
    // An explicit target is chosen up front, so the control always has a real value.
    assert.match(page, /useState\(DEFAULT_WALL_CLOCK\)/)
  })
})

describe('nothing runs or animates without the user asking', () => {
  it('the animation starts only after Start Simulation was pressed', () => {
    // `flowPlaying` used to fall back to `Boolean(shownSim)`, so opening the page with a
    // cached result animated it with no interaction at all.
    assert.match(page, /const \[playRequested, setPlayRequested\] = useState\(false\)/)
    assert.match(page, /const flowPlaying = playRequested && !flowDone/)
    assert.doesNotMatch(page, /flowOverride/)
    assert.doesNotMatch(page, /flowOverride \?\? Boolean\(shownSim\)/)
  })

  it('a cached result on mount does not trigger playback', () => {
    // The result effect also runs on mount, where `sim` may already hold an earlier run.
    // The ref is what distinguishes a result the user asked for from one that was merely
    // read back out of the cache.
    assert.match(page, /const runRequested = useRef\(false\)/)
    assert.match(page, /if \(!sim \|\| !runRequested\.current\) return/)
    assert.match(page, /runRequested\.current = false[\s\S]*?setPlayRequested\(true\)/)
  })

  it('the Start button arms playback and runs the engine in one click', () => {
    assert.match(page, /function startRun\(\) \{[\s\S]*?runRequested\.current = true[\s\S]*?run\(\)/)
    assert.match(page, /onClick=\{startRun\}/)
    assert.match(page, /Nothing runs on its own\./)
  })

  it('editing the workload never re-runs the engine', () => {
    // A 420 ms debounce used to re-run the engine whenever the sliders moved, so results
    // could appear without the user ever pressing anything.
    assert.doesNotMatch(page, /setTimeout\(\(\) => \{[\s\S]*?run\(\)/)
    assert.doesNotMatch(page, /lastRunKey/)
  })

  it('the engine is not auto-run on mount', () => {
    assert.match(page, /useResults\(arch, \{ autoRun: false \}\)/)
  })

  it('the only controls are an explicit speed target, pause/resume and replay', () => {
    assert.match(page, /Resume/)
    assert.match(page, /Replay/)
    assert.doesNotMatch(page, /\{flowPlaying \? 'Pause' : 'Play'\}/)
  })
})

describe('Run configuration and Capacity stay in the UI', () => {
  it('both cards are still rendered', () => {
    assert.match(page, /title="Run configuration"/)
    assert.match(page, /title="Capacity"/)
  })

  it('Run configuration says plainly when nothing has run yet', () => {
    assert.match(page, /Nothing has run yet\./)
    assert.match(page, /'awaiting first run'/)
  })

  it('Run configuration discloses a run the engine cut short', () => {
    assert.match(page, /event budget stopped this run/)
  })

  it('Capacity states that it is independent of the run', () => {
    assert.match(page, /Independent of the run above\./)
  })

  it('Capacity still shows busy, result and failure states', () => {
    assert.match(page, /capacityBusy \?/)
    assert.match(page, /capacity\?\.ok \?/)
    assert.match(page, /capacity\?\.reason \|\| 'Capacity has not been measured for this architecture\.'/)
  })
})

describe('the parent-owned DOM refs are null-guarded', () => {
  // The progress bar lives in the parent and is only rendered once a result exists, so
  // `progressBarRef.current` is null on first mount. Testing the ref object instead of its
  // `current` threw `Cannot read properties of null` and crashed the whole Simulation page.
  it('never touches .current without checking it first', () => {
    const offenders = [...flow.matchAll(/if \((\w*[Rr]ef)\)\s+\1\.current/g)].map((m) => m[0])
    assert.deepEqual(offenders, [], `unguarded ref access: ${offenders.join(', ')}`)
  })

  it('guards the progress bar in both the reset effect and the frame loop', () => {
    assert.match(flow, /if \(progressBarRef\?\.current\) progressBarRef\.current\.style\.width = '0%'/)
    assert.match(flow, /if \(progressBarRef\?\.current\) progressBarRef\.current\.style\.width/)
  })

  it('guards the read-out ref the same way', () => {
    assert.match(flow, /if \(readout\?\.current && slot > 0\)/)
    assert.doesNotMatch(flow, /if \(readout\)\s+readout\.current/)
  })

  it('the page only renders the progress bar once a result exists', () => {
    assert.match(page, /\{shownSim \? \([\s\S]*?ref=\{flowProgress\}/)
  })
})

describe('the 3D digital twin is gone from the project', () => {
  const base = new URL('../', import.meta.url)

  it('the twin scene and its packet stream were deleted', () => {
    assert.equal(existsSync(new URL('src/features/three/TwinScene.jsx', base)), false)
    assert.equal(existsSync(new URL('src/features/three/PacketStream.jsx', base)), false)
  })

  it('the login page keeps its own three.js scene, and needs fiber for it', () => {
    assert.equal(existsSync(new URL('src/features/three/LandingScene.jsx', base)), true)
    const pkg = JSON.parse(readFileSync(new URL('package.json', base), 'utf8'))
    assert.ok(pkg.dependencies['@react-three/fiber'], 'LandingScene still renders the login hero')
    assert.equal(pkg.dependencies['@react-three/drei'], undefined, 'drei was only used by the deleted twin scene')
  })
})