# KeyFlowOS Finding Register — Reversal Supplement

Status: CANONICAL CONTINUATION OF `08K-FINDING-REGISTER-RECOVERY-SUPPLEMENT.md`

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`
Current audit-only head: `168732d0e2226e11ed033c14fbdf7b3ea5344a41`

Canonical sequence continues after F159.

---

## F160 — Deleting a published SocialPost removes only local KeyFlow state while the provider post remains externally published

**Status:** VERIFIED CROSS-LAYER / REVERSAL-SEMANTICS FINDING

A social post may be published through `SocialPublishingService.publishToChannels()`, which invokes connected provider publishers and persists publication evidence including `publishResults`, `externalPostId`, `externalUrl`, `status=POSTED` and `postedAt`.

The live delete surface later calls:

```text
SocialService.deletePost(businessId, postId)
→ SocialPost.deletedAt = now
→ emit social_post.deleted
```

No provider deletion/unpublish operation is invoked by `deletePost()`.

The inspected `SocialPublishingService` exposes publish/list behavior but no provider delete/unpublish method. The current web social surface removes the local item and reports “Post deleted.”

For a previously published artifact, the possible truth is therefore:

```text
KeyFlow local truth: post deleted/hidden
provider truth: post remains publicly published
user-facing truth: “Post deleted”
```

Multi-platform publication makes this more consequential: one SocialPost can correspond to multiple provider artifacts, each of which may have a different reversal capability/outcome.

This is not the same as F152. F152 concerns saga compensation falsely claiming confirmed reversal. F160 concerns the ordinary product delete operation itself representing local deletion as if it were deletion of the published business effect.

Target law:

```text
LOCAL DELETE
!= PROVIDER DELETE
```

A published-effect delete must either:

1. execute and reconcile provider deletion for every relevant provider artifact;
2. explicitly state that it removes only the KeyFlow record; or
3. create provider-specific RecoveryEffect work and expose unresolved/failed/unavailable reversals truthfully.

Original publication evidence must remain available for recovery/audit even if the local object is hidden from normal product views.

Affected kernels: K6, K8, K9, K11.
Affected journeys: social/content journeys, J2, J6, J18, J23.

---

# Reversal law

```text
DELETE UX
must identify whether it means
LOCAL RECORD REMOVAL
or
EXTERNAL EFFECT REVERSAL
```

No production implementation is authorized by this supplement.
