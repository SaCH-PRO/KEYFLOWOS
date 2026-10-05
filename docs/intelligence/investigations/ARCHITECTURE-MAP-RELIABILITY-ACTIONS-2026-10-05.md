# Architecture map reliability follow-up
Date: 2026-10-05
Status: bounded evidence audit and proposed implementation specification; no runtime dispatch.
Companion: CONTROL-RECOVERY-PROCEDURAL-ACTION-PLAN-2026-10-05.md.

## Context and scope
Continue existing architecture memory; do not introduce a competing map system.
Uploaded continuity and reassessment instructions were read earlier in this analytical cycle.
Evidence baseline for main is 110532883411007787f62de35e0a951aa1c16cfa.
Existing docs/intelligence START-HERE still identifies checkpoint KFG-2026-09-17-01. Its age and divergent operational context require reconciliation, not automatic deletion of safety restrictions.
No whole-programme context-integrity PASS is claimed. This addendum does not replace the canonical handoff or allocate new recommendation IDs.

## Verified observations
1. AGENTS.md requires map-before-modifying and architecture updates after significant changes.
2. .agents/skills/codebase-architect/SKILL.md defines architecture maps, scanner workflows and confidence distinctions.
3. architecture/system-overview.md names databases, queues, storage, voice and external APIs.
4. architecture/execution-paths.md describes source files, routes, auth boundaries and side effects. These are documented claims; this tranche did not retrace every path.
5. architecture/data-ownership.yaml explicitly infers owner from most direct client references. Its generated 2026-09-21 snapshot records 441 models and 86 unassigned. These are snapshot counts, not a fresh schema inventory.
6. dependency_scan.py scans ts/tsx/js/jsx/mjs/cjs files, uses regex import extraction, labels @keyflow/ imports resolved without resolving their exported symbol/file, and does not inspect deployed resources or cloud policies. Its output is dependency evidence, not full runtime topology or semantic ownership.
7. Documentation exists in architecture/, architecture/os/ and docs/intelligence/. Clear routing and precedence must be verified; multiple directories alone are not proof of duplication.

## Proposed work, in dependency order
A. Entry-point reconciliation
Read current handoff, operating-layer rules, taxonomy and owner contracts before edits. Establish a concise route from AGENTS.md to current task context. Preserve historic checkpoints with explicit scope and supersession rather than rewriting history.
Acceptance: a new session can identify applicable revision, active scope, unresolved blockers and next legal action; conflicting evidence remains visible.

B. Evidence metadata
Extend existing map records with subject, evidence reference, verified revision, environment where applicable, verification method, confidence and known gaps. Distinguish documented intent, static observation and runtime verification.
Acceptance: a stale map remains useful history but cannot silently claim current runtime truth. Unknowns do not become false/absent.

C. Ownership
Retain generated usage statistics as evidence. Link reviewed semantic ownership to the existing canonical contract/decision and distinguish data owner, writer, reader and operational maintainer.
Acceptance: frequency of references never grants ownership or permission. Disagreements route to existing findings rather than new parallel concepts.

D. External dependency mapping
Choose one existing storage journey after checking canonical journey ownership. Trace caller -> adapter -> configuration reference -> logical resource -> deployment evidence -> access boundary -> data/effect identity -> retry/reconciliation -> monitoring/recovery.
Store configuration names and secret references only, never secret values. Mark deployed state unknown if read-only evidence is unavailable.
Acceptance: identify the affected resource and blast radius for a caller or permission change; test partial failure without live destructive effects.
Do not assume Azure is in KEYFLOWOS because it appeared in the supplied video.

E. Scanner assurance
Characterize representative static import, side-effect import, re-export, assigned require, dynamic import, alias and workspace export cases against the current scanner. Report unsupported forms explicitly before choosing targeted parser improvements.
Acceptance: expected fixture edges match output, unsupported dependencies are visible, repeated scans are reproducible. Static completeness is not runtime completeness.
Do not broaden active PR120 to carry scanner improvements.

F. Task context and change impact
Use existing packet/handoff machinery to supply relevant maps, authoritative contracts, revision bindings, invariants and unresolved issues for the task.
For architecture-affecting diffs, record affected maps and review their updates. Start checks in report-only mode to measure false positives before proposing admission enforcement.
Acceptance: missing required context is explicit; unchanged unrelated maps do not create ceremonial churn; a justified no-impact disposition remains reviewable.

## Initial verification matrix
- stale revision -> flagged, not silently refreshed;
- heuristic owner -> distinguish from reviewed owner;
- missing external permission evidence -> unknown;
- dependency outside scanner coverage -> explicit limitation;
- changed interface -> affected callers and map obligations;
- conflicting handoff -> scoped reconciliation, no inferred authority;
- artifact re-generation -> deterministic output and provenance;
- agent context -> relevant evidence references, not entire repository dumped into a prompt.

## Current PR120 boundary
At observation, PR120 head is 1a536eadf1f11c61cfd4f64c830a4c6c2a33570c, open draft, 24 commits ahead of main.
Worker PROGRESS-011 (5993537762) reports live branch status CONSISTENT at generation 87, ACTION-001 held, WAIT_AUTHORITY; local 448 passed/0 skipped and 157 live mutation controls. This tranche did not independently rerun those local results.
Latest observed autopilot event 5993550789 still reports REPORT_DRIFT. Thus branch recovery is not established as effective on the main-based control path.
Final artifact binding, final-head checks and review remain outstanding. No merge or release is authorized by this document.

## Exact next frontier
Audit canonical map-routing/ownership contracts and one existing external-storage journey; characterize scanner fixtures; then propose the smallest implementation diff under the existing packet system. Keep the mapping follow-up distinct from the bounded PR120 recovery.

## Evidence links
- https://github.com/SaCH-PRO/KEYFLOWOS/blob/110532883411007787f62de35e0a951aa1c16cfa/AGENTS.md
- https://github.com/SaCH-PRO/KEYFLOWOS/blob/110532883411007787f62de35e0a951aa1c16cfa/.agents/skills/codebase-architect/SKILL.md
- https://github.com/SaCH-PRO/KEYFLOWOS/blob/110532883411007787f62de35e0a951aa1c16cfa/.agents/skills/codebase-architect/scripts/dependency_scan.py
- https://github.com/SaCH-PRO/KEYFLOWOS/blob/110532883411007787f62de35e0a951aa1c16cfa/architecture/data-ownership.yaml
- https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-5993537762
- https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-5993550789
