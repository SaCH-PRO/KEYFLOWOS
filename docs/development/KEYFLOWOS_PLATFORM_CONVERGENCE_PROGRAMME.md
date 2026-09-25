# KEYFLOWOS Platform & Workflow Convergence Programme

Status: **DURABLE SUCCESSOR PROGRAMME — NOT YET ACTIVATED**

Canonical control channel: GitHub issue #80  
Implementation truth: repository + PR + exact-head CI evidence  
Execution authority: newest valid ChatGPT DIRECTIVE / REVIEW / HOLD / RESUME on issue #80

## Purpose

This programme converges KEYFLOWOS infrastructure, deployment, data, observability,
security, configuration, and autonomous engineering workflow into one coherent
operating model.

It is a successor to the currently active application/convergence control loop.
It MUST NOT supersede an active hold or packet merely because this file exists.

Activation requires an explicit ChatGPT authority message on issue #80 after the
current programme/hold permits advancement.

## Target operating model

- **Web:** Next.js on Vercel is the single canonical production frontend.
- **API/runtime:** NestJS and long-running workers run outside Vercel.
- **Application data:** one canonical Prisma/PostgreSQL application data plane.
- **Identity:** Supabase Auth is the identity/session authority unless a later
  admitted migration explicitly changes that boundary.
- **Queues:** Redis + BullMQ remain the background-work primitive.
- **Objects:** S3-compatible durable object storage; MinIO may remain local/dev.
- **Voice:** LiveKit + dedicated voice worker.
- **Observability:** Sentry first, OpenTelemetry for distributed traces/metrics.
- **Delivery:** immutable artifacts promoted through preview/staging/production.
- **Source/control:** GitHub is durable truth and merge authority.

## Autonomous agent contract

### ChatGPT
Owns architecture, sequencing, packet issuance, scope/contradiction resolution,
adversarial review, merge admission, post-merge verification, and checkpoints.

### Claude Code
Primary implementation worker. It characterizes the current code, implements the
bounded packet, runs proof, reconciles review feedback, and returns durable evidence.

### GitHub Copilot
Continuous independent PR reviewer. Copilot reviews every meaningful code PR and
subsequent semantic push. Substantive Copilot findings must be either:
1. resolved in code/test/docs; or
2. explicitly rejected with evidence and surfaced in the RETURN.

Copilot is not an architecture authority and cannot widen scope, change canonical
truth ownership, authorize production effects, or weaken proof.

### Kimi Code
Optional secondary worker/adversarial prover. The programme must remain executable
without Kimi; when used, Kimi receives non-overlapping work or independent proof.

### GitHub Actions / repository gates
Deterministic proof and durable admission: typecheck, build, tests, security,
packet-specific proof, branch hygiene, agent-control validation and exact-head status.

## Required execution loop

SELECT -> RE-RESOLVE MAIN -> CHARACTERIZE -> DEFINE INVARIANT/FAILURE MATRIX ->
IMPLEMENT -> FOCUSED PROOF -> COPILOT REVIEW -> CLAUDE TRIAGE ->
FULL CI -> RETURN -> CHATGPT REVIEW -> READY_TO_MERGE -> MERGE ->
POST-MERGE VERIFY -> CHECKPOINT -> NEXT PACKET

If a semantic push occurs after Copilot review or RETURN, all evidence tied to the
old semantic head is stale and must be refreshed.

## Human-only gates

Autonomy stops for:
- production DNS/domain cutover;
- destructive production data/schema action;
- creation of paid infrastructure/resources;
- entry/rotation of secrets or OAuth credentials when no safe connected writer exists;
- real provider traffic not already authorized;
- major architecture override;
- lowering/weaking a security, tenancy, branch, proof or admission gate.

Everything else should be driven through the control loop.

## Phases

### Phase 0 — Activate the successor programme safely
- KF-PLAT-AUTO-001: teach the dispatcher to recognize this successor programme
  without disturbing the current application DAG.
- KF-PLAT-AUTO-002: make Copilot review disposition an explicit exact-head
  admission input.
- KF-PLAT-AUTO-003: prove unattended SELECT -> Claude -> PR -> Copilot -> RETURN
  -> ChatGPT review on a non-production control packet.

### Phase 1 — Canonical frontend/runtime topology
- KF-INFRA-001: finish Vercel compatibility/current PR and verify preview.
- KF-INFRA-002: verify fresh Vercel production deployment from main.
- KF-INFRA-003: characterize DNS/Caddy/cookies/CORS/auth redirects/API proxy.
- KF-INFRA-004: cut canonical web domain to Vercel. **Human production gate.**
- KF-INFRA-005: retire duplicate Hetzner web runtime after production proof.

### Phase 2 — Supabase/Auth and data-plane convergence
- KF-DATA-001: full Supabase lineage + live-consumer audit.
- KF-DATA-002: codify Supabase Auth -> local User -> Membership -> Business boundary.
- KF-DATA-003: quarantine/archive legacy Supabase public application schema.
  **Human destructive-data gate if deletion is proposed.**
