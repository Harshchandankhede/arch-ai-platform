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
| AI recommendations | Browser | **deterministic rules** — no model wired up yet |
| Interview scoring | Browser | **keyword matching** against a 14-question bank |

Simulation results are recomputed in the browser and held in an in-memory cache keyed by
architecture hash and workload; they are **not persisted**, so a page reload discards them.

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
**Linting** — Oxlint, both packages

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

Runs on `http://localhost:5173`. Point it at the API with `VITE_API_BASE_URL`
(defaults to `http://localhost:5000/api`).

### Scripts

| Command | Where | Does |
| --- | --- | --- |
| `npm run dev` | both | Start the dev server |
| `npm run build` | frontend | Production build to `dist/` |
| `npm run lint` | frontend | Oxlint |
| `npm test` | frontend | Pipeline test suite (Node's built-in runner, no dependencies) |

`npm test` covers the simulation → mining → evaluation → recommendations pipeline: engine
determinism and capacity, conformance and bottleneck detection, dimension calibration,
score ordering across architectures, and health-score monotonicity under rising load.

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
  lib/          engine, mining, evaluation, metrics, contract, rng
  features/     simulation worker, three.js scenes
  services/     API clients (api, auth, projects, architectures, ai)
  store/        reducer, context, useResults
  pages/        Builder, Simulation, ProcessMining, Evaluation, ...
  components/   UI primitives, charts, node shapes
  data/         node types, question bank, seed architectures
backend/src/
  models/       User, Project, ArchitectureVersion, shared architecture schema
  services/     auth, project, architecture
  controllers/  request handling
  routes/       /auth, /projects, nested /projects/:projectId/versions
  middleware/   JWT auth, CORS, central error handler
  config/       env, database, logger
```

## API

All routes except `/api/health` and the two auth entry points require
`Authorization: Bearer <token>`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness + database state |
| `POST` | `/api/auth/register` | Create account |
| `POST` | `/api/auth/login` | Obtain JWT |
| `GET` | `/api/auth/me` | Current user |
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

## Deployment

`vercel.json` is included for the frontend. The backend needs a host that can run a
long-lived Node process and reach MongoDB Atlas; adjust the API base URL for that host.

## Security notes

- `.env` is git-ignored. Only `.env.example` (placeholders) is committed.
- Passwords are stored as bcrypt hashes and excluded from JSON output by default.
- Atlas credentials should live in the host's secret store, never in the repository.
