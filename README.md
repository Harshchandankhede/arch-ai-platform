# arch-ai-platform

AI-powered software architecture platform for designing, simulating, analyzing, evaluating, and improving architectures before implementation.

Discrete-event simulation (DES) of distributed-system architectures, with conformance
checking against process-mined models, a weighted health score, and a digital twin view —
so a design can be validated *before* any code is written.

## Status

| Area | Where it runs | Notes |
| --- | --- | --- |
| Authentication (JWT) | Server → MongoDB Atlas | bcrypt, unique email index |
| Project CRUD | Server → MongoDB Atlas | owner-scoped, other users get 404 |
| Architecture version history | Server → MongoDB Atlas | save, list, restore, rename, delete |
| DES simulation | Browser (Web Worker) | `engine.js`, deterministic seeded RNG |
| Process mining | Browser | conformance + bottleneck detection |
| Health score evaluation | Browser | six weighted dimensions |
| AI recommendations | Server → Gemini | two arms: deterministic rules + a server-side Gemini call. The key never reaches the browser |
| Report profile | Server → MongoDB Atlas | display name and affiliation, separate from the login email |
| Interview scoring | Browser | **keyword matching** against a 15-question bank |

A full run is held in an in-memory cache keyed by architecture hash and workload. Because
that holds the event log it is **not** persisted, so the full result does not survive a
reload. A compact **run summary** is persisted separately — metrics, component utilisation,
chart series, the exact configuration and the timestamp — so the figures remain visible
after a refresh. The summary is deliberately kept out of the shared result cache, because
Evaluation and Recommendations consume the event log too and would otherwise be handed a
result they could not justify.

The pipeline runs engine → mining → evaluation → recommendations in one pass, either in a
Web Worker (`src/features/simulation/sim.worker.js`) or inline when workers are unavailable.

### Scoring calibration

`evaluation.js` scores six weighted dimensions. Two properties are enforced by the test
suite because breaking either silently invalidates every number the UI shows:

- The engine reports `failureRate`, `dropRate` and `memoryUtilization` as **percentages**.
  `readMetrics` converts them to 0–1 fractions before they are compared against ceilings.
- Latency is scored linearly inside the budget and decays exponentially past it, so two
  architectures with different p95 values cannot tie at the same score.

Queueing bottlenecks are measured as real `QUEUE_ENTER` → `QUEUE_EXIT` residence time. The
engine also supplies per-component utilisation and `queueLengthMax`, which cannot be
recovered from an event-log prefix alone. A system that never queues correctly reports **no**
bottleneck rather than inventing one.

## Tech stack

**Frontend** — React 19, Vite 8, Tailwind 4, React Router, Recharts, Three.js, Oxlint
**Backend** — Node.js, Express 5, Mongoose 9, MongoDB Atlas, JWT, bcrypt
**Linting** — Oxlint (frontend only; the backend defines no lint script)

## Getting started

### Backend

```bash
cd backend
npm install
cp .env.example .env     # then fill in your own values
npm run dev
```

Runs on `http://localhost:5000`. The server connects to MongoDB **before** accepting
traffic and shuts down gracefully on `SIGINT`/`SIGTERM`.

`.env` is git-ignored and must never be committed. See `.env.example` for the full list
of required variables.

On networks where the Atlas SRV hostname does not resolve, set
`MONGO_DNS_SERVERS=1.1.1.1,8.8.8.8`.

### Frontend

```bash
npm install
npm run dev
```

Runs on `http://localhost:5173`. The API is reached at a **relative** `/api`, which Vite
proxies to `http://localhost:5000` in both `npm run dev` and `npm run preview`, so
development does not depend on the backend's CORS allowlist. Override with
`VITE_API_BASE_URL` only when the API genuinely lives on another origin, and
`API_PROXY_TARGET` to point the proxy somewhere else. See `.env.example`.

### Scripts

