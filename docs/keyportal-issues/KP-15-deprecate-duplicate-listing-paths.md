# KP-15: Deprecate duplicate product/service listing paths

## Milestone
Milestone 3: Unified Catalog

## Labels
`keyportal`, `backend`, `api`, `cleanup`

## Description
Mark older listing endpoints as deprecated once the catalog endpoint is in use. Do not remove them yet to avoid breaking external integrations.

## Acceptance Criteria
- [ ] Add `@Deprecated()` decorator or JSDoc to old endpoints.
- [ ] Update API docs/OpenAPI annotations.
- [ ] Add warning log when old endpoints are called.
- [ ] Frontend no longer calls deprecated endpoints for KEYPORTAL.
- [ ] Internal timeline documented for removal (target: post-MVP).

## Related PR
PR 5: Unified Catalog

## Dependencies
KP-14
