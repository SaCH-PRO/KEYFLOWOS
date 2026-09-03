# KeyFlowOS Decision Register

Status: INITIAL CANONICAL REGISTER

Material architectural/product/methodological decisions belong here. Rejected alternatives should be preserved when known.

---

## KF-DEC-001 — Externalize analytical intelligence from chat

**Status:** ACCEPTED

**Decision:** Conversations are temporary working memory. Durable KeyFlowOS understanding must be written into version-controlled repository files.

**Rationale:** Chat length and retrieval limits must not cause loss of accepted work or force future agents to reconstruct architectural history from memory.

**Consequence:** A substantial analytical cycle is incomplete until canonical files, current state, handoff, and session journal are updated.

---

## KF-DEC-002 — Use GitHub repository as canonical intelligence store

**Status:** ACCEPTED

**Decision:** `docs/intelligence/` in the KeyFlowOS repository is the canonical shared memory for ChatGPT, Claude Code, Kimi Code, other agents, and human collaborators.

**Rationale:** Version control provides explicit files, history, diffability, reversibility, and cross-agent access.

**Consequence:** ChatGPT Project sources may mirror canonical material but are not the sole source of truth.

---

## KF-DEC-003 — Analyse KeyFlowOS macroscopically before microscopic modelling

**Status:** ACCEPTED / COMPLETED PHASE

**Decision:** Build and refine the system-level model first, then proceed into microscopic causal journeys.

**Rationale:** Local code analysis without a system model risks optimizing or documenting components without understanding their role in the whole operating system.

---

## KF-DEC-004 — Microscopic modelling should be journey-based and computable

**Status:** ACCEPTED

**Decision:** The microscopic model should trace causal end-to-end business journeys rather than merely documenting modules in isolation.

**Rationale:** KeyFlowOS's value and complexity arise from cross-domain state transitions, intelligence, governance, and automation.

---

## KF-DEC-005 — First microscopic journey is Business Birth

**Status:** ACCEPTED

**Decision:** Begin the microscopic programme with `KF-JOURNEY-001 — Business Birth`.

**Rationale:** Business Birth establishes identity, initial business state, foundational knowledge, readiness, and the context upon which downstream journeys depend.

---

## KF-DEC-006 — Business Genome is living operating DNA

**Status:** ACCEPTED DIRECTION

**Decision:** The Business Genome is not a one-time onboarding profile. It is a living, evidence-backed operating understanding of the business.

**Consequence:** Genome lifecycle, evidence, scoring, decay, readiness, and evolution require dedicated microscopic validation.

---

## KF-DEC-007 — Blueprint and Genome are not synonyms

**Status:** ACCEPTED

**Decision:** Treat the Business Blueprint as structured business facts and the Business Genome as the wider evidence-backed/scored interpretation unless future evidence justifies a revised canonical distinction.

---

## KF-DEC-008 — KEY creates intelligence, not unchecked authority

**Status:** ACCEPTED

**Decision:** KEY's execution authority must be bounded by business context, evidence, permissions, readiness, governance, and risk.

**Consequence:** Microscopic analyses must track not only what KEY can technically do, but what KEY is legitimately authorized to do at each state.

---

## KF-DEC-009 — Isolation is build strategy; integration is product outcome

**Status:** ACCEPTED

**Decision:** Modular isolation remains valuable for implementation and testing, but controlled synchronous coupling is permitted where a critical user experience requires immediate cross-domain orchestration.

**Rationale:** Architectural dogma must not break essential user flows.

---

## KF-DEC-010 — Preserve evidence, interpretation, and decision separately

**Status:** ACCEPTED

**Decision:** Repository/source/runtime evidence must remain distinguishable from analyst interpretation and from accepted architectural decisions.

**Consequence:** A repository observation cannot silently become canonical architecture without analysis and acceptance.

---

## KF-DEC-011 — Do not fabricate continuity gaps

**Status:** ACCEPTED

**Decision:** If prior-thread details cannot be reliably recovered, record the gap and proceed only through explicit re-acceptance or later recovery.

**Current application:** the exact previously proposed `KF-JOURNEY-002+` sequence remains unrecovered and will not be recreated as though it were historical fact.
