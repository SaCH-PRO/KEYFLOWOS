# Operator data-cleanup scripts (W10-DATA-CLEANUP-SCRIPTS)

Two one-off operator scripts repair rows that were stored before a fix landed.
Both live in `apps/server/scripts/`, beside `backfill-google-identities.ts`, and
follow the same contract:

- **Dry run by default.** Without `--apply` they only count. Nothing is written.
- **`--apply` writes.** Run the dry run first and read its counts.
- **Idempotent.** A second `--apply` finds nothing left to do. A run that stops
  part way is finished by running it again.
- **`--business=<id>`** (repeatable) limits a run to some businesses. Use it to
  try one tenant before the whole database.
- **Counts only.** They never print an id, a name, a title or a value. On a
  failure they print only the error's class and code, never the database's
  message.
- Exit status: `0` done, `1` a database read or write failed, `2` bad arguments.

They read `DATABASE_URL` from the environment, else from the repo-root `.env`
(`tsx --env-file-if-exists=../../.env`; a variable already set wins over the
file). The package.json scripts run tsx with `scripts/tsconfig.json`, which has
no `paths`: under `apps/server/tsconfig.json` tsx resolved `@keyflow/db` to a
`.d.ts` and every run died with `Cannot read properties of undefined (reading
'$disconnect')`. `@keyflow/db` must be built (`pnpm --filter @keyflow/db
build`). Proof: `apps/server/test/backfill-scripts-cli.integration.test.ts`
runs each package.json script's dry run (BSC-01..04). On the production box,
where the API image has no `scripts/` directory, mount it as
`docs/development/owner-membership-backfill.md` describes; both scripts here
import only `@keyflow/db`, so the same command works with their file names.
Neither has been run against a real database. Running them in production is an
operator decision: take a backup first and run the dry run against that
database before `--apply`.

## 1. Cross-tenant custom-field values (SF-1)

```bash
cd apps/server
pnpm cleanup:custom-field-values                   # dry run, every business
pnpm cleanup:custom-field-values --business=<id>   # dry run, one business
pnpm cleanup:custom-field-values --apply           # delete
```

**Why.** `contact_custom_field_values` joins a contact to a custom-field
definition and has no business column. Before W9-CUSTOM-FIELDS-TENANT,
`ContactCustomFieldValueService.setValuesForContact` looked definition names up
without a business. Names are unique only within a business, so a caller with
no ambient tenant could bind a contact of business A to a definition of business
B. That packet stopped new binds. The values route and the contact detail now
skip such rows, and a custom-field write on the contact removes them (review
SF-1). Rows on contacts nobody edits stay in the table.

**What it deletes.** Every value row whose contact and definition belong to
different businesses:

```sql
DELETE FROM contact_custom_field_values v
  USING contacts c, custom_field_definitions d
  WHERE v.contact_id = c.id AND v.definition_id = d.id
    AND c.business_id <> d.business_id;
```

`--apply` is this one statement, so it is atomic. Contacts and definitions are
never touched, and since W9 no screen shows these rows, so no business loses
anything it could see. With `--business`, a row is in scope when its contact or
its definition belongs to a listed business.

**Output.** `cross_bound_values`, `contacts_affected` and
`businesses_affected` (the contacts' and the definitions' businesses), plus
`deleted` with `--apply`.

## 2. Timeline contact links for pre-W9 rows (owner ruling D-115)

```bash
cd apps/server
pnpm backfill:timeline-contacts                    # dry run, every business
pnpm backfill:timeline-contacts --business=<id>    # dry run, one business
pnpm backfill:timeline-contacts --apply            # write
```

**Why.** The timeline rule (`apps/server/src/modules/timeline/timeline-visibility.ts`,
owner ruling D-63) hides a row that names a contact from members who may not
open that contact. It finds the contact through the row's `contactId`, or its
`entityId` when `entityType` is `contact`. Until W9-TEXT-ONLY-CONTACT-WRITERS,
two writers named the contact only in the row's text:

