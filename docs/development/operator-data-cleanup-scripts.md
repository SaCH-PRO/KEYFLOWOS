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

Section 3 is a different kind of script: a **read-only** count the owner runs
against production before v1 hides its deferred modules. It has no `--apply`
and no write path at all.

Section 4 follows the contract above with one difference: its dry run also
lists each stale copy's id (an opaque generated id) with its reason, so the
operator can see what `--apply` will delete. It still never prints a copy's
content or a business id.

Section 5 does the same for phone keys: its dry run lists each contact id it
would rewrite or leave, with the action, and never prints a phone number, a
name or a business id. Its proof is
`apps/server/test/phone-country-duplicates.integration.test.ts` (V71L-30..33).

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

## 3. Read-only usage count of the modules v1 hides (USAGE-COUNT-SCRIPT, D-152)

```bash
cd apps/server
pnpm usage:v1-modules > v1-module-usage.json        # the aggregate (no business id): post this one to #80
umask 077 && mkdir -p ~/v1-usage-private            # the per-business report: keep this one, never post it
pnpm usage:v1-modules --per-business > ~/v1-usage-private/v1-module-usage-by-business.json
```

**Why.** v1 hides about 45 screens (owner ruling D-152, from the product
audit). A business that already keeps records in one of them must not find
those records apparently gone: NAV-B-HIDE shows such a module read-only to that
business instead, and keeps the WhatsApp auto-confirm listener working for a
business with a WhatsApp setup (D-153). This script tells the owner how many
live businesses have rows in which hidden module, and, with `--per-business`,
which ones. The owner runs it against production (D-148) three times: now,
immediately before NAV-B-HIDE starts, and before the redeploy
(GATE-OWNER-TEST).

**What goes to #80, and what does not.** #80 is an issue of a
**public repository**, and a production business id is not anonymous: the public
routes (`/site/storefront/public/<slug>`, `/bookings/public/businesses/<id>/...`,
`/catalog/public/businesses/<id>/products`) resolve it to the business's name.
An edited GitHub issue keeps its history and notification emails, so a post
cannot be taken back. Therefore:

- **Post only the aggregate** (the run without arguments). Per module it gives
  how many live businesses use it, how many have each facet, and what this
  schema lacks. It has no business id (`"scope": "aggregate"`).
- **Keep the per-business report private** (`--per-business`,
  `"scope": "per-business"`). It names each business id with its counts
  (payroll runs, contracts, active API keys and webhooks, a WhatsApp setup).
  Write it with `umask 077` into a directory only the owner can read, outside
  the deploy checkout. Never post it to #80 or any issue, PR or chat, and never
  commit it. NAV-B-LEGACY-SERVER answers per business live, so no packet needs
  these ids from the file.

**What it counts.** The modules, their tables, routes and KEY tools are one
list, `packages/shared/src/v1-modules.ts` (exported from `@keyflow/shared`),
which NAV-B-LEGACY-SERVER, NAV-B-HIDE and the KEY tool allowlist also read. For
every table entry of every module it runs one statement:

```sql
SELECT t."<business column>" AS business_id, count(*)::int AS n
  FROM "<table>" t JOIN "businesses" b ON b."id" = t."<business column>"
 WHERE b."deleted_at" IS NULL
   [AND t."<soft-delete column>" IS NULL] [AND (<the entry's fixed filter>)]
 GROUP BY t."<business column>";
```

A soft-deleted business or row is not counted. A few entries carry a fixed
filter, because some rows are created for every business and mean nothing:

- `automations`: only *enabled* autopilot loops (opening Automations creates
  them all, disabled);
- `presence_pages`: only *saved* website drafts (version 2 and up; opening the
  builder creates version 1);
- `connectors` and `accounting_sync`: only `connected` connector rows, and
  `connectors` leaves out Gmail (v1), the payment keys (Getting paid) and
  WhatsApp (its own module);
- `whatsapp.config`: a business whose `meta_data` holds a `whatsapp` object
  (the Twilio or Meta setup the listener sends with). `businesses.meta_data` is
  **credentials-bearing**: it holds that setup's account id, token and sender
  number, among other settings. The count tests the key's presence in its
  `WHERE` and extracts no value; no statement projects anything but a business
  id and a count.

