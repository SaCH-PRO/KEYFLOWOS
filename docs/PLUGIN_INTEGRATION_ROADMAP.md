# Plugin Integration Roadmap

_How the available claude.ai plugin catalog maps onto KEYFLOW OS, and the order we should adopt them in._

Status: **Phase 1 (Langfuse) shipped** on `claude/plugin-integration-improvements-wzdpex`; Phases 2–4 scoped below.

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

### Phase 2 — GrowthBook: feature flags & experimentation

**Gap it fills:** no flag system exists (nothing in `.env.example`, no flag client). We ship features across Cockpit / Workspaces / Studio with no safe kill-switch or A/B path.

**Integration points:**
- Server: a small `FeatureFlagService` (SDK or the GrowthBook HTTP API) resolving flags by `businessId` — mirror the `LangfuseService` env-gated, no-op-when-unconfigured pattern so it's safe to merge dark.
- Web: `apps/web` provider + hook for client-gated UI; server-evaluated flags for API/route gating.

**First flags to define:** gate each new plugin integration (including the Phase 3/4 work below) behind a flag so rollout is per-business and reversible.

**Effort:** M. **Risk:** low (additive, dark by default).

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
2. **GrowthBook** — get the safety net in place; every subsequent integration ships behind a flag.
3. **StackHawk + Vanta** — trust/enterprise-readiness while the surface is still small.
4. **CRM enrichment** — first clear user-facing win, built on the integration-hub.

Each phase is independently shippable and dark-by-default, so we can stop, reorder, or parallelize at any point.