| Writer | Row |
|---|---|
| KEY `commerce_send_invoice` (`FlowOrchestratorService`) | module `commerce`, action `invoice_sent`, entityType `invoice`, entityId = invoice, title `Invoice <n> sent to <name>` |
| `MessageIntakeOrchestrator.executePlan` | module `communications`, action `message_intake.approved`, entityType `message_intake`, entityId = intake, detail `<intent> from <sender> — <subject>` |

Both writers have stored `contactId` since W9. Their older rows still have no
`contactId`, so the feed (`/events`, the day's summary, the legacy activity
route and the briefings) served them to members who may not open the contact
(review SEC-W9TO-1, timeline-scope TS-13d).

**What it does (D-115).** It reads only rows with exactly one of these two
shapes and an empty `contactId`:

1. **Link.** When the row's business has an invoice (or intake) with the row's
   `entityId`, and that invoice's (or intake's) contact belongs to the same
   business, the row's `contactId` is set to that contact. An invoice row is
   linked only when its title names that contact (review SEC-W10DCS-2): the
   title must end with ` sent to <name>`, where `<name>` is the contact's first
   and last name joined by a space, or `Customer` when both are empty (exactly
   as the writer formats it). `updateInvoice` can re-point a DRAFT, SENT or
   OVERDUE invoice to another contact, and the title names the contact at send
   time, so a row whose title names someone else is not linked. An intake's
   contact is never re-pointed after approval. Nothing else on the row changes.
   From then on the timeline rule shows the row only to members who may open
   that contact.
2. **Withhold.** When the source is gone, the row cannot be tied to a contact.
   This covers rows with no `entityId`, rows whose invoice or intake is not in
   the row's business, and rows whose source's contact belongs to another
   business. An invoice row whose title names someone other than its invoice's
   current contact (the invoice was re-pointed, or the contact renamed) is
   withheld too: the script cannot tell which contact it names. D-115 says a
   row whose source is gone (`source_gone`) is served only to OWNER and ADMIN.
   D-118 narrows that for a `name_mismatch` row, whose title may name a PRIVATE
   contact: it is served only to the OWNER and SUPER_ADMIN. The OWNER is a
   member holding an OWNER-role membership of the business (D-116 as read by
   D-125): a recorded owner (`Business.ownerId`) holding only an ADMIN or STAFF
   membership is treated as that role, and a co-owner holding OWNER is the
   owner. The script
   moves the row to module `d115_withheld`. `ACTIVITY_MODULE_SCOPES` deliberately
   does not map that module, and the rule already serves a row of an unmapped
   module to OWNER and ADMIN only (and SUPER_ADMIN), under D-63
   (`canReadActivityRow`, `readsUnmapped`). An invoice row also gets category
   `COMMERCE` (unless it already has a revenue category). It therefore still
   needs revenue read, as its module `commerce` required. The original module
   and category are kept in `data.d115` as
   `{ withheld, module, category }`, merged into the row's own data. `withheld`
   is `source_gone`, or `name_mismatch` for an invoice row whose invoice is
   there but names another contact. The title, detail and entity are
   unchanged.
3. **Left as is.** An approved intake whose intake has no contact is not
   changed. Either the sender was never a contact, or the contact was deleted
   and the intake's link was set to null. The W9 writer stores exactly this row
   today (timeline-scope TS-13b), so the script only counts it.

The timeline rule serves a `d115_withheld` row under D-63's unmapped branch
plus two terms (below). `test/data-cleanup-scripts.integration.test.ts`
(DCS-T05) pins that `d115_withheld` stays unmapped. Never add it to
`ACTIVITY_MODULE_SCOPES`: that would serve withheld rows to everyone who reads
the mapped module.

Limits of the withheld audience (D-63's unmapped branch, the D-115 term and
the D-118 term):

- A withheld invoice row still needs `revenue` read, as before the backfill.
  An ADMIN whose `revenue` access is `none` is not served it, and neither is
  an OWNER whose `revenue` access is `none`.
