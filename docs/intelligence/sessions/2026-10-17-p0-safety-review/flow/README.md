# Flow authority characterization

These probes characterize two unresolved defects in unchanged main
`98ee0202499ba87fa4ee13d58a2a9075016225bd`. A successful run confirms the
recorded unsafe behavior; it is not a security PASS or implementation fix.

## Recorded evidence

- [flow-policy-probe-result.json](flow-policy-probe-result.json) contains all five selective policy-read cases, the ordinary/claimed-envelope decisions, the preserved business-policy denials, source SHA-256 hashes and runtime limits.
- [peer-review.md](peer-review.md) independently traces ingress, policy, tool selection and the conditional CRM soft-delete path. It also identifies the prior capability-map record for the envelope finding.
- [flow-policy-probes.cjs](flow-policy-probes.cjs) is the original source-executing harness, adapted only to take explicit checkout/dependency/output paths.

## Reproduction

Use a clean checkout of the exact main revision above and the isolated
dependency directory prepared by the [PR #155 reproduction](../pr155/README.md).
The original run used Node 24.19.0, TypeScript 5.9.3 and Nest common 11.1.19;
the recorded PR #155 dependency/runtime qualifications also apply here.

```bash
node flow-policy-probes.cjs /path/to/pinned-main /path/to/test-deps /path/to/output
```

The harness loads the actual oversight service, role engine, job-role policy,
registry and pure authority helpers. It supplies synthetic dependency-injection
tokens and database return values. It runs the exact AST-extracted
`selectToolsForRequest` method. Source method bodies and assertions are not
rewritten. The output directory receives `flow-policy-probe-result.json`.

Expected characterization includes five policy cases, allowance after a
selective typed-policy read failure with permissive legacy settings, and
allowance/menu inclusion for a forged role envelope under the synthetic
permissive business policy. A typed advisory policy, a business blocklist, both
reads failing and malformed legacy policy still deny the corresponding cases.

No provider, HTTP server, real database or contact deletion is exercised.
Tool selection and policy decisions are executed; the remainder of the CRM
effect chain is established by the source trace. This does not assert actual
production configuration, caller-induced database errors, cross-tenant access
or an observed exploit.

The harness's final SHA assertion identifies the checkout. Recorded source
hashes additionally identify the files actually loaded. Reproduce against a
clean checkout and compare those hashes; an altered checkout at the same HEAD
is not the original evidence.
