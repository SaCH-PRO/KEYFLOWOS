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

They read `DATABASE_URL` from the repo-root `.env` (`tsx --env-file ../../.env`).
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
   business, the row's `contactId` is set to that contact. Nothing else on the
   row changes. From then on the timeline rule shows the row only to members
   who may open that contact.
2. **Withhold.** When the source is gone, the row cannot be tied to a contact.
   This covers rows with no `entityId`, rows whose invoice or intake is not in
   the row's business, and rows whose source's contact belongs to another
   business. D-115 says such a row is served only to OWNER and ADMIN. The script
   moves it to module `d115_withheld`. `ACTIVITY_MODULE_SCOPES` deliberately
   does not map that module, and the rule already serves a row of an unmapped
   module to OWNER and ADMIN only (and SUPER_ADMIN), under D-63
   (`canReadActivityRow`, `readsUnmapped`). An invoice row also gets category
   `COMMERCE` (unless it already has a revenue category). It therefore still
   needs revenue read, as its module `commerce` required. The original module
   and category are kept in `data.d115` as
   `{ withheld: 'source_gone', module, category }`, merged into the row's own
   data. The title, detail and entity are unchanged.
3. **Left as is.** An approved intake whose intake has no contact is not
   changed. Either the sender was never a contact, or the contact was deleted
   and the intake's link was set to null. The W9 writer stores exactly this row
   today (timeline-scope TS-13b), so the script only counts it.

The timeline rule itself is unchanged. `test/data-cleanup-scripts.integration.test.ts`
(DCS-T05) pins that `d115_withheld` stays unmapped. Never add it to
`ACTIVITY_MODULE_SCOPES`: that would serve withheld rows to everyone who reads
the mapped module.

Limits of the withheld audience, as D-63's unmapped branch defines it:

- An ADMIN is served a withheld row whatever their `crm` scope.
- A withheld invoice row still needs `revenue` read.
- A withheld intake row (category `AI`) needs no further scope.

`--apply` runs four UPDATE statements: link invoice rows, link intake rows,
withhold invoice rows, withhold intake rows. Each is idempotent on its own. A
linked row has a `contactId` and a withheld row has another module, so neither
matches again.

**Output.** Both modes print `invoice_sent_unlinked`,
`intake_approved_unlinked` and `intake_approved_no_contact`. A dry run adds
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
  untouched;
- idempotent re-runs and the `--business` scope;
- TS-13d: after the backfill, `/events`, the day's summary and the legacy
  activity route no longer serve the pre-W9 rows naming a PRIVATE contact to a
  view-all ADMIN, a crm_view `owned` member or a crm `none` member, and serve
  withheld rows to OWNER and ADMIN only.
