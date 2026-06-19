# KP-5: SEO, metadata, and structured data

## Milestone
Milestone 1: Portal Foundation

## Labels
`keyportal`, `frontend`, `seo`, `foundation`

## Description
Ensure the KEYPORTAL route has proper metadata and structured data for search engines and social sharing.

## Acceptance Criteria
- [ ] `generateMetadata` in `layout.tsx` produces title: `"KEYPORTAL for {businessName}"`.
- [ ] Description is pulled from business profile or portal headline.
- [ ] OpenGraph tags include business logo and cover image.
- [ ] JSON-LD LocalBusiness structured data is rendered.
- [ ] Canonical URL points to `/portal/[slug]`.
- [ ] No duplicate metadata between `/portal` and `/book`.

## Related PR
PR 2: Portal Sub-Routes

## Dependencies
KP-1
