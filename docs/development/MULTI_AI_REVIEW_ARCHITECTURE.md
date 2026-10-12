# Multi-AI development and review architecture

Status: PROPOSAL for independent review. Nothing here is implemented or in
force. Operator directive of 2026-10-12. Read from `main` `98ee0202`.

This document does four things: says what already exists and what is missing,
gives the smallest design that puts GPT-6 review into the existing control
plane, specifies the review evidence record and the gate that reads it, and
lists the bounded packets that would build it. It adds to
`AGENT_CONTROL_PLANE.md`; it does not replace it and it defines no second
control plane.

## 1. Roles

| Role | Does | Does not |
|---|---|---|
| Claude Code | implementation, local execution, tests, corrections, the evidence manifest | review its own change; merge or deploy without authority |
| GPT-6 / ChatGPT | independent architecture, security and semantic review | implement the change it reviews |
| KEY | progressively: evidence collection, task coordination, reconciliation | hold authority; decide a merge or a release |
| Deterministic tooling | tests, static analysis, CI, security checks, negative controls | stand in for a semantic review |
| Operator | final authority for sensitive changes and production releases | — |

Kimi Code has no role. See section 7.

A review is called independent only when its provenance, its inputs, the
reviewer's identity and the exact commit are recorded (section 4). A second
session of the implementer's own model is evidence, never an independent
review.

## 2. What exists and what is missing

### Reused as it is

| Need | Existing mechanism |
|---|---|
| One parser for control messages, sender and author allowlist, edit detection | `scripts/agent-control/lib/control-envelope.mjs` |
| Review verdict bound to an exact commit | `lib/semantic-review.mjs`: `reviewed_head` must be the source head, the PR head, or a commit followed only by control files |
| A semantic change invalidates the review | path rule: any file outside `.agent-control/` after `source_head` fails `non_control_tail`; advancing `source_head` fails `reviewed_head_is_not_the_admitted_semantics` |
| Review outcome vocabulary | `PASS`, `NOT_RUN`, `CHANGES_REQUIRED`; `unresolved_substantive_findings` |
| Self-review is rejected | `semantic-review.mjs` implementer/reviewer check |
| Findings send work back | REVIEW with `control_effect: PACKET_CORRECTION` |
| Builder evidence | `.agent-control/claude-return.yaml`, `negative-controls.yaml`, `proof-mutation.mjs`, `lib/return-evidence.mjs` |
| Admission and merge | `lib/admission.mjs`, `auto-merge-admitted.mjs`, evaluated twice, merge pinned to the head |
| Lineage of authority | `lib/authority-effects.mjs` reducer, `lib/reconcile.mjs`, `status.mjs` |
| Merge record | `lib/merge-record.mjs` AUTO_MERGE comment |

### Missing

| # | Gap | Consequence today |
|---|---|---|
| G1 | The provider table makes Copilot primary and ChatGPT a fallback that counts only when Copilot is `PASS` or `NOT_RUN` | the approved independent reviewer is second in line behind a tool with a quota |
| G2 | No reviewer model, version, interface or operator recorded | "ChatGPT reviewed it" cannot be distinguished from "the owner account posted it" |
| G3 | Nothing builds a review package | the reviewer sees whatever it is handed; inputs are unrecorded |
| G4 | No risk classification; the only discriminator is the `impl/` branch prefix | an auth change and a typo get the same rule, and `fix/` and `docs/` branches get none |
| G5 | No durable record of which review covered which commit | the record lives in a per-PR file that the next packet replaces |
| G6 | ChatGPT has no identity of its own; its messages arrive through the owner account | the allowlist is an owner-account boundary, as `AGENT_AUTOPILOT.md` already says |
| G7 | No private review path | a security review cannot be recorded on a public issue |
| G8 | `ACCEPT_FOR_ADMISSION` is treated as `READY_TO_MERGE` | leaving draft is in effect the merge (open finding F9) |
| G9 | No external reviewer is ever invoked; both reviewer adapters return `WAITING_EXTERNAL_AGENT` | review is requested and transcribed by hand |
| G10 | No "KEY" role in the control plane | orchestration is ChatGPT plus the GitHub autopilot; `orchestrate.mjs --apply` is never run |
| G11 | The review verdict in `claude-return.yaml` is transcribed by the implementer | the independent anchor is only the live comment it cites |

