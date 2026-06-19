# KP-9: Preview mode

## Milestone
Milestone 2: Portal Configuration

## Labels
`keyportal`, `frontend`, `dashboard`, `ux`

## Description
Allow owners to preview their KEYPORTAL before publishing. Preview should render the portal using the draft config regardless of `status`.

## Acceptance Criteria
- [ ] "Preview" button on customize page opens `/portal/[slug]?preview=true`.
- [ ] Preview mode fetches the latest saved config, not requiring `PUBLISHED` status.
- [ ] A banner indicates "Preview Mode — only you can see this".
- [ ] Preview mode can be exited to return to customize page.
- [ ] Public visitors do not see preview mode.

## Related PR
PR 4: Owner Customization UI

## Dependencies
KP-8
