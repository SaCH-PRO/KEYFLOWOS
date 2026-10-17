> **Publication update:** root verified the source findings and posted [review5559896104 on #169](https://github.com/SaCH-PRO/KEYFLOWOS/pull/169#pullrequestreview-5559896104) and [review5559896456 on #175](https://github.com/SaCH-PRO/KEYFLOWOS/pull/175#pullrequestreview-5559896456). Both are GitHub COMMENT events carrying CHANGES_REQUIRED, at the exact heads below. The original preparation report follows unchanged; its unposted wording describes preparation, not the subsequent publication. Raw fetched reviews are in `posted-worker-reviews.json`.

# PR #169 and PR #175 — exact-head worker reliability review

**Review state: PROVING. Health: YELLOW / FRICTION. Recommendation: CHANGES_REQUIRED for both reviewed heads.**

This is a local independent review report for root to verify and publish. It is not a posted review, admission, merge authorization, or installation record. Heads were revalidated at approximately **2026-10-17 20:16 UTC**. No remote writes, tracked-source changes, worker actions, or installation were performed.

## Reviewed revisions and scope

| Item | PR #169 | PR #175 |
|---|---|---|
| PR | [169](https://github.com/SaCH-PRO/KEYFLOWOS/pull/169) | [175](https://github.com/SaCH-PRO/KEYFLOWOS/pull/175) |
| Semantic/artifact head | `7aa3c1910075a02287b0815867026a500187594f` | `09d00c3e03af1d31b2e4df93aaa4cf062718f4ec` |
| Branch | `fix/agent-control-worker-worktree-path-001` | `fix/agent-control-worker-coordination-001` |
| Base | `main`; fork snapshot `7d2619c771cd008f21bae9c60ca348e3deaa07cd` | PR #169 branch at `7aa3c1910075a02287b0815867026a500187594f` |
| State observed | Open, draft, unmerged | Open, draft, unmerged |
| Change scope | Worktree path budget, retry reuse, counted worktree failure | Machine lock, process ownership, bounded network and other pre-wake failures |

Live main was verified as `98ee0202499ba87fa4ee13d58a2a9075016225bd`. These `fix/*` PRs have no separate per-PR packet artifact commits. Their listed heads carry the reviewed semantics. This report does not certify current-main integration.

## Finding KF169-P2-01 — shortened-name collisions reuse a different directive's worktree

**Priority: P2. Introduced in PR #169.**

The worker truncates SHA-256 to four bytes, then treats that tag plus a directory-name prefix as directive ownership. The following distinct, valid IDs both hash to tag `86c85112`:

```text
CG-DIRECTIVE-LONG-PACKET-NAME-LONG-PACKET-NAME-INTEGRATION-CORRECTION-081631
CG-DIRECTIVE-LONG-PACKET-NAME-LONG-PACKET-NAME-INTEGRATION-CORRECTION-095457
```

With 32 characters available, both map to `CG-DIRECTIVE-LONG-PACKE-86c85112`. Full IDs, digests, expected name, and the executed calculation are retained in `collision-fixture.json`.

Exact-head source anchors in `scripts/agent-control/claude-worker.ps1`:

- [485–489: truncated tag](https://github.com/SaCH-PRO/KEYFLOWOS/blob/7aa3c1910075a02287b0815867026a500187594f/scripts/agent-control/claude-worker.ps1#L485-L489).
- [515–527: tag/prefix match accepted as prior worktree](https://github.com/SaCH-PRO/KEYFLOWOS/blob/7aa3c1910075a02287b0815867026a500187594f/scripts/agent-control/claude-worker.ps1#L515-L527).
- [437–443: registration checks only repository path](https://github.com/SaCH-PRO/KEYFLOWOS/blob/7aa3c1910075a02287b0815867026a500187594f/scripts/agent-control/claude-worker.ps1#L437-L443).
- [545–559: existing tree reused without full directive ownership or base resolution](https://github.com/SaCH-PRO/KEYFLOWOS/blob/7aa3c1910075a02287b0815867026a500187594f/scripts/agent-control/claude-worker.ps1#L545-L559).
- [655–660: Claude invoked in accepted directory](https://github.com/SaCH-PRO/KEYFLOWOS/blob/7aa3c1910075a02287b0815867026a500187594f/scripts/agent-control/claude-worker.ps1#L655-L660).
- [574–580: dirty/unpushed work retained](https://github.com/SaCH-PRO/KEYFLOWOS/blob/7aa3c1910075a02287b0815867026a500187594f/scripts/agent-control/claude-worker.ps1#L574-L580); [751–764: cleanup occurs only after successful completion](https://github.com/SaCH-PRO/KEYFLOWOS/blob/7aa3c1910075a02287b0815867026a500187594f/scripts/agent-control/claude-worker.ps1#L751-L764).

Consequently, if the first directive leaves partial work, the second can be woken in that same tree. The prompt's request to validate main is not an enforced ownership check. This is distinct from the acknowledged pre-existing normalization collisions in whole-ID directory names.

**Correction acceptance:** Bind shortened-worktree ownership to the complete raw ID or full digest. A colliding different ID must get a distinct tree or a counted refusal without waking Claude in the first tree. Add the two fixture IDs as a deterministic regression with retained partial work. Preserve retry reuse after longest-path changes, whole-ID compatibility, and ambiguous-match refusal.

**Proof boundary:** The review agent independently executed SHA-256 and name computation in Node. The reuse and invocation chain was confirmed by source inspection. No Windows worker tick or collision integration test was executed locally.

## Finding KF175-P2-01 — mutex failure reopens stale-lock reclamation race

**Priority: P2. Introduced in PR #175. Conditional on unavailable/timed-out acquisition mutex.**

At [worker lines 519–530](https://github.com/SaCH-PRO/KEYFLOWOS/blob/09d00c3e03af1d31b2e4df93aaa4cf062718f4ec/scripts/agent-control/claude-worker.ps1#L519-L530), both a mutex construction/acquisition exception and `WaitOne(30000)` returning false still enter the stale-owner read/remove/create loop. No guard requires `$owned` before reclamation.

Allowed interleaving:

1. Two workers from different checkouts read the same stale machine lock.
2. A deletes the stale file and creates its fresh lock, returning success.
3. B performs its already-decided unconditional deletion, removing A's fresh lock.
4. B creates its lock and also returns success.

`CreateNew` protects file creation, not the preceding stale-read/delete sequence. The code comment at lines 511–515 recognizes this race but assumes atomic creation is sufficient if the mutex is refused. Checkout locks do not exclude workers in separate checkouts.

The [existing four-starter test, lines 264–296](https://github.com/SaCH-PRO/KEYFLOWOS/blob/09d00c3e03af1d31b2e4df93aaa4cf062718f4ec/scripts/agent-control/tests/windows/worker-lock.spec.mjs#L264-L296) uses normal mutex acquisition and does not force these branches.

**Correction acceptance:** Fail closed when the acquisition mutex is not acquired, or protect the complete read/reclaim/create transaction by another mechanism. Prove constructor/acquisition failure and timeout cause no unsafe reclamation or wake. Preserve normal concurrent-start and stale-owner reclamation proofs.

**Proof boundary:** Exact source control flow plus deterministic interleaving analysis. No local Windows contention reproduction, injected mutex-failure run, or observed installed-worker failure is claimed.

## Existing review and scope records

No independent semantic review was found in the inspected PR or #80 records before this review. Current-head Copilot reviews report quota exhaustion, hence **NOT_RUN**:

- [PR #169 review 5484329501](https://github.com/SaCH-PRO/KEYFLOWOS/pull/169#pullrequestreview-5484329501).
- [PR #175 review 5484828496](https://github.com/SaCH-PRO/KEYFLOWOS/pull/175#pullrequestreview-5484828496).

PR #169's [older Claude review](https://github.com/SaCH-PRO/KEYFLOWOS/pull/169#issuecomment-6111375923) explicitly was non-independent and covered `2d012625`. Its retry-name should-fix was addressed at `7aa3c191`; the [correction](https://github.com/SaCH-PRO/KEYFLOWOS/pull/169#issuecomment-6111981335) and [review packet](https://github.com/SaCH-PRO/KEYFLOWOS/pull/169#issuecomment-6112655766) say the revised head still lacked independent review. Do not apply that old review to the revised head.

The [#80 META-003 RETURN](https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6112456137) and [META-004 progress](https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6113926596) establish the split: PR #169 handles path/retry failures; PR #175 handles cross-checkout locking and persistent network/other pre-wake failures. The latter are not duplicate new findings against #169. The inspected full #80 snapshot had 1,436 comments through 20:01:38 UTC; root reported no new #169/#175 authority through 20:10:57 UTC.

## Hosted proof actually inspected

| Proof | PR #169 | PR #175 |
|---|---:|---:|
| Windows tests | 510 pass, 0 fail, 1 skip / 511 | 526 pass, 0 fail, 1 skip / 527 |
| Windows live negative controls | 188 / 188 | 204 / 204 |
| Ubuntu portable tests | 477 pass, 0 fail, 1 skip / 478 | 477 pass, 0 fail, 1 skip / 478 |
| Node | 20.18.1 | 20.18.1 |

Actual job logs were read. The skipped case is the existing authenticated-`gh` test, **“the cursor makes directive processing idempotent.”** Do not substitute zero-skip local PR-body totals for these CI totals.

- [PR #169 Worker Proof 38161878707](https://github.com/SaCH-PRO/KEYFLOWOS/actions/runs/38161878707): Windows job `114536325860`, Ubuntu job `114536326056`.
- [PR #175 Worker Proof 38172351521](https://github.com/SaCH-PRO/KEYFLOWOS/actions/runs/38172351521): Windows job `114567418379`, Ubuntu job `114567418099`.

PR #169 had seven successful exact-head runs. Its control gate skipped artifact validation and ChatGPT admission as inapplicable; HawkScan skipped the scan steps. PR #175 had four successful exact-head runs and no main-target CI/CD or HawkScan run in that set because it targets the stacked branch. Green badges do not establish missing admission, scan execution, or current-main integration.

Local environment: Linux, no `pwsh` on PATH. No PowerShell installation, Windows suite bypass, or local full-suite claim was made.

## Remaining order and scope ledger

1. Fix and prove #169 shortened-tree ownership; review the revised head against current main and run applicable integration checks.
2. Integrate/review #175 on the accepted #169 revision, including the mutex failure path and its existing pre-wake/network obligations.
3. Merge in dependency order only after exact-head review and required checks.
4. Perform the separately controlled worker upgrade and post-upgrade verification. The first #175 upgrade must account for old workers holding no machine lock; its runbook requires stopping old workers before upgrade.

**Resolved:** Exact-head/history/CI preflight; source confirmation of the two findings; separation of old and new obligations. **Remaining:** Corrections, new-head review/proof, integration, merge, controlled upgrade, post-upgrade verification, durable checkpoint. **Deferred:** Local Windows execution, because unavailable here; hosted logs were inspected instead. **Dropped:** Nothing. **Superseded:** PR #169's original retry-name finding by its `7aa3c191` correction; original-head test counts by current-head hosted totals.