## 3. Minimal integration design

Six additions, each to an existing file or beside one. No new workflow engine,
no new state store, no new authority type.

**3.1 Review class (new `lib/review-class.mjs`).** A pure function from the
changed paths of `source_main..source_head` to one of three classes; the
highest class any path earns wins.

- `critical`: authentication and session (`apps/server/src/core/auth/**`),
  tenant isolation (`core/tenant/**`, `packages/db/src/client.ts`,
  `packages/db/src/middleware/**`), payments and money movement
  (`modules/payments/**`, payment and invoice routes), deletion and trash,
  agent execution (KEY executor, planner, autonomy, approval), database
  migrations, and infrastructure (`.github/workflows/**`,
  `scripts/agent-control/**`, `scripts/deploy.sh`, `infrastructure/**`,
  compose files, Dockerfiles).
- `lightweight`: every changed path is documentation (`**/*.md`, `docs/**`)
  and none is a control document that code reads.
- `standard`: everything else.

The path lists live in one tracked file with a shrink-proof test: a path can be
added to `critical` freely, and removed only with a negative control showing
what then stops being protected. The class is computed by the gate, never
declared by the builder.

**3.2 Review package (new `build-review-package.mjs`).** Given a PR head, writes
a directory and a manifest: the diff, every changed file in full at the head,
the surrounding files the class requires (for `critical`: the guards,
interceptors and data-layer extension on the request path), the builder's
return artifact, proof output, and the review request with the claimed
properties. Code is extracted with `git show <sha>:<path>`. The manifest lists
every file with its SHA-256; the package hash is the SHA-256 of the manifest.
The package is immutable: a new head is a new package.

**3.3 Review evidence record (schema in section 4).** The reviewer's verdict.
For public work it is committed under `.agent-control/reviews/<head>.yaml` (a
control path, so it does not invalidate itself) and announced by the existing
REVIEW comment on the control issue, which gains four one-line fields:
`review_package_sha256`, `reviewer_identity`, `review_class`, `operated_by`.
The existing three (`reviewed_head`, `semantic_review_outcome`,
`unresolved_substantive_findings`) are unchanged.

**3.4 Judge (extend `lib/semantic-review.mjs`).** The provider table gains a
role per class instead of one global order:

| class | counts as the independent review | Copilot |
|---|---|---|
| critical | a GPT-6 record with full provenance, bound to the head and the package | advisory only; never sufficient |
| standard | a GPT-6 record; or, as today, Copilot `PASS` with every finding dispositioned | sufficient |
| lightweight | none required; deterministic checks and a proof that only documentation changed | not required |

Everything else in the judge stays: head binding, live-evidence equality,
self-review rejection, contradiction rules.

**3.5 Merge.** `critical` is never merged by the autopilot: the evaluator
returns a new not-eligible reason and the operator merges at the printed head
after the review passes. `standard` and `lightweight` keep today's path. G8 is
closed in the same change: `ACCEPT_FOR_ADMISSION` stops being merge-eligible.

**3.6 Lineage.** The AUTO_MERGE record, and its operator-merge equivalent,
gain `review_class`, `reviewed_head`, `review_package_sha256` and
`review_evidence`. The reducer already folds the control issue; `status.mjs`
then shows, per merged commit, which review covered it. No new ledger.

**Private track.** For an unpublished security change nothing above is posted
publicly. The package is handed to the reviewer directly, the record is stored
with the private advisory, and the control issue carries at most a line saying
a private review exists. When the advisory is published the record is committed
like any other.

