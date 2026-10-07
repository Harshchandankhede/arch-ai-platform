# Arch-AI — Remaining Work Plan

Updated at the end of the Simulation work. Everything listed as done below is committed and
pushed to `origin/main`.

## Where things stand

| Phase | Scope | State |
|---|---|---|
| 0 | Data inventory + test-account cleanup | Done |
| 1 | Durable project persistence (autosave, duplicate, delete) | Done |
| 2 | Legacy browser-data migration — **retired**, not migrated | Done |
| 3 | Server-side report profile | Done |
| 4 | Two-account integration suite (disposable DB) | Done |
| 5 | Frontend↔backend integration + browser E2E | Done |
| 6 | Simulation page: presentation, accessibility, result persistence | Done |
| 7 | Documentation | Done |
| — | Deployment | **Not started** |
| — | Research write-up groundwork | **Not started** |

Verification totals: **unit 363/363 · integration 61/61 · E2E 49/49 · build clean · lint clean.**

### Decisions taken, for the record

- **Old browser projects are not migrated.** They were sample and test data. Any `projects`
  field in a legacy localStorage blob is stripped on read, on write and at startup, while the
  preferences in the same blob survive. The JWT lives under a different key and is never touched.
- **Comparison, Interview Prep and Learning Path are hidden, not deleted.** Routes, pages and
  state remain; only the sidebar entries were withdrawn.
- **Run comparison (Pass 4) was deliberately skipped**, so there is no side-by-side view of
  two runs. `Comparison.jsx` still compares two *versions of one project*, reached by URL.
- **The Gemini advisor has never been exercised end-to-end.** `playwright.config.js` sets
  `GEMINI_API_KEY: ''`, so every test skips the AI arm by design.

---

## Phase 8 — Close the test coverage gaps (highest value)

Route-by-route status of the browser suite:

| Route | Coverage |
|---|---|
| `/login` `/register` `/projects` `/builder` `/settings` | Real journeys |
| `/simulation` | Real journeys |
| `/evaluation` `/comparison` `/interview` `/learning` | URL only — proven to render, never exercised |
| `/dashboard` `/process-mining` `/recommendations` `/reports` | **None** |

Process Mining and Evaluation are the academic core of the project and a regression there
would ship silently today.

Known constraint: `/process-mining` consumes the simulation **event log**, which is
deliberately not persisted. Its journey test must therefore simulate and mine within one page
session rather than across a reload.

---

## Phase 9 — Deployment (nothing is live)

The production bundle uses a relative `/api`, so a static host plus a reverse proxy works.
Still required:

1. **Choose a host** — Render for the Node API plus a static host for the frontend, or one
   VPS with nginx. Everything else follows from this.
2. Provision a **production MongoDB Atlas cluster**. Only the dev cluster exists.
3. Generate **production** `JWT_SECRET` and `MONGO_URI`. The values in test config are
   throwaways by design.
4. Set `VITE_API_BASE_URL` at build time **only** if the API is cross-origin, and add the
   frontend origin to the backend CORS allowlist.
5. Smoke-test the deployed stack: register → create project → reload → confirm persistence.

---

## Phase 10 — Research write-up groundwork

Do this while the development data is intact; it is the only copy.

- Collect the experimental evidence: health scores, bottleneck and deviation findings,
  process-mining results, before/after comparisons.
- Fix and document the evaluation methodology.
- **Declare the AI-generated contribution.** Recommendations come from two arms — a
  deterministic rule-based baseline and a server-side Gemini call — and that must be declared.

---

## Housekeeping

| Item | Detail |
|---|---|
| Dev database | 20 accounts, 25 projects. **Back this up** |
| Synthetic accounts | 7 `@example.com` accounts remain, all with 0 projects |
| Empty test databases | 7 empty `archai_it_*` databases on the cluster. Cannot be dropped without elevated Atlas rights — request `dropDatabase` so future runs leave no residue |
| Dev servers | Ports 5000/5173 run a build from before the Simulation work. Restart to pick it up |

---

## House rules for the rest of this plan

1. One phase per session, confirmed before starting.
2. No commit or push without explicit instruction.
3. Integration and E2E suites always run against a disposable database; the development
   database is never written to by tests.
4. Report PASS/FAIL per area at the end of each phase.
5. Keep all work inside the project directory.