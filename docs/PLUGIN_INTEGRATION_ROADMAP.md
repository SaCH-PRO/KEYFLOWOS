# Plugin Integration Roadmap

_How the available claude.ai plugin catalog maps onto KEYFLOW OS, and the order we should adopt them in._

Status: **Phase 1 (Langfuse) and Phase 2 (GrowthBook) shipped** on `claude/plugin-integration-improvements-wzdpex`; Phases 3–4 scoped below.

---

## Principle: build the gaps, not the duplicates

KEYFLOW OS already ships a deep integration surface. Before recommending anything we mapped what exists so we only add leverage, never overlap:

| Capability | Already in KEYFLOW OS |
|---|---|
| Payments | Stripe, PayPal, Google Pay, WiPay |
| Comms | Twilio (SMS), WhatsApp Business, Resend (email), Chatwoot (support) |
| Voice / realtime | LiveKit, ElevenLabs, OpenAI voice |
| AI providers | OpenAI, Anthropic, xAI, Google, Moonshot, native/opensource — via `apps/server/src/modules/ai/model-gateway.service.ts` |
| AI cost/usage | `llm-cost.service.ts`, `ai-usage.service.ts` (tokens + dollars per call) |
| Auth | Supabase JWT + HMAC admin fallback |
| Error tracking | Sentry |
| Storage / cache | S3-compatible, Redis + BullMQ |
| Code sandbox | E2B |

So the highest-value plugins are the ones filling a **real gap**, not re-implementing the above.

---

## The four priorities

### Phase 1 — Langfuse: LLM observability ✅ SHIPPED

**Gap it fills:** the gateway routes across six providers with fallback, BYOK and budget caps, and we cost every call — but we had no visibility into the *shape* of a call: traces, latency distribution, which task categories fall back, quality drift over time.

**Integration point:** the gateway's two cost recorders — `recordCostFromResponse` and `recordCostFromStream` in `model-gateway.service.ts` — are the single seam every completion (buffered and streamed) already passes through.

**What shipped:**
- `apps/server/src/modules/ai/langfuse.service.ts` — env-gated shim that POSTs a trace + generation to Langfuse's public ingestion HTTP API. **No SDK dependency** (no lockfile churn), **no-op when `LANGFUSE_*` keys are absent**, and **fire-and-forget** (a tracing outage never touches the request it observes — same degrade-don't-die contract the gateway already holds for absent providers).
- Wired into both cost recorders; registered in `ai.module.ts`.
- `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` added to `.env.example`.
- Tests: `langfuse.service.spec.ts` (disabled/no-network, enabled/batch-shape, swallows fetch failure) + the existing 78 gateway/provider tests still green.

**To turn it on:** set the two keys in the server environment. Traces appear per business (`userId`), tagged by provider / primary-vs-fallback / stream-vs-complete, with token + cost usage attached.