**How GPT-6 is reached.** First by the operator: package in, record out. That
is the honest description of G6 and G9 today, and the `operated_by` and
`session_reference` fields exist to say so. A direct API adapter, with its own
credential and its own GitHub identity, is a later packet and an operator
decision (secrets, cost, and what the reviewer may read).

**KEY.** KEY takes work in this order and holds authority at none of them:
(1) read-only: run `status.mjs --verify --json` and the stale-gate report and
present them; (2) evidence collection: build review packages and assemble
proof output; (3) coordination: propose the next legal action from the
reconciler; (4) reconciliation: record lineage. Every step writes through the
existing envelope as a non-authority sender. KEY never posts `sender: chatgpt`.

## 4. Review evidence schema (`keyflow.review-evidence/v1`)

```yaml
schema: keyflow.review-evidence/v1
review:
  packet_id: ""                 # or advisory id on the private track
  pr_number: 0
  reviewed_commit: ""           # 40 hex
  source_main: ""               # 40 hex
  review_class: critical        # critical | standard | lightweight — must equal the computed class
  review_package_sha256: ""     # must equal the package built for reviewed_commit
reviewer:
  identity: ""                  # model and version as the product reports it
  provider: ""
  interface: ""                 # conversation | api
  session_reference: ""         # retrievable by the operator
  operated_by: ""               # GitHub login of the human who ran it; "none" for an API run
  is_author_of_change: false
  shares_context_with_author: false
provenance:
  inputs: []                    # the package, and anything else, listed
  inputs_outside_package: []
  executed_anything: false
  started_at: ""
  finished_at: ""
properties:                     # one entry per property claimed in the review request
  - id: P1
    result: pass                # pass | fail | not_assessed
    basis: ""
findings:
  - id: F1
    severity: high              # critical | high | medium | low | info
    property: P1
    location: path:line
    evidence: ""
    reproduction: ""
    established_by: reading     # reading | execution
    confidence: high            # high | medium | low
    smallest_fix: ""
    blocks_release: true
verdict:
  decision: APPROVE             # APPROVE | APPROVE_WITH_CONDITIONS | REJECT | INSUFFICIENT_EVIDENCE
  conditions: []
  statement: ""
```

Mapping to the existing vocabulary: `APPROVE` and `APPROVE_WITH_CONDITIONS`
with no open condition are `semantic_review_outcome: PASS`; `REJECT` is
`CHANGES_REQUIRED`; `INSUFFICIENT_EVIDENCE` is neither and blocks.
`unresolved_substantive_findings` is the count of findings with
`blocks_release: true`.

## 5. Gate specification

The evaluator refuses, with the named reason, when any rule fails. Rules R1–R4
are today's; the rest are new.

| # | Rule | Reason code |
|---|---|---|
| R1 | the record's `reviewed_commit` is the source head, the PR head, or followed only by control files | `reviewed_head_is_not_the_admitted_semantics` |
| R2 | the reviewer is not the implementer | `self_review` |
| R3 | the live REVIEW comment is unedited, from an allowlisted author, and its fields equal the record | existing live-binding codes |
| R4 | no blocking finding is open | `unresolved_substantive_findings` |
| R5 | `review_class` equals the class computed from the changed paths | `review_class_mismatch` |
| R6 | the class's required reviewer supplied the passing record | `reviewer_insufficient_for_class` |
| R7 | `review_package_sha256` equals the hash of the package rebuilt at `reviewed_commit` | `review_package_mismatch` |
| R8 | `reviewer.identity`, `provider`, `interface`, `session_reference`, `operated_by` are present and non-empty | `review_provenance_incomplete` |
| R9 | `is_author_of_change` and `shares_context_with_author` are both false | `reviewer_not_independent` |
| R10 | every property in the review request has a result, and none is `fail`; for `critical`, none is `not_assessed` | `property_not_established` |
| R11 | `verdict.decision` is `APPROVE`, or `APPROVE_WITH_CONDITIONS` with every condition recorded as met by a later control message | `verdict_not_approving` |
| R12 | for `critical`, the merge is requested by the operator path, not the autopilot | `critical_requires_operator_merge` |
| R13 | for `lightweight`, every changed path matches the documentation list | `not_documentation_only` |