- A withheld row whose `data.d115.withheld` is `name_mismatch` is served only
  to the OWNER (an OWNER-role membership, D-116 / D-125) and SUPER_ADMIN, not
  to an ADMIN, whatever the ADMIN's scopes (D-118; `readsOwnerWithheld` in
  `timeline-visibility.ts`). A withheld row with no reason, or a reason other
  than `source_gone`, is treated the same way (fail closed). The script always
  writes a reason, so this only matters for rows edited by hand. `source_gone`
  rows keep D-115's OWNER and ADMIN audience. The end-of-day count
  (`GET ai/businesses/:businessId/briefing/eod`) counts by module only for a
  viewer who reads owner-withheld rows; everyone else's rows are judged one by
  one, so the count matches `/events`.
- A withheld row also needs read on the scope of the module it had before the
  backfill (`data.d115.module`). A withheld intake row (module
  `communications` before, read on `crm`) is not served to an ADMIN whose
  `crm` access is explicitly `none`, who was not served it before either
  (review SEC-W10DCS-1 / CR-W10DCS-1, D-114's principle that explicit scopes
  bind ADMINs). `canReadActivityRow` applies this term to every row of module
  `d115_withheld` (`D115_WITHHELD_MODULE` in `timeline-visibility.ts`, the
  same marker as the script's `WITHHELD_MODULE`).

`--apply` runs four UPDATE statements: link invoice rows, link intake rows,
withhold invoice rows, withhold intake rows. Each is idempotent on its own. A
linked row has a `contactId` and a withheld row has another module, so neither
matches again.

**Output.** Both modes print `invoice_sent_unlinked`,
`invoice_sent_name_mismatch` (unlinked invoice rows whose invoice is there but
names another contact; part of `*_would_withhold`), `intake_approved_unlinked`
and `intake_approved_no_contact`. A dry run adds
`*_would_link` and `*_would_withhold`. `--apply` adds `invoice_sent_linked`,
`invoice_sent_withheld`, `intake_approved_linked` and
`intake_approved_withheld`.

**To undo a withhold** for one row (for example, when its source is restored),
set the row's `module` and `category` back from `data.d115` and remove that key.
Then re-run the script so it can link the row.

## Proof

`apps/server/test/data-cleanup-scripts.integration.test.ts` (prefix `v96o_`)
runs both scripts' `main()` in process against Postgres. It covers:

- dry runs that write nothing and print counts only;
- `--apply` fixing exactly the seeded rows, with same-business controls left
  untouched. An invoice of business A and an intake of business A whose
  contact belongs to business B are both withheld, never linked to B's
  contact: these negative controls pin the tenant binding on both sides
  (review SEC-W10DCS-3);
- idempotent re-runs and the `--business` scope;
- TS-13d: after the backfill, `/events`, the day's summary and the legacy
  activity route no longer serve the pre-W9 rows naming a PRIVATE contact to a
  view-all ADMIN, a crm_view `owned` member or a crm `none` member, and serve
  withheld rows to OWNER and ADMIN only;
- DCS-T06 (review SEC-W10DCS-2): a row naming the contact an invoice had before
  it was re-pointed is withheld, not linked to the invoice's new contact. The
  writer's `Customer` fallback still links;
- DCS-T07 (review SEC-W10DCS-1 / CR-W10DCS-1): an ADMIN whose `crm` access is
  `none` is not served a withheld intake row, its sender or its subject; the
  same ADMIN, reading `revenue`, is still served the withheld invoice rows of
  business A (all `source_gone`), but not a `name_mismatch` invoice row, even
  with `crm` read (D-118);
- DCS-T08 (D-118): after the backfill, the `name_mismatch` row of business C
  is not served on `/events`, the day's summary or the legacy activity route
  to an ADMIN with default scopes, nor is the PRIVATE name it carries; that
  ADMIN still gets C's linked rows, the OWNER gets every row, and the ADMIN
  whose `crm` access is `none` no longer gets the `name_mismatch` row;
- DCS-T09 (D-118 with D-116 / D-125): a recorded owner holding only an ADMIN
  membership is not served the `name_mismatch` row (its timeline viewer has
  `readsOwnerWithheld` false) but is served the `source_gone` and linked rows;
  the co-owner holding the OWNER membership is served every row.
  `src/modules/timeline/timeline-visibility.spec.ts` (TV-10) pins the rule:
  `name_mismatch`, a missing or an unknown reason are owner-only, and
  `source_gone` stays OWNER and ADMIN.