- KF-DATA-004: remediate only relevant Supabase performance/security findings.
- KF-DATA-005: prove one canonical application database authority.

### Phase 3 — Isolated staging
- KF-STAGE-001: staging architecture and threat model.
- KF-STAGE-002: staging API/runtime.
- KF-STAGE-003: isolated staging Postgres/Redis/object state.
- KF-STAGE-004: preview-to-staging routing.
- KF-STAGE-005: provider sandbox/disabled/read-only matrix.
- KF-STAGE-006: prove previews cannot mutate production.

### Phase 4 — Immutable backend delivery
- KF-DEPLOY-001: GHCR image pipeline for API/voice/worker artifacts.
- KF-DEPLOY-002: reproducible image/build proof.
- KF-DEPLOY-003: Hetzner pull-by-SHA deployment.
- KF-DEPLOY-004: migration/backup/health deployment gate.
- KF-DEPLOY-005: exact-image rollback.
- KF-DEPLOY-006: staging-to-production artifact promotion proof.

### Phase 5 — Data resilience
- KF-RESILIENCE-001: explicit RPO/RTO/retention/encryption contract.
- KF-RESILIENCE-002: encrypted off-site PostgreSQL backups.
- KF-RESILIENCE-003: WAL/PITR strategy and proof.
- KF-RESILIENCE-004: durable production object-storage strategy.
- KF-RESILIENCE-005: automated isolated restore drill.

### Phase 6 — Observability
- KF-OBS-001: complete NestJS Sentry exception/integration path.
- KF-OBS-002: one Git SHA release identity across GitHub/Vercel/API/workers/Sentry.
- KF-OBS-003: structured logs with sensitive-field policy.
- KF-OBS-004: OpenTelemetry trace propagation across web/API/queue/worker/provider.
- KF-OBS-005: health/queue/deploy/provider alerting.
- KF-OBS-006: voice-worker liveness/readiness surface.

### Phase 7 — GitHub, CI and supply-chain hardening
- KF-GOV-001: canonical active main ruleset.
- KF-GOV-002: CODEOWNERS for high-risk surfaces.
- KF-GOV-003: merge queue/exact-head admission where supported.
- KF-CI-001: Turbo-aware/affected CI and remote cache.
- KF-CI-002: remove duplicate install/build/Prisma work.
- KF-SEC-001: Dependabot for pnpm/GitHub Actions/Docker.
- KF-SEC-002: security debt ratchet; new critical/high-risk regressions block.
- KF-SEC-003: CodeQL/static security integration.

### Phase 8 — Environment and secrets convergence
- KF-CONFIG-001: canonical development/test/staging/production env schema.
- KF-CONFIG-002: secret classification/inventory.
- KF-CONFIG-003: select one secrets platform. **Human cost/connection gate if needed.**
- KF-CONFIG-004: project config safely into GitHub/Vercel/Hetzner/Supabase.
- KF-CONFIG-005: CI drift proof for required/public/server-only variables.

### Phase 9 — Multi-agent scale
- KF-AGENT-001: worktree-per-packet.
- KF-AGENT-002: machine-readable file claims.
- KF-AGENT-003: semantic/domain/entity/journey/kernel claims.
- KF-AGENT-004: conflict admission and non-overlap proof.
- KF-AGENT-005: standardized Claude RETURN with Copilot disposition.
- KF-AGENT-006: optional Kimi adversarial/secondary role.
- KF-AGENT-007: unattended next-packet launch after checkpoint.

### Phase 10 — Infrastructure as Code
- KF-IAC-001: OpenTofu/Terraform host/network/DNS/firewall specification.
- KF-IAC-002: Ansible host configuration.
- KF-IAC-003: clean-machine rebuild proof.
- KF-IAC-004: documented disaster-recovery reconstruction.

### Phase 11 — Final qualification
- KF-QUAL-001: whole-stack reassessment across frontend, API, auth, data, queues,
  voice, storage, providers, CI, deploy, observability, security and agent workflow.
- KF-QUAL-002: adversarial failure matrix: outages, restart, replay, stale deploy,
  queue/provider failure, bad migration, DB restore, Supabase outage, agent collision.
- KF-QUAL-003: final durable checkpoint and residual-risk ledger.

## Completion contract

The platform programme is complete only when all applicable statements are YES:
- one canonical production frontend authority;
- one canonical application data authority;
- one explicit identity authority;
- preview/staging cannot mutate production;
- immutable artifact delivery and rollback proven;
- off-site backup and restore proven;
- production release is traceable by one immutable release identity;
- observability catches application and worker failures;
- GitHub branch/admission protections are active;
- Copilot substantive findings are exact-head dispositioned;
- deterministic CI/security gates are green;
- secrets/config have one declared environment model;
- autonomous worker isolation/conflict rules are proven;
- production topology is reproducible from code/runbooks/IaC;
- final main is post-merge revalidated;
- no unexplained deferral, skipped proof, or legacy authority conflict remains.