| Command | Where | Does |
| --- | --- | --- |
| `npm run dev` | both | Start the dev server |
| `npm run build` | frontend | Production build to `dist/` |
| `npm run lint` | frontend | Oxlint |
| `npm test` | frontend | Unit suite (Node's built-in runner, no test framework installed) |
| `npm run test:integration` | frontend | HTTP suite against a real backend on a disposable database |
| `npm run test:e2e` | frontend | Browser suite in Chrome via Playwright, also on a disposable database |
| `npm run test:all` | frontend | All three, in order |
| `npm run preview` | frontend | Serve the production build locally |

The backend defines only `npm start` and `npm run dev`; it has no build, lint or test
script.

`npm test` covers:

| Suite | Guards against |
| --- | --- |
| `pipeline.test.js` | Engine determinism and capacity, conformance, bottleneck detection, dimension calibration, health-score monotonicity under load |
| `request-flow.test.js` | Trajectory reconstruction, per-edge traffic, outcome classification, replay-window selection |
| `capacity.test.js` | Ceiling honesty — the reported rate must survive re-running the engine at it |
| `auth.test.js` | Auth/token desync, the 401 request loop, session invalidation, secret leakage in errors |
| `project-scope.test.js` | Project ownership: nothing persisted, never rehydrated across accounts |
| `legacy-cleanup.test.js` | Obsolete browser project data cannot re-enter state; the JWT is never touched |
| `autosave.test.js` | Autosave coalescing, out-of-order responses, recovery after a failed write |
| `sim-summary.test.js` | The persisted run summary carries no event log or project data |
| `report-profile.test.js` | Report profile validation, and that it cannot change credentials |
| `success-rate-color.test.js` | The success-rate colour bands and their monotonicity |
| `playback.test.js` | Playback timing, reduced motion, and the playback controls |
| `advisor.test.js`, `advisor-config.test.js` | Two-arm agreement, severities, and the rule-based fallback |
| `simulation-ui.test.js` | Utilisation unit conversion (the engine reports a 0–1 ratio, the UI shows a percentage) |
| `evaluation-ui.test.js`, `score-animation.test.js`, `topbar.test.js`, `theme.test.js` | Evaluation display, animated score, notifications and search, theme tokens |

Several suites assert on source text rather than runtime behaviour, which catches
regressions in wiring but not runtime-only failures. Where that was avoidable the assertions
were rewritten to test behaviour instead.

### Live request flow

The Simulation page replays the completed run on the 2D diagram. Nothing about the motion
is decorative:

- **Trajectories** (`lib/trajectories.js`) reconstruct one path per request from the event
  log, recording the measured enter/exit timestamp of every hop.
- **Connection flow** — each edge's dashes advance in proportion to the traffic that
  connection actually carried, counted from real request paths.
- **Request dots** — positioned by interpolating the real hop timings, coloured by outcome
  (completed, retried, failed, dropped).
- **Node cards** show measured utilisation, with an alert marker above 85%.
- **Speed** is a time-lapse *target*: the control says how many real seconds the whole run
  should take, and the multiplier is derived. It is deliberately not a bare multiplier,
  because two earlier models of this control produced playback the user had not asked for.
- **Playback runs once** across the configured duration and then stops, rather than looping.
- **Reduced motion is respected.** A reader whose system asks for less motion gets the
  diagram held still; the run still executes and every metric still reports, and playback
  stays available on request.
- **Keyboard**: Space plays or pauses, `R` replays, both ignored while a form field has
  focus.

Only the 400 logged cases animate. That is the same deterministic sample process mining
consumes, so the flow and the conformance analysis stay consistent.

### Capacity analysis

`lib/capacity.js` sweeps the DES engine upward until the design breaks, then reports the
sustainable arrival rate, the estimated concurrent-user count via Little's Law, the
component that caps the design, and whether the current load is sustainable, at risk, over
capacity, or simply underused. A rate counts as sustainable when it serves every request it
accepts without dropping any and keeps p95 inside the latency budget.

The sweep runs on its own Web Worker so it can never delay Start Simulation. The ceiling is
searched up to 6,000 req/s; a design still healthy at that point is reported as a lower
bound rather than given a false exact number. The reported figure is only meaningful for
the probe duration it was measured at, which is returned as `probeDuration`.

### Simulation is started by the user

The Simulation page does **not** run automatically. It opens on the workload configuration
with a **Start Simulation** button, and nothing is simulated until that button is pressed.
Downstream pages (Process Mining, Evaluation, Recommendations, Reports, Dashboard) keep
auto-running when they are opened with no cached result, so navigating there directly still
works. Pass `{ autoRun: false }` to `useResults` to opt out, as `Simulation.jsx` does.

The worker is module-scoped and outlives page unmounts, so navigating away mid-run no longer
discards the result — it is written to the store and picked up by the next page that mounts.

## Layout

```
src/
  lib/          engine, mining, evaluation, recommendations, capacity,
                trajectories, metrics, contract, rng, eventQueue, validate,
                playback, archWriter, simSummary, useReducedMotion
  features/     simulation worker, three.js scenes
  services/     API clients (api, auth, projects, architectures, advisor, loadProjects)
  store/        reducer, context, useResults, storage, notificationSink
  pages/        Builder, Simulation, ProcessMining, Evaluation, ...
  components/   UI primitives, charts, node shapes, ArchitectureFlow
  data/         node types, seed architectures, question bank
tests/          unit suites, integration/ (HTTP), integration harness
e2e/            Playwright browser journeys
backend/src/
  models/       User, Project, ArchitectureVersion, shared architecture schema
  services/     auth, project, architecture, recommendation
  controllers/  request handling
  routes/       /auth, /projects, nested /projects/:projectId/versions, /recommendations
  middleware/   JWT auth, CORS, central error handler
  config/       env, database, logger
```

### Browser-side project data

Projects are **never** stored in the browser. They are owned by the server and every query is
scoped by the JWT subject. What the browser keeps is per-account preferences only — workload,
settings, interview history, and a compact run summary — namespaced by user id under
`archai.state.v1.u.<userId>`, with the session JWT under the separate key `archai.token`.

Older builds did persist projects in the browser, including inside the per-user blob. Those
fields are stripped on read, on write and at startup, so a stale blob cannot reintroduce a
project, while the preferences in the same blob survive.

## API

All routes except `/api/health` and the two auth entry points require
`Authorization: Bearer <token>`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness + database state |
| `POST` | `/api/auth/register` | Create account |
| `POST` | `/api/auth/login` | Obtain JWT |
| `GET` | `/api/auth/me` | Current user |
| `PUT` | `/api/auth/me/report-profile` | Save display name and affiliation only |
| `GET` | `/api/recommendations/advisor` | Advisor status, e.g. whether Gemini is configured |
| `POST` | `/api/recommendations/advisor` | Generate findings from both arms |
| `GET` | `/api/projects` | List own projects |
| `POST` | `/api/projects` | Create project from a template |
| `GET` | `/api/projects/:id` | Read project |
| `PUT` | `/api/projects/:id` | Update name, description, draft architecture |
| `DELETE` | `/api/projects/:id` | Delete project |
| `GET` | `/api/projects/:id/versions` | List version summaries |
| `POST` | `/api/projects/:id/versions` | Save a snapshot |
| `GET` | `/api/projects/:id/versions/:versionId` | Read one version |
| `PUT` | `/api/projects/:id/versions/:versionId/label` | Rename |
| `POST` | `/api/projects/:id/versions/:versionId/restore` | Restore onto the project |
| `DELETE` | `/api/projects/:id/versions/:versionId` | Delete (last version is protected) |

Ownership is resolved in the service layer, and a resource belonging to another user
returns `404` rather than `403` so that project ids cannot be probed.

## Testing

Three suites, increasing in cost and in what they can catch.

| Suite | Command | Needs |
| --- | --- | --- |
| Unit | `npm test` | nothing |
| Integration | `npm run test:integration` | MongoDB reachable |
| Browser | `npm run test:e2e` | MongoDB reachable, Chrome installed |

### Integration and browser suites use a disposable database

Neither suite may touch the development database. Both:

1. mint or reuse a database named `archai_it_*`,
2. refuse to run if the name does not match that prefix,
3. assert the server under test reports that same database on its health endpoint before any
   test executes, and
4. empty it before and after the run.

The configured Atlas role is **not permitted `dropDatabase`**, so a uniquely named database per
run would leave an empty shell behind on the cluster every time. One fixed database is reused
and emptied instead, which keeps the residue to a single empty `archai_it_suite`.

Both suites start their own backend and Vite instances, so nothing needs to be running first.
Integration uses `BCRYPT_ROUNDS=4` and a throwaway `JWT_SECRET`, because the cost factor buys
nothing against a database that is discarded.

The browser suite drives the Chrome already installed on the machine (`channel: 'chrome'`),
so no browser binary is downloaded.

## Deployment

`vercel.json` is included for the frontend. The backend needs a host that can run a
long-lived Node process and reach MongoDB Atlas; adjust the API base URL for that host.

The production bundle refers to a **relative** `/api`, so a static host plus a reverse proxy
works without rebuilding. Set `VITE_API_BASE_URL` at build time only if the API is served
from a different origin, and add that frontend origin to the backend's CORS allowlist.

## Security notes

- `.env` is git-ignored. Only `.env.example` (placeholders) is committed.
- Passwords are stored as bcrypt hashes and excluded from JSON output by default.
- Atlas credentials should live in the host's secret store, never in the repository.
