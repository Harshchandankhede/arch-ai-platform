# Arch-AI — Remaining Work Plan

Status as of end of session. Phases 0–5 are complete, verified and **uncommitted**.
Work resumes here tomorrow, one phase at a time, with nothing committed until you say so.

## Where things stand

| Phase | Scope | State |
|---|---|---|
| 0 | Data inventory + test-account cleanup | Done |
| 1 | Durable project persistence (autosave, duplicate, delete) | Done |
| 3 | Server-side report profile | Done |
| 4 | Two-account integration suite (disposable DB) | Done |
| 5 | Frontend↔backend integration + browser E2E | Done |
| 2 | Legacy browser-data migration | **Not started** |
| 6 | Documentation | **Not started** |
| 7 | Deployment | **Not started** |

Verification totals: unit 314/314 · integration 61/61 · E2E 30/30 · build clean · lint clean.

---

## Phase 6 — Commit the verified work (do this first)

Everything from Phases 1–5 is sitting uncommitted across 14 files. It should be committed
before new work starts, otherwise tomorrow's changes blend into an unreviewable diff.

Suggested sequence, one commit per phase so each is independently revertible:

1. `feat: run integration and browser test suites against a disposable database`
2. `feat: proxy the API in dev and make its base URL configurable`
3. `fix: carry reportProfile from the API response into app state`
4. `fix: correct the password storage hint on the sign-up form`
5. `feat: expose comparison, interview and learning pages in the sidebar`

Before the first commit: secret-scan the diff, confirm no `.env`, no traces, no
`test-results/`, and re-run the full gate.

---

## Phase 7 — Legacy browser-data migration (the original Phase 2)

The only functional gap left from the earlier plan. `src/services/migrateLocalData.js`
still exists and is the remaining consumer of the old shared
`archai.state.v1` localStorage key.

Decisions needed before implementing:

- Which local projects, if any, get claimed by the account signing in first.
- Whether migration is offered or automatic. Automatic is riskier: it silently attaches
  whatever the browser holds to whichever account arrives first.
- Whether to migrate project data at all, or only preferences, given projects are now
  server-owned.

Once resolved: implement, add tests, verify against a browser with pre-seeded localStorage,
and confirm a second account on the same browser never sees migrated projects.

---

## Phase 8 — Documentation

- Rewrite `README.md`, which is currently outdated. Must cover: prerequisites, the two
  `.env` files, `npm run dev` in both `backend/` and the root, and the three test commands
  (`test`, `test:integration`, `test:e2e`).
- Document the disposable-database convention and why `dropDatabase` is unavailable on the
  current Atlas role.
- Document `VITE_API_BASE_URL` and when a deployment actually needs it.
- Add per-phase notes as needed for the write-up.

---

## Phase 9 — Deployment

Nothing is deployed yet. The blocker found and fixed in Phase 5 was that the production
bundle hardcoded `http://localhost:5000/api`; that is now a relative `/api`, so a static
host plus a reverse proxy works.

Needs a decision: **where to host** (the options being Render for the Node backend plus a
static host for the frontend, versus a single VPS with nginx). This drives everything else.

Then:

- Provision the production MongoDB Atlas cluster (the current one is the dev database).
- Generate production secrets. `JWT_SECRET` and `MONGO_URI` must be new values; the
  throwaway keys in the test config are not secrets.
- Configure the frontend build with `VITE_API_BASE_URL` pointing at the deployed API.
- Verify CORS origins match the deployed frontend origin.
- Smoke-test the deployed stack: register, create a project, reload, confirm persistence.

---

## Phase 10 — Research write-up groundwork

- Collect the experimental evidence: health scores, bottleneck and deviation findings,
  process-mining results, before/after comparisons.
- Decide and document the evaluation methodology.
- Note that AI-labelled contributions must be declared; the Gemini advisor arm is
  externally generated.
- Export the data the write-up needs while the dev database is intact.

---

## Open items carried forward

- **7 synthetic `@example.com` accounts** remain in the dev database, all with 0 projects.
  You chose not to delete them; they can go any time.
- **6 empty `archai_it_*` databases** sit on the cluster. They hold no data and cannot be
  dropped without elevated Atlas rights. Worth requesting `dropDatabase` so future runs
  leave no residue.
- **The dev database holds 24 projects and 19 accounts.** This is the last remaining copy,
  so it should be backed up before any future cleanup work.

## House rules for the rest of this plan

1. One phase per session, confirmed before starting.
2. No commit or push without explicit instruction.
3. Integration and E2E suites always run against a disposable database; the dev database
   is never written to by tests.
4. Report PASS/FAIL per area at the end of each phase.
5. Keep all work inside the project directory.