Every rule gets a negative control in `negative-controls.yaml` that removes it
and shows a proof failing, and the provider table keeps its existing test that
an unapproved provider is refused.

What the gate cannot establish, stated so nobody reads more into a green
result: that the record was produced by the model it names. Until the reviewer
has its own credential and identity, R8 records a claim made through the owner
account. The gate checks that the claim is complete and bound to a commit and a
package; it does not authenticate the reviewer.

## 6. Implementation plan

Each packet is a normal branch and pull request under today's gates, reviewed
before the next starts. None changes merge behaviour until P4.

| Packet | Scope | Tests and acceptance |
|---|---|---|
| P1 review class | `lib/review-class.mjs`, the tracked path list, `status.mjs` prints the class per open PR. Report-only. | unit tests over real paths from merged PRs; a control proving a `core/auth` path cannot classify below `critical`; no gate reads it yet |
| P2 review package | `build-review-package.mjs` and the manifest schema | building twice at one head gives one hash; changing one byte of one included file changes it; a file missing at the head fails the build |
| P3 evidence record | the schema, a validator in `lib/`, the four new REVIEW fields parsed by `control-envelope.mjs` | valid and invalid fixtures per rule R5–R11; existing envelope tests unchanged |
| P4 judge and gate | `semantic-review.mjs` roles by class, R5–R13 in `admission.mjs`, `ACCEPT_FOR_ADMISSION` no longer merge-eligible | one negative control per rule; the existing 193 controls still live; a dry sweep over every open PR showing the decision before and after |
| P5 lineage | review fields on the merge record; `status.mjs` shows review coverage per merged commit | the recorder's exact-content rule still holds; a merged commit with no review record is reported |
| P6 Kimi removal | section 7 | the two tests that refuse a `kimi` provider and sender stay and pass |
| P7 KEY, read-only | KEY presents `status --verify` and the stale-gate report | KEY posts nothing; a test that its sender is never an authority sender |
| later | API adapter and a distinct reviewer identity | operator decision first |

Order: P6 and P1 can start at once; P2 and P3 next; P4 only after P1–P3 are
merged and a dry sweep has been reviewed; P5 after P4.

## 7. Kimi Code removal

Kimi Code is removed from the development and review architecture. Historical
records are kept.

To change (current-architecture documents and development tooling):
`AGENTS.md`, `docs/development/EXECUTION_CONTROL_STANDARD.md`,
`docs/development/KEYFLOWOS_AUTONOMOUS_AGENT_ROLES.md`,
`docs/development/KEYFLOWOS_PLATFORM_CONVERGENCE_PROGRAMME.md`,
`docs/development/KEYFLOWOS_PLATFORM_DAG.yaml` (`optional_secondary_prover`),
and the Kimi extension keys in `.vscode/settings.json`.

To keep: the tests and the negative control that prove a `kimi` provider or
sender is refused — they are what enforces the removal; and every historical
audit report, plan and specification that names Kimi as its author or
addressee.

Not decided here: the product's AI model gateway also lists Kimi as a
selectable model provider for customers' own AI features. That is a product
capability, not a development agent. Removing it is a separate product
decision and is not part of this change.

## 8. Decisions needed

1. Whether `critical` changes are always operator-merged (R12), or may be
   autopilot-merged once a GPT-6 record passes.
2. Whether Copilot `PASS` remains sufficient for `standard`.
3. Whether the product's Kimi model provider stays (section 7).
4. Whether and when GPT-6 gets its own credential and identity.
