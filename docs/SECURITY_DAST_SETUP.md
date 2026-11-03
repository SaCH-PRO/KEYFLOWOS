# Security: DAST (native gate, manual StackHawk) & Compliance (Vanta) setup

Phase 3 of the [plugin integration roadmap](./PLUGIN_INTEGRATION_ROADMAP.md). It
covers **dynamic** app security testing and a path to compliance evidence.

There are two DAST workflows, and only one of them is a gate:

| Workflow | File | Runs on | Role |
|---|---|---|---|
| **DAST (Native)** | `.github/workflows/native-dast.yml` | every PR to `main`, and `workflow_dispatch` | The required DAST gate. Needs no third-party account and no secret. |
| **DAST (HawkScan)** | `.github/workflows/hawkscan.yml` | `workflow_dispatch` only | Manual-only StackHawk scan. Not a required check. |

The swap is V1-30 (owner ruling D-22, finding PRS-M08): as a required check,
DAST (HawkScan) concluded success with every scan step skipped whenever its
StackHawk key was absent, so it admitted PRs that were never scanned.

---

## The required gate: DAST (Native)

**What runs.** `.github/workflows/native-dast.yml` (V1-13) has two jobs:

1. **Native DAST evaluator spec** runs
   `node --test scripts/security/tests/native-dast.spec.mjs`, so a broken judge
   can never produce a green probe run.
2. **Native dynamic security proof** needs the first job. It builds the API,
   boots it against the job's own Postgres (pgvector, pg16) and Redis with real
   migrations, waits on `/healthz`, then runs exactly
   `node scripts/security/native-dast.mjs scripts/security/native-dast-manifest.json`.

**What it proves.** The harness (`scripts/security/native-dast.mjs`) sends
every probe in `scripts/security/native-dast-manifest.json` to the API on
`127.0.0.1:3001`. It refuses any host that is not loopback. Every probed
protected route is AuthGuard-first:

- an anonymous call must answer 401 or 403;
- a credential authentication must refuse (malformed bearer, `alg: none`,
  wrong key, expired, wrong audience, foreign issuer) must answer 401;
- a valid token for a caller who is no member must answer 403.

A 404 (route gone), a 5xx, a 2xx or 3xx, a 403 to a refused credential, a
leaked stack frame or Prisma marker, or a server it cannot reach fails the job.
Nothing is skipped.

**What it needs.** Nothing to activate. The workflow generates its signing and
encryption keys per run, sets no Supabase project URL, and depends on no
repository secret. No probe leaves the runner.

**Why it is the gate.** `REQUIRED_WORKFLOWS` in
`scripts/agent-control/lib/events.mjs` names DAST (Native), and the exact-head
admission evaluator reads it (`docs/development/AGENT_CONTROL_PLANE.md`).
`scripts/agent-control/tests/workflow-integrity.spec.mjs` proves that it runs
on every PR without a path filter, and that it cannot conclude success without
probing: no `continue-on-error`, no dormant guard, no secret, and probe and
evaluator commands that nothing can swallow.

**Running it locally.** Start the API on port 3001 with the same
`SUPABASE_JWT_SECRET` the probes sign with, then:

```sh
NATIVE_DAST_BASE_URL=http://127.0.0.1:3001 SUPABASE_JWT_SECRET=<the server's> \
  node scripts/security/native-dast.mjs scripts/security/native-dast-manifest.json
```

Exit 0 means every probe passed, 1 means a probe failed, and 2 means the
configuration was refused.

**Adding a probe.** Add it to `scripts/security/native-dast-manifest.json`. The
rules it is judged by are in the header of `scripts/security/native-dast.mjs`.

---

## Why DAST, when there's already a "Security Scan" job

The existing `Security Scan` job in `ci-cd.yml` is **static**: `pnpm audit` (known
CVEs in dependencies) and `trufflehog` (committed secrets). Neither runs the app.
An auth bypass, an IDOR on `/businesses/:id/...`, or a reflected injection in a
live route is invisible to static tooling. The native gate boots the API and
probes its auth boundary; HawkScan, run by hand, crawls and attacks a broader
surface. They complement each other.

---

## StackHawk: manual-only HawkScan

