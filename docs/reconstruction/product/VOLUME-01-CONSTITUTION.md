# Volume 1 — KEYFLOWOS Product Constitution (v1 candidate)

Status: PRODUCT-FIRST RECONSTRUCTION / DRAFT, NOT APPROVED PRODUCT CANON  
Snapshot: main@b1948d2797e1bae3660a3d7173abb75397e05aad  
Prepared: 2026-10-29

## 1. One-sentence product definition

KEYFLOWOS is a multi-tenant, AI-assisted business operating system that connects a small business's people, money, time, work, communications, public presence and operational knowledge into coherent end-to-end flows. KEY is the optional, governed intelligence worker inside that operating system, not a separate authority over it.

## 2. Job to be done

A business owner currently loses time and context moving among messages, contact lists, calendars, quotes, invoices, financial records and customer follow-up. KEYFLOWOS should preserve that business context, let an owner complete work manually, and progressively remove repetitive administration without obscuring what really happened.

Initial wedge: small/service-led businesses in Trinidad & Tobago and the Caribbean; multi-currency and international expansion remain architectural requirements. This is a proposed launch focus, not the limit of the ultimate platform.

## 3. User-visible promises

1. **One business memory**: linked customers, interactions, bookings, quotes, invoices, payments and outcomes; no repeated re-entry across every step.
2. **Immediate useful outcome**: onboarding reaches a working business artifact quickly (for example, a contact, public booking link or invoice), instead of requiring the owner to configure an entire platform first. Historical 60-second target remains a test hypothesis.
3. **Run versus configure**: a Cockpit shows next actions, Workspaces let users complete tasks, Studio configures the business, Public pages serve customers. Do not freeze a particular navigation design before current-UI reconciliation.
4. **Manual parity**: users can carry out ordinary business actions without KEY or a paid AI provider; KEY interprets, drafts and recommends, escalating risk-sensitive actions to approved authority.
5. **Money truth**: quote -> invoice -> payment -> balance -> ledger and audit must remain correct under retry, duplication, partial payment, reversal, and refresh.
6. **Tenant and role boundaries**: one business cannot see another's records; in-business private/shared/owned scopes must be respected; secrets and customer data must not leak.
7. **Observable work**: a user can distinguish proposed, pending, approved, executed, verified, failed and unknown actions. A UI may not report a business outcome just because an AI tool or job returned success.
8. **Composable evolution**: Playbooks, richer integrations, commerce, storefront, analytics, communications, staff support and KEY's cognitive capabilities extend the platform without inventing conflicting sources of truth.

## 4. What KEY is and is not in v1

KEY: context-aware assistant that can retrieve authorized business facts, answer questions, prepare actions, explain evidence and request approval. Where a deterministic/manual workflow already works, KEY can sit over it.

KEY is not required to autonomously operate finances, modify permissions, send customer communications or execute external provider effects in the first release. "Consciousness"/JARVIS metaphors describe a long-term user experience and research direction, not proof of subjective awareness or an MVP dependency.

## 5. Engineering invariants that directly protect the user promise

- Every customer-visible feature needs a working data/service/manual-UI path, and associated rights and negative tests.
- Preserve existing source-of-truth owners; new diagrams and AI abstractions do not become authority merely because they are named.
- Reuse existing modules; characterize real behavior before proposing replacement. No big-bang rewrite.
- Effects involving money, identity, permissions or external providers must have durable identity, correct authorization, audit/evidence, retries and recovery appropriate to risk.
- Production remains read-only during reconstruction; issue #186 is a release target, not a merge/deployment authorization.
- "Working" means tested at a pinned code/environment revision, not a route or page existing.

## 6. First product proof

Release 0 reference journey (issue #186): owner signs in; selects a business; creates/edits a contact; creates and issues a quote or invoice; records offline/manual payment; sees correct results after refresh; unauthorised tenant fails to access or modify records. No unapproved paid API prerequisite.

The Contacts packet is the first bounded specification pilot. It cannot declare the full Release 0 journey complete.

## 7. Source status and open decisions

Primary current evidence: docs/KEYFLOWOS_APP_SPEC.md (main blob ed0f2a5f332c745877c5354375fd94396846ac0a); docs/INFORMATION_ARCHITECTURE.md (blob 91d72eb8af683bfc9bd89c02f8097e8fb6762a4a); docs/KEYFLOWOS_WORLD_PLUGGED_OS_MASTER_PLAN.md (blob dab60267b7e5f736350bf83a76fcf927eded5379); docs/architecture/ADR-0001-flow-is-the-execution-substrate.md (blob 6c2354af7a299f607c0e0e7dccad39637a94a507); issue #186 (2026-10-28); user-provided KEYFLOW v3 blueprint (historical source; content reviewed but no uploaded-file hash yet).

Unresolved: exact v1 release boundaries beyond Release 0; which of multiple navigation designs to formalize; manual-only versus KEY-included v1; payment provider schedule; connector scope; business on-boarding KPIs; how future cognition and agent research converges. None blocks the Contacts specification.

This volume intentionally keeps the constitution short. Detailed modules live under product/modules/ and source lineage stays in the evidence ledger.
