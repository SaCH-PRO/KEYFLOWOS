# Security: DAST (StackHawk) & Compliance (Vanta) setup

Phase 3 of the [plugin integration roadmap](./PLUGIN_INTEGRATION_ROADMAP.md). This
adds the two pieces the codebase didn't have: **dynamic** app security testing,
and a path to compliance evidence. Both are inert until you supply credentials,
so the code is already merged and safe.

---

## What shipped

- **`stackhawk.yml`** — HawkScan config targeting the NestJS API (`:3001`).
- **`.github/workflows/hawkscan.yml`** — a **dark-by-default** DAST workflow. It
  boots the app the same way the `Run Tests` job does (Postgres + Redis, real
  migrations), waits on `/healthz`, then runs HawkScan. With no `HAWK_API_KEY`
  secret it skips every heavy step and passes as a no-op, so it never turns the
  branch-protected `main` red on its own.

It is a **separate workflow**, not a job in `ci-cd.yml`, precisely so a scan that
depends on an external account can't break the required status checks. Promote it
to a required check only after it has run green with real credentials.

---

## Why DAST, when there's already a "Security Scan" job

The existing `Security Scan` job in `ci-cd.yml` is **static**: `pnpm audit` (known
CVEs in dependencies) and `trufflehog` (committed secrets). Neither runs the app.
An auth bypass, an IDOR on `/businesses/:id/...`, or a reflected injection in a
live route is invisible to static tooling. HawkScan boots the API and attacks it —
that's the only way those surface. The two are complementary, not redundant.

---

## Activating StackHawk

1. Create a StackHawk account and an **Application** for KEYFLOW OS
   (https://app.stackhawk.com). Note its **Application ID**.
2. Create an **API key** (Settings → API keys).
3. Add two repository secrets (Settings → Secrets and variables → Actions):
   - `HAWK_API_KEY` — the API key. **This is the activation switch** — the moment
     it exists, the workflow starts scanning on PRs to `main`.
   - `HAWK_APP_ID` — the Application ID (kept out of the committed config).
4. Open a PR (or run the workflow manually via **Actions → DAST (HawkScan) → Run
   workflow**). The first run establishes a baseline.

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
   the CI DAST run sets the flag; production leaves it off.
2. Uncomment the `openApiConf` block in `stackhawk.yml` (already templated).

This is a small, self-contained change but it adds a dependency and a
(gated) endpoint to the API, so it's called out here as an explicit decision
rather than bundled into the dark scaffolding.

To scan **behind Supabase auth**, uncomment the `authentication` block in
`stackhawk.yml` and add a `HAWK_TEST_JWT` secret holding a **disposable test
user's** token — never a real user's.

### Turning it into a gate
The scan starts as a **soft gate** (`continue-on-error: true`) so it reports
without blocking. Once the baseline is triaged:
1. Set `continue-on-error: false` on the `Run HawkScan` step.
2. Add `HawkScan` to `main`'s required status checks (same ruleset you created
   for the CI checks — see [issue #60](https://github.com/SaCH-PRO/KEYFLOWOS/issues/60)).

---

## Activating Vanta

Vanta is compliance automation (SOC 2 / ISO 27001 evidence collection). Unlike
StackHawk it is **configuration, not code** — there's nothing to build in this
repo, but here's the path so it's not lost:

1. Connect Vanta to the infrastructure it monitors: the cloud host (Render, per
   `render.yaml`), GitHub (this org), the database, and identity/SSO.
2. Map controls to what already exists here — e.g. this repo's branch protection
   and required checks, `SECURITY.md`, Sentry, secret scanning, and (once live)
   the StackHawk DAST gate are all evidence for change-management and
   vulnerability-management controls.
3. Assign control owners and let Vanta's monitors run continuously.

The Vanta MCP plugin is enabled on this workspace, so once the account is
connected an agent can query control/evidence status directly.

---

## Status

| Piece | State |
|---|---|
| `stackhawk.yml` + DAST workflow | Merged, dormant until `HAWK_API_KEY` is set |
| Authenticated scanning | Config block ready, needs `HAWK_TEST_JWT` |
| DAST as a required check | After baseline triage (flip `continue-on-error`) |
| Vanta | Account/connector setup (no code) |