DAST (HawkScan) is manual-only. `hawkscan.yml` runs on `workflow_dispatch` and
nothing else, and it is not a required check: no PR runs it, so as a required
status check it would never report and would block every merge.
`workflow-integrity.spec.mjs` proves it has no trigger but `workflow_dispatch`.

### What it adds

- **`stackhawk.yml`**: HawkScan config targeting the NestJS API (`:3001`).
- **`.github/workflows/hawkscan.yml`**: boots the app the same way the `Run Tests`
  job does (Postgres + Redis, real migrations), waits on `/healthz`, then runs
  HawkScan.

Without the `HAWK_API_KEY` secret its guard skips every heavy step and the run
concludes success having scanned nothing. A green manual run without the key
proves nothing.

### Running HawkScan by hand

1. Create a StackHawk account and an **Application** for KEYFLOW OS
   (https://app.stackhawk.com). Note its **Application ID**.
2. Create an **API key** (Settings → API keys).
3. Add two repository secrets (Settings → Secrets and variables → Actions):
   - `HAWK_API_KEY`: the API key. Without it a run scans nothing.
   - `HAWK_APP_ID`: the Application ID (kept out of the committed config).
4. Run the workflow from **Actions → DAST (HawkScan) → Run workflow**, on the
   branch you want scanned. The first run establishes a baseline in StackHawk.

Triage findings in StackHawk. A finding that names an auth-boundary defect
should also become a probe in `scripts/security/native-dast-manifest.json`, so
the required gate keeps it fixed.

### First-pass scope
The committed config scans the **public surface unauthenticated** — health/readiness
plus whatever the spider can crawl. It excludes the SSE stream (`/healthz/events`)
and webhook ingress paths at any depth (`^(.*/)?webhooks?(/.*)?$`), which must
never be fuzzed.

### Making coverage real (recommended follow-up)
The API root serves plain text with no links and the app ships **no OpenAPI
spec**, so the spider alone reaches almost nothing — a scan today would mostly
test `/`. To cover the real API surface, generate an OpenAPI document and point
HawkScan at it:

1. Add `@nestjs/swagger` and expose the spec at `/openapi.json`, **gated to
   non-production** (or behind a flag) so it isn't a permanent public endpoint —
   the HawkScan workflow sets the flag; production leaves it off.
2. Uncomment the `openApiConf` block in `stackhawk.yml` (already templated).

This is a small, self-contained change but it adds a dependency and a
(gated) endpoint to the API, so it's called out here as an explicit decision
rather than bundled into the dark scaffolding.

To scan **behind Supabase auth**, uncomment the `authentication` block in
`stackhawk.yml` and add a `HAWK_TEST_JWT` secret holding a **disposable test
user's** token — never a real user's.

### Not a gate
The `Run HawkScan` step keeps `continue-on-error: true`, so a manual run
reports findings without failing. Making HawkScan a gate again would need a PR
trigger, a run that cannot pass without its key, and an owner ruling that
reverses D-22. Until then, the DAST gate is DAST (Native).

---

## Activating Vanta

Vanta is compliance automation (SOC 2 / ISO 27001 evidence collection). Unlike
StackHawk it is **configuration, not code** — there's nothing to build in this
repo, but here's the path so it's not lost:

1. Connect Vanta to the infrastructure it monitors: the cloud host (Render, per
   `render.yaml`), GitHub (this org), the database, and identity/SSO.
2. Map controls to what already exists here — e.g. this repo's branch protection
   and required checks, `SECURITY.md`, Sentry, secret scanning, and the required
   DAST (Native) gate are all evidence for change-management and
   vulnerability-management controls.
3. Assign control owners and let Vanta's monitors run continuously.

The Vanta MCP plugin is enabled on this workspace, so once the account is
connected an agent can query control/evidence status directly.

---

## Status

| Piece | State |
|---|---|
| DAST (Native), `native-dast.yml` | Required DAST gate on every PR to `main`; no secret needed |
| DAST (HawkScan), `hawkscan.yml` + `stackhawk.yml` | Manual-only (`workflow_dispatch`), not a required check; scans nothing without `HAWK_API_KEY` |
| Authenticated HawkScan | Config block ready, needs `HAWK_TEST_JWT` |
| Vanta | Account/connector setup (no code) |
