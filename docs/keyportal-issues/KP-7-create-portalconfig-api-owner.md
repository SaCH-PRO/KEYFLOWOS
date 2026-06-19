# KP-7: Create PortalConfig API (owner)

## Milestone
Milestone 2: Portal Configuration

## Labels
`keyportal`, `backend`, `api`, `config`

## Description
Build the authenticated API surface for owners to manage their KEYPORTAL configuration.

## Acceptance Criteria
- [ ] New `keyportal` module exists at `apps/server/src/modules/keyportal`.
- [ ] `GET /keyportal/config` returns the owner's current `PortalConfig`.
- [ ] `POST /keyportal/config` creates or updates the owner's `PortalConfig`.
- [ ] Validation enforces allowed `layoutType` values.
- [ ] Validation enforces allowed `status` values.
- [ ] Validation ensures `slug` is unique and URL-safe.
- [ ] Endpoints are scoped to the authenticated user's business.
- [ ] DTOs are created using Zod or class-validator.

## Related PR
PR 3: PortalConfig Schema & API

## Dependencies
KP-6
