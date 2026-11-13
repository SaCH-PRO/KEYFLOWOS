# Kimi Code Adversarial Review — KF-EXEC-EXTFX-001

Attack these cases independently:
1. provider accepts, DB write fails;
2. process dies after request but before response;
3. source content changes before retry;
4. two workers claim same delivery;
5. retry after Resend 24h idempotency window;
6. same idempotency key with changed payload;
7. cross-tenant delivery id probing;
8. provider success then campaign/contact/content repair fails;
9. stale Sending row;
10. legacy Failed/RetryPending with no provider evidence;
11. EventEmitter consumer throws;
12. transactional system email without idempotency input.

For every issue return exact file/function, failure sequence, violated invariant, and smallest correction. Do not broaden architecture unless this package cannot express the fix.
