---
kind: ledger
gate: apps/server/src/core/config/route-parity-ledger.spec.ts
writers: [burndown-cycle, audit-cycle]
---

# Route parity — client calls the server cannot answer

The web client's API paths are string literals with no contract to the
server's routes (`apps/web/src/lib/client.ts` + `apps/web/src/lib/api/*`).
The 2026-08-11 audit fixed 22 mismatched calls and classified the remaining
19; full history in `architecture/VERIFIED_STATE_2026-08-11.md` § "The web
client calls API paths that do not exist".

**A static path-comparison gate is deliberately not shipped**: it measured a
28% false-positive rate (client literals in `:param` positions), and a
disabled gate is worse than none. The enforcement mechanism for this ledger
is the runtime oracle — `node scripts/os/probe-routes.mjs` — where the
router itself resolves literal-vs-parameter ambiguity: **401 means the route
exists and wants a token, 404 means there is no such route.** Controls:
`/webhooks/health` → 200, junk path → 404. Probing settles GET only; a
POST-only route answers 404 to GET regardless.

## Ledger — known-absent endpoints (shrink-only)

Each row is a client call the server serves no endpoint for. These are
missing features, not wrong paths (each was probe-confirmed absent and
source-confirmed uncorrectable); building them is a product decision. A row
leaves when the endpoint ships or the client call is removed. Machine-read by
the gate; keep the table exactly: `| path | client source | recorded |`.

| path | client source | recorded |
|---|---|---|
| `/whatsapp/businesses/:id/status` | apps/web/src/app/app/key-connect/components/whatsapp/whatsapp-manage-drawer.tsx | 2026-08-11 |
| `/whatsapp/businesses/:id/conversations` | apps/web/src/app/app/key-connect/components/whatsapp/whatsapp-manage-drawer.tsx | 2026-08-11 |
| `/whatsapp/businesses/:id/conversations/:conversationId` | apps/web/src/app/app/key-connect/components/whatsapp/whatsapp-manage-drawer.tsx | 2026-08-11 |
| `/whatsapp/businesses/:id/templates` | apps/web/src/app/app/key-connect/components/whatsapp/whatsapp-manage-drawer.tsx | 2026-08-11 |
| `/whatsapp/businesses/:id/messages` | apps/web/src/app/app/key-connect/components/whatsapp/whatsapp-manage-drawer.tsx | 2026-08-11 |
| `/commerce/businesses/:id/recurring-invoices/:invoiceId/history` | apps/web/src/lib/client.ts | 2026-08-11 |

The five WhatsApp rows make the entire manage drawer inert — the server's
WhatsApp controller has only `config`, `send`, `test` and webhooks, and
`/messages` is not `/send` under another name (the client posts
`{to, body, scheduledAt}`; `/send` takes `{to, message}` with no scheduling).

## Not ledgered (context, awaiting re-derivation)

The other 13 of the classified 19: eleven were comparison artefacts (client
literal in a `:param` position — `/businesses/me/providers`,
`/businesses/system/templates`, the `${apiPrefix}/status` connector family —
all probe-confirmed 401/existing) and two are POST/PATCH-only, unprobeable by
GET. The itemized list lived in a session scratchpad and was lost; the audit
cycle re-derives candidates by extraction + probe rather than quoting this
paragraph. (Ledger paths above were re-derived from the client source on
2026-08-23, not copied from the snapshot.)
