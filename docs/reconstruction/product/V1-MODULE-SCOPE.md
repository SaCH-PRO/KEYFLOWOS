# KEYFLOWOS — Ranked Product Module Scope and Disposition (v1 candidate)

Status: PROVISIONAL PRODUCT PRIORITIZATION, not merge approval, automatic deletion, or complete future-platform rejection.  
Base: main@b1948d2797e1bae3660a3d7173abb75397e05aad; prepared 2026-10-29.  
Authority: product reconstruction proposal derived from original vision, current APP_SPEC, May information architecture, and October 28 Release-0 issue. Operator sign-off still pending.

## Disposition language

- KEEP — retain the existing functional domain and prove/harden its reachable v1 behavior.
- MERGE — converge overlapping user experiences or competing implementations into an existing owner, after usage/consumer proof.
- DEFER — preserve full long-term specification and history, but do not require implementation for Release 0 / first v1.
- CUT FROM V1 — remove from the *new v1 scope*, not erase historical vision or delete any existing working code without independent approval.

## Ranked module decisions

| Rank | Product domain | Decision | Release 0 | First v1 | Rationale / boundary |
|---|---|---|---|---|---|
| P0-1 | Account / Business onboarding / Auth / Team membership | KEEP | Required | Required | Tenant root, identities and permissions are prerequisite to every business result |
| P0-2 | Contacts, CRM record, lifecycle, basic notes/tasks | KEEP | Required | Required | Customer identity ties all other journeys together; first specification pilot |
| P0-3 | Quotes, invoices, issued commercial records | KEEP | Required (quote OR invoice) | Required | Core revenue loop and public customer handoff |
| P0-4 | Offline/manual payment, balance and auditable financial posting | KEEP | Required | Required | Accurate money without paid provider dependency; full accounting extras separate |
| P0-5 | Customer-facing quote/invoice link, receipt/visible result | KEEP | Conditional on journey | Required | Public experience and correct result state; no new checkout provider needed initially |
| P0-6 | Existing operational cockpit / navigation / business status | MERGE | Minimal route and result | Required | Display what matters without broad visual redesign or AI-only actions |
| P0-7 | Existing business profile, configuration, local currency/timezone | KEEP | Minimal setup | Required | TTD/Caribbean context; do not expand to full corporate registration workflow |
| P1-1 | Bookings, services, availability and calendar | KEEP | Not required | Next product slice | Original onboarding wedge and real time/people flow; prove after money path |
| P1-2 | KEY Command for authorized read/summarize/draft | KEEP (bounded) | Optional | Optional additive | AI may add value, but manual product must run without AI or paid API |
| P1-3 | Basic event history, status feed and rule-driven playbooks | MERGE | Minimal evidence only | Limited flows | Preserve event/state semantics; a general visual flow editor is not a launch gate |
| P1-4 | Storefront/public business presence | MERGE | Public commercial artifacts only | Minimal public presence | Reuse customer-facing pages; sophisticated site builder deferred |
| P2-1 | Contact AI intelligence, relationship graph, segmentation and campaigns | DEFER | No | Later | Preserve CRM data integrity; enhance after Contact CRUD and invoicing are proven |
| P2-2 | Bank feeds, tax engine, reconciliation UI, advanced accounting, payroll | DEFER | No | Later | Double-entry correctness for payment remains core; advanced finance not first release |
| P2-3 | Omnichannel inbox, social publishing, marketing automation | DEFER | No | Later | External connector costs, approvals, consent and provider effects need separate proof |
| P2-4 | Project management, time tracking, operations, SOPs | DEFER | No | Later | Valuable long-term system; do not make core transaction path depend on it |
| P2-5 | Team hierarchy, HR, delegation, recruitment, procurement | DEFER | No | Later | Preserve concepts but avoid HR/organizational scope expansion |
| P2-6 | Connector Fabric, browser/device bridges, plugin marketplace | DEFER | No | Later | Existing integration owner to be assessed, not rebuilt or made prerequisite |
| P2-7 | Autonomous KEY worker, voice, reflective/cognitive simulators, model learning | DEFER | No | Later | Strong future vision; governed read-only KEY can be added independently |
| P2-8 | Community, creator marketplace, gamification enhancements | DEFER | No | Later | Growth loop after retention and basic customer usefulness |
| D-1 | Parallel execution authorities/tool registries, unused API adapters | CUT FROM V1 DESIGN pending proof | No | No new duplicate implementations | ADR-0001 favors Flow as execution authority; removing legacy source code requires reachability proof |
| D-2 | Competing global AI entry points and oversized dashboards | MERGE in user-facing design | No redesign | Small corrective UX only | Consolidate toward one visible KEY entry point, without altering existing behavior blindly |

## Release 0 non-negotiables

Issue #186 remains authoritative as release *target*: signup/login and tenant-scoped business; contact CRUD; quote OR invoice; manual payment; visible persisted outcome; denial of cross-tenant access; no essential paid provider dependency. Staging and exact-head proof are needed before a release claim.

## Preservation of full vision

Defer does not mean never. The future-platform backlog retains all features with their source links, priority hypotheses and semantic owners. No historical PR is closed or source deleted by this scope table.

## Contradictions / admission questions

1. Original May 2026 four-surface navigation (Cockpit/Workspaces/Studio/Public) differs from later shipped Cockpit/KEY/Operate/Build/Me rail. Preserve shipped routes now; choose canonical navigational labels after current UX tests.
2. Early KEYFLOW v3 favors tRPC and event-only cross-module communication; current APP_SPEC says REST drives web and synchronous financial changes must preserve transaction boundaries. Do not introduce an API rewrite or async-only financial event path.
3. Original blueprint defers the visual builder; later KEY Cortex PRs claimed a built Flow Studio. Release 0 neither needs nor deletes it.
4. Claims of 287 tools, 441 models, etc. are historical inventory at document vintage, not readiness; current tests and reachability determine release credit.
5. KEY cognition and development-system research are separate workstreams, not prerequisites for v1 core.