Some modules count more than one store:

- `goals`: `ai_goals` (what `/app/goals` lists and the `goals_*` KEY tools
  write, through `/api/v1/cortex/goals`) and `business_goals` (the older
  `/ai/businesses/:id/goals` route);
- `performance`: `staff_performance_snapshots`, the history `/app/performance`
  trends (taken by the page and by `performance_take_snapshot`).

Rows that are seeded or created on first view, such as deal stages, are not
counted at all. Modules with no records of their own (dashboards and hubs such
as Intelligence, Operations or the flow hubs) are listed with
`measured: false`. Two are deliberate gaps, recorded in the list:

- `legal`: the genesis document pack `/app/legal` generates is
  `document_instances` rows, which v1 still lists in Settings > Business
  profile (Documents) and opens at `/app/documents/<id>`, so hiding
  `/app/legal` makes none of them look gone;
- `connectors`: a Google Drive connection made through its OAuth route is kept
  on the business row's `drive_*` token columns and may have no `connected`
  connector row; counting it would read a credential column, so it is not
  counted.

`evidence` counts every row: only the Evidence screen and its KEY tools
(`EvidenceService.submit`) write that table. KEY chat's own "evidence" write
names columns the table does not have and fails, so it creates no row.

**Safety.** There is no write path:

- Everything runs in **one transaction** whose first statement is
  `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`. Postgres itself
  refuses any write inside it (SQLSTATE 25006), and every count sees the same
  snapshot. The script reads back `transaction_read_only` and refuses to count
  unless it is `on` (exit 1, nothing printed on stdout).
- Each statement is bounded: `statement_timeout` 60 s, `lock_timeout` 5 s.
- It reads only the business column, the soft-delete markers and the columns a
  filter names. Those are ids and status flags, except
  `businesses.meta_data` (above), which it reads in a `WHERE` only. No
  statement projects a name, an email, a phone number, an amount, free text
  or a credential: every `SELECT` projects a business id and a count, or schema
  metadata (`pg_catalog` names and column privileges, the latest migration).
- It makes no network call other than the database connection, and on a
  failure prints only the error's class and code, never the database's message.
- A table or column this database does not have (production on an older
  schema) is listed under the module's `absent`; a column the database role may
  not read is listed under `unreadable`. Neither is a failure. `schema` gives
  the latest applied migration, so an `absent` entry can be read against it.

The read-only transaction does not depend on the database role, but the
operator may run the script as a role granted `SELECT` on only the columns the
list names. That role can still read `businesses.meta_data`, and with it the
WhatsApp credentials, so grant it knowingly:

```sql
CREATE ROLE v1_usage_reader LOGIN;          -- then set its password interactively: \password v1_usage_reader
GRANT USAGE ON SCHEMA public TO v1_usage_reader;
GRANT SELECT (id, deleted_at, meta_data) ON businesses TO v1_usage_reader;   -- meta_data: credentials-bearing
GRANT SELECT (migration_name, finished_at, rolled_back_at) ON _prisma_migrations TO v1_usage_reader;
-- and, for every other table of the list, SELECT on its business column, its
-- soft-delete column and the columns its filter names (v1-modules.ts), e.g.
GRANT SELECT (business_id, status) ON payroll_runs TO v1_usage_reader;
```

To keep the credentials out of the role's reach, grant `businesses` only
`(id, deleted_at)`: the run still completes, every other count is the same,
and `whatsapp.config` is reported under `unreadable` (`config:
businesses.meta_data`), so the WhatsApp setups are then not counted.

**Output.** One JSON object. The two shapes share these fields:

| Field | Meaning |
|---|---|
| `report`, `formatVersion`, `generatedAt` | `v1-module-usage-count`, `2`, the run's time (UTC) |
| `scope`, `notice` | `aggregate` (the default; post it) or `per-business` (keep it), and what that means |
| `transaction` | `{ "readOnly": true, "isolation": "repeatable read" }` as Postgres reported it |
| `schema` | `latestMigration` and `appliedMigrations` from `_prisma_migrations` (null if absent) |
| `liveBusinesses` | businesses with no `deleted_at` |
| `summary` | module key -> how many live businesses use it (`null`: nothing to count) |
| `modules[]` | per module, in list order: `key`, `label`, `treatment`, `returnsIn`, `measured`, `businessCount`, `absent` and `unreadable` |

The aggregate adds, for a module with facets, `facetBusinessCounts`: how many
live businesses have each facet above zero. The per-business report adds
`modules[].businesses[]`, sorted by id: `businessId`, `rows` (every count of the
module, 0 included) and, where the module has them, `facets`.

A business is on a module's list when any of its `rows` is above zero.
`facets` are informative sub-counts that never decide use: `payroll`
`runs_reserving_safe_to_spend` (DRAFT and APPROVED runs, which D-144 reserves in
safe-to-spend, so Money > Overview must say so), `api_keys` and `webhooks`
`active`, and `presence_pages` `published_live` (served at `/site/<slug>` today).
Exit status: `0` done, `1` the read failed (nothing is written either way),
`2` bad arguments (it takes none, or `--per-business` alone). Like the other
scripts, the process lingers about 30 seconds after printing (the
`@keyflow/db` pool's idle timeout).

**On the production box.** The API image has no `scripts/` directory, and its
`@keyflow/shared` build predates the module list, so the script imports the
list by relative path and both files are mounted read-only into the API
container. Take them from the commit that carries this packet without touching
the deploy checkout's working tree (`<ref>`: that commit, or `origin/main`
once it is merged), and write both outputs outside the checkout:

```bash
cd /opt/keyflowos
git fetch origin
mkdir -p /tmp/v1-usage/apps/server/scripts /tmp/v1-usage/packages/shared/src
git show <ref>:apps/server/scripts/v1-module-usage-count.ts > /tmp/v1-usage/apps/server/scripts/v1-module-usage-count.ts
git show <ref>:packages/shared/src/v1-modules.ts > /tmp/v1-usage/packages/shared/src/v1-modules.ts
RUN='docker compose --env-file .env.production -f docker-compose.production.yml run --rm -T
  -v /tmp/v1-usage/apps/server/scripts:/app/apps/server/scripts:ro
  -v /tmp/v1-usage/packages/shared/src:/app/packages/shared/src:ro
  -w /app/apps/server api npx tsx scripts/v1-module-usage-count.ts'

# 1. The aggregate: no business id. This is what goes to #80.
$RUN > /tmp/v1-usage/v1-module-usage.json

# 2. The per-business report: the owner's only. Never posted, never committed.
umask 077 && mkdir -p ~/v1-usage-private
$RUN --per-business > ~/v1-usage-private/v1-module-usage-by-business-$(date -u +%Y%m%dT%H%MZ).json
```

Check `"scope": "aggregate"` at the top of `/tmp/v1-usage/v1-module-usage.json`
before posting it. The script needs nothing but `DATABASE_URL`, which the
`api` service already has.

## 4. Stale semantic copies of AI memories (FU-MEMORY-COPIES-REWRITE, D-221)

```bash
cd apps/server
pnpm cleanup:memory-copies                   # dry run: list and count, every business
pnpm cleanup:memory-copies --business=<id>   # dry run, one business
pnpm cleanup:memory-copies --apply           # delete
```

