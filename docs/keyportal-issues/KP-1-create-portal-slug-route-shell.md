# KP-1: Create `/portal/[slug]` route shell

## Milestone
Milestone 1: Portal Foundation

## Labels
`keyportal`, `frontend`, `routes`, `foundation`

## Description
Establish the new canonical public route for KEYPORTAL. This route will eventually replace `/book/[slug]` as the primary customer-facing surface. For this issue, focus only on the route shell, layout, and basic metadata. Do not implement catalog rendering or checkout yet.

## Acceptance Criteria
- [ ] New directory `apps/web/src/app/portal/[slug]/` exists.
- [ ] `layout.tsx` fetches business by slug and sets page metadata.
- [ ] `page.tsx` renders a shell page (can be placeholder text/business name).
- [ ] `error.tsx` and `loading.tsx` exist.
- [ ] Route is reachable at `http://localhost:5000/portal/{business-slug}`.
- [ ] Legacy `/book/[slug]` remains fully functional and unchanged.
- [ ] Mobile-first CSS structure is in place.

## Related PR
PR 1: Portal Route Foundation

## Dependencies
None