**Follow-ups worth doing later:** thread a real `sessionId` from KEY conversations into the trace (today it's per-call); add Langfuse **scores** from the existing `ai-quality` / oversight signals so eval dashboards populate; sample high-volume task categories if ingestion volume warrants.

---

### Phase 2 — GrowthBook: dynamic flags & experimentation ✅ SHIPPED

**Gap it fills:** the repo already has `modules/feature-flags` — a **DB-backed nav gate** (static "coming soon" toggles with per-email bypass, operator-edited). What it *can't* do is a dynamic rollout: enable a change for 10% of businesses, flip it off without a deploy, target by plan/country, or run an A/B test. GrowthBook is that layer, and it complements the existing service rather than replacing it.

**What shipped:**
- `apps/server/src/core/growthbook/growthbook.service.ts` — `GrowthBookService` wrapping the `GrowthBookClient` (multi-user server client: one shared instance, per-request `UserContext`). `isEnabled(key, ctx, fallback)` and `getValue(key, fallback, ctx)`, keyed by `businessId` (GrowthBook's `id` hash attribute → deterministic percentage rollouts).
- Same dark-by-default contract as Langfuse/Sentry: env-gated on `GROWTHBOOK_CLIENT_KEY`, and **every flag resolves to the caller's fallback** when disabled, unloaded, or unknown — a missing config can only mean "the safe default", never a crash or an accidental on. GrowthBook init failure degrades to fallbacks; it never blocks boot.
- Global `GrowthBookModule` registered in `app.module.ts` (mirrors `core/sentry`); `GROWTHBOOK_CLIENT_KEY` + `GROWTHBOOK_API_HOST` in `.env.example`.
- Tests: `growthbook.service.spec.ts` (disabled/no-network, boolean + typed eval, unknown→fallback, deterministic bucketing).

**Named distinctly on purpose:** `GrowthBookService` (dynamic) vs. the existing `FeatureFlagsService` (static nav gate) so the two never collide. Use GrowthBook for rollouts/experiments; keep the DB service for operator nav toggles.

**To turn it on:** set `GROWTHBOOK_CLIENT_KEY` (SDK client key, not a personal API key). **First flags to define:** gate each new plugin integration (Phase 3/4) behind a GrowthBook flag so rollout is per-business and reversible.

**Follow-up:** a web-side provider/hook in `apps/web` for client-gated UI (server evaluation shipped; client evaluation is the natural next step).

---

### Phase 3 — StackHawk + Vanta: security & compliance

**Gap it fills:** `SECURITY.md` exists but security posture is docs-only. KEYFLOW OS handles money + PII, so this is trust/enterprise-readiness, not polish.

**Integration points:**
- **StackHawk (DAST):** add a `hawkscan` job to `.github/workflows` that scans the running app (spin up `docker-compose.yml`, point HawkScan at the web + API). Gate PRs on new high-severity findings only, to avoid noise on day one.
- **Vanta:** compliance monitoring/evidence collection — largely org/config setup rather than code; wire the integrations Vanta needs (cloud, CI, repo) and track SOC2-style controls.

**Effort:** StackHawk M (CI wiring), Vanta S–M (mostly config). **Risk:** low; findings inform, they don't block until we choose to gate.

---

### Phase 4 — CRM contact enrichment (Apollo / Lusha / ZoomInfo / Common Room)

**Gap it fills:** the Money → Contacts CRM stores contacts but doesn't enrich them (company, title, verified email, firmographics).

**Integration point:** the existing `integration-hub` module (`apps/server/src/modules/integration-hub`) is the natural home. Add an enrichment provider interface with one concrete adapter first (recommend **Apollo** for breadth), invoked on contact create/update and exposed as a manual "enrich" action.

**Design notes:** respect BYOK-style credential storage (the app already encrypts provider creds); rate-limit and cache enrichment results; make the provider swappable so Lusha/ZoomInfo can be added behind the same interface.

**Effort:** M. **Risk:** medium (external data quality, cost per lookup, PII handling — coordinate with Phase 3).

---

## "Something else" — bucket B product integrations (candidates, not yet scoped)

Plugins that would add *new user-facing capability* rather than harden internals. Pull any into a numbered phase on request:

- **Postiz** — multi-platform social scheduling, extends the Content/People module beyond Meta/WhatsApp.
- **Canva / Cloudinary / Figma** — design assets + on-the-fly image transforms for storefronts and content. Cloudinary could offload the current S3 image pipeline with automatic resizing/format negotiation.
- **Zapier** — let users connect KEYFLOW flows to thousands of external apps.
- **Qdrant / Pixeltable** — a vector store to power real RAG/semantic search for KEY over CRM, content, and documents.
- **Datadog / Grafana / Honeycomb / SignOz** — deeper prod observability (APM/metrics/logs) once traffic grows; complements, doesn't replace, Sentry.

---

## Adoption order (recommended)

1. **Langfuse** ✅ — see what KEY is actually doing before changing anything else.
2. **GrowthBook** ✅ — safety net in place; every subsequent integration ships behind a flag.
3. **StackHawk + Vanta** — trust/enterprise-readiness while the surface is still small.
4. **CRM enrichment** — first clear user-facing win, built on the integration-hub.

Each phase is independently shippable and dark-by-default, so we can stop, reorder, or parallelize at any point.