**Why.** An AI memory row (`ai_memories`) has semantic copies in
`ai_memory_embeddings` (`source_type` `memory`, `source_id` the row's id): the
backfill route (`POST /ai/businesses/:id/agent/memory/backfill`) writes
`<category>: <key> = <value>`, and KEY's memory writer (indexSemantic) writes
the value. Every member reads them back (`GET .../agent/memory/search` and
KEY's memory block). Before W1F-MEMORY-COPIES a deleted row left its copies, and
before FU-MEMORY-COPIES-REWRITE a row rewritten in place (the owner's
`PUT .../ai/memory` of a new value, a document extracted again, a promotion into
the same key) left the copies of its old value. Since those packets no such copy
is served, every deletion and rewrite removes them, and a rewrite copies the row
again with its new value when the embedding path is on (after the write has
answered). The copies stored
before are still in the table, holding text the owner removed or replaced.

**What it deletes.** Every `memory` copy that no memory row of its business
with its `source_id` holds, in either form (the same test as
`copyHoldsRowValue` in `semantic-memory.service.ts`). A settings row
(category `settings`: the owner's AI preferences, which hold the BYOK
provider keys as ciphertext, the routing table, the autonomy settings) is
configuration, not memory, and has no copy since the FU-MEMORY-COPIES-REWRITE
review repair (`AI_MEMORY_SETTINGS_CATEGORIES`), so every copy of one is
deleted whatever it holds:

```sql
DELETE FROM ai_memory_embeddings e
 WHERE e.source_type = 'memory'
   AND NOT EXISTS (SELECT 1 FROM ai_memories m
                    WHERE m.id = e.source_id AND m.business_id = e.business_id
                      AND m.category NOT IN ('settings')
                      AND (e.content = m.value
                           OR e.content = m.category || ': ' || m.key || ' = ' || m.value));
```

The reasons it reports: `row_gone` (no row with that id in the copy's business:
deleted, or another business's row), `settings_row` (the row is a settings
row: the backfill copied those before the review repair, and their writers
rewrite them outside the write door, so after the owner rotated a BYOK key the
copy still held the old key's ciphertext) and `value_rewritten` (the row holds
another value). A copy of an expired row still holds what its row holds and is
kept (search hides it while the row is expired). Other source types (document
chunks, events, conversations) are never read or deleted. `--apply` deletes in
batches of 1000, each one statement that re-checks the copy is still stale;
a re-run deletes nothing new.

**Output.** `stale_row_gone`, `stale_settings_row` and `stale_value_rewritten`, then `would_delete`
and one `stale copy <id> <reason>` line per copy (dry run), or `deleted`
(`--apply`). Exit status as above.

**After a cleanup.** A row whose only copies were stale has no copy until a
member runs the backfill route again (or the row is rewritten with the
embedding path on).

## 5. Phone keys stored before E.164 (FU-PHONE-COUNTRY-DUPLICATES, D-211)

```bash
cd apps/server
pnpm backfill:phone-keys                     # dry run: list and count, every business
pnpm backfill:phone-keys --business=<id>     # dry run, one business
pnpm backfill:phone-keys --apply             # rewrite the keys
```

**Why.** `contacts.phone_normalized` is a contact's phone identity key: the
partial unique `(business_id, phone_normalized)` over live contacts makes one
number one contact. Since WA-E164-SERVER a contact write stores the phone read
under the business's country (`Business.country`; unset is Trinidad and
Tobago, +1 868) and keys it in E.164; since FU-PHONE-COUNTRY-DUPLICATES the
connector door (EntityResolutionService) and the Google and Outlook contact
syncs do too (owner ruling D-211: a number written without a country code is
read in the business's country only). Rows written before keep the key of the
spelling (`8685550101`, or the seven-digit `5550101`), or none (contacts the
connector door created). The readers bridge that, but the unique only sees
equal keys.

**What it writes.** For each contact with a phone (or a key), the key a write
stores for its phone today: the E.164 number when the phone reads under its
business's country, the spelling's digits when it does not, no key when the
phone has no digit. Only `phone_normalized` changes; the phone a contact shows
and `updated_at` are left as they were. Soft-deleted contacts are rewritten
too (the unique does not cover them). Each row is one `UPDATE` that still
requires the phone and key the run read, so a row edited since is left
(`changed_since_read`) for the next run.

**What it leaves.** `needs_merge`: another live contact of the business holds
the number now, or would after the run (two old spellings of one number).
Rewriting one would break the unique, and which customer is the real one is
the owner's call: merge them in Customers, then run again. `unreadable`: the
phone does not read (too short, or a local number under a country with no
dialling rules); its key stays as typed and the data-quality scan flags it.

**Output.** `contacts_scanned`, `key_current`, `unreadable_kept`,
`needs_merge`, `would_rewrite` (and `rewritten`, `changed_since_read`, `failed`
with `--apply`), then one `<contact id>  <action>` line per row that is not
current (`rewrite`, `needs_merge`, `unreadable`). It never prints a phone
number, a name or a business id. Exit status as above. It imports the reading
from `apps/server/src/modules/crm/crm-duplicate.util.ts`, so on the production
box mount `src/` beside `scripts/` (as for `backfill-google-identities.ts`).
Not run against production by the packet.

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

`apps/server/test/ai-memory-copies-rewrite.integration.test.ts` (prefix
`v71i_`) proves section 4 against Postgres: V71I-07 runs `main()` in process
(the dry run lists exactly the seeded stale copies by id and reason, prints no
content and deletes nothing; its stale set is exactly the `memory` copies search
does not serve, less an expired row's; `--apply` deletes exactly those and is
idempotent; `--business` leaves another business's copies; bad arguments exit
2), and V71I-08 runs `pnpm cleanup:memory-copies` as pnpm runs it, with only
`DATABASE_URL` (dry run, then `--apply`; the database URL is never printed).
V71I-14 covers the settings rows: after the owner rotates a BYOK key (the real
gateway writer), the dry run lists the copies of the preferences row made
before the review repair as `settings_row` without their content, its stale set
is exactly what search does not serve, and `--apply` leaves no copy of either
key's ciphertext.

`apps/server/test/v1-module-usage-count.integration.test.ts` (prefix `v61a_`)
proves section 3 against Postgres:

- V61-01, the list: unique keys; every table and column it names exists in the
  migrated database; every column a count reads is an id, a soft-delete marker
  or a status flag, except `businesses.meta_data` (credentials-bearing), which
  only `whatsapp.config` reads, in a `WHERE` that tests a key; every route is
  an `apps/web` page; every KEY tool is a registered FLOW tool, in one module
  only, and every FLOW tool is in a hidden module or in the test's reviewed v1
  set (so a new tool is classified); every route NAV-B-HIDE and NAV-B-HIDE-2
  gate resolves to a module, and v1 routes to none;
- V61-02, exact counts for two live tenants with rows in projects, payroll
  (with the D-144 facet) and the WhatsApp setup, plus contracts and autopilot
  loops; a soft-deleted business, project or task, a disabled loop, an unsaved
  website draft and an empty business are not counted;
- V61-03, read only: the run's first statement makes the transaction READ ONLY
  and REPEATABLE READ; an UPDATE and an INSERT inside it are refused (25006)
  and change nothing; a run writes no row; a transaction that is not read only
  is refused by the self-check;
- V61-04, no PII: every SELECT projects only a business id and a count; neither
  output carries the seeded names, emails, titles, amounts or WhatsApp
  credentials; a database role granted `SELECT` on only the columns the list
  names (of which `businesses.meta_data` is the one that is not a flag) gets
  the same answer, and is refused `businesses.name` (42501); a role granted
  the same columns without `meta_data` is refused the credentials, still runs,
  and reports `whatsapp.config` as `unreadable`; no `fetch` is made;
- V61-05, an absent table or column is reported, not fatal; unknown arguments
  (and `--per-business` with anything else) exit 2 without touching the
  database;
- V61-06, `pnpm usage:v1-modules` (with only `DATABASE_URL`; the aggregate)
  and the production image shape above (the script and the list alone, no
  `tsconfig.json`, `@keyflow/db` through `node_modules`; `--per-business`)
  print the JSON and exit 0;
- V61-07, through the HTTP routes with the real guards: a goal created through
  `POST /api/v1/cortex/goals` and a snapshot taken through
  `POST /staff-performance/businesses/:id/snapshot` put the business on the
  `goals` and `performance` lists; KEY chat's cortex evidence write fails and
  writes no `evidence` row;
- V61-08, the default output carries no business id (none of the database's)
  and the same counts as `--per-business`, which says it is the owner's alone;
  this section and the script header say what may be posted.
