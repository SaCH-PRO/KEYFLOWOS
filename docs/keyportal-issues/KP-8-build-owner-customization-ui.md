# KP-8: Build owner customization UI

## Milestone
Milestone 2: Portal Configuration

## Labels
`keyportal`, `frontend`, `dashboard`, `ui`

## Description
Create the owner-facing customization page at `/app/keyportal/customize`. This is where business owners personalize their portal without getting website-builder complexity.

## Acceptance Criteria
- [ ] Page exists at `apps/web/src/app/app/keyportal/customize/page.tsx`.
- [ ] Branding section: logo upload, cover image, brand color, accent color.
- [ ] Business info section: headline, subheadline, short description.
- [ ] Layout preset selector: Service-first, Store-first, Event-first, Hybrid, Minimal Professional.
- [ ] Section toggles and ordering for enabled sections.
- [ ] Featured item selector for service/product/event/promo.
- [ ] Primary CTA type and label selector.
- [ ] Form saves to `/keyportal/config` API.
- [ ] Shows loading/success/error states.

## Related PR
PR 4: Owner Customization UI

## Dependencies
KP-7
