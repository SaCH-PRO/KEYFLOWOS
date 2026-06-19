# KP-10: Publish/unpublish state

## Milestone
Milestone 2: Portal Configuration

## Labels
`keyportal`, `backend`, `frontend`, `config`

## Description
Implement status control for the portal: `DRAFT`, `PUBLISHED`, `PAUSED`. The public route should respect this status.

## Acceptance Criteria
- [ ] `PATCH /keyportal/config/status` accepts `{ status: "DRAFT" | "PUBLISHED" | "PAUSED" }`.
- [ ] Only authenticated owner can update status.
- [ ] Public `/portal/[slug]` returns 404 when status is `DRAFT` or `PAUSED`.
- [ ] Public `/portal/[slug]` renders normally when status is `PUBLISHED`.
- [ ] Owner preview mode bypasses status check.
- [ ] UI shows clear publish/unpublish/pause actions.

## Related PR
PR 4: Owner Customization UI

## Dependencies
KP-8
