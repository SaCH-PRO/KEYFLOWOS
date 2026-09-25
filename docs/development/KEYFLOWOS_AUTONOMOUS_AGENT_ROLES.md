# KEYFLOWOS Autonomous Agent Roles

This file defines responsibility boundaries for the platform/workflow convergence
programme. It does not replace issue #80 authority or the Execution Control Standard.

## Operating rule

**Claude writes. Copilot reviews. CI proves. ChatGPT admits. GitHub records.**

Kimi may independently challenge/prove work, but no required path depends on Kimi.

## ChatGPT
- owns architecture and canonical boundary decisions;
- chooses/authorizes packets through issue #80;
- resolves contradictions and scope changes;
- reviews exact-head RETURN evidence;
- alone grants READY_TO_MERGE under the agent-control protocol;
- performs post-merge verification/checkpoint decisions;
- never silently grants production effects.

## Claude Code
- runs only from the worker-selected dedicated worktree;
- ACKs before mutation;
- characterizes actual current main/branch before implementation;
- stays within the packet's declared semantic/file scope;
- implements, tests and documents;
- consumes Copilot review feedback;
- records each substantive Copilot finding as resolved or rejected-with-evidence;
- refreshes proof after any semantic push;
- emits RETURN only when scope/proof/review disposition is complete.

## GitHub Copilot
- automatic code reviewer on semantic PRs and pushes;
- reports likely defects, security smells, regressions, missing tests,
  maintainability/performance issues and API/dependency misuse;
- its substantive findings are admission inputs;
- may not change packet scope, architecture, safety constraints or merge authority;
- a Copilot review tied only to an older semantic head is stale after a semantic push.

## GitHub Actions / repository automation
- deterministic type/build/test/security/proof checks;
- exact-head admission and branch hygiene;
- event normalization and durable journal;
- auto-merge only after ChatGPT admission and all required exact-head gates.

## Kimi Code (optional)
- independent adversarial proof, forensics, test generation or non-overlapping packet work;
- cannot redefine architecture or self-approve semantic work.

## Human owner
Required only for the explicit human gates recorded in
KEYFLOWOS_PLATFORM_DAG.yaml. Ordinary implementation/review/merge mechanics
should proceed unattended once the relevant authority exists.

## Copilot disposition schema

Every semantic RETURN should be able to report:

```yaml
copilot_review:
  reviewed_head: <sha>
  findings_total: 0
  resolved: 0
  rejected_with_evidence: 0
  unresolved_substantive: 0
  stale_review_detected: false
```

A semantic push after `reviewed_head` invalidates the disposition until a new
review/reconciliation is obtained.

## Safety

No probabilistic reviewer (Claude, Copilot, Kimi or ChatGPT) replaces deterministic
proof. No deterministic green check replaces scope accounting or architectural
admission. Production mutation remains separately authorized.
