<!--
Recovered 2026-08-09 from workflow wf_425aceaa-0e2 (session cc10ffc0), whose
result was produced but never written to disk. Source of record:
.claude/projects/<project>/cc10ffc0-.../subagents/workflows/wf_425aceaa-0e2/journal.jsonl
Six lens agents returned 15+14+18+17+17+15 = 96 structured findings; a seventh
agent synthesised Parts 1-3 below. Appendix regenerated from the raw findings.
-->
# KEYFLOW OS — Strategy: What Is, What We Want, What We Need

**Basis:** `main` @ `f502aee4`, measured 2026-08-09. Successor to `docs/CRITICAL_ANALYSIS_2026-08.md` (5.3/10, 2026-08-07). Six independent audit lenses — departments, three-layers, roles, ingestion, incumbents, leverage — plus re-derivation of every headline number below. Where I quote a single line of code, I opened the file.

**What changed since the 5.3:** the fork is closed, the server boots, CI runs 3,177 tests including real-Postgres integration, production is a Hetzner VPS on Docker Compose and login works, and the finance moat has a door — ~17 finance labels are in the nav. Four of the five Tier-0 items are done. That analysis's single most important finding ("the product built a moat and did not put a door in it") is closed at the nav layer and **still open one layer down**: the moat is now navigable and still fed by less than a third of the business.

---

# PART 1 — WHAT IS THERE RIGHT NOW

## 1.1 The shape, in numbers

| Measure | Count | How |
|---|---:|---|
| Server modules | 110 | `ls apps/server/src/modules` |
| Prisma models | 439 | `grep -c '^model '` |
| Web routes under `/app` | 209 `page.tsx` | find |
| Nav entries | 100 (95 distinct hrefs) | `lib/nav-config.ts` |
| Static routes with **no** nav entry | **86 of 176** | set difference |
| KEY tools | 245 (95 read · 65 crud · 42 organize · 35 execute · **8 draft**) | registry parse |
| — of which write | 142 | `family !== 'read'` |
| Server write endpoints | ~1,194 across 167 controllers | `@Post|@Patch|@Put|@Delete` |
| SMART layer actions actually implemented | **6** (flow) / **6** (automation executor) | `flow-action.registry.ts`, `automation-executor.service.ts` |
| SMART layer actions **advertised to users** | 25 | `automation-constants.ts` |
| `@Cron` jobs | 26 — **17 in key-cortex**, 0 in contracts/procurement/payroll/helpdesk/projects/marketing | grep |
| `setInterval` schedulers | 52 (78 in-process timers total) | grep |
| Distributed lock / leader election | **0** | `pg_advisory\|redlock\|SETNX` → no matches |
| Connectors registered | 22 — **2** perform a real provider pull | `connector-sync-modes.ts` |
| Money-touching modules that post to the ledger | **5 of 18** | verified per-module grep |

Per-module non-spec LOC, the number that explains the product's priorities better than any other:

```
key-cortex  70,282   crm       25,394   projects      1,884
ai          40,264   commerce  17,635   contracts     1,184
                     finance   11,010   procurement     502
                                        payroll         301
                                        helpdesk        237
                                        marketing       138
```

**key-cortex + ai = 110,546 lines. crm + commerce + finance = 54,039.** The reasoning layer is twice the size of the three largest business departments combined, and it owns 17 of the 26 scheduled jobs in the entire server.

## 1.2 Departments, rated by depth

Depth = can a real business run this department here end to end, with the record that proves it happened.

| Department | LOC | Tools | Screens | Acts on its own | Posts to ledger | Depth | The one fact |
|---|---:|---:|---:|---|---|:--:|---|
| Finance / accounting | 11,010 | 19 | 19 | 1 cron | **is** the ledger | **8** | Correct engine, fed by 5 of 18 money modules. Zero event emits — nothing can react to a financial fact. |
| CRM / sales | 25,394 | 33 | 25 | 5 loops, 40 listeners | via commerce | **8** | The only department that genuinely adapts. All schedulers are `setInterval`, so they double-fire on a 2nd replica. |
| Commerce / storefront | 17,635 | ~20 | — | listeners | yes | **7** | Order → revenue + COGS + VAT at payment actually works. Shopify needs A2X + Xero for this. Marketed nowhere. |
| Comms / Key Inbox | 9,385 | 12 | 6 | yes | n/a | **6** | 9,385 lines of inbound handling feeding a 237-line case record with no clock. |
| Calendar / bookings | 9,223 | ~15 | — | 63 `@OnEvent`, 2 schedulers | bookings do | **6** | No RRULE, no .ics, no inbound Google Calendar. Double-booking is structurally possible. |
| Analytics / reporting | 2,252 | **1** | 1 | 6 crons | reads it | **5** | 1 tool of 245. The layer that answers "how is the business doing" is the one KEY can least query. No scheduled delivery. |
| Projects / delivery | 1,884 | 8 | 2 | **none** | no | **3** | Task vocabulary is TODO/ACTIVE/DONE. `dependencies` is an unvalidated JSON blob. Change orders never bill. |
| Procurement / inventory | ~2,500 | 12 | 8 | **none** | no | **3** | Goods receipt and stock count change `InventoryStock` and write **no** `StockMovement`. `markInvoiced` creates no Bill. No three-way match. |
| Legal / contracts | 1,184 | 11 | 2, **no nav** | **none** | no | **2** | `renewalDate` is written by the AI extractor and read by nothing. No cron in the module. Renewals never fire. |
| Support / helpdesk | 237 | 6 | — | **none** | n/a | **2** | No SLA field, no queue, no routing. `replyToTicket` compares `=== 'resolved'` against a schema that writes `'RESOLVED'` — verified at `helpdesk.service.ts:140`. The reopen path can never fire. |
| Marketing (campaign layer) | 138 | 14 | — | **none** | no | **2** | `budget` and `expectedRevenue`, no `actualRevenue`, no attribution, no execution path. Every call is `(prisma.client as any)`. |
| People / HR / payroll | 301 | 7 | 1 | **none** | **no** | **1** | No Employee, Leave, Shift, Attendance or Candidate model in 439. Gross pay only — no PAYE, NIS, Health Surcharge, net pay or payslip. `markRunPaid` moves no money in the books. |
| Multi-entity / group | 244 | 0 | 0 | none | no | **1** | `cross-business-intelligence` compares counts. No consolidated trial balance, and it is a `GROUP BY`. |

## 1.3 The four structural facts

Everything else in this document follows from these.

**(1) The ledger is not the system of record.** `RevenuePostingService` / `ExpensePostingService` are consumed by 7 files across 5 modules — commerce, expenses, payments, marketplace, site. Grepping `PostingService|postJournal|journalEntry.create` returns **zero** for payroll, retainers, subscriptions, bookings, procurement, supplier, continental-ops, change-orders, contracts, keystore, community, education and public-events. A P&L from `ledger-reporting.service.ts` is correct only for a business that does not run payroll, retainers or purchasing. The engine is right; less than a third of the money reaches it.

**(2) The AI's standing picture of the business has no money in it.** Every chat turn builds its prompt from `businessGraph.buildContextString()`. `assembleSnapshot` is one `Promise.all` of 29 aggregate queries. Grepping that file for `db.ledgerEntry.`, `db.financialAccount.`, `db.bill.`, `db.inventoryStock.`, `db.deal.`, `db.payrollRun.`, `db.supportTicket.` returns **0 for all seven**. KEY knows how many contacts you have and not your pipeline value; invoices and not your bank balance; expenses and not your unpaid bills. It can fetch the rest if asked — every proactive path, alert and unprompted judgement is made blind. The richer assembler that exists (`key-cortex-context-v2`, 1,643 lines, 9 slices) also has no finance slice and is not what chat calls.

**(3) The three layers are not equivalent, and the gate that says they are is measuring the wrong thing.** `check-tool-routes.ts` reports 142/142 manual parity, and it is a sophisticated checker — it resolves redirect shims, follows `next.config` redirects, walks the import graph 3 deep, and runs its own negative control. But `crossDomain` is a substring test on the tool's name prefix, so `finance_post_journal_entry → /app/finance` passes on the word "finance". All 13 tools rooted at `/app/finance` rest their parity claim on `createReserveBucket` — a savings-bucket button. **A human cannot post a journal entry anywhere in this app.** The 256-line balanced double-entry composer still exists at `finance/components/books-journal-tab.tsx`; commit `4420c4aa` replaced the page that mounted it with `redirect('/app/financial-flow')` and left 905 lines of tab components with zero importers.

Meanwhile the SMART layer is gated by nothing: `/app/automations` offers 32 triggers and 25 actions, the LLM prompt advertises 32 and 19, and `AutomationExecutorService` dispatches on 8 events and implements 6 actions. 19 of 25 actions fall to `default: logger.warn('Unknown action type')` — and `executePlaybooks` writes an ActivityLog with `outcome: 'success'` **after** the loop regardless. The user sees a green run for an automation that did nothing.

**(4) No role can deliver a message to a customer.** Every outbound tool is T3 or T4 (`send_message_with_approval`, `inbox_reply_thread`, `comms_send_broadcast`, `commerce_send_invoice`, `marketing_send_campaign` T4, `social_publish_post` T4). sales/finance/support/marketing cap at `maxRiskTier: 2`; general/executive at 1. The only outbound act any role can take inside its own ceiling is `operator` sending an invoice. The apparent exception, `helpdesk_reply_to_ticket` at T2, writes a `SupportTicketMessage` row with `channel: 'internal'` and calls no sender. And there are **three disconnected role systems**: 8 department roles with tool envelopes (`role-engine.service.ts`), 35 named job titles that are read-only notification queues (`flow-role-subscriptions.config.ts`, 23 of 35 structurally empty), and `JobRole` → tool envelope, which is reachable **only** from a staff member's registered WhatsApp number and, with every permission in the product's own UI set to `admin`, reaches 56 of 245 tools and **zero money tools**.

## 1.4 What is genuinely strong

Not flattery — these are the assets the plan spends.

- **The posting engine.** Balanced double-entry, Decimal arithmetic, deterministic `buildExternalRef(sourceType, sourceId, kind)` idempotency with `ConflictException` on re-post, accounting periods with lock, reconciliation with tolerance/date-window/reference scoring, credit notes, fixed assets, recurring journals, a tax rollup that nets input tax from `expense.taxAmount`, and a real accountant export ZIP. Eighteen months of competitor work.
- **The tool layer.** 245 typed tools with risk tiers, sagas with compensation attached *before* the step runs, idempotency keys, and honesty specs that structurally assert every declared tool has a handler (`flow-tool-honesty.spec.ts`), pin five known fabricated-success defects (`tool-honesty-sweep.spec.ts`), and hold the dead-listener count at 10 with a canary proving the detector still fails (`event-wiring.spec.ts`).
- **Statement parsing.** CSV/OFX/QIF/MT940 with the format sniffed from **content, not filename**, per-account `importProfile` remembering a bank's odd headers, deduping on the bank's own FITID where present.
- **The contractor path.** `OrgAssignment.isContactOnly` + `StaffChatBridgeService` routes an inbound WhatsApp from a registered number into the same KEY engine with reply-based approval (`yes`/`no` resolves a pending approval). This is exactly the "affiliate who will never log in" case in the vision, and it is genuinely built.
- **The buy-not-build instinct, where it fires.** docling, Chatwoot, LiveKit, MinIO and pgvector all run as real production services.
- **The self-audit culture.** Still the best thing about this project, and the reason six lenses could measure this in a day.

## 1.5 Where it is hollow — the pattern

Three defect classes recur, and the repo already has instruments for all three — pointed at exactly one layer.

| Class | AI layer (gated) | SMART layer (ungated) | Elsewhere (ungated) |
|---|---|---|---|
| Declared but not implemented | 245/245 have handlers | 19 of 25 actions, 24 of 32 triggers | 7 of 12 Key Inbox channels have no producer; 16 of 20 `JobRolePolicy` module keys can never be produced by the UI |
| Reports success without acting | 5 pinned instances | `send_message` returns `{sent:true, direct:true}` and calls no sender; playbook logs `outcome:'success'` after a no-op loop | `sync-engine.service.ts:298` returns `recordsRead: 0` + "placeholder result" and marks the job SUCCESSFUL; a campaign with no Gmail connection is still written `status:'SENT'` with full `sentCount` and emits `campaign.sent` |
| Written and never read | dead listeners held at 10 | `autoExecutable` written at 7 sites, read by nothing | `renewalDate`, `sop.version` (hard-coded 1), `contact.search_vector` (the populate trigger and GIN index live in `migrations-archived/`, so the column is permanently NULL and the tsvector query silently falls back to ILIKE) |

Add the silent-wrong ones found this pass:

- `key-cortex-document.service.ts` parses Excel via `await import('xlsx')`. **`xlsx` is in no package.json and no lockfile entry.** A hand-written `apps/server/src/types/xlsx.d.ts` ("Minimal stub for the xlsx dynamic import") is what lets it typecheck. At runtime the import throws, the catch swallows it, and the fallback embeds `buffer.toString('utf-8')` of a binary ZIP. The spreadsheet is chunked, embedded and reported successful as mojibake.
- `llm-cost.service.ts:39` — `TOKEN_COST_PER_1K[model] || { input: 0, output: 0 }`, against a hand-maintained 9-row table whose newest entries are gpt-4o and claude-3-5-sonnet. The registry references 12 model families. **Most inference in this product costs exactly zero according to the meter.**
- `flow-runner.service.ts:284` — `if (totalMs > 0 && totalMs <= 30000)`. A "wait 3 days then follow up" node completes instantly. Line 283 is the comment `// In production, this should queue to BullMQ`. BullMQ is installed and already does exactly this three files away.
- `safe-to-spend.service.ts:68-69` — `// Placeholder: payroll and debt not yet modeled` / `const payrollReserved = 0;`. The flagship "can I spend this" number omits the largest recurring outflow in an SMB, and `payrollRun.totalGross` is one query away in the same Postgres.
- `module-scope.guard.ts` prefers a member's stored `permissionScopes` over `DEFAULT_SCOPES`. `identity.service.ts:506` writes the shorter 11-key map on every invite. That map has no `operations` key — so **an invited ADMIN resolves `none` on all 58 handlers decorated `RequireModuleScope('operations')`, including the entire approvals surface.** The founder is unaffected because their membership is upserted with no scopes at all. `connect` is in neither map, so 7 integration-hub handlers are forbidden to everyone including the owner.
- `flow.controller.ts:26/61` — `pageContext` is an inline-typed `@Body()`, so the global ValidationPipe whitelist does not strip it. A client can supply its own `jobRoleEnvelope`, and `ai-oversight.service.ts:129-138` **skips the department-role check entirely when an envelope is present.**

## 1.6 The honest distance to the vision

Scored clause by clause against measured numerators. This is not a feeling.

| Vision clause | Measure | Score |
|---|---|---:|
| Every command via phone + today's AI | KEY chat + WhatsApp staff bridge + Whisper are real. 9 multipart endpoints, each domain-bound; no generic "drop anything" door; `manualEquivalentRoute` appears in **0** files under `apps/web/src`, so the "do it yourself" link the registry docstring promises is invisible. | **30%** |
| Showcase using tools wisely | 245 typed tools, risk tiers, sagas, honesty gates. Deduct: 8 of 245 are `draft`; parity proved by the wrong evidence; the cost meter reads $0. | **70%** |
| Omnisciently optimise operations | Standing context touches 0 of 7 money/stock/people models. 76 of 110 modules have no cron, no loop, no listener. 17 of 26 crons are in the layer with no department. | **15%** |
| Connect and ingest any and every material | 2 of 22 connectors pull; 12 have no inbound path at all; 4 of 12 inbox channels are fed; PDF statements — what T&T banks actually send — are read as `utf8` and sniffed to "csv"; **0 tools ingest anything**. | **15%** |
| Equivalent MANUAL, SMART, AI layers | MANUAL 132/209 writable but 86/176 doorless; AI 142 write tools ≈ 12% of 1,194 write endpoints and 40 of 209 screens named; SMART 6 real actions of 25 advertised. "Equivalent" fails on the weakest. | **20%** |
| Organised by department, role, function | 110 modules, 100 nav entries, and **three** role systems with no edge between them. | **30%** |
| Replace or amplify every tier of employee | 0 of 8 roles can send a customer a message in tier; 23 of 35 job queues can never contain a row; a defined position reaches 56/245 tools and 0 money tools; no employee record exists. | **10%** |

**Weighted (double weight on the four load-bearing clauses): 23%. Unweighted mean: 27%.**

**Call it one quarter of the vision.** The defence of that number is the gap against a second one: score "does code exist in this repo that could do this" and you get roughly **65%**. The distance between 65% and 25% is not a code-volume problem — it is a join problem, and it is the entire management thesis of this document. 722,000 lines have been written. The next 100,000 should be closer to 10,000.

---

# PART 2 — WHAT WE WANT TO BE

Adjectives removed. Each statement below is something you can write a test for.

## 2.1 The one-sentence target

> A single Postgres for a Caribbean SMB in which **every business fact that costs or earns money leaves a ledger entry**, KEY can see that ledger without being asked, and any function can be performed three ways — by hand on a screen, by a deterministic rule, or by KEY — with the same result and the same audit row.

## 2.2 Ingestion: "any and every material", named

**Sources — target state, testable per source.**

| Source | Target | Today |
|---|---|---|
| Bank statements — Republic, RBC Royal, First Citizens, Scotiabank TT | **PDF (native + scanned) via docling**, plus existing CSV/OFX/QFX/QIF/MT940 | text formats only; PDF becomes mojibake |
| QuickBooks Online, Xero | One-time backfill: chart of accounts, opening trial balance, open AR/AP, 24 months of journals | no inbound path |
| Stripe, PayPal, WiPay | Historical transaction + payout backfill, reconciled against invoices | no inbound path |
| Google Drive / OneDrive / Dropbox | **Google Docs/Sheets/Slides natively + .docx/.xlsx/.pptx** — the export path already exists at `google-drive.service.ts:879-941` and the 5-minute sweep's mime filter excludes it | sweep is `image/ or application/pdf or text/` only |
| Gmail / Outlook | Threads **and attachments parsed** — `IngestionAttachment` is written at `ingestion-orchestrator.service.ts:81` and never fetched | metadata recorded, bytes ignored |
| Mailchimp / Klaviyo | List + suppression + engagement import | no inbound path |
| Google Calendar | **Inbound events**, not just outbound push | push-only; double-booking possible |
| Shopify | Registered in `CONNECTOR_SYNC_MODES` with health + nav | real 4-endpoint pull that nobody can find |
| Website form, website chat, SMS, Meta lead form, FB/IG comments | Producers into Key Inbox | 7 declared channels, 0 producers |
| WhatsApp | Attachments swept into ingestion, not only text | text only |
| Anything else | **Per-business MCP servers**, pasted URL + token | `MCP_REMOTE_SERVERS=` empty in `.env.example:134` |

**Formats — one door, one contract.** PDF (native + scanned), DOCX/XLSX/PPTX, Google native, CSV/TSV, OFX/QFX/QIF/MT940, VCF, JPEG/PNG/HEIC, audio, EML/MSG, ICS, ZIP of any of the above.

**Testable capability:** `POST /ingest` accepts any of the above. Dropping a folder of 40 mixed files produces 40 typed `IngestionItem` rows, each recording **which parser handled it**, and **zero rows may report success with zero extracted content**. That last clause is the whole point — it makes the `xlsx` class of defect impossible.

**And KEY must be able to do it.** Today zero of 245 tools ingest anything. Target: `ingest_file`, `ingest_url`, `import_statement`, `run_connector_backfill`, `scan_drive_folder` — so "KEY, pull last year out of QuickBooks" is a sentence.

## 2.3 The three layers, made a contract

| Layer | Definition | Gate that proves it |
|---|---|---|
| MANUAL | A human can perform action X on a screen reachable from the nav in ≤3 clicks | `nav-reachability.spec.ts` (exists) + the doorless allowlist is the honest backlog |
| SMART | A deterministic rule can perform X with no LLM | **One registry** of implemented triggers/actions, read by the UI options, the LLM prompt and `createAutomation`; a spec asserting all three lists are the same set |
| AI | KEY can perform X within some role's tier ceiling | Parity keyed to **the tool's own api function**, not any mutation on the page; plus a **reverse** gate — a writable screen in a nominated domain with no tool fails the build |

Plus: **an action that did not happen may never log `outcome: 'success'`.** Point `tool-honesty-sweep.spec.ts` at `flow/`, `autopilot/`, `key-connector/sync/` and `email-marketing/`.

## 2.4 Employee tiers: named roles, named acts

"Replace or amplify every tier" becomes: for each role, the specific thing KEY does unattended, at a stated tier, with a stated approval boundary.

| Role | KEY does unattended | Needs |
|---|---|---|
| **Bookkeeper / AR clerk** | Codes bank lines against rules, matches receipts, drafts the month-end journal, chases overdue invoices at **T2** | Journal + bill-pay tools drop to T2 with a value ceiling; a manual `/app/finance/books` so parity is real |
| **AP clerk** | Turns a goods receipt + supplier invoice into a Bill with three-way match; flags variance | `markInvoiced` must create a Bill; goods receipt must post Dr Inventory / Cr GRNI |
| **Collections clerk** | Sends the reminder ladder at **T2** to contacts with a genuinely overdue balance; escalates at day 60 | Per-role send policy; delegation loops 2–5 actually sending |
| **Receptionist / scheduler** | Answers "are you open Saturday", books, confirms, reschedules, sends the .ics | Inbound calendar sync; `ical-generator`; T2 reply on an existing thread |
| **L1 support agent** | Replies on the customer's channel at **T2**, opens the ticket with an SLA clock, escalates on breach | `helpdesk_reply_to_ticket` must actually send; `SupportTicket` needs `dueAt`/`firstResponseAt`/`resolvedAt`; a `supportTicket.*` bridge pattern so the queue is not empty |
| **SDR** | Enrols a new lead in a sequence, sends step 1 at **T2**, books the meeting | `sequence_*` is approved for `finance` only — move it to `sales` |
| **Procurement buyer** | Chases unacknowledged POs and overdue deliveries; drafts the reorder at reorder point | Any scheduler at all in `procurement/`; `purchaseOrder.*` events that the bridge forwards |
| **Receiving / stock clerk** | Posts the receipt, writes the `StockMovement`, flags the discrepancy | `StockMovement` on receipt and count; `/app/continental-ops` parent page (all four screens are doorless) |
| **Payroll administrator** | Builds the run from time entries, produces a bureau-format CSV, posts the accrual | Posting on `markRunPaid`. **Not** statutory computation — see §3.4 |
| **Contract administrator** | Warns `renewalNoticeDays` before renewal; flags auto-renew; routes for signature | One cron; an e-sign sidecar; `/app/legal` in the nav |
| **Marketing coordinator** | Executes a campaign plan across email/social, attributes revenue back to it | `actualRevenue` + attribution on `MarketingCampaignPlan`; an execution path from plan → send |
| **Owner's chief of staff** | The morning brief that names the number that changed and what to do about it | The money slices in the context snapshot |

**And the join that makes all twelve real:** one role model. `JobRole.permissions` (a real position) → tool envelope (exists) → tier ceiling (exists in `role-engine`) → flow-signal queue (exists in `flow-signal`). Three closed clusters, no edges. The product is the edge.

## 2.5 The money contract

Every state change that costs or earns money writes a journal entry in the same transaction. Test: a spec that lists money-touching modules and asserts each imports a posting service or is on an explicit, reasoned exemption list — the same shape as `tenant-model-list.spec.ts`. Today that spec would fail 13 times.

---

# PART 3 — WHAT WE NEED

Sequenced by impact per unit of effort. Every item says BUILD or ADOPT, and adoptions name the project and the licence.

## 3.1 Wave 0 — days. Truth, doors, and one-line defects

Nothing here is new capability. All of it is making the product tell the truth or connecting something already built.

| # | Action | B/A | Effort | Unlocks |
|---|---|---|---|---|
| 1 | Re-mount `books-journal-tab` + 3 siblings on `/app/finance/books`; repoint `finance_post_journal_entry` / `finance_pay_bill` / `finance_create_bill` there and at `/app/expenses` | BUILD | 2 d | 905 orphaned lines become the manual layer for the best asset in the repo. Manual parity stops being a lie. |
| 2 | **Contract renewal sweep** — one `@Cron` reading `renewalDate` / `renewalNoticeDays` | BUILD | 1 d | Turns a CRUD table into the department's entire purpose. Highest value per line in the audit. |
| 3 | Single trigger/action **registry** for the SMART layer, read by UI + LLM prompt + `createAutomation`, with a set-equality spec | BUILD | 3 d | Kills 19 fake actions and 24 fake triggers, and stops KEY building an ENABLED playbook on `schedule.daily` / `send_sms`. |
| 4 | Point `tool-honesty-sweep.spec.ts` + the dead-listener analyser at `flow/`, `autopilot/`, `key-connector/sync/`, `email-marketing/` | BUILD | 2 d | Catches `sent:true` with no sender, `outcome:'success'` after a no-op, `autoExecutable` written-never-read, and the placeholder sync. |
| 5 | **Fix the invited-ADMIN lockout** — reconcile `DEFAULT_SCOPES` with `PERMISSION_MODULES`, add `connect`, and stop writing a short map on invite | BUILD | 1 d | Every invited admin is currently locked out of the entire approvals surface. |
| 6 | Make `pageContext` a validated DTO in `flow.controller.ts` | BUILD | 0.5 d | A client can supply its own `jobRoleEnvelope` today and skip the role check. |
| 7 | Fix `helpdesk.service.ts:140/143` case mismatch | BUILD | 0.5 h | A customer replying to a resolved ticket is silently ignored, always. |
| 8 | Cost meter: read OpenRouter's returned per-request cost; delete the 9-row table's `|| {input:0, output:0}` | BUILD | 1 d | Gross margin becomes a number that exists. |
| 9 | **"Do it yourself" link** on the tool-result card from `manualEquivalentRoute` | BUILD | 1 d | The guarantee that KEY is optional is currently an engineering invariant no user can see. Data exists on both sides. |
| 10 | Restore the FTS trigger + `USING gin(search_vector)` from `migrations-archived/` | BUILD | 1 d | `search_vector` is permanently NULL; the tsvector query matches zero rows and silently falls back to 129 unindexable ILIKEs. |
| 11 | `List-Unsubscribe` + `List-Unsubscribe-Post` headers; Resend bounce/complaint webhook → suppression | BUILD | 1 d | Gmail/Yahoo have required this on bulk mail since 2024. `BOUNCED` is currently only ever set from a send-call failure. |
| 12 | Widen `GENERIC_WRITE` to `/^(apiPost\|apiPatch\|apiPut\|apiDelete)(Simple)?$/`; `/app/continental-ops` and `/app/legal` parent pages + nav | BUILD | 1 d | Three writable screens classified read-only; an entire receiving department with no door. |
| 13 | Pin `chatwoot/chatwoot:latest-ce` and `minio/minio` to a version | ADOPT | 1 h | `:latest` bundles Chatwoot's `enterprise/` directory under a **commercial licence**, not MIT. |

**Wave 0 total: ~3 weeks of work, and it moves the honesty of the product more than the last three months of features.**

## 3.2 Wave 1 — weeks. The money path and KEY's eyes

This is the wave that changes what the product *is*.

| # | Action | B/A | Effort | Unlocks |
|---|---|---|---|---|
| 14 | **Post from the other 13 money modules.** Payroll accrual on `markRunPaid`; Dr Inventory / Cr GRNI on goods receipt; shrinkage on stock-count variance; retainer invoicing; change-order billing | BUILD | 3–4 wk | Makes the ledger the system of record. Everything below depends on it. |
| 15 | `StockMovement` on goods receipt and stock count; stop using `updateMany` without checking the returned count | BUILD | 1 wk | Stock is currently unreconcilable: goods out is recorded, goods in and physical counts are not. A product with no `InventoryStock` row silently increments nothing. |
| 16 | `procurement.markInvoiced` → create `Bill`; three-way match (PO qty / receipt qty / invoice amount) | BUILD | 2 wk | The single reason mid-market businesses buy SAP B1. The chain is severed at exactly one method. |
| 17 | **Money slices in the standing context** — ledger balances, cash, AP due, stock value, pipeline value, payroll committed, open tickets | BUILD | 1 wk | Every proactive act stops being blind. Cheapest large capability gain in the plan. |
| 18 | `safe-to-spend`: `payrollReserved` from `payrollRun.totalGross`; add unbilled WIP from `timeEntry` | BUILD | 2 d | Two lines and one query fix the flagship number. |
| 19 | **Time → invoice.** "Invoice everything unbilled on this project" | BUILD | 1 wk | Both legs exist (`markAsBilled` and `payroll` reading `timeEntry`); nothing in `commerce` or `projects` reads `timeEntry` at all. |
| 20 | **Per-role T2 send policy** + real channel delivery on `helpdesk_reply_to_ticket` | BUILD | 2 wk | Converts eight advisors into eight workers. Nothing else in this plan does that. |
| 21 | **One role model.** `JobRole` → tool envelope → tier ceiling → flow queue. Reconcile the 11 UI module keys with the 20 policy keys. Pass the envelope from the in-app session, not only from a WhatsApp number | BUILD | 3 wk | 35 named jobs become 35 workers instead of 35 inboxes. 16 of 20 policy keys are currently unreachable. |
| 22 | Bridge the dropped events: `deal.*`, `quote.*`, `supportTicket.*`, `purchaseOrder.*`, `inventory.low` | BUILD | 1 wk | 49 of 118 forwarded event names route to zero flows; 23 of 35 role queues are structurally empty. |
| 23 | **MCP from the database.** Move `McpServerConfig[]` into a Prisma model scoped by businessId, token in `keystore`, honour the `_businessId` argument, add a paste-a-URL screen | BUILD | 1 wk | Answers "connect and ingest any and every material" **without writing a 23rd connector**. Vendor-maintained MCP servers already exist for Stripe, Google Workspace, Slack, Notion, Linear, GitHub, Postgres. Keep bridged tools at T3 — MCP output is untrusted text entering a prompt that can call 245 typed tools, and the 200-char cap is not a prompt-injection defence. |
| 24 | **docling on the bank-statement path** and the Drive sweep and CRM import | ADOPT (already running) | 1 wk | PDF statements are what Trinidad banks send. The parser exists as a production sidecar with two callers. |
| 25 | Drive sweep mime filter: add `application/vnd.google-apps.*` and Office types; route through the export path at `google-drive.service.ts:879` | BUILD | 2 d | The sweep currently excludes most of what is in an SMB's Drive, using conversion code that already exists 700 lines away. |
| 26 | Delete `xlsx.d.ts`; route Excel through ExcelJS or docling | BUILD | 1 d | A type stub is currently hiding a MODULE_NOT_FOUND that silently embeds binary garbage. |

## 3.3 Wave 2 — weeks/months. Stop hand-rolling

Every item here replaces code you maintain with code someone else maintains. Four of the six need a dependency **already in `package.json`**.

| # | Replace | With | Licence | Effort | Note |
|---|---|---|---|---|---|
| 27 | 78 in-process timers + the 30-second delay ceiling | **BullMQ** — already installed, already used in `ai/queue.service.ts:113` with `repeat: { pattern, tz }` and idempotent jobIds | MIT | 3–4 wk | Repeatable jobs fire once across N workers *by construction*. This is leader election, horizontal scale and durable flow waits in one move, with no new dependency and no new container. Redis is already in both compose files. Postgres-only alternative: **pg-boss** (MIT). |
| 28 | `model-gateway.service.ts` (2,974 lines, 8 providers) + the 9-row price table | **LiteLLM Proxy** sidecar | MIT | 3 wk | One OpenAI-compatible endpoint, upstream-maintained pricing for every model, per-key budgets, fallbacks, caching. Plausibly deletes 1,500–2,000 lines and turns `aiCreditsPerMonth` from an unenforced field into a proxy-enforced budget. Add **Langfuse** (MIT core — the `ee/` dir is not MIT, self-host OSS) or **Helicone** (Apache-2.0) for traces. |
| 29 | 237 bespoke web components, a 413-line hand-written data table, a dialog with no focus trap | **shadcn/ui** on **Radix** (both MIT), **TanStack Table** (MIT), **cmdk** (MIT), **react-day-picker** (MIT) | MIT | ongoing, screen by screen | shadcn is copy-in — no runtime dependency, no upgrade hostage. And the free one: `react-hook-form` + `zod` are installed and used in **1 file against 2,169 `useState` calls**. Adopt `contact-form.tsx` as the house pattern; it costs nothing but repetition. |
| 30 | Four hand-rolled OAuth refresh helpers | **google-auth-library** — installed at `^10.5.0` with **zero imports in the monorepo** | Apache-2.0 | days | Handles refresh rotation, ID-token verification, clock skew. Then **Nango** (Apache-2.0 core; some enterprise components are Elastic-licensed) for the other 18 connectors' OAuth, backoff and incremental sync. **Airbyte's platform is Elastic License v2** — its connectors are MIT but the platform forbids providing it as a managed service. |
| 31 | `finance/pdf-builder.ts` (136 hand-written PDF bytes) + `zip-builder.ts` (109 lines of hand-rolled PKZip with a CRC32 table) + 2 client-side jspdf paths | **pdfkit** (MIT, installed, 2 callers) and **archiver**/**yazl** (MIT) — or ExcelJS's zip writer, already in the bundle | MIT | 1 wk | Both hand-rolls justify themselves in header comments with bundle-size reasoning that the already-installed dependency invalidates. Also removes the jspdf CVE. **And note: there is no invoice PDF at all** — `grep application/pdf` over `modules/commerce` returns nothing. If branded documents matter, the answer is HTML→PDF: **Gotenberg** (MIT, container) or **Typst** (Apache-2.0). |
| 32 | No e-signature at all | **Documenso** / **DocuSeal** / **OpenSign** — all **AGPL-3.0**, all sidecar | AGPL-3.0 | days | Never build e-sign; it is a legal-evidence product and 90% right is worth nothing in a dispute. Run the unmodified upstream image behind Caddy and talk HTTP — exactly the shape already used for Chatwoot and docling. Do **not** vendor their React components into `apps/web` and do **not** patch their source. |
| 33 | No recurrence, no .ics, no inbound calendar | **rrule.js** (BSD-3), **ical-generator** (MIT), **ical.js** (MPL-2.0) | permissive | 1 wk | "Every second Tuesday" and DST/EXDATE/COUNT-vs-UNTIL are notoriously easy to get subtly wrong. Emitting .ics is the cheapest "works with Outlook and Apple Calendar" win available. Also: `date-fns` is installed, `date-fns-tz` is not, and 14 server files touch timezone. **Cal.com is AGPL** — sidecar only. |
| 34 | 129 `contains:` ILIKE filters | Restored Postgres FTS + `pg_trgm` (Wave 0 #10); **Meilisearch** (MIT) sidecar only if cross-entity search is the goal | MIT | days | **Typesense is GPL-3.0** and **ParadeDB pg_search is AGPL-3.0** — usable as network services, never linked or forked. |

**Write this rule down, once, and every future decision becomes mechanical:**

> **AGPL software is fine as a network sidecar. It is never fine linked into `apps/server` or `apps/web`.** Calling an unmodified upstream image over its own API does not make KEYFLOWOS a derivative work. Vendoring its components or patching its source does.

## 3.4 What NOT to do, and why

A plan that only adds is a wish list. These are refusals.

| Do not | Why |
|---|---|
| **Do not build T&T statutory payroll** (PAYE, NIS, Health Surcharge, TD4) | It is a compliance product with an annual maintenance obligation as rates change, and no OSS engine knows T&T rates — OrangeHRM, Odoo payroll, Frappe HR are all localised elsewhere. Keep `time → hours → gross`, which is genuinely useful and already built, export a bureau-format CSV, and let the accountant channel do the statutory part. If it must exist later, the honest shape is a versioned rates *table* maintained by an accountant, not an engine maintained by an engineer. |
| **Do not build a workflow engine** | BullMQ is installed and `flow-runner.service.ts:283` literally asks for it in a comment. If it must grow beyond that: **Temporal** (MIT) or **Trigger.dev v3** (Apache-2.0). **n8n is NOT open source** — Sustainable Use License, explicitly restricts hosting it for third parties, which is what a SaaS is. **Windmill is AGPL-3.0** — sidecar only. |
| **Do not build a BI / report-builder layer** | A 1–15 person business does not want a dashboard designer; it wants six correct statements and an Excel file its accountant accepts. Fixed reports + ExcelJS (installed) + the accountant export already cover that. What is missing is *scheduled delivery*, which BullMQ does. **Metabase OSS is AGPL-3.0 and the interactive-embedding path is precisely what triggers the network clause** — the most commonly-tripped AGPL trap in SaaS. If BI is genuinely demanded: **Superset** (Apache-2.0) or **Evidence.dev** (MIT). |
| **Do not build an ESP** | Resend already sends bounce/complaint webhooks for free. **Listmonk is AGPL, Mautic is GPL-3.0** — sidecar only, and not worth the ops cost when the tracking layer here already works. |
| **Do not grow `modules/helpdesk`** | Chatwoot is already running and already has the inbox, canned responses, SLAs, teams, CSAT and mobile apps. Generalise the bridge (five env vars including `CHATWOOT_BUSINESS_ID` — **one business per deployment** today) into a per-business connector record and delete the 237-line CRUD table. |
| **Do not write connector #23** | 22 connectors are 9,760 lines and 2 of them pull. MCP-from-the-database (#23) plus Nango covers more surface for less code. |
| **Do not add another key-cortex subsystem** | 70,282 lines against 11,010 for the accounting engine, and the 2026-08-07 analysis's finding stands: most of it never sees a tool call. It is also the only part of the product that acts on its own, which is the wrong distribution. |
| **Do not add another domain module** | 110 modules; 76 of them have zero cron, zero loop and zero listener. Breadth is not the constraint. |
| **Do not build project-management depth** | Monday/Asana win that fight and it does not matter. Build project **profitability** instead — `timeEntry` cost + `expense` + `invoice` on one project id, which is a single query and which no work-management tool can do. |
| **Do not build multi-entity consolidation yet** | It matters and it is a `GROUP BY` over a `businessId` column that already exists, with `skipTenantIsolation()` as the audited cross-tenant read. Do it when a customer with three outlets asks, not before. |
| **Do not fork MinIO** | Its server is AGPL-3.0. Unmodified image + S3 API from a separate process is safe. The larger risk is operational — features are being removed from the community build. **SeaweedFS** (Apache-2.0) or Cloudflare R2 are the exits. Also keep `redis:7-alpine` pinned: Redis 8 moved to AGPL/RSAL. |

## 3.5 The two or three things that matter more than everything else

**1. Make the ledger the system of record — all 18 modules, not 5.**

Every downstream claim depends on it. `safe-to-spend` is wrong without payroll. The P&L is wrong without procurement. The accountant channel — the strongest distribution idea anyone has proposed for this product — is unsellable until the books are complete, because an accountant will find the hole in ten minutes. And this is the only thing on the list that no incumbent can copy: Xero cannot see your bookings, Salesforce cannot post a journal, and neither can be made to.

**2. Give KEY eyes on the money, and one role that can act across departments.**

Two changes. First, the standing context gets ledger, cash, AP, stock, pipeline, payroll and tickets — a week's work that changes every proactive path in the product from blind to sighted. Second, kill the one-role-per-turn gate: `flow-orchestrator.service.ts:1047` picks a single role by a regex race and filters all 245 tools through its allowlist, which is why *"the client cancelled — refund them and release their booking"* is structurally impossible. It routes to `finance` on `/refund/`, and `finance` has `payments_*` but no `bookings_*`. Route it to `support` and you get `bookings_*` with `bookings_cancel_booking` in `blockedTools` and no refund tool. **Neither role can complete the sentence.** That sentence is the product.

**3. Let one role send a message inside its own ceiling.**

Zero of eight roles can deliver anything to a customer today, and the exception that looks like one writes an internal row. Every drafting capability in the product terminates at a human pressing send. "Replace or amplify an employee" fails at the last inch, and it fails uniformly. A per-role send policy — support may reply on an existing thread at T2; finance may send a reminder to a contact with a genuinely overdue invoice at T2 — plus real channel delivery on `helpdesk_reply_to_ticket` is a fortnight, and it is the difference between eight advisors and eight workers.

Everything else in this document is worth doing. If only these three ship, the product is materially different. If all the rest ship and these do not, it is the same product with better tables.

## 3.6 Where the genuine 10x lives — and where it does not

**It lives in exactly one place: one Postgres, one idempotent posting engine, 245 typed tools, all over the same 439 models.** The specific instructions that no incumbent can execute at any price:

| Instruction | Why no incumbent can | Distance here |
|---|---|---|
| "Refund them and release their booking slot" | Stripe has no calendar; Calendly has no ledger | Blocked by one-role-per-turn. Both tools exist. |
| "Invoice everything unbilled on the Ramkissoon project and post it" | Harvest can't post; Xero can't see the timer | Both legs exist. `commerce` and `projects` never read `timeEntry`. One join. |
| "What can I actually spend this week?" — cash, AP due, tax reserved, payroll committed, unbilled WIP, stock on order | Requires five systems to agree | `safe-to-spend` exists and hard-codes `payrollReserved = 0`. |
| "Rank my ticket queue by outstanding customer balance" | Zendesk structurally cannot see an invoice | Nothing joins `supportTicket` to `invoice`. Two columns. |
| "Show me the consolidated P&L for all three of my businesses" | SAP B1 territory, six figures | It is a `GROUP BY` with an audited cross-tenant read helper that already exists. |
| Storefront order posts revenue **and** COGS **and** VAT liability at the moment it is paid | Shopify needs A2X plus Xero plus a monthly reconciliation | **This already works** (`store-order.service.ts` → `invoice-workflow.service.ts:139`) and is marketed nowhere. |

**It does not live in:**

- **Breadth.** Matching Odoo and Zoho on scope with one founder means matching them on nothing else. That was the 2026-08-07 finding and it is still the binding constraint — 110 modules, 76 with no autonomy.
- **Payroll, e-sign, search, BI, email infrastructure, project management, storefront themes, helpdesk UI, workflow engines.** Every one of these is a solved category with a licensed answer, and every hour spent on them is an hour not spent on the six rows above.
- **key-cortex.** 70,282 lines of biological metaphor that reaches the user through a concatenated string. It is not where the differentiation is; the differentiation is 11,010 lines away in `modules/finance` and needs thirteen callers.
- **The tool count.** 245 is already more than any competitor ships and more than any user can consume. The next 100 tools are worth less than making 12 of the existing ones reachable by a role that can act.

---

## Closing

The 2026-08-07 verdict was 5.3/10 with the diagnosis "capability without reachability." One quarter later the nav is fixed, CI is real, and production is deployed — and the same defect has moved down a layer. It is no longer screens with no door. It is **departments that mutate state without writing the record that proves it**, **an AI whose standing picture of the business contains no money**, **a SMART layer that advertises four times what it implements and logs success either way**, and **eight roles that can think and cannot send**.

The distance to the stated vision is about **25%**. The distance measured as "code that could do this exists somewhere in the tree" is about **65%**. Forty points of the vision are already paid for and not connected. That is the best problem to have and the least satisfying one to fix, because closing it looks like deleting things, writing specs, and adding `queue.add()` where a `setTimeout` used to be — none of which feels like progress and all of which is.

The measure of whether the next quarter worked is not a feature count. It is three sentences:

1. `payrollReserved` is a query, not a `0`.
2. "Refund them and release their booking" completes in one turn.
3. A support agent's reply reaches the customer without a human pressing send.

---

# Appendix — the 96 findings, by lens

Six lenses ran independently against the tree at `f502aee4`, each returning a
structured finding list. Nothing here is summarised: this is the raw audit the
strategy above was synthesised from. `depth` is one of absent / shell / crud /
workflow / intelligent.

---

## Lens: Department coverage and depth — 14 findings

**Headline.** The departments that handle money AFTER it is earned — payroll, procurement/inventory, retainers, contract renewals — each mutate business state without writing the record that proves it happened: only 5 of 18 money-touching modules post to the double-entry ledger, goods receipt and stock count change InventoryStock with no StockMovement row, and nothing outside the contracts module ever reads renewalDate. Meanwhile 17 of the server's 26 scheduled jobs live in key-cortex and zero live in contracts, procurement, payroll, helpdesk, projects or marketing — so the AI reasoning layer (110,546 LOC, twice CRM+commerce+finance combined) is the only part of this business OS that acts on its own.

### 1. Cross-cutting — the money path (finance integration)

| | |
|---|---|
| Depth | `workflow` |
| Impact | critical |
| Effort | weeks |

**Today.** A real double-entry posting engine exists and is wired by direct DI, not events: RevenuePostingService is injected by commerce.service, invoice-workflow.service, payments.service and site/store-order.service; ExpensePostingService by expenses.service, invoice-workflow.service, marketplace.service and fulfillment-routing.service. Sales, storefront orders, expenses and marketplace fulfilment all reach the ledger transactionally.

**Gap.** Only 5 of 18 money-touching modules post. Grepping `PostingService|postJournal|journalEntry.create` across each module returns 0 files for payroll, retainers, subscriptions, bookings, procurement, supplier, continental-ops, change-orders, contracts, keystore, community, education and public-events. Concretely: PayrollService.markRunPaid flips status to PAID and moves no money in the books; RetainerAgreement stores monthlyAmount and there is no invoice-creation call anywhere in the module, so a retainer never bills and never posts; goods receipt creates no AP liability. The ledger is therefore not the system of record — a P&L run from reports/ledger-reporting.service.ts is correct only for businesses that do not run payroll, retainers or purchasing.

**Evidence.** grep -rl 'PostingService|postJournal|journalEntry.create' per module dir (5 hit, 13 zero); apps/server/src/modules/payroll/payroll.service.ts markRunPaid (no ledger reference — grep for journal/ledger/posting in payroll/ returns nothing); apps/server/src/modules/retainers/*.service.ts (no invoice.create/createInvoice); bookings by contrast does have bookings.service.ts:268 createInvoiceFromBooking, which routes through commerce and does post.

### 2. People / HR

| | |
|---|---|
| Depth | `crud` |
| Impact | high |
| Effort | months |

**Today.** Four HR models exist in a 439-model schema: OrgAssignment, PayRate, PayrollRun, PayrollItem. PayrollService (301 LOC) is better than its size suggests — effective-dated rates, an overlap guard that rejects a second run covering the same period, hourly runs aggregated from billable TimeEntry, and a genuine DRAFT→APPROVED→PAID transition where each step refuses a wrong predecessor state. staff-performance (313 LOC, 1 write) computes a scorecard from tasks, hours and approval latency.

**Gap.** Grepping schema.prisma for Employee, Leave, TimeOff, PerformanceReview, Applicant, Candidate, Shift, Roster or Attendance returns nothing — there is no employee record, no leave, no recruiting, no scheduling, no reviews. Payroll computes totalGross only: no NIS, PAYE or Health Surcharge (the T&T statutory deductions), no net pay, no payslip, no YTD, no filing export — which makes it unusable as payroll in the target market rather than merely incomplete. And /app/people-flow is not HR: people-overview.service.ts counts contacts, leads, prospects, customers, open deals and follow-ups — it is CRM relationship health wearing an HR name, so the department looks covered in the nav and is not.

**Evidence.** grep -oE '^model (Employee|Leave|TimeOff|PerformanceReview|Payroll[A-Za-z]*|PayRate|OrgAssignment|Applicant|Shift|Roster|Attendance)[A-Za-z]*' packages/db/prisma/schema.prisma → 4 hits, all payroll/assignment; apps/server/src/modules/payroll/payroll.service.ts (totalGross only, no deduction fields); apps/server/src/modules/people-flow/people-overview.service.ts:31-60 (PeopleOverviewDto is contacts/pipeline/followUps).

### 3. Procurement / supply chain

| | |
|---|---|
| Depth | `crud` |
| Impact | high |
| Effort | weeks |

**Today.** Split across five modules with no single owner: procurement (502 LOC — a real DRAFT→SUBMITTED→APPROVED/REJECTED workflow with timeline events, creating a PO at procurement.service.ts:181), continental-ops (723 LOC / 4 services — goods receipt, delivery note, stock count, payment receipt), supplier (1,251), catalog (666) and marketplace. Goods receipt has honest workflow mechanics: PENDING/CHECKED/POSTED/DISCREPANCY, automatic discrepancy detection when qtyAccepted+qtyRejected ≠ qtyReceived, and immutability once POSTED.

**Gap.** The stock mutations do not leave a trail. goods-receipt.service.ts post() and stock-count.service.ts adjust() both change InventoryStock.quantity via updateMany and write no StockMovement row — only delivery-note.service.ts:111 writes one. So goods in and physical counts are invisible in the movement ledger while goods out is recorded, which means stock can never be reconciled. Both use updateMany and never check the returned count, so a product with no InventoryStock row silently increments nothing — the repo's own documented silent-zero class. goods receipt also never updates the PurchaseOrder status (no three-way match; POs stay open forever) and stock-count variance is written off with no GL entry, so shrinkage never reaches the P&L. Two modules create POs independently (procurement.service.ts:181 and marketplace.service.ts:846). The 'AI interpretation' in procurement.create is a hand-rolled inferCategory with the comment 'replace with LLM when quota available'.

**Evidence.** grep -rn 'stockMovement.create' apps/server/src → 8 sites, only 1 in continental-ops (delivery-note.service.ts:111); read apps/server/src/modules/continental-ops/goods-receipt.service.ts:117-138 (post: inventoryStock.updateMany increment, then gr status POSTED — nothing else) and stock-count.service.ts:99-120 (adjust: updateMany set quantity, status ADJUSTED); grep -rn 'purchaseOrder.create' → procurement.service.ts:181, marketplace.service.ts:846, fulfillment-routing.service.ts:521.

### 4. Legal / compliance

| | |
|---|---|
| Depth | `crud` |
| Impact | high |
| Effort | days |

**Today.** contracts (1,157 LOC) stores renewalDate, renewalType and renewalNoticeDays, has DRAFT status, and ships a genuinely good AI clause extractor (contract-clause.service.ts, 191 LOC) with a ~40-clause taxonomy that marks absence of Indemnification, Cap On Liability, Termination For Convenience, Governing Law and IP Assignment as critical. governance (191 LOC) is BusinessRisk CRUD. evidence (494 LOC) and risc (609 LOC, 1 cron) exist.

**Gap.** The renewal machinery is captured and never fires. Nothing outside the contracts module reads renewalDate — the only other occurrences in the whole server are the AI extractor writing it (document-intelligence.service.ts) and the tool registry declaring it as a parameter. The contracts module contains no @Cron and no setInterval at all. So a business enters a renewalNoticeDays value and no code will ever warn it; auto-renewing supplier contracts renew silently and terminable ones lapse. This is the highest-leverage days-sized fix in the audit: one scheduled sweep turns a CRUD table into the department's actual purpose. /app/legal also has no nav entry.

**Evidence.** grep -rn 'renewalDate' apps/server/src --include='*.ts' | grep -v modules/contracts | grep -v spec → only ai/document-intelligence.service.ts (writer) and ai/flow-tool-registry.ts (param declaration); grep -rn 'setInterval|@Cron' apps/server/src/modules/contracts/ → no matches; comm against nav hrefs shows /app/legal absent.

### 5. Support / service — ticketing

| | |
|---|---|
| Depth | `crud` |
| Impact | high |
| Effort | weeks |

**Today.** helpdesk is 237 LOC over a SupportTicket model: list, get, create, update, soft-delete, reply, list messages. It emits supportTicket.created, which two AI default triggers subscribe to (default-triggers.constants.ts:41, :91). Six helpdesk_* AI tools exist and six tools point their manual route at /app/helpdesk.

**Gap.** SupportTicket carries no SLA surface at all — no dueAt, firstResponseAt, resolvedAt or breach field (verified by reading the model); there is no queue, no routing rule, no escalation, and no scheduler in the module. It is a ticket table, not a service desk. There is also a live defect: helpdesk.service.ts:49 writes status 'OPEN' and the schema default is "OPEN" with an uppercase vocabulary (// OPEN, IN_PROGRESS, WAITING, RESOLVED, CLOSED), but replyToTicket at :140 compares ticket.status === 'resolved' || 'closed' in lowercase. The comparison can never be true on a ticket this system created, so the advertised behaviour — 'a reply reopens an open/resolved conversation' — never happens; a customer replying to a resolved ticket is silently ignored. If it ever did match, :143 writes lowercase 'open', desyncing the vocabulary the [businessId, status] index is filtered on.

**Evidence.** apps/server/src/modules/helpdesk/helpdesk.service.ts:49 (status: body.status || 'OPEN'), :140 (=== 'resolved' || === 'closed'), :143 (data: { status: 'open' }); packages/db/prisma/schema.prisma model SupportTicket — status String @default("OPEN"), no SLA/date fields beyond createdAt/updatedAt/deletedAt.

### 6. Support / service — inbound communications

| | |
|---|---|
| Depth | `workflow` |
| Impact | medium |
| Effort | weeks |

**Today.** The strong half of support. communications is 6,215 LOC / 14 services including consent.service, delivery-queue.service, omnichannel-processor.service, interaction-classifier.service, message-intake-orchestrator.service and response-draft.service (with a tenancy spec). key-inbox adds 3,170 LOC: intelligence, analysis, action executor, reply sender and a temporal emitter. Together these classify, draft and act on inbound messages.

**Gap.** The asymmetry is the problem, not the depth: inbound handling is 9,385 LOC and the case record it should feed is 237 LOC of CRUD with no SLA. A conversation can be classified, drafted and replied to without ever becoming a ticket with an owner and a clock, so support work is untrackable in aggregate. key_inbox.reply_sent is also a listener with no emitter per the repo's own analyser.

**Evidence.** ls apps/server/src/modules/communications/ (14 services) and key-inbox/; LOC scan of non-spec .ts per module; docs/OPEN_GAPS_2026-08-09.md and apps/server/src/core/event-bus/event-wiring.spec.ts KNOWN_DEAD list.

### 7. Marketing

| | |
|---|---|
| Depth | `crud` |
| Impact | medium |
| Effort | weeks |

**Today.** Channel execution is real: email-marketing (3,143 LOC), social (2,711), seo (1,597), content-ops (970, with a full content_request.* lifecycle emitted via a template-literal helper and consumed by event-stream). 14 tools point their manual route at /app/marketing, 8 at /app/seo, 10 at /app/content-ops.

**Gap.** The campaign layer that should tie these together is 138 LOC of pure CRUD. MarketingCampaignService reads and writes marketingCampaignPlan with name, goal, audience, offer, channel, budget, expectedRevenue and status 'DRAFT' — and nothing else. There is no actualRevenue, no attribution, no linkage from a campaign plan to an email-marketing send, a social post or a lead, and no code path that executes a plan. A campaign is a note with a budget field. The whole service is written through `(this.prisma.client as any)`, so the schema is not type-checked here. Marketing is therefore the one department where spend is recorded and return is structurally unmeasurable.

**Evidence.** apps/server/src/modules/marketing/*.service.ts read in full (138 LOC, list/create/update/delete/toDto, every call `as any`); CampaignPlanDto has budget and expectedRevenue and no actual/attribution field; module has 0 emits, 0 listeners, 0 schedulers.

### 8. Sales / CRM

| | |
|---|---|
| Depth | `intelligent` |
| Impact | low |
| Effort | days |

**Today.** The deepest department by a wide margin and the only one that genuinely adapts. 68 files, 25,394 LOC, 245 writes, 28 emits, 40 listeners, 13 $transaction. Sequence engine with graph util, scheduler, analytics and an attribution listener; deal-forecast, deal-velocity, deal-health, won-lost-reason; contact-scoring engine, duplicate detection, data-quality service with its own scanner, relationship-health service, best-channel service. 30 AI tools by prefix (13 crm_, 11 deals_, 6 sequence_) and 35 tools name /app/crm as their manual equivalent — the largest manual-parity cluster in the registry.

**Gap.** Two structural notes rather than holes. First, every CRM scheduler uses setInterval (best-channel-scheduler:27, crm-data-quality.scheduler:30, plus lead-scoring, deal-intelligence and relationship-health schedulers) rather than @Cron — CRM contributes 0 of the 26 @Cron jobs. That makes them invisible to any scheduler inventory and, combined with the single-instance constraint already recorded in OPEN_GAPS, they will double-fire on a second replica with no leader election. Second, relationship_health.changed remains in the analyser's UNVERIFIED bucket.

**Evidence.** ls apps/server/src/modules/crm/ (68 files); per-module write/emit/listener scan; grep -rn 'setInterval|@Cron|scheduler' apps/server/src/modules/crm/*.ts; grep -rn '@Cron(' apps/server/src → 26 total, none in crm.

### 9. Finance / accounting (the engine itself)

| | |
|---|---|
| Depth | `workflow` |
| Impact | medium |
| Effort | weeks |

**Today.** The strongest asset in the repo and no longer doorless — the nav now carries ~17 finance labels (Reconcile bank, Tax, Close the month, General ledger, Trial balance, Recurring journals, Assets & depreciation, Bank rules, Credit notes, Exchange rates, Accounting sync). 32 services / 11,010 LOC / 14 $transaction: posting.service, ledger-balance, accounting-period, reconciliation, bank-import with multi-format statement parsers, bank-rule, credit-note, fixed-asset, recurring-journal-entry, tax-liability with a rollup scheduler, accountant-export (608 LOC) and finance-intelligence (935 LOC). reports adds a 1,164-line ledger-reporting service producing P&L, cashflow and aging on both cash and accrual basis.

**Gap.** The intelligence here is advisory, not agentic: finance-intelligence, cashflow-forecast, safe-to-spend and cash-reserve compute and present, but nothing in finance acts — the module carries exactly 1 of the 26 @Cron jobs and, uniquely among large modules, zero event emits and zero @OnEvent listeners (verified by grep for emit(/@OnEvent/EventEmitter2 across finance/ — no matches). That is a defensible synchronous-posting design, but it means no other department can react to a financial fact: nothing can subscribe to 'invoice overdue' or 'period closed'. Combined with the money-path finding above, finance is a correct engine fed by less than a third of the business.

**Evidence.** ls + wc -l apps/server/src/modules/finance/ (32 services, 11,010 non-spec LOC); grep -rn 'emit(|@OnEvent|EventEmitter2' apps/server/src/modules/finance/ → no matches; grep -oE 'label: "..."' apps/web/src/lib/nav-config.ts shows the finance cluster present.

### 10. Operations / delivery

| | |
|---|---|
| Depth | `workflow` |
| Impact | medium |
| Effort | weeks |

**Today.** Broad and moderately deep. calendar (5,181 LOC) is the most reactive module in the codebase with 63 @OnEvent handlers; bookings (4,042) has PENDING/CONFIRMED/COMPLETED/CANCELLED, a booking-optimizer, a no-show listener, 2 schedulers and bookings.service.ts:268 createInvoiceFromBooking that reaches the ledger; task-assignments (1,110), time-tracking (642), change-orders (300), sop (132).

**Gap.** Projects is the thin spot for a delivery business: 1,884 LOC with a task vocabulary of exactly TODO/ACTIVE/DONE (grep of status literals in projects/*.service.ts) — no dependencies, no critical path, no baselines, no resource levelling, no budget-vs-actual. change-orders (300 LOC) never bills — no invoice creation and no posting — so scope changes are recorded and never charged, which is the single most common way a project business loses margin. sop is 132 LOC of CRUD whose version field is hard-coded to 1 on create, so 'version' is decoration.

**Evidence.** grep -oE "status: '[A-Z_]+'" in projects/ → ACTIVE, DONE, TODO only; grep for invoice creation in change-orders/ → none; apps/server/src/modules/sop/*.service.ts create() sets version: 1 with no bump path; per-module counts for calendar (63 @OnEvent) and bookings.

### 11. Analytics / reporting

| | |
|---|---|
| Depth | `workflow` |
| Impact | medium |
| Effort | days |

**Today.** Healthy and correctly shaped. reports is 2,636 LOC with 0 writes — appropriate for a read-only reporting layer, not a shell — including ledger-reporting.service.ts (1,164 LOC) with typed PnlReport/CashflowReport and a cash|accrual basis switch, plus report-formatters (456). analytics (1,470) owns 6 of the 26 @Cron jobs (daily 1am/3am/4am, weekly, monthly 1st). intelligence (2,702), growth-intelligence (1,827, 18 listeners), product-analytics (425), admin-analytics (244, 28 reads / 0 writes).

**Gap.** Almost no agent reach: exactly 1 tool with a reports_ prefix and 1 tool naming /app/reports as its manual equivalent, against 35 for CRM and 19 for finance. For a product whose thesis is 'the agent owns the data layer', the layer that answers 'how is the business doing' is the one the agent can least query. Reporting also cannot be scheduled or delivered — no cron in reports/, so there is no 'email me the P&L monthly'.

**Evidence.** wc -l apps/server/src/modules/reports/*.ts; per-module write scan (reports w=0, r=48); prefix histogram of the 245 tool names (reports: 1) and manualEquivalentRoute histogram (/app/reports: 1); grep '@Cron(' in reports/ → none.

### 12. Admin / platform / settings

| | |
|---|---|
| Depth | `crud` |
| Impact | medium |
| Effort | weeks |

**Today.** identity (4,299 LOC) is substantial; there are 21 /app/settings routes covering AI, autonomy, billing, business, catalog, compliance, custom-fields, developers, invite, notifications, privacy, security, team, templates and webhooks. api-keys, feature-flags, keystore, admin-auth and admin-platform exist.

**Gap.** 15 of the 21 settings routes have no nav entry — the largest doorless cluster in the app (they are presumably reachable from a settings hub, but nothing in nav-config names them). admin-platform is 255 LOC with 3 controllers and 0 services. Role granularity is thin: the previously recorded /keystore/admin/* issue — any member of a business can manage listings and mark orders delivered — is a symptom of authorization being tenant-scoped (BusinessGuard) but not role-scoped at the controller level, which will not survive a business with more than a handful of staff.

**Evidence.** comm -13 of nav hrefs (95, extracted with double-quote pattern from apps/web/src/lib/nav-config.ts) against 176 static /app routes → 86 unreachable, of which settings is the largest bucket at 15; ls apps/server/src/modules/admin-platform/ (0 *.service.ts, 3 controllers); docs/OPEN_GAPS_2026-08-09.md.

### 13. Cross-cutting — where autonomy actually lives

| | |
|---|---|
| Depth | `intelligent` |
| Impact | high |
| Effort | weeks |

**Today.** The AI layer is wired properly and is not vapour: 245 declared tools, and flow-tool-honesty.spec.ts structurally asserts that every declared tool has a case clause in executeToolAction or is an explicitly bridged cortex tool (my own diff: 244 case clauses, 4 declared-not-cased, all bridged). Risk tiers, manual-equivalent routes and the CI check that enforces them are real.

**Gap.** Autonomy is concentrated in the layer that has no department. 17 of the 26 @Cron jobs in the entire server are in key-cortex; the remaining 9 are analytics (6), finance (1), business-genome (1), risc (1). Zero scheduled jobs exist in contracts, procurement, payroll, supplier, helpdesk, projects, marketing or retainers. key-cortex + ai together are 110,546 LOC against 54,039 for crm + commerce + finance combined — the reasoning layer is twice the size of the three largest business departments put together. The vision is 'omnisciently optimise operations'; the measurement is that the departments which would need to act unprompted are exactly the ones with nothing that ever runs. The AI tool surface also over-reaches the department depth beneath it: 12 procurement_ tools and 7 payroll_ tools sit on services of 502 and 301 LOC, so the agent can invoke more procurement capability than the procurement module implements.

**Evidence.** grep -rn '@Cron(' apps/server/src --include='*.ts' | grep -v spec → 26 total, 17 in key-cortex; per-module non-spec LOC scan (key-cortex 70,282 + ai 40,264 vs crm 25,394 + commerce 17,635 + finance 11,010); tool-name prefix histogram over the 245 names extracted from flow-tool-registry.ts; apps/server/src/modules/ai/flow-tool-honesty.spec.ts.

### 14. Cross-cutting — doorless departments

| | |
|---|---|
| Depth | `shell` |
| Impact | high |
| Effort | days |

**Today.** The nav now carries 95 hrefs across the department taxonomy the product uses for itself (Cockpit, KEY, Money, Customers, Schedule, Build, Me), and the finance moat has been connected as the prior analysis recommended.

**Gap.** 86 of 176 static /app routes still have no nav entry, and the pattern matters more than the count. All four continental-ops screens (delivery-notes, goods-receipts, receipts, stock-counts) are unreachable AND there is no /app/continental-ops parent page — an entire receiving-and-inventory department exists in the server, has a working POSTED state machine, and no human can navigate to it. Same for /app/legal. Five nav hrefs point at nothing that resolves: three anchors (#flows, #key, #me) plus /app/marketplace?tab=suppliers and /app/profile?tab=business-genome, which are query-string destinations rather than routes.

**Evidence.** comm -13 /tmp/nav.txt /tmp/routes.txt → 86 of 176; comm -23 → 5 nav targets with no matching page.tsx; find shows continental-ops/{delivery-notes,goods-receipts,receipts,stock-counts}/page.tsx with no sibling continental-ops/page.tsx.

---

## Lens: The manual / smart / AI trichotomy — 15 findings

**Headline.** The trichotomy is enforced in exactly one direction and proved by the wrong evidence: check-tool-routes reports 142/142 manual parity while a human cannot post a journal entry anywhere in the app (the 256-line double-entry composer has been imported by nothing since 4420c4aa, and the /app/finance tools' parity rests on a savings-bucket button) — and the SMART layer, which nothing gates at all, advertises 32 triggers and 25 actions to users and 32/19 to KEY against an engine that implements 8 and 6, logging outcome:'success' either way.

### 15. SMART layer — automation trigger/action vocabulary

| | |
|---|---|
| Depth | `shell` |
| Impact | critical |
| Effort | weeks |

**Today.** /app/automations lets a human build a playbook by picking from 32 triggers and 25 actions (apps/web/src/app/app/automations/components/automation-constants.ts), and KEY can build one from plain English via POST /automation/businesses/:id/ai/generate-flow, whose system prompt names the same 32 triggers and 19 actions (automation.controller.ts:180). The engine behind both is AutomationExecutorService (apps/server/src/modules/flow/automation-executor.service.ts): it dispatches playbooks on 8 event names and its executeAction switch implements 6 action types (add_tag, create_task, update_status, send_email, send_whatsapp, send_email_campaign, plus legacy LOG_EVENT).

**Gap.** 24 of 32 offered triggers never reach executePlaybooks/executeFlows, and 19 of 25 offered actions fall through to `default: this.logger.warn('Unknown action type')`. Of the 19 actions the AI prompt advertises, 5 execute. Worse, executePlaybooks (lines 87-166) increments runCount and writes an ActivityLog with tone:'success', outcome:'success', title 'Playbook X executed' AFTER the action loop, regardless of whether every action hit default — so /app/automations' ExecutionLog and FlowHealthStrip show a green run for an automation that did nothing. flow.service.ts createAutomation validates neither the trigger string nor the action type (the six valid types are listed in a docstring comment at :613-616, not in a check), so KEY can create an ENABLED playbook on 'schedule.daily' with action 'send_sms'. Needs: a registry of implemented triggers/actions that the UI options, the LLM prompt and createAutomation all read from, plus a spec asserting the three lists are the same set — the exact shape of flow-tool-honesty.spec.ts, which covers the AI layer and not this one.

**Evidence.** Derived by set-differencing three lists I extracted directly: UI options via grep -oE 'value: "[a-z_]+"' over automation-constants.ts (25 actions, 32 triggers across 6 TRIGGER_GROUPS); the LLM prompt string at apps/server/src/modules/automation/automation.controller.ts:180 (32 triggers, 19 actions) and :261 (21 triggers); implemented actions via grep -oE "case '[a-z_]+':" over automation-executor.service.ts (6 unique lowercase); implemented triggers via grep of executePlaybooks(...) call sites (8 strings). Cross-checked the unfired triggers: 'contact.inactive', 'contact.no_activity_30d', 'lead.scored', 'recurring.failed', 'subscriber.joined', 'segment.changed', 'staff.assignment_missing' appear in ZERO non-spec server files; 'schedule.daily/weekly/monthly' appear only inside the two prompt strings. Confirmed no spec covers this: grep -rln 'TRIGGER_OPTIONS|ACTION_GROUPS|Available triggers' over all *.spec.ts returns only key-cortex files matching on an unrelated executeAction.

### 16. Finance — manual layer for double-entry books

| | |
|---|---|
| Depth | `shell` |
| Impact | critical |
| Effort | days |

**Today.** KEY has 19 tools rooted at /app/finance* (10 read, 6 organize, 3 execute), including finance_post_journal_entry (organize, T3), finance_pay_bill (execute, T3), finance_create_bill, finance_create_coa_account and finance_auto_match_bank. The server backs them: POST /finance/journal-entries and POST /finance/chart-of-accounts exist among 108 finance endpoints in finance.controller.ts. The manual side does not. /app/finance/page.tsx is a 6-line redirect to /app/financial-flow, a cash-flow cockpit whose only writes are createReserveBucket / deleteReserveBucket / resolveFlowSignal. /app/finance/journal redirects to /app/finance/ledger, which imports only fetchGeneralLedger. apps/web/src/lib/api/finance.ts has no journal-entry or COA create at all.

**Gap.** A human cannot post a journal entry or pay a bill from any screen in the app, while KEY can do both at T3. The screen that did it still exists: apps/web/src/app/app/finance/components/books-journal-tab.tsx is a 256-line balanced double-entry composer (debit/credit lines, `balanced` check, calls createJournalEntry from lib/client.ts) — and grep across apps/web/src and apps/web/scripts finds ZERO importers of it, or of books-accounts-tab.tsx, books-snapshot-tab.tsx, books-cashflow-tab.tsx (905 lines orphaned in total). Fix is small and known: re-mount the four tabs on a real /app/finance/books route and repoint finance_post_journal_entry / finance_pay_bill / finance_create_bill at the screens where a person actually does them (/app/finance/books, /app/expenses).

**Evidence.** git show 4420c4aa^:apps/web/src/app/app/finance/page.tsx shows the pre-2026-06-03 page rendering BooksSnapshotTab/BooksCashflowTab/BooksAccountsTab/BooksJournalTab in a 4-tab shell; commit 4420c4aa ('refactor(redundancy): Remove 20+ redundant pages') replaced it with redirect('/app/financial-flow') and left the components behind. Orphan status established by `grep -rn 'books-journal-tab|books-accounts-tab|books-snapshot-tab|books-cashflow-tab' apps/web/src apps/web/scripts` → exit 1, no matches. Absence of a manual write path confirmed by grepping every web consumer of createJournalEntry (only the orphan), createFinanceCoa (/app/finance/settings only) and markBillPaid (absent from apps/web entirely, though flow-orchestrator.service.ts:4582 calls getExpenses().markBillPaid for finance_pay_bill).

### 17. Manual-parity gate — direction and evidence quality

| | |
|---|---|
| Depth | `workflow` |
| Impact | high |
| Effort | days |

**Today.** apps/web/src/lib/tool-route-audit.ts is a genuinely sophisticated gate: it resolves redirect() shims, follows next.config redirect tables, walks the import graph 3 deep to find a mutation imported from the api layer, and runs its own negative control (assertParityCheckWorks pins /app/accounting as read-only and /app/contracts as writable so a broken checker cannot pass silently). I ran it: 245/245 tools declare manualEquivalentRoute, 245/245 resolve to a real page, 142/142 write tools have manual parity, 142/142 point inside their own domain.

**Gap.** The check proves *a* mutation exists on the destination screen, not *the* mutation — the repo already identified this failure mode for domain parity and built crossDomain to catch it, but crossDomain is a substring test on the tool's name prefix, so 'finance_post_journal_entry' → '/app/finance' passes on the word 'finance'. All 13 tools rooted at /app/finance therefore rest their parity claim on createReserveBucket, a savings-bucket button on /app/financial-flow. And the gate points one way only: nothing asserts that a screen a human can write from is also reachable by KEY. Needs (a) parity evidence keyed to the tool's own api function, not any function on the page, and (b) a reverse spec — the same shape as nav-reachability.spec.ts, which was added for exactly this asymmetry in navigation.

**Evidence.** Ran `apps/web/node_modules/.bin/tsx scripts/check-tool-routes.ts` in /c/kfm/apps/web for the live 142/142 figure. Traced the finance chain by hand: apps/web/src/app/app/finance/page.tsx → redirect('/app/financial-flow'); financial-flow/page.tsx imports createReserveBucket/deleteReserveBucket from @/lib/api/finance, which satisfies MUTATION_NAME. Read the CROSS_DOMAIN_ROUTES and MANUAL_PARITY_EXEMPTIONS tables (tool-route-audit.ts:180-290) — the exemption list has 7 entries, all procurement. Confirmed no reverse gate exists by listing every invariant spec (grep -rl 'readFileSync|readdirSync' --include=*.spec.ts): nav-destinations, nav-reachability, no-fabricated-screens, inventory-reachability all check screens; none checks tool coverage of a screen.

### 18. Manual/AI trichotomy — reverse coverage

| | |
|---|---|
| Depth | `crud` |
| Impact | high |
| Effort | months |

**Today.** 245 tools name only 40 distinct manual routes. 169 of the app's 209 /app screens are named by no tool at all. Splitting those 169 with the repo's own canWrite() instrument: 95 are screens a human CAN write from with no AI equivalent, and 74 are read-only screens with no AI equivalent. At area level, 48 of ~84 route areas have zero tools, covering 98 routes — including /app/settings (21 routes), /app/presence (7), /app/intelligence (5), /app/money (5), /app/continental-ops (4), /app/events (4), /app/assets, /app/budgeting, /app/retainers, /app/portal, /app/change-orders, /app/legal, /app/whatsapp (a 517-line screen), /app/social (2 routes, though social_* tools point at /app/marketing).

**Gap.** The vision says every function is available three ways. The measured shape is: MANUAL is the deep layer (132 of 209 screens writable, 1,194 server write endpoints across 167 controllers), AI is the thin one (142 write tools ≈ 12% of the server's write surface), SMART is the thinnest. The asymmetry is not random — it tracks whichever domain got a tool batch. Needs a per-domain coverage target and a gate that fails when a writable screen in a nominated domain has no tool, so the backlog is visible the way nav-reachability made orphan screens visible.

**Evidence.** Parsed all 245 tools out of flow-tool-registry.ts (245 name lines at 4-space indent; families read 95 / crud 65 / organize 42 / execute 35 / draft 8; tiers T1 122, T2 90, T3 30, T4 3 — matches the gate's own 142 write-tool count). Enumerated 209 page.tsx routes and 90 /app nav hrefs from nav-config.ts. Ran a script that reuses tool-route-audit.ts's canWrite/resolveImport/isApiModule verbatim over every route: 129 writable / 80 read-only strict, 132/77 when apiPostSimple is also counted. 95 + 74 = 169 reconciles exactly against 209 − 40 named routes. Server endpoint counts by grep -rhE '^\s*@(Post|Patch|Put|Delete)\(' over *.controller.ts.

### 19. SMART layer — where the app acts on its own

| | |
|---|---|
| Depth | `workflow` |
| Impact | high |
| Effort | months |

**Today.** 25 @Cron methods across 13 services (16 of them in key-cortex) plus 45 setInterval+onModuleInit scheduler loops across the domain modules — invoice-overdue, quote-stale, recurring-invoice, recurring-expense, recurring-journal-entry, tax-liability-rollup, finance-intelligence, crm-sequence-scheduler, lead-scoring, campaign-scheduler, abandoned-cart-recovery, review-solicitation, currency-rates, and more. On top of that a real event bus: 344 @OnEvent decorators over 165 distinct event names, of which the repo's own analyser reports 144 LIVE, 9 DYNAMIC, 2 UNVERIFIED, 10 DEAD.

**Gap.** The substrate is strong and unevenly distributed: 76 of 110 server modules have zero cron, zero scheduler loop and zero listener. That set includes procurement (12 tools, 4 screens), contracts (11 tools), projects, time-tracking, helpdesk, payroll, documents, evidence, approvals, continental-ops, assets, portal, retainers, change-orders, community and keystore. So for roughly two-thirds of the product the answer to 'where does the app act on its own' is: nowhere. Also, none of this substrate is reachable by a user — the only user-configurable consumer of the event bus is the 8-trigger automation executor above.

**Evidence.** Wrote a per-module scanner over apps/server/src/modules that counts ^\s*@Cron(, files containing both setInterval( and onModuleInit, and @OnEvent('...') occurrences, excluding *.spec.ts/*.test.ts. Totals: cron 25, loops 45, listeners 344, .emit( call sites 301. Ran the repo's own analyser (apps/server/scripts/event-wiring.ts via tsx) for the LIVE/DEAD split; its gate apps/server/src/core/event-bus/event-wiring.spec.ts holds a KNOWN_DEAD list of 10 (booking.deleted, storefront.order_created and 8 key.* realtime events).

### 20. SMART layer — delegation loops

| | |
|---|---|
| Depth | `workflow` |
| Impact | high |
| Effort | weeks |

**Today.** apps/server/src/modules/autopilot/delegation-loop.service.ts is 1,607 lines defining 5 loops (payment_recovery, lead_reactivation, post_purchase, booking_prep, weekly_hygiene) on a 5-minute sweep, with per-business intervals, milestone dedupe, a contact-window check evaluated at send time rather than at task creation, and adaptGovernanceFromHistory which promotes/demotes maxAutoTier on approval rate. Each has an execute-family tool (delegation_*) and a manual card on /app/automations (autopilot-loops.tsx).

**Gap.** Only payment_recovery actually performs an outbound action. `this.emailService.send(` appears exactly once in the file (line 668) and no other send/dispatch path exists in it; the other four loops create AutopilotTask rows and stop. Their LOOP_DEFINITIONS descriptions say otherwise — post_purchase: 'Sends thank-you messages (2h), review requests (7d), and cross-sell prompts (14d)'; booking_prep: 'Sends preparation reminders before appointments'. The field that would gate execution, autoExecutable, is written at 7 sites in this file and read by nothing: no where-clause, no branch, no UI. So four fifths of the delegation layer is a to-do list wearing an automation's description.

**Evidence.** grep -n 'emailService.send|AUTO_EXECUTED' over delegation-loop.service.ts returns one send at :668, inside runPaymentRecovery (established by awk-tracking the enclosing `private async run*` function). grep -rn 'autoExecutable' across apps/server/src and apps/web/src returns only data: writes, DTO fields, template constants and a zod schema — no read that conditions execution. Loop descriptions read from LOOP_DEFINITIONS at delegation-loop.service.ts:44-88.

### 21. SMART layer — Flow Studio action registry

| | |
|---|---|
| Depth | `crud` |
| Impact | high |
| Effort | weeks |

**Today.** /app/flows is a visual flow builder (309 + 531 + 186 lines) backed by FlowRunnerService (449 lines, with idempotency keys, published versions and FlowRun records). Its action vocabulary is FlowActionRegistry (apps/server/src/modules/flow/flow-action.registry.ts, 207 lines) with 6 registered types: create_command_item, draft_message, notify_user, create_task, send_message, create_contact.

**Gap.** Four of the six only write a CommandItem or a ResponseDraft — the flow's output is a row in someone's queue. The one that claims to act, send_message, has the fabricated-success defect the repo has gates for elsewhere: with requiresApproval:false it executes `return { sent: true, channel, body, direct: true }` (line 160) and calls no messaging service. `direct` is read nowhere in the codebase, and FlowRunnerService records the run as successful. tool-honesty-sweep.spec.ts pins five instances of exactly this class on the AI side (commerce_send_invoice, schedule_action, automations_create_playbook, store_list_products, bulkUpdateInvoices) and none on the SMART side.

**Evidence.** Read flow-action.registry.ts in full — 6 this.register(...) calls. `grep -rn 'direct: true|\.direct\b' apps/server/src` (excluding specs) returns the single producing line and no consumer. Compared against apps/server/src/modules/ai/tool-honesty-sweep.spec.ts and flow-tool-honesty.spec.ts, whose scans read flow-orchestrator.service.ts only.

### 22. Roles and departments — the 35 employee roles

| | |
|---|---|
| Depth | `shell` |
| Impact | high |
| Effort | months |

**Today.** apps/server/src/modules/flow-signal/flow-role-subscriptions.config.ts defines 35 employee roles (Data Entry Clerk, AR Clerk, Bookkeeper, SDR/BDR, L1/L2 Support Agent, Procurement Buyer, HR Administrator, Paralegal, Medical Receptionist/Biller/Coder …), each subscribing to FlowSignal streams by flow type and type prefix. /app/key-flows lists them and /app/key-flows/[rolekey] renders each role's live queue. Signals arrive through a real chain: domain events on EventEmitter2 → EventEmitterFlowBridgeService (441 lines, ~30 event-prefix patterns) → KeyCortexEventBus → FlowSignalBridgeService → FlowRouterService → FlowSignal rows.

**Gap.** A role can do exactly three things to an item: resolve, mark action-required, snooze (flow-signal.controller.ts:46-68; the [rolekey] page imports only resolveFlowSignal). No role has tools, autonomy, a risk ceiling, or a drafted action attached. And it is a second, disconnected role system: the 8 roles that DO carry approvedTools/blockedTools/maxRiskTier/autonomyLevel live in apps/server/src/modules/ai/role-engine.service.ts, and getRoleDefinition in flow-signal is never called from ai/, nor the reverse. 'Replace or amplify every type and tier of employee' currently ships as 35 notification inboxes. The join is the product: give each of the 35 a tool allowlist and a tier, and reuse the existing approval orchestrator.

**Evidence.** grep -c "key: '" over flow-role-subscriptions.config.ts → 35. Read role-flow.service.ts (read-only queue assembly) and flow-signal.controller.ts (the only three POSTs). grep -rn 'FLOW_ROLE_SUBSCRIPTIONS|getAllRoleDefinitions|getRoleDefinition' across apps/server/src shows two closed clusters: flow-signal/* and ai/role-engine.service.ts, with no edge between them.

### 23. The 'do it yourself' link

| | |
|---|---|
| Depth | `absent` |
| Impact | high |
| Effort | days |

**Today.** Every tool declares manualEquivalentRoute, CI enforces it 245/245, and CapabilityContractService projects it onto GET /capabilities (capability-contract.service.ts:125). The registry docstring states the purpose: 'KEY surfaces this as a "Do it yourself" link so the AI is never the only way to take an action.'

**Gap.** It is surfaced nowhere. `manualEquivalentRoute` appears in zero files under apps/web/src, the web app never calls /capabilities, and no chat component navigates to a screen after a tool runs — key-message-renderer.tsx has no router.push or <Link> at all. So the guarantee that KEY is optional is an engineering invariant a user never sees; in the product, chat is the only visible path to the 142 things KEY can change. This is the cheapest high-value item on the list: one link on the tool-result card, driven by data that already exists on both sides.

**Evidence.** grep -rn 'manualEquivalentRoute|Do it yourself|manualRoute' over apps/web/src (excluding tool-route-audit.ts and __tests__) → no matches. grep for '/capabilities' as an api path in apps/web/src → no matches (the only 'capabilities' hits are business-genome operations endpoints). grep -rn 'router.push|<Link' over apps/web/src/components/key/chat/key-message-renderer.tsx → no matches.

### 24. Administration — settings, team, permissions

| | |
|---|---|
| Depth | `absent` |
| Impact | medium |
| Effort | weeks |

**Today.** 21 screens under /app/settings (team, invite, security, privacy, compliance, notifications, webhooks, developers, custom-fields, templates, output-templates, catalog, billing, ai, ai-control, autonomy, conversion, insights, business, profile). Most are writable by hand — settings/team is 1,015 lines, settings/webhooks 627, settings/custom-fields 529.

**Gap.** Zero AI tools target any of them, in either direction: no tool's manualEquivalentRoute is under /app/settings, and no tool prefix in the registry corresponds to team, invite, permission, webhook, custom-field or notification administration. KEY can create a purchase order at T2 and pay a bill at T3, but cannot invite a colleague, grant a permission, change a notification preference or add a custom field. For a product whose stated aim is to replace or amplify every tier of employee, the administrator is the tier with no AI layer at all — and it is the tier a small business owner most wants to stop being.

**Evidence.** Area cross-reference of the 245 parsed tool routes against the 209 enumerated routes: /app/settings has 21 routes and 0 tools. Confirmed independently against the 55 distinct tool-name prefixes extracted from the registry — none is settings/team/user/permission/webhook/field/notification shaped. Screen line counts from the canWrite scan.

### 25. AI layer — the 'smart/assist' middle inside the registry

| | |
|---|---|
| Depth | `shell` |
| Impact | medium |
| Effort | weeks |

**Today.** The registry's own middle layer — the draft family, where KEY proposes and a human commits — is 8 of 245 tools (3%): draft_followup_message, draft_campaign_bundle, draft_payment_reminder, draft_storefront_copy, draft_project_update, generate_content_brief, call_generate_script, helpdesk_draft_reply. The registry is otherwise 95 read and 142 write.

**Gap.** The three-layer promise is implemented inside the AI as a risk ladder (T3/T4 → approval) rather than as a capability ladder (propose → review → commit). That works for money movement and fails for judgement work: there is no draft_ tool for a contract clause, a quote, a job description, a supplier email, a social reply, an SOP or a policy — all things where an owner wants a first draft rather than either a blank screen or an autonomous act. The infrastructure exists (ResponseDraft rows, the approvals screen, the approval orchestrator); the tool family does not use it.

**Evidence.** Family tallies from the registry parse (read 95 / crud 65 / organize 42 / execute 35 / draft 8, summing to 245 and matching the gate's 142 write tools). The 8 draft tools listed by filtering the parsed registry on family === 'draft'; all are T1 except generate_content_brief (T2).

### 26. Payroll

| | |
|---|---|
| Depth | `crud` |
| Impact | medium |
| Effort | weeks |

**Today.** 7 tools, 3 of them execute at T3 — payroll_generate_run, payroll_approve_run, payroll_mark_paid — plus payroll_set_rate (organize T2). One manual screen at /app/payroll (319 lines, in nav, writable). Zero smart layer.

**Gap.** The whole implementation is apps/server/src/modules/payroll (3 files, 301 lines: a 228-line service over PayRate and pay runs from time entries or flat salaries). There is no PAYE, NIS or Health Surcharge computation, no payslip, no statutory filing — in a product whose differentiator is being priced and built for Trinidad & Tobago. The AI layer is at its most powerful (T3, money out) over the thinnest domain implementation in the repo, and no cron or listener touches payroll, so nothing runs a period on its own. Either deepen the domain or drop the execute tools to draft/organize until it is real.

**Evidence.** Tool list filtered from the registry parse. wc -l over apps/server/src/modules/payroll/*.ts → 301 total (controller 61, module 12, service 228). Read payroll.service.ts head — setRate/listRates over PayRate with currency defaulting to TTD, no statutory deduction logic. Per-module scanner shows payroll: cron 0, loops 0, listeners 0.

### 27. Procurement

| | |
|---|---|
| Depth | `crud` |
| Impact | medium |
| Effort | weeks |

**Today.** 12 tools (4 read, 6 crud, 2 execute incl. procurement_issue_po at T3), 4 screens (/app/procurement, /new, /suppliers, /[requestId]) in nav, and a 5-file/500-line server module.

**Gap.** Procurement holds all 7 entries in MANUAL_PARITY_EXEMPTIONS — the only exemptions in the gate. The stated reason is honest and correct (the mutations live on /app/procurement/[requestId], and canWrite cannot see a sibling route reached by navigation rather than by import), but the effect is that the largest single block of write tools in the registry has its manual parity asserted by comment rather than measured. And the domain has no smart layer at all: nothing watches a PO for late acknowledgement or overdue fulfilment, which is the one thing procurement automation is for. The gate needs a route-graph notion of 'reachable detail route', not more exemptions.

**Evidence.** MANUAL_PARITY_EXEMPTIONS read in full at apps/web/src/lib/tool-route-audit.ts (7 entries, all procurement_*, with the import-graph reasoning in the comment above them). Tool list from the registry parse; /app/procurement measured read-only by canWrite (205 lines) while /app/procurement/[requestId] (508 lines) is writable. Per-module scanner: procurement cron 0, loops 0, listeners 0.

### 28. Manual-parity gate — write detection blind spot

| | |
|---|---|
| Depth | `workflow` |
| Impact | low |
| Effort | days |

**Today.** canWrite() recognises a manual write via MUTATION_NAME (a verb-prefixed named import) or GENERIC_WRITE = /^(apiPost|apiPatch|apiPut|apiDelete)$/. The app has a second transport convention: apiPostSimple / apiGetSimple in apps/web/src/lib/api.ts:253, used by 22 non-lib files including the 517-line /app/whatsapp screen.

**Gap.** An exact-match regex on apiPost means apiPostSimple is not counted, so three screens that a human can write from are classified read-only. Nothing fails today because no write tool points at them — but the failure mode is the one the file's own comments warn about twice (the /app/time-tracking case: 'two defects hiding each other: the wrong route, and a checker that would have rejected the right one'). Widening GENERIC_WRITE to /^(apiPost|apiPatch|apiPut|apiDelete)(Simple)?$/ is a one-line change; the self-test fixtures still hold.

**Evidence.** Ran my canWrite replica twice over all 209 routes, identical except for that regex: 129 writable with the repo's version, 132 with (Simple)? added. grep -rl 'apiPostSimple' apps/web/src excluding lib/ → 22 files; apiPostSimple defined at apps/web/src/lib/api.ts:253.

### 29. AI layer wiring — the part that is genuinely done

| | |
|---|---|
| Depth | `intelligent` |
| Impact | medium |
| Effort | days |

**Today.** Of 245 declared tools, 241 have a case clause in flow-orchestrator.service.ts::executeToolAction and the remaining 4 (inbox_list_threads, inbox_read_thread, inbox_brief, inbox_mark_resolved) dispatch through CORTEX_TOOL_BRIDGE. flow-tool-honesty.spec.ts asserts the structural property and separately proves the bridge exemption cannot be used to silence it; tool-honesty-sweep.spec.ts pins five specific fabricated-success defects; event-wiring.spec.ts holds the dead-listener count at 10 and includes a canary test proving the detector can still fail.

**Gap.** Nothing is missing in the AI layer's wiring — this is the layer that works, and it is the reason the other two look thin by comparison. The gap is that every one of these gates points at the AI layer. The same three defect classes (declared-but-unhandled, reports-success-without-acting, listener-with-no-emitter) all recur in the SMART layer — 19 unhandled playbook actions, send_message returning sent:true, autoExecutable written and never read — and no gate looks there. The cheapest structural move in this whole audit is to point the existing instruments at flow/ and autopilot/.

**Evidence.** Ran a node script comparing the 245 `name:` entries in flow-tool-registry.ts against `case '...':` occurrences inside executeToolAction in flow-orchestrator.service.ts (5,886 lines): 241 matched, 4 bridged. Read flow-tool-honesty.spec.ts, tool-honesty-sweep.spec.ts and core/event-bus/event-wiring.spec.ts; ran apps/server/scripts/event-wiring.ts directly (165 listeners, 144 live, 10 dead).

---

## Lens: Employee and role coverage — 18 findings

**Headline.** KEY has eight department hats and 245 tools, but no role can deliver a single message to a customer within its own risk ceiling — the only outbound action any role can take unapproved is `operator` sending an invoice, and the helpdesk 'reply' that looks like the exception writes an internal row and never sends. Beneath that, the one layer that models a real job title (JobRole → tool envelope) is reachable only from a staff member's WhatsApp number and, with every permission in the product's own UI set to admin, reaches 56 of 245 tools and zero money tools.

### 30. Outbound communication — every customer-facing role

| | |
|---|---|
| Depth | `shell` |
| Impact | critical |
| Effort | weeks |

**Today.** KEY can reason for any role but can deliver almost nothing to a customer. Every tool that actually leaves the building is riskTier 3 or 4: send_message_with_approval (T3), inbox_reply_thread (T3), comms_send_broadcast (T3), commerce_send_invoice (T3), marketing_send_campaign (T4), social_publish_post (T4). sales/finance/support/marketing all cap at maxRiskTier 2 and general/executive at 1, so every one of these needs a formal human approval every single time. The one apparent exception, helpdesk_reply_to_ticket (T2), does not send: HelpdeskService.replyToTicket writes a SupportTicketMessage row with channel 'internal' and never calls an email/WhatsApp/SMS sender. The only outbound action ANY role can perform inside its own ceiling is commerce_send_invoice by the `operator` role (maxRiskTier 3).

**Gap.** There is no tier-2 delivery path for any role. 'Replace or amplify an employee' fails at the last inch: KEY drafts the reply, the reminder, the campaign — and a human still presses send on all of it. A per-role send policy (e.g. support may reply to an existing thread at T2; finance may send a reminder to a contact with an overdue invoice at T2) plus real channel delivery on helpdesk_reply_to_ticket is what converts eight advisors into eight workers.

**Evidence.** Computed the role×tool matrix from apps/server/src/modules/ai/role-engine.service.ts and flow-tool-registry.ts (245 tools parsed): 22 tools are reachable by some role but above EVERY role's maxRiskTier. Tier assignments read from the registry. helpdesk.service.ts:117-148 shows replyToTicket only inserts a row. ai-oversight.service.ts:185-193 shows tier 3 → requiresFormalApproval.

### 31. Position-scoped governance (JobRole) — the only layer that models a real job title

| | |
|---|---|
| Depth | `crud` |
| Impact | critical |
| Effort | days |

**Today.** JobRolePolicyService.envelopeForJobRole maps a JobRole.permissions JSON ({module: read|write|admin}) onto tool patterns. It is real and it works. But the ONLY UI that creates a JobRole (apps/web/src/app/app/structure/components/job-roles-panel.tsx:16-27) offers 11 module keys: crm, revenue, bookings, projects, content, expenses, automations, storefront, settings, ai, team. Only FOUR of them (crm, bookings, projects, content) exist as keys in MODULE_TOOL_FAMILIES. The other seven grant nothing. And 16 of the policy's 20 keys — finance, sales, commerce, calendar, time, marketing, social, helpdesk, comms, inbox, structure, hr, contracts, legal, procurement, documents — can never be produced by the product.

**Gap.** A named position defined through the product, with every toggle set to admin, reaches 56 of 245 tools and ZERO money tools (no finance_*, commerce_*, payments_*, expenses_*, reconcile_*, payroll_*). The permission vocabulary in the UI and the vocabulary in the policy service were written independently and never reconciled; nothing fails when they diverge.

**Evidence.** Simulated JobRolePolicyService.isToolAllowed over all 245 registry tools with every UI key granted: 56 reachable (32 T1 / 18 T2 / 6 T3), families read:24 crud:20 organize:9 execute:3, domains fetch:12 crm:13 bookings:6 projects:8 content:8 calendar:3 time:5 documents:1. Set-differenced the UI key list against MODULE_TOOL_FAMILIES in apps/server/src/modules/structure/job-role-policy.service.ts:19-40.

### 32. Position governance reachability — in-app chat vs staff phone

| | |
|---|---|
| Depth | `workflow` |
| Impact | high |
| Effort | days |

**Today.** jobRoleEnvelope is passed to FlowOrchestrator from exactly one call site: StaffChatBridgeService (apps/server/src/modules/structure/staff-chat-bridge.service.ts:127), reached only when an inbound WhatsApp/SMS number matches StructureService.resolveStaffByPhone. Every in-app chat request goes through flow.controller.ts with no envelope, so it falls back to the eight department roles.

**Gap.** The layer that models 'this specific person holds this specific position' is unreachable from the app itself. A logged-in bookkeeper and a logged-in owner get identical KEY authority; only a staff member texting from a registered phone gets position scoping. Also: pageContext is an inline-typed @Body() in flow.controller.ts:26/61, so the global ValidationPipe whitelist does not strip it (the repo documents this exact behaviour at key-genome.controller.ts:179) — a client can supply its own jobRoleEnvelope, and in ai-oversight.service.ts:129-138 the presence of an envelope SKIPS the department-role check entirely.

**Evidence.** grep for `jobRoleEnvelope` across apps/server/src and apps/web/src returns 5 hits: the type declaration, three governance.evaluate call sites in flow-orchestrator.service.ts, and the single producer in staff-chat-bridge.service.ts. Read flow.controller.ts:20-80 for the inline body type.

### 33. Bookkeeper / AR-AP clerk

| | |
|---|---|
| Depth | `workflow` |
| Impact | high |
| Effort | weeks |

**Today.** Best-served role in the product. `finance` reaches 91/245 tools, 81 within its tier-2 ceiling, 29 of them acting (execute/crud/organize). It can list receivables and payables, create COA accounts and bills, auto-match the bank, run reconcile_run_auto_match / match_line / connect_statement_source / sweep_statements, create invoices, and draft payment reminders.

**Gap.** KEY cannot read the books it is allowed to write to. The 12 finance_* tools contain no trial balance, no general-ledger read, no accounting-period close, no credit note, no fixed-asset, no tax-liability tool — while /app/finance ships 13 screens for exactly those (nav-config.ts:174-189). And the two tools a bookkeeper's job actually turns on, finance_post_journal_entry and finance_pay_bill, are T3, above finance's ceiling of 2, so every journal and every bill payment is a formal approval. Also blind to reality: no FlowSignal type starting transaction./bank./reconciliation. is emitted anywhere, so the BOOKKEEPER flow queue is permanently empty.

**Evidence.** Per-domain matrix computed from role-engine + registry: finance row = finance 10/12, reconcile 6/6, payroll 4/7, commerce 8/9, sequence 4/6. Enumerated all finance_* tool names from flow-tool-registry.ts. Cross-referenced nav finance hrefs. Simulated the event→FlowSignal→role-queue pipeline over all 234 emitted event names.

### 34. Accountant / Controller / CFO (the `executive` role)

| | |
|---|---|
| Depth | `crud` |
| Impact | high |
| Effort | days |

**Today.** `executive` reaches 52/245 tools, 48 within its ceiling, of which only 4 are acting tools — the rest are reads. It is a genuine advisor: receivables, balances, forecasts, pipeline velocity, contracts_stats, inventory_summary, goals.

**Gap.** The role designed to decide approvals cannot decide one. approval_decide_step is riskTier 3; executive.maxRiskTier is 1; applyRoleCeiling clamps maxAutoTier to 1, so evaluate() falls through to requiresFormalApproval — the approver must raise an approval to approve. The reachability spec asserts isToolAllowed('executive','approval_decide_step') === true and passes, because it checks the allowlist shape and never the tier ceiling. This is the same green-but-wrong class the repo has already fixed twice elsewhere. A real CFO also has no close-the-month, no variance, no cash-forecast tool.

**Evidence.** executive maxRiskTier=1 (role-engine.service.ts:371); approval_decide_step riskTier 3 (registry). Traced ai-oversight.service.ts evaluate() lines 159-193 with settings clamped by applyRoleCeiling (line 124). Spec at role-tool-reachability.spec.ts:122-124 asserts only allowlist membership.

### 35. External accountant

| | |
|---|---|
| Depth | `crud` |
| Impact | high |
| Effort | weeks |

**Today.** AccountantExportService (apps/server/src/modules/finance/accountant-export.service.ts) builds a real ZIP — P&L, cashflow, balance sheet, AR/AP aging, tax summary, trial balance, general ledger, audit log, manifest — and accountant-export-email.service.ts can mail it. That is genuinely good and more than most SMB tools ship.

**Gap.** There is no external-accountant identity. Membership.role is only OWNER/ADMIN/STAFF (schema.prisma:2170-2193); PortalAccess (schema.prisma:10565) is keyed to a contactId with settings {invoices, projects, documents, bookings} and the portal controller exposes only token CRUD plus /validate — no accountant-facing read of the ledger, no ability for them to post an adjusting entry or ask KEY a question. The distribution channel the CRITICAL_ANALYSIS calls out as strategically decisive (Tier 3 item 21) has a file export and no seat.

**Evidence.** Read accountant-export.service.ts:1-60 and portal.controller.ts (5 endpoints). grep of schema.prisma for models matching accountant|contractor|franchis returns nothing; enum search shows no member-role enum.

### 36. Salesperson / SDR

| | |
|---|---|
| Depth | `workflow` |
| Impact | high |
| Effort | days |

**Today.** `sales` reaches 74/245, 71 within ceiling, 29 acting. Full crm_* (11/12 within ceiling), full deals_* (10/10), bookings_*, commerce_create_quote/create_invoice, draft_followup_message, create_followup_queue, tag_contact, segment_contacts, payments_create_link.

**Gap.** The cadence engine is in the wrong role. All six sequence_* tools (list/create/enroll/enroll_overdue/unenroll/pause_resume) are approved only for `finance` — the sales role cannot enrol a lead in a follow-up sequence at all, and the two enrol tools are T3 even there. The SDR_BDR flow queue only sees sequence.step.due / sequence.step.failed. Combined with the T3 send ceiling, the sales role can create the deal and draft the follow-up but can neither send it nor automate it.

**Evidence.** role-engine.service.ts:214 lists 'sequence_*' under finance.approvedTools; it appears in no other role. Matrix row: sales sequence = 0 reachable, finance sequence = 4/6.

### 37. Sales manager

| | |
|---|---|
| Depth | `shell` |
| Impact | medium |
| Effort | days |

**Today.** The `sales` role is literally named 'Sales Manager' in its definition, but it holds no management capability: people_assign_task is absent from its allowlist (baseline gives it only the four people_* READ tools), performance_* is operations-only, goals_* is unreachable, and it has no visibility into another rep's pipeline beyond deals_list.

**Gap.** A sales manager's job is assignment, coaching and forecasting against quota. KEY can forecast (deals_forecast, deals_pipeline_velocity) but cannot assign a lead to a rep, cannot pull a rep's scorecard, and cannot set or track a team goal. /app/sales-team exists as a screen with no role or tool behind it.

**Evidence.** Matrix rows: sales people 4/4 of 5 (missing people_assign_task), sales performance '.', sales goals '.'. people_assign_task appears in operations/general/operator/executive allowlists only (role-engine.service.ts:258, 313, 345, 369).

### 38. Customer service agent

| | |
|---|---|
| Depth | `crud` |
| Impact | critical |
| Effort | weeks |

**Today.** `support` reaches 57/245, 54 within ceiling, 22 acting. Real helpdesk depth: create/update/reply/draft on tickets (5 of 6 within ceiling), crm_*, bookings_*, calendar_*, finance_customer_balance so it can answer 'what do I owe'.

**Gap.** It cannot work the channel where customers actually arrive. inbox_* is approved for `operations`, not `support`; support gets only inbox_brief, inbox_mark_resolved and the two baseline reads. inbox_reply_thread is T3 anyway. So the support role can read a WhatsApp/email thread, mark it resolved, and never answer it. Its ticket reply, as noted above, is recorded internally and never delivered. The L1_L2_CUSTOMER_SUPPORT_AGENT flow queue is also structurally empty — the only ticket event emitted anywhere is `supportTicket.created`, whose prefix 'supportTicket.' is in none of the router's FINANCIAL/PEOPLE/TEMPORAL prefix sets, so it is forwarded and then dropped with zero flows.

**Evidence.** role-engine.service.ts:235 support.approvedTools. Matrix row: support inbox 4/4, helpdesk 5/6. Pipeline simulation: supportTicket.created appears in the 'forwarded but routed to NO flow' list (49 of 118 forwarded event names).

### 39. Operations manager

| | |
|---|---|
| Depth | `workflow` |
| Impact | high |
| Effort | weeks |

**Today.** By far the widest role: 150/245 reachable, 135 within ceiling, 62 acting tools. Sole holder of procurement_* (12), structure_* (9), performance_* (4), contract_* extraction (4), call_* (5), evidence_* (3), time_* (5), automations_* (3), delegation_* (5), and inbox_* writes.

**Gap.** This is not one job. `operations` is carrying procurement officer, HR administrator, dispatcher, project manager, contract administrator, inbox agent and office manager simultaneously — seven real hats in one 60-line allowlist. That is why the six roles below have no representation: their tools exist, they were all filed under operations. Splitting operations is cheaper than building anything new, because the tools already exist and pass the manual-parity gate.

**Evidence.** Matrix: operations is the only role with a non-zero cell for procurement (11/12), structure (7/9), performance (4/4), contract (4/4), call (5/5), time (5/5). Its approvedTools array at role-engine.service.ts:258 is the longest in the file.

### 40. HR administrator / recruiter

| | |
|---|---|
| Depth | `absent` |
| Impact | high |
| Effort | months |

**Today.** No KEY role. No Employee, Leave, TimeOff, Shift, Attendance, Candidate or Application model exists in the 439-model schema. People are OrgAssignment rows against a JobRole. Payroll is PayrollRun + PayrollItem with hoursWorked and grossPay only.

**Gap.** payroll_* (7 tools) sits under `finance`, and the three that matter — generate_run, approve_run, mark_paid — are all T3, above finance's ceiling of 2. PayrollRun carries no deductions, no net pay, no PAYE/NIS fields, which for a Trinidad & Tobago payroll is not a payroll. There is no hiring pipeline, no leave request, no onboarding checklist. The HR_ADMINISTRATOR and RECRUITER flow queues subscribe to employee./hr./onboarding./candidate./application. and no event with any of those prefixes is emitted anywhere in the server.

**Evidence.** grep of schema.prisma model names for employee|leave|timeoff|candidate|applicant|shift|attendance returns nothing; PayrollRun/PayrollItem read at schema.prisma:2368-2416 (totalGross/grossPay, no net or deduction column). grep for deduction|paye|nis|withhold across modules/payroll and the schema: zero hits. Pipeline simulation lists both roles as structurally empty.

### 41. Procurement officer

| | |
|---|---|
| Depth | `crud` |
| Impact | medium |
| Effort | days |

**Today.** Twelve procurement_* tools exist and are complete as a workflow: list/get requests, list suppliers, create/update request, submit_for_review, select_vendor, issue_po, acknowledge_vendor, mark_fulfilled, mark_invoiced. /app/procurement and /app/procurement/suppliers are in the nav.

**Gap.** No role owns it. All 12 are approved for `operations` only, and procurement_issue_po is T3 above operations' ceiling of 2, so the one irreversible step always escalates. The PROCUREMENT_BUYER flow queue subscribes to procurement./purchase_order./vendor.quote and none are emitted; the only purchasing event in the codebase is `purchaseOrder.received`, which matches no bridge pattern (the bridge tests /^purchase_order\./ and /^order\./) and is therefore never forwarded.

**Evidence.** Enumerated procurement_* tools and tiers from the registry. Matrix: procurement column non-zero only for operations (11/12). Pipeline simulation: purchaseOrder.received is in the 116 events dropped by the bridge patterns.

### 42. Project manager

| | |
|---|---|
| Depth | `crud` |
| Impact | medium |
| Effort | days |

**Today.** projects_* (8) and time_* (5) exist and are approved for operations/operator/general; the Work nav group ships Projects, Approvals, Time tracking, Change orders, Performance.

**Gap.** No project-manager role, and the PROJECT_MANAGER_ADMINISTRATIVE queue subscribes to project.risk / milestone.due / budget.variance — none of which are emitted. project.* and task.* events ARE emitted (15 distinct types) and do land in the PROJECT_COORDINATOR queue, which makes this the one place where fixing the role is a subscription-filter edit rather than new capability.

**Evidence.** Pipeline simulation: PROJECT_COORDINATOR live with 15 signal types (project.created, project.status.advanced, task.created, project.task.completed…); PROJECT_MANAGER_ADMINISTRATIVE empty. Subscriptions at flow-role-subscriptions.config.ts:233-242.

### 43. Contractor / non-login staff (the best-built role in the repo)

| | |
|---|---|
| Depth | `workflow` |
| Impact | medium |
| Effort | weeks |

**Today.** OrgAssignment supports isContactOnly with contactName/contactEmail/contactPhone (E.164) and a preferred channel, and StaffChatBridgeService routes an inbound WhatsApp/SMS from that number into the same KEY chat engine, with reply-based approval (autoApprovalViaReply resolves a pending aiApprovalItem on 'yes'/'no'). This is exactly the 'affiliate who will never log in' case the vision describes, and it is genuinely implemented.

**Gap.** The authority the contractor gets is the 56-tool, zero-money envelope described above — or none at all if no JobRole is attached, in which case they fall back to text-detected department roles with full business autonomy. There is no per-contractor scope of WORK (only this client, only these projects), no rate/invoice loop back to the contractor, and no way for them to be paid: payroll is assignment-based but has no contractor path.

**Evidence.** staff-chat-bridge.service.ts:61-139 read in full; its own header comment concedes 'It does not yet scope tool/approval access to the caller's specific JobRole' (lines 25-29) even though line 104 now builds an envelope — the envelope path is real but the comment records the design intent. OrgAssignment fields at schema.prisma:2292-2311.

### 44. The 35-role employee catalogue (KEY FLOWS)

| | |
|---|---|
| Depth | `shell` |
| Impact | high |
| Effort | weeks |

**Today.** flow-role-subscriptions.config.ts defines 35 named jobs — Data Entry Clerk, Bookkeeper, SDR/BDR, HR Administrator, Procurement Buyer, Recruiter, Paralegal, Field Service Dispatcher, Front Desk, Restaurant Manager, Board Secretary, Executive Assistant, Transcriptionist… — and /app/key-flows renders a directory of all 35 with live queue counts. This is the closest thing in the repo to the vision's 'replace every tier of employee'.

**Gap.** 23 of the 35 queues can never contain a row. I simulated the full pipeline — 234 distinct emitted event names → 92 bridge regexes → module-prefix strip → underscore-to-dot normalisation → FlowRouter flow classification → subscription typeFilter — and only 12 roles receive anything. 49 of the 118 forwarded event types are routed to zero flows and silently discarded, including EVERY deal event (deal.created/won/stage.changed — prefix 'deal.' is in none of the FINANCIAL/PEOPLE/TEMPORAL sets), every quote event (10), inventory.low/out, and supportTicket.created. And these are lenses, not workers: a role queue confers no tools, no autonomy and no ability to act — RoleFlowService only does findMany + dedupe.

**Evidence.** Ran the pipeline simulation in scratch: LIVE 12 (Data Entry Clerk, File/Records Clerk, Expense Report Processor, AR Clerk, Lead Qualifier, Reservation Agent, Project Coordinator, SDR/BDR, Social Media Manager, Email/Content Marketer, Operations Coordinator, E-commerce Manager); EMPTY 23. Inputs: 234 emit(' ') names extracted from 1,601 server files, patterns from event-emitter-flow-bridge.service.ts:31-135, prefix sets from flow-router.service.ts:97-237, subscriptions from flow-role-subscriptions.config.ts.

### 45. Staff seat permissions (Membership scopes)

| | |
|---|---|
| Depth | `crud` |
| Impact | critical |
| Effort | days |

**Today.** ModuleScopeGuard gates 34 of 158 controllers (289 decorated handlers) on membership scopes. DEFAULT_SCOPES in module-scope.guard.ts:22-38 covers 13 modules; IdentityService.PERMISSION_MODULES (identity.service.ts:411) covers 11.

**Gap.** The two lists disagree and the invite path writes the shorter one. identity.service.ts:506 stores permissionScopes explicitly on every invited member; module-scope.guard.ts:69 then prefers that stored object over DEFAULT_SCOPES. Since the stored map has no 'operations' or 'analytics' key, an invited ADMIN resolves 'none' on all 58 handlers decorated RequireModuleScope('operations') — which includes the entire approvals surface (ai-approvals.controller.ts) and AI settings — and all 14 'analytics' handlers. The founder is unaffected: their membership is upserted with no permissionScopes (identity.service.ts:955-967) so they fall through to the 13-key default. Separately, 'connect' is requested by 7 integration-hub handlers and exists in NEITHER list, so it is forbidden for everyone including the owner.

**Evidence.** Counted RequireModuleScope call sites by module across all *.controller.ts: operations 58, crm 157, revenue 77, expenses 32, team 29, settings 28, analytics 14, automations 12, bookings 11, content 9, connect 7. Set-differenced against both scope maps. Guard resolution order read at module-scope.guard.ts:68-84.

### 46. Role detection from context

| | |
|---|---|
| Depth | `workflow` |
| Impact | high |
| Effort | days |

**Today.** detectRoleFromContext now actually runs — the web sends role: undefined unless a mode is explicitly picked (use-key-chat-actions.ts:390-404, pinned by role-activation.spec.ts). Route context contributes +3 on an exact match, +2 on a prefix match.

**Gap.** The route map largely points at pages that do not exist. 16 of the 38 ROUTE_ROLE_MAP entries (/app/invoices, /app/contacts, /app/deals, /app/leads, /app/quotes, /app/revenue, /app/tickets, /app/campaigns, /app/tasks, /app/dashboard…) resolve to no page.tsx; the real routes are /app/crm/contacts, /app/crm/deals, /app/commerce, /app/helpdesk. And 63 of the 90 unique /app nav destinations have no mapping at all — the entire finance stack (13 screens), payroll, contracts, inventory, helpdesk, /app/marketing and /app/key/chat itself. So on the finance ledger page KEY gets zero route signal and falls back to keyword matching.

**Evidence.** Extracted ROUTE_ROLE_MAP (38 entries) from role-engine.service.ts:48-94, walked apps/web/src/app/app for page.tsx (209 routes), and extracted 90 unique /app hrefs from nav-config.ts. Set difference computed both directions.

### 47. Supplier, franchisee and multi-entity roles

| | |
|---|---|
| Depth | `shell` |
| Impact | medium |
| Effort | months |

**Today.** SupplierConnection / SupplierProduct / SupplierVariant models exist, a supplier module exists, and the marketplace has a Supplier tab behind dormantFlag 'supplier'. procurement_list_suppliers is a read tool.

**Gap.** No supplier identity, no supplier login, no supplier-side quote or PO acknowledgement seat — procurement_acknowledge_vendor is a tool the BUYER uses on the supplier's behalf. Franchisee is absent entirely: Business has no parent/child relation and no group id, so there is no way to model a franchisor rolling up three outlets, or one owner with two businesses sharing staff. This is the boundary between 'small-to-medium' and the 'large chunk of enterprise capacity' the vision names.

**Evidence.** grep of schema.prisma for parentBusiness|parent_business|franchis|group_id returns zero; Business model read at schema.prisma:151-176 has ownerId and no hierarchy. Supplier models at 7152/7178/7206. nav-config.ts:372 shows the Supplier entry is dormant-flagged.

---

## Lens: Ingestion — "connect and ingest any and every material" — 15 findings

**Headline.** Ingestion is wide at the connect step and nearly empty at the data step: of 22 registered connectors, 12 have no inbound data path at all and only gmail and google_forms perform a genuine pull — so no business can import its existing history from QuickBooks, Xero, Stripe, PayPal, WiPay, Mailchimp or Klaviyo, and the one path that reaches the double-entry ledger accepts only CSV/OFX/QIF/MT940 text, silently mangling the PDF statements Trinidad banks actually send.

### 48. Connector framework — provider pull & historical import

| | |
|---|---|
| Depth | `shell` |
| Impact | critical |
| Effort | months |

**Today.** 22 connectors are registered and presented in the Connect hub. 16 of them return an explicit `PULL_SYNC_NOT_IMPLEMENTED` and the 4 social ones return `UNSUPPORTED`. Only `gmail` and `google_forms` have a genuine `sync()`. Counting every mechanism (pull, webhook, connect-callback), 12 of the 22 have no inbound data path of any kind: stripe, paypal, wipay, quickbooks, xero, mailchimp, klaviyo, google_calendar, google_business_profile, linkedin, twitter, tiktok.

**Gap.** No historical import exists from any accounting, payment or marketing system. A business switching to KEYFLOW cannot bring its books (QuickBooks/Xero), its payment history (Stripe/PayPal/WiPay), or its lists (Mailchimp/Klaviyo). The product can observe the future but cannot absorb the past — which is the single hardest objection in an SMB migration sale.

**Evidence.** `core/connectors/connector-sync-modes.ts:43-87` classifies all 22; `connector-sync-not-implemented.spec.ts:28-50` is an executable list of the 16 stubs and asserts gmail/google_forms are NOT stubbed. Grep for `syncToIngestion` across `apps/server/src` returns exactly one implementation (`implementations/gmail.connector.ts:97`). Corroborated by the repo's own `docs/audits/connectors/functional-inventory.md:88-125`.

### 49. Bank statement formats — the ledger path

| | |
|---|---|
| Depth | `workflow` |
| Impact | critical |
| Effort | weeks |

**Today.** Real and well-built: `bank-statement-parsers.ts` handles CSV, OFX, QIF and MT940, with format sniffed from CONTENT not filename, and a per-account `importProfile` remembering a bank's odd column headers. Backed by a spec that fixtures TTD MT940 and unclosed-SGML OFX.

**Gap.** The path is text-only. `finance.controller.ts:613` does `file.buffer.toString('utf8')` before calling `bankImport.ingest(..., content: string, ...)` (`bank-import.service.ts:251-254`), and the automated sweep's `STATEMENT_EXT` regex (`statement-source.service.ts:92`) is `/\.(ofx|qfx|qif|sta|mt940|txt|csv)$/i`. A PDF or XLSX statement becomes mojibake, falls through `detectFormat` to 'csv', and yields garbage or zero rows. Trinidad banks (Republic, RBC, First Citizens) email PDF statements; OFX/QIF/MT940 are what US/EU and treasury systems emit. The format coverage is inverted relative to the stated market. The docling sidecar that could solve this is never called on this path.

**Evidence.** Read `finance.controller.ts:596-623`, `bank-import.service.ts:1-140,251-260`, `statement-source.service.ts:45-103`. Cross-checked that `DocumentParsingService` has only two call sites (grep: `document-intelligence.service.ts:152`, `contract-clause.service.ts:58`) — neither is finance.

### 50. Live bank feeds

| | |
|---|---|
| Depth | `crud` |
| Impact | high |
| Effort | months |

**Today.** A `BankConnection` Prisma model exists with `provider` ('plaid | yodlee | salt_edge | open_banking'), `accessToken` and `lastSyncCursor`, a full CRUD service, 6 controller routes, and a web form where the user picks 'Plaid' from a dropdown and types a provider item ID.

**Gap.** There is no aggregator integration behind it. `plaid` appears in no `package.json` in the repo and in no entry of `pnpm-lock.yaml` (positive control: `exceljs`, `mammoth`, `pdf-parse` all resolve in the same lockfile). `recordSync()` only stamps `lastSyncAt` and clears the error. The screen lets a user configure a bank feed that can never deliver a transaction.

**Evidence.** `schema.prisma:10050-10062`; `finance/bank-connection.service.ts:92-104` (recordSync is a timestamp write); `apps/web/src/app/app/key-connect/components/banking-section.tsx:19-35`; lockfile greps as described.

### 51. Google Drive intake — format filter

| | |
|---|---|
| Depth | `workflow` |
| Impact | high |
| Effort | days |

**Today.** A 5-minute background sweep (`connector-intelligence.service.ts`) pages Drive with a `modifiedTime >` cursor, dedupes on file id + modifiedTime into `DriveIntakeFile`, and routes to `DriveIntakeOrchestrator` for an extract-and-plan flow.

**Gap.** The sweep query is `mimeType contains 'image/' or 'application/pdf' or 'text/'`. That excludes every native Google Doc, Sheet and Slide (`application/vnd.google-apps.*`) and every Office file (`.docx`, `.xlsx`, `.pptx`, `.doc`, `.xls`) — i.e. most of what is actually in an SMB's Drive. The conversion capability already exists and is unreachable from the sweep: `google-drive.service.ts:879-941` exports Google Docs to HTML via `?export?mimeType=text/html` and converts `.docx` through mammoth, but only on the manual view path. This is the repo's signature 'built then not connected' pattern, reproduced inside ingestion.

**Evidence.** Read `ai/connector-intelligence.service.ts:113-147` (the query string is line 129) and `google-drive/google-drive.service.ts:849-941`.

### 52. KEY Cortex document RAG — Excel parsing

| | |
|---|---|
| Depth | `workflow` |
| Impact | high |
| Effort | days |

**Today.** `key-cortex-document.service.ts` accepts PDF/Word/Excel/PNG/JPEG/TXT/CSV, extracts text, chunks at 800 chars with 150 overlap, embeds with `text-embedding-3-small` and serves vector-search Q&A with citations. PDF (pdf-parse), Word (mammoth), image (GPT-4o vision) and text branches are all real.

**Gap.** The Excel branch calls `await import('xlsx')` — and `xlsx` is in no `package.json` in the repo and no entry in `pnpm-lock.yaml`. A hand-written stub at `apps/server/src/types/xlsx.d.ts` ('Minimal stub for the xlsx dynamic import') is what lets it typecheck. At runtime the import throws MODULE_NOT_FOUND, the `catch` swallows it, and the fallback returns `buffer.toString('utf-8')` of a binary ZIP container — so a spreadsheet is chunked and embedded as mojibake, and the document reports success. Silent-wrong, not loud-broken: the type stub is the mechanism that hides it. This is the same defect class the repo's `phantom-injection.spec.ts` was written to prevent, in a place that gate does not look.

**Evidence.** Read `key-cortex/key-cortex-document.service.ts:826-841` (parseExcel) and `:164-215`; read `apps/server/src/types/xlsx.d.ts` in full; grepped `xlsx` against `**/package.json` (no matches) and `pnpm-lock.yaml` (no matches), with exceljs/mammoth/pdf-parse as the positive control (lockfile lines 6233/7655/8348).

### 53. Omnichannel Key Inbox — declared vs. fed channels

| | |
|---|---|
| Depth | `crud` |
| Impact | high |
| Effort | weeks |

**Today.** 12 channels are declared in `key-inbox.constants.ts` and `normalizeKeyInboxChannel` maps ~20 aliases onto them. Five have real inbound producers: EMAIL (gmail-ingestion), GOOGLE_FORMS (google-forms-ingestion), WHATSAPP (whatsapp.service), INSTAGRAM_DM and FACEBOOK_MESSENGER (meta-social-ingestion).

**Gap.** Seven declared channels have no inbound producer anywhere: SMS, WEBSITE_FORM, WEBSITE_CHAT, META_LEAD_FORM, FACEBOOK_PAGE_COMMENT, INSTAGRAM_COMMENT, MANUAL. SMS appears only in the outbound reply sender. So the 'omnichannel inbox' is a four-channel inbox with eight labels, and a website chat widget or a Facebook page comment — both routine for a Caribbean SMB — cannot reach it.

**Evidence.** Read `key-inbox/key-inbox.constants.ts` in full; grepped every `KEY_INBOX_CHANNELS.<X>` reference across `apps/server/src` and classified each as producer, sender or constant/spec; ran a second grep for raw-string producers (`channel: 'website_form'` etc.) which found only outbound/analytics uses.

### 54. Inbound email & SMS webhook

| | |
|---|---|
| Depth | `shell` |
| Impact | high |
| Effort | weeks |

**Today.** `POST /communications/inbound/email` and `/sms` exist, HMAC-verified over the raw body with `timingSafeEqual`, failing closed when the secret is unset. They resolve a business by destination address and emit `message.intake.received`.

**Gap.** Two problems. (1) They accept an already-normalized KEYFLOW payload — the docstring says providers must be 'normalised to the Keyflow inbound event shape IN FRONT OF these endpoints'. There is no Twilio, Resend, SendGrid or Postmark adapter in the repo, so using them requires the customer to build and host a translating proxy. No SMB will. (2) A single global `INBOUND_WEBHOOK_SECRET` guards all tenants while `businessId` is taken from the request body, so any holder of that one secret can inject messages into any business. The repo already has the right pattern next door — `core/connectors/form-webhook.controller.ts` uses a per-business webhook secret — and this controller does not use it.

**Evidence.** Read `communications/inbound-communications.controller.ts` in full (docstring :10-18, body-supplied businessId :30/:43 and :59/:71, shared-secret check :81-103) and `inbound-communications.service.ts:60-134`. Contrast established by reading `core/connectors/form-webhook.controller.ts:38-46`.

### 55. KEY's own ability to ingest

| | |
|---|---|
| Depth | `crud` |
| Impact | high |
| Effort | weeks |

**Today.** 245 tools in `flow-tool-registry.ts`. Roughly 15 touch ingested data: `documents_list`, `documents_search`, `drive_create_folder`, `drive_create_document`, six `inbox_*` tools, three `reconcile_*statement*` tools, `finance_list_bank_accounts`, `finance_auto_match_bank`.

**Gap.** Not one tool ingests. There is no tool to upload a file, parse a document, import a CSV, run the Drive scan, or backfill a connector. KEY can read the inbox and list documents but every byte still enters through a human at a form or a cron on a timer. Against the vision of 'connect and ingest any and every material' using the phone, the agent is a reader of the pipe, never its operator. `reconcile_connect_statement_source` / `reconcile_sweep_statements` are the sole counter-example and are statement-specific.

**Evidence.** Counted `name: '` in `flow-tool-registry.ts` (245, matching the given baseline) then grepped tool names against `(ingest|import|upload|statement|bank|connector|inbox|document|drive)` and read the hits at lines 1384-1413, 2268-2285, 2950-2968, 3236-3246, 3512-3530, 4351-4408.

### 56. Document parsing (docling)

| | |
|---|---|
| Depth | `workflow` |
| Impact | medium |
| Effort | weeks |

**Today.** Genuinely real and well-shaped. `docling-serve` runs as a sidecar in both `docker-compose.yml:81` and `docker-compose.production.yml:170`; `DocumentParsingService` posts multipart to `/v1/convert/file` with a `/v1alpha` fallback, 120s timeout, returns Markdown + up to 10 tables + page count, and fails open with null so callers degrade rather than break. `document-intelligence.service.ts` prefers it over vision for PDF/Office and falls back to GPT-4o vision for images.

**Gap.** Only two call sites — `document-intelligence.service.ts:152` and `contract-clause.service.ts:58`. The best parsing asset in the repo is absent from the bank-statement path, the Drive intake path, the CRM import path and the Cortex RAG path, each of which hand-rolls its own weaker extraction (pdf-parse, mammoth, a missing xlsx, or raw utf-8). One good parser, four bypasses.

**Evidence.** Read `ingestion/document-parsing.service.ts` in full and `ai/document-intelligence.service.ts:231-278`; grepped `DocumentParsingService|documentParsing` across `apps/server/src` — 8 hits, of which only 2 are consumers (rest are the module wiring and the class itself).

### 57. File upload surface

| | |
|---|---|
| Depth | `crud` |
| Impact | high |
| Effort | weeks |

**Today.** Nine multipart endpoints exist across 110 server modules: bank statement (finance:600), product image and a file (commerce:234,249), CRM import and contact-card scan (crm:969,1027), voice (keyflow-command:129), marketplace file (:436), Cortex audio and Cortex document (key-cortex:1214,2775). `UploadsModule` itself is only a presigned-URL vendor — `uploads.service.ts` is 17 lines and returns an upload URL, nothing more.

**Gap.** There is no generic 'drop any file here and KEY figures it out' endpoint, which is the literal phrasing of the vision. Each of the nine is bound to one domain with its own format list, its own parser and its own failure mode. A user with a folder of mixed supplier invoices, a signed contract scan and a price list has no single door — and the phone-first promise ('bring every business command into reality using the phone') has no camera-to-anything path beyond the single-purpose contact-card and receipt scanners.

**Evidence.** Grepped `FileInterceptor|FilesInterceptor|UploadedFile` across `apps/server/src` (all hits enumerated above); read `modules/uploads/uploads.service.ts` in full.

### 58. Forms ingestion

| | |
|---|---|
| Depth | `workflow` |
| Impact | medium |
| Effort | days |

**Today.** The strongest ingestion family. Typeform, Jotform and a generic `webhook_form` share `FormPlatformConnectorBase` with `parseInbound` + `verifyWebhook`, ingest at `/webhooks/forms/:businessId/:type`, and use a PER-BUSINESS `webhookSecret` (HMAC) rather than a global one. Google Forms has a real ingestion service with both webhook and connect-time backfill, plus field-to-CRM mapping (`connect/google-forms-mapping.service.ts`) and a backfill endpoint.

**Gap.** `sync()` is inherited and returns PULL_SYNC_NOT_IMPLEMENTED, so nothing arrives before the webhook is wired — no historical submissions. And `WEBSITE_FORM` remains an unfed Key Inbox channel, so KEYFLOW's own hosted lead form (`public/lead-forms/:formId/submit`) does not land in the same inbox as a Typeform submission.

**Evidence.** Read `core/connectors/implementations/form-platform.base.ts:101-127`, `core/connectors/form-webhook.controller.ts:38-46`, `connector.controller.ts:307`; `lead-forms.controller.ts:80` for the native form route; channel-producer analysis as above.

### 59. Shopify — real sync, outside the framework

| | |
|---|---|
| Depth | `workflow` |
| Impact | medium |
| Effort | days |

**Today.** `ShopifyService` makes genuine authenticated calls to `https://{shop}/admin/api/{version}/{endpoint}` and the controller exposes four real pull endpoints: sync/products, sync/orders, sync/customers, sync/all.

**Gap.** It is the only integration in the repo with a genuine multi-entity provider pull, and it is invisible. `'shopify'` is in the `ConnectorType` union (`connector.interface.ts:24`) but absent from `REGISTERED_CONNECTOR_TYPES` and from `CONNECTOR_SYNC_MODES` — the missing entry compiles only because that map is written `as Record<ConnectorType, ...>`, a cast that defeats the exhaustiveness check that would otherwise have caught it. It has no ConnectorStatus row, no health monitoring, no scheduler entry, and no nav link. The best pull connector is the one nobody can find.

**Evidence.** Read `modules/shopify/shopify.service.ts:108-110` and `shopify.controller.ts:17-86`; grepped `shopify` in `core/connectors/` (single hit: the type union); confirmed the `as Record<...>` cast at `connector-sync-modes.ts:79`; grepped nav-config for shopify (no matches).

### 60. Calendar ingestion

| | |
|---|---|
| Depth | `shell` |
| Impact | high |
| Effort | weeks |

**Today.** `google_calendar` is classified PUSH_OR_PUBLISH + STATUS_ONLY: bookings are pushed out to Google Calendar by a dedicated method, and `sync()` counts local bookings. It is in the PULL_SYNC_NOT_IMPLEMENTED list.

**Gap.** Nothing comes back in. External meetings, client-created events and availability changes made in Google Calendar never reach KEYFLOW, so the booking engine's view of the owner's day is only ever the half it created itself — double-booking is structurally possible. Also a live documentation conflict: `docs/audits/connectors/functional-inventory.md:24-26` still asserts 'google-calendar.sync does real bidirectional provider I/O (fetch events + insert + delete)', which the executable spec now contradicts. The doc is stale in the product's disfavour and should be corrected in place per this repo's own convention.

**Evidence.** `connector-sync-modes.ts:46`; `GoogleCalendarConnector` present in the NOT_IMPLEMENTED list at `connector-sync-not-implemented.spec.ts:38`; contradicting claim read at `functional-inventory.md:24-26`.

### 61. Voice, image and contact-card capture

| | |
|---|---|
| Depth | `workflow` |
| Impact | high |
| Effort | weeks |

**Today.** Working. Whisper transcription via `keyflow-voice.service.ts:54-75` behind a 25MB audio upload, metered through `aiUsage.trackAudio`. Business-card and receipt capture via GPT-4o vision: `crm-import.service.ts:506-583` (`extractContactFromImage`, `scanContactImage`) and the device/expenses receipt paths. CRM import genuinely handles csv, xlsx (ExcelJS), pdf (pdf-parse), image (vision OCR) and vcf (with correct RFC line-unfolding).

**Gap.** All single-shot and single-purpose. No batch capture (a stack of 40 receipts), no camera-roll or WhatsApp-attachment sweep, and `IngestionAttachment` carries only name/mimeType/url — the orchestrator stores attachment metadata on `IngestionItem` but never fetches or parses the bytes, so an invoice attached to an ingested email is recorded and then ignored. That is the most common way a real SMB receives a document.

**Evidence.** Read `keyflow-command/keyflow-voice.service.ts:51-75`, `crm/crm-import.service.ts:506-583,750-808`; read `ingestion-orchestrator.service.ts` in full — `attachments` is written at :81 and referenced again only in `buildSummary` :446; `IngestionAttachment` shape at `connector.interface.ts:185-191`.

### 62. Ingestion UI reachability

| | |
|---|---|
| Depth | `crud` |
| Impact | high |
| Effort | days |

**Today.** Three ingestion destinations are in the nav: `/app/key-inbox`, `/app/data-inbox`, `/app/key-connect`, plus `/app/finance/bank-rules`.

**Gap.** `/app/inbox`, `/app/inbox/intake`, `/app/documents` and `/app/documents/[instanceId]` exist as pages and are in no nav group — a second, orphaned inbox competing with the two that are linked, and the entire document library unreachable. There is also no dedicated statement-import screen; the upload lives inside `/app/finance/reconciliation`, which is itself outside the nav. So the highest-value ingestion action in the product — get a bank statement into the double-entry ledger — has no navigable door, which is exactly the §5.1 defect of the base analysis reproduced one layer down.

**Evidence.** Globbed `apps/web/src/app/app/{key-connect,key-inbox,inbox,documents,uploads,import,data-inbox,connect}/**/page.tsx` (8 pages) and grepped `apps/web/src/lib/nav-config.ts` for each href; finance page glob shows 19 routes with no bank-import page; grepped the finance web tree for the upload call — only `reconciliation/page.tsx`, `_intel-panel.tsx`, `components/payment-record-modal.tsx`.

---

## Lens: The incumbents, per department — 17 findings

**Headline.** KEYFLOWOS beats every incumbent on the raw ingredients for cross-department action — one Postgres with 439 models, an idempotent double-entry posting engine, 245 risk-tiered tools, an event firehose — and then spends almost none of it: the AI's standing picture of the business is 29 aggregate queries that touch the ledger, cash, bills, stock, pipeline, payroll and tickets exactly zero times, and one detected role gates the whole turn, so the single instruction that would prove the thesis ("refund them and release their booking") is structurally impossible.

### 63. Cross-domain reasoning — the AI's standing picture of the business

| | |
|---|---|
| Depth | `workflow` |
| Impact | critical |
| Effort | weeks |

**Today.** Every chat turn builds its system prompt from `businessGraph.buildContextString(snapshot)` (flow-orchestrator.service.ts:1294 and :1673). `assembleSnapshot` is a single `Promise.all` of 29 aggregate queries over contacts, invoices, bookings, expenses, expenseBudget, projects/projectTasks, socialPosts, emailCampaigns, automations and products. It is cached and it works.

**Gap.** The snapshot contains ZERO queries against `ledgerEntry`, `financialAccount`, `chartOfAccount`, `bill`, `inventoryStock`, `deal`, `payrollRun` or `supportTicket` — verified by grepping `db.<model>.` in business-graph.service.ts, all eight return 0. So KEY's default picture is: how many contacts you have, but not your pipeline value; invoices, but not your bank balance; expenses, but not your unpaid bills; product count, but not your stock; nothing at all about labour or open tickets. The 439-model shared schema is the whole differentiation thesis, and the AI's standing view is assembled from about 12 of them. The tools exist to fetch the rest on demand (finance_*, deals_*, inventory_*), so KEY can answer if asked — but every proactive path, every alert, and every unprompted judgement is made blind to the ledger. `calculateHealthScore` and `generateAlerts` (business-graph.service.ts) are computed from crm/commerce/bookings/inbox/genome only. A separate, richer assembler exists — key-cortex-context-v2.service.ts `getFullContext`, 1,643 lines, 9 slices — and it too has no finance, inventory, people or projects slice, and it is not what the chat path calls.

**Evidence.** apps/server/src/modules/ai/business-graph.service.ts:141-215 (the 29-query Promise.all, read in full); apps/server/src/modules/ai/flow-orchestrator.service.ts:1294,1328,1673,1705 (contextSnapshot -> BUSINESS_CONTEXT); negative control: `grep -c 'db.ledgerEntry\.'` etc. over business-graph.service.ts returns 0 for all eight models; apps/server/src/modules/key-cortex/key-cortex-context-v2.service.ts:290-372 (getFullContext's 9 slices, none financial).

### 64. Acting across departments in one instruction

| | |
|---|---|
| Depth | `workflow` |
| Impact | critical |
| Effort | weeks |

**Today.** `RoleEngineService` defines 8 roles with approvedTools/blockedTools/maxRiskTier. `flow-orchestrator.service.ts:1047` picks ONE role per turn and filters the entire tool set through it: `detectedRole && detectedRole !== 'general' ? all.filter(t => roleEngine.isToolAllowed(detectedRole, t.function.name)) : all`. `AiOversightService.evaluate` re-checks the same single role at execution (ai-oversight.service.ts:136).

**Gap.** Role detection is a regex race (role-engine.service.ts:405-432, ordered keyword tests) and the winner's allowlist bounds the whole turn. The canonical cross-department instruction is therefore structurally impossible: 'the client cancelled — refund them and release their booking slot' routes to `finance` (matches /refund/ first), and finance's approvedTools contain `payments_*` but no `bookings_*`; route it to `support` instead and it gets `bookings_*` but `bookings_cancel_booking` is in support's blockedTools and it has only `payments_list_transactions`/`payments_search_transactions`, no refund. Neither role can complete the sentence. The `general` fallback sees all 245 tools but its blockedTools include `commerce_send_invoice`, `marketing_send_campaign`, `social_publish_post`, `bookings_cancel_booking` — so the default role cannot send an invoice. This is the exact capability no incumbent can offer (Salesforce cannot touch your ledger, Xero cannot touch your calendar), and the gate that would deliver it is one-role-per-turn.

**Evidence.** apps/server/src/modules/ai/flow-orchestrator.service.ts:1035-1050; apps/server/src/modules/ai/role-engine.service.ts:190-191 (sales), :214-215 (finance), :235-236 (support), :313-314 (general), :567-608 (isToolAllowed, blocked-then-approved-then-baseline); cross-checked the four allowlists by hand against the refund+cancel pair.

### 65. Payroll / HR (Gusto, Deel, Zoho Payroll)

| | |
|---|---|
| Depth | `shell` |
| Impact | critical |
| Effort | months |

**Today.** `payroll.service.ts` is 228 lines: setRate, listRates, generateRun, listRuns, getRun, approveRun, markRunPaid. It genuinely reads `timeEntry` (aggregates billable durationMinutes per assignment's user, payroll.service.ts:122-135) so hours × rate works, salaried staff get a flat monthly amount. 7 AI tools (payroll_*), one nav entry /app/payroll, a real 319-line page wired to @/lib/api/payroll. Overlap protection and a DRAFT->APPROVED->PAID state machine exist.

**Gap.** Gross pay only. No PAYE, no NIS, no Health Surcharge, no employer contributions, no net pay, no deductions of any kind, no payslip document, no bank/ACH disbursement, no statutory return (TD4/annual). Grep for PAYE|NIS|TD4|Health Surcharge across apps/server/src returns hits ONLY inside LLM prompt strings (ai-advisor.service.ts:687-688, :729) and reminder checklists (business-genesis/trinidad-compliance-rules.ts). The Caribbean wedge is asserted in prose and not computed anywhere. `markRunPaid` writes a status and stops — payroll has no import of PostingService, so the largest recurring outflow in an SMB never reaches the general ledger that this repo already has.

**Evidence.** apps/server/src/modules/payroll/payroll.service.ts read in full (228 lines, 3 files in the module); `grep -rn 'PostingService' apps/server/src/modules/payroll` returns nothing while 21 other files import it; `grep -rniE '\bPAYE\b|\bNIS\b|\bTD4\b'` over apps/server/src hits only prompt text and trinidad-compliance-rules.ts.

### 66. Labour cost as a data island (the shared-schema thesis, tested)

| | |
|---|---|
| Depth | `crud` |
| Impact | high |
| Effort | days |

**Today.** I bucketed the 439 models into 8 department sets and counted, per non-spec server file, how many buckets its Prisma calls touch. 69 files touch 3 or more domains — cross-domain READS are common. Domain file counts: crm 136, ar_ap 117, ops 108, inventory 54, marketing 43, finance/ledger 32, support 21.

**Gap.** The `people` bucket (payrollRun, payRate, timeEntry, orgAssignment, jobRole, staffPerformance, delegationRule) is touched by exactly 6 files out of ~1,600, and co-occurs with another domain in 3. The sharpest instance: `safe-to-spend.service.ts:68-69` — the flagship 'can I spend this' number — reads cash accounts and the tax-payable ledger, then writes `const payrollReserved = 0;` with the comment 'Placeholder: payroll and debt not yet modeled'. `payrollRun.totalGross` for the current period is one query away in the same Postgres. That single line is the whole 10x argument failing in one file: the integration nobody else can do, not done, in the place it would be most visible.

**Evidence.** Python scan of apps/server/src/modules mapping `prisma.client.<model>.<op>` to 8 domain buckets (script at /tmp, re-runnable); people-domain files = ai/approval-routing, key-cortex/key-cortex-expertise-lens, payroll/payroll.service, staff-performance/staff-performance.service, structure/structure.service, time-tracking/time-entry.service; apps/server/src/modules/finance/safe-to-spend.service.ts:68-69 and :79 read directly.

### 67. Procure-to-pay / three-way match (Odoo, SAP B1, Dynamics)

| | |
|---|---|
| Depth | `crud` |
| Impact | high |
| Effort | weeks |

**Today.** `procurement` has a 12-tool AI surface and a request lifecycle: create -> submit_for_review -> select_vendor -> issue_po -> acknowledge_vendor -> mark_fulfilled -> mark_invoiced. `continental-ops` has goods-receipt, delivery-note and stock-count services that do write `inventoryStock` and `stockMovement` inside transactions. Accounts payable itself is real and posts: `expenses/bills.controller.ts` exposes bills, `payables/aging`, `vendors/balances`, and `expenses.service.ts:193-195` calls `posting.onBillCreated` / `onExpensePaid`.

**Gap.** The chain is severed at the join. `procurement.service.ts:250-262` `markInvoiced` sets `status: 'INVOICED'` and writes an activity row — it creates no `Bill`, no payable, no GL entry. So the PO the system issued and the bill the system posts are unrelated records; there is no three-way match (PO qty vs goods-receipt qty vs invoice amount), which is the single reason mid-market businesses buy SAP B1 or Dynamics. Goods receipt increments stock quantity but posts no Dr Inventory / Cr GRNI, so received-not-invoiced never appears on the balance sheet. The `supplier` module has 0 AI tools (`grep -c 'supplier_' flow-tool-registry.ts` = 0) despite having an adapter interface and a product-normalisation service.

**Evidence.** apps/server/src/modules/procurement/procurement.service.ts:250-262; apps/server/src/modules/continental-ops/goods-receipt.service.ts:122-130 and delivery-note.service.ts:104-115 (stock writes, no posting import); apps/server/src/modules/expenses/expenses.service.ts:6,14,193-195 (AP does post); `grep -c 'supplier_' apps/server/src/modules/ai/flow-tool-registry.ts` = 0.

### 68. Inventory valuation & COGS (Odoo, SAP B1, Dynamics, Shopify+A2X)

| | |
|---|---|
| Depth | `crud` |
| Impact | high |
| Effort | weeks |

**Today.** COGS posting exists and is careful: `invoice-workflow.service.ts:139-167` `postCogsForPaidInvoice` hydrates invoice line products and calls `expensePosting.onProductSold` inside the same `$transaction` as the status change, and skips silently rather than fabricating a cost when none exists (documented as the FIN3 rule). Cost per unit is a quantity-weighted average across warehouses (expense-posting.service.ts:430-450).

**Gap.** There are no cost layers — no FIFO, no moving-average recalculation on receipt, no standard-cost variance. `inventoryStock.costPerUnit` is a standing field; nothing recomputes it when a goods receipt lands at a different price, so the weighted average silently drifts from what was actually paid. Worse, COGS is triggered by invoice PAID only: stock that leaves via a delivery note, a stock-count writedown, a marketplace fulfilment or a cash storefront order moves quantity without moving value, so the inventory asset account and the physical count diverge with no reconciliation report. Landed cost has an engine (`commerce/landed-cost-engine.service.ts`) that does not feed `costPerUnit`. For an importing business in Trinidad — duty, freight, and FX on every container — landed cost into unit cost is the whole game.

**Evidence.** apps/server/src/modules/commerce/invoice-workflow.service.ts:131-167,216-232,322-330; apps/server/src/modules/finance/expense-posting.service.ts:430-460; `grep -rniE 'fifo|costMethod|movingaverage'` over apps/server/src/modules returns no inventory-costing hits (only unrelated 'weighted average' in key-cortex and key-genome).

### 69. Deterministic automation / iPaaS (Zapier, Make, Monday automations)

| | |
|---|---|
| Depth | `shell` |
| Impact | critical |
| Effort | months |

**Today.** Two independent automation systems. (1) `flow/` — FlowEngine + FlowRunner + FlowActionRegistry, with a visual builder at /app/flows and templates. (2) `ai/flow-tool-registry.ts` — 245 typed tools (95 read, 65 crud, 42 organize, 35 execute, 8 draft; 122 T1 / 90 T2 / 30 T3 / 3 T4). Plus an `events.onAny` firehose in agent-trigger.service.ts:37 that matches `AgentTrigger.eventPattern` rows and turns an event into an AI plan.

**Gap.** `FlowActionRegistry.registerBuiltins` registers exactly SIX actions: create_command_item, draft_message, notify_user, create_task, send_message, create_contact. There is no HTTP/webhook action at all (`grep -rniE 'webhook|http_request|fetch\('` over modules/flow returns nothing) — the one primitive that defines Zapier. No flow action can touch finance, inventory, bookings, projects, or any external system. Separately `automation/automation.service.ts` is 115 lines with 4 hardcoded DEFAULT_RULES over 4 event types and 3 action kinds. The vision promises equivalent MANUAL, SMART and AI layers; measured, the deterministic layer is 6 actions against the AI layer's 245 — 2.4%. A business will not let an LLM run its collections unattended; it will let a rule do it, and the rule engine cannot reach the ledger.

**Evidence.** apps/server/src/modules/flow/flow-action.registry.ts (207 lines, 6 `this.register(` calls enumerated); flow-runner.service.ts:305,354-367 (4 condition kinds); apps/server/src/modules/automation/automation.service.ts read in full; tool totals re-derived from flow-tool-registry.ts by grepping `name:`/`family:`/`riskTier:`.

### 70. External connectors / sync (Zapier, Zoho Flow, Odoo connectors)

| | |
|---|---|
| Depth | `shell` |
| Impact | high |
| Effort | months |

**Today.** `key-connector/providers/provider-registry.service.ts` registers 36 providers — 17 external (google_forms/contacts/business/calendar/drive, outlook_contacts/calendar, whatsapp_business, stripe, wipay, typeform, jotform, mailchimp, sendgrid, slack, zapier) and 19 internal KEYFLOWOS modules. `connect/` contains genuinely working Google Contacts, Google Forms, Google Business Profile and Outlook Contacts sync with token helpers. Payments has real WiPay/Stripe/PayPal.

**Gap.** `sync-engine.service.ts:298-333` — `executeProviderSync`, the function every scheduled sync funnels through — is a stub for EVERY provider: it sleeps 100ms and returns `{recordsRead: 0, recordsCreated: 0, recordsFailed: 0, meta: {note: 'Sync adapter not yet implemented — placeholder result'}}`, and the job is marked SUCCESSFUL. That is the same silent-zero failure class this repo has an entire spec suite about (no-fabricated-screens.spec.ts, flow-tool-honesty.spec.ts) reproduced in the connector layer: a green sync history that moved no data. `slack.service.ts` is 149 lines with a single `sendWebhook` — no Slack app, no slash commands, no approving a T3 action from Slack, which is where an owner actually is.

**Evidence.** apps/server/src/modules/key-connector/sync/sync-engine.service.ts:298-333 read in full; provider keys enumerated by `grep -oE "key: '[a-z_0-9]+'"` over provider-registry.service.ts (36, authType: 8 oauth2 / 7 api_key / 1 webhook / 1 internal); apps/server/src/modules/slack/slack.service.ts (149 lines, one async method).

### 71. Email marketing (Mailchimp, HubSpot Marketing, Klaviyo)

| | |
|---|---|
| Depth | `workflow` |
| Impact | high |
| Effort | weeks |

**Today.** `email-marketing.service.ts` `sendCampaign` is a careful workflow: an atomic DRAFT/SCHEDULED->SENDING claim that makes double-send impossible, segment filtering on tags/status, suppression of `doNotContact` and non-`marketingOptIn` contacts, per-recipient tracking pixel and footer injection, BOUNCED marking on failure, revert-to-DRAFT on error. Campaign intelligence adds a pre-send validation pass.

**Gap.** Delivery goes through the business owner's personal Gmail OAuth token, one message at a time, with `await new Promise(r => setTimeout(r, 200))` between sends, inside the HTTP request (email-marketing.service.ts:400-437). A 1,000-contact campaign is a 200-second blocking loop against Gmail's ~500/day cap, from a consumer sending domain, with no SPF/DKIM alignment for the business, no ESP bounce or complaint webhooks, no warm-up, no list hygiene. Mailchimp's entire product is the part that is missing. And the honesty gap the repo polices elsewhere is present here: when Gmail is not connected the campaign is still written `status: 'SENT'`, `sentCount: recipientData.length`, and `events.emit('campaign.sent', {recipientCount: recipientData.length})` — full audience, zero delivered. The warning string is only in the HTTP response; the persisted record and the event bus both say it went out.

**Evidence.** apps/server/src/modules/email-marketing/email-marketing.service.ts:324-473 read in full, specifically :400-424 (Gmail loop + 200ms sleep), :438-451 (unconditional SENT/sentCount/emit), :453-456 (warning returned but not persisted); Resend exists but only for system/transactional mail (main.ts:26-36, notifications/system-email.service.ts).

### 72. Accounting / general ledger (QuickBooks, Xero)

| | |
|---|---|
| Depth | `intelligent` |
| Impact | medium |
| Effort | weeks |

**Today.** The strongest department in the repo and no longer hidden — the Aug-07 analysis's headline finding is closed. 32 services / 13,092 lines in modules/finance: `posting.service.ts` with balanced double-entry, Decimal arithmetic, a deterministic `buildExternalRef(sourceType, sourceId, kind)` idempotency key and ConflictException on re-post; COA seeder with system keys; bank rules; reconciliation with tolerance/date-window/reference scoring; multi-format statement ingestion (OFX FITID, MT940 :61:, QIF, CSV) that dedupes on the bank's own id where present; credit notes; fixed assets; accounting periods with lock; recurring journals; exchange rates; tax-liability rollup computing VAT/Sales Tax/Business Levy with input tax netted from `expense.taxAmount`; accountant export with ledger-driven P&L; `getBalanceSheet` in ledger-reporting.service.ts:657. 11 finance nav entries; 18 AI tools (12 finance_* + 6 reconcile_*) including T3 `finance_post_journal_entry` and `finance_pay_bill`.

**Gap.** Against Xero/QBO what is missing is mostly the surrounding market plumbing, and one structural piece. Missing: budget-vs-actual against the GL (only a flat `ExpenseBudget` model, summed in business-graph), dimension/class/location tracking on journal lines, multi-entity consolidation and inter-company elimination, and a filed VAT return artefact (the rollup computes the numbers; nothing produces the form). No bank-feed aggregator — this is a reasoned decision documented in bank-statement-parsers.ts:11-17 (open banking is a UK/EU regime; T&T coverage may not exist) and statement ingestion is the right answer for the market. One reliability note that undercuts the depth: the nightly rollups are `setInterval(24h)` started in `onModuleInit` (tax-liability-rollup.scheduler.ts:22-33), so the first tick is 24h after boot and every redeploy resets the clock — on a service that deploys often, the tax rollup may never have run.

**Evidence.** apps/server/src/modules/finance/ — 49 files, `find … | xargs wc -l` = 13,092; posting.service.ts:1-60 and buildExternalRef; tax-liability.service.ts:73-108,186-205; reports/ledger-reporting.service.ts:657; nav hrefs extracted from apps/web/src/lib/nav-config.ts (92 distinct, 11 under /app/finance); tool names and tiers from flow-tool-registry.ts:3332,3361.

### 73. CRM & sales (HubSpot, Salesforce, Zoho CRM)

| | |
|---|---|
| Depth | `intelligent` |
| Impact | medium |
| Effort | weeks |

**Today.** Genuinely competitive at the Starter/Professional tier. 40+ services in modules/crm: sequence engine with a typed node graph (email/whatsapp/sms/wait/branch/end, crm-sequence-graph.util.ts), duplicate detection + merge preview/execute, a data-quality scheduler, relationship-health scoring with its own scheduler, a contact scoring engine, saved views, lists, journeys, best-channel selection, Google contact sync, import. 33 AI tools across crm_*/deals_*/sequence_*. 25 web routes. `crm.deal.won` now fires from both win paths so a customer who bought stops being nurtured (commit dca8700a).

**Gap.** Custom fields exist for exactly one object: `CustomFieldDefinition` -> `ContactCustomFieldValue` (schema.prisma:2625,2649) — nothing for deals, invoices, products, projects or tickets. Every incumbent from Zoho upward lets a business add a field to any object, and for a T&T business that means things like BIR number on a customer or a container reference on an order have nowhere to live. Also absent vs HubSpot/Salesforce: forecast categories and quota attainment (`deals_forecast` is a single tool, not a managed forecast), territory/assignment rules, and a meetings/scheduling link tied to the deal. What the integrated schema makes possible and no CRM can: score a deal by the customer's actual ledger behaviour — days-to-pay from `payment`, credit-note history, margin realised from `expensePosting` — instead of by email opens. Nothing does this today; `contact-scoring.engine.ts` does not read the ledger.

**Evidence.** `ls apps/server/src/modules/crm` (60+ files); packages/db/prisma/schema.prisma:2625-2660; tool counts from flow-tool-registry.ts by first-token grouping (crm 13, deals 11, sequence 6); `find apps/web/src/app/app/crm -name page.tsx | wc -l` = 25.

### 74. Time, billing & professional services (Harvest, FreshBooks, Xero Projects)

| | |
|---|---|
| Depth | `crud` |
| Impact | high |
| Effort | days |

**Today.** `time-entry.service.ts` has timers (start/stop/running), manual entries, billable flag, `getSummary` returning billableMinutes/billedMinutes/unbilledHours, and `markAsBilled(ids, businessId, invoiceId)` which correctly re-validates the invoice belongs to the business before writing (a fixed tenant bug, per the comment at :305). 5 time_* AI tools, /app/time-tracking is in the nav. Time genuinely feeds payroll.

**Gap.** There is no path from unbilled time to an invoice. `markAsBilled` requires an `invoiceId` you must already have; nothing in `commerce` or `projects` reads `timeEntry` (`grep -rn timeEntry` over both modules returns nothing outside the AI orchestrator's tool dispatch). So the core professional-services loop — 'invoice everything unbilled on this project' — does not exist, in a product whose stated persona includes freelancers. Consequently work-in-progress never appears in the books: no WIP accrual, no revenue recognition on hours, and unbilled labour is invisible to `safe-to-spend` and to every forecast. The reverse leg (time -> payroll) is wired, which makes the missing leg cheaper than it looks: both sides of the join already exist.

**Evidence.** apps/server/src/modules/time-tracking/time-entry.service.ts:273-320; `grep -rn 'timeEntry' apps/server/src/modules/commerce apps/server/src/modules/projects --include=*.ts` returns nothing; payroll.service.ts:122-135 proves the opposite join works.

### 75. Work management (Monday, Asana, ClickUp)

| | |
|---|---|
| Depth | `crud` |
| Impact | medium |
| Effort | weeks |

**Today.** `projects` module has 8 files: projects.service, project-planner (LLM-driven plan generation), project-plan-executor, project-plan.listener, project-revenue.listener. 8 projects_* AI tools including get_timeline and get_budget. `ProjectTask.dependencies` is a `Json @default("[]")` column (schema.prisma:1759). 2 web routes.

**Gap.** Dependencies are an unvalidated JSON blob — nothing computes a critical path, nothing blocks a task whose predecessor is open, and `dependencyViolations` in project-planner.service.ts is a field the LLM is asked to populate in its JSON response (:305,:315) rather than something the server checks. No board/kanban or timeline view (2 routes total vs 25 for CRM), no workload balancing across people, no custom views or per-project fields, no subtasks. Against Monday/Asana this is a task list. The integrated angle that would actually beat them — project profitability computed live from `timeEntry` cost + `expense` + `invoice` on the same project id — is one query away and `projects_get_budget` does not do it.

**Evidence.** `ls apps/server/src/modules/projects` (8 entries); packages/db/prisma/schema.prisma:1759; apps/server/src/modules/projects/project-planner.service.ts:50,167,305,315,346; `find apps/web/src/app/app/projects -name page.tsx | wc -l` = 2.

### 76. Customer support (Zendesk, Intercom, Freshdesk)

| | |
|---|---|
| Depth | `crud` |
| Impact | medium |
| Effort | weeks |

**Today.** `helpdesk` is 3 files (controller, module, service). 12 AI tools across helpdesk_* (6) and inbox_* (6), including `helpdesk_draft_reply` and `inbox_brief`. `key-inbox` is a separate and more developed unified-thread surface with its own models (KeyInboxThread/KeyInboxMessage) and 6 web routes' worth of screens. Channel adapters exist for email, WhatsApp and Meta.

**Gap.** No SLA policy, no first-response or resolution clock, no breach escalation, no macros/canned responses, no CSAT survey, no business hours, no queue/assignment rules — `grep -rniE 'sla|firstResponse|breach|macro|csat|satisfaction'` over modules/helpdesk returns nothing. That is most of what Zendesk sells. `supportTicket` is also absent from the AI's standing context snapshot, so KEY never proactively notices a ticket ageing. The unique play the schema permits and Zendesk cannot: rank the queue by the customer's ledger value — outstanding balance, lifetime margin, days-to-pay — rather than by ticket age. Nothing joins `supportTicket` to `invoice` today.

**Evidence.** `ls apps/server/src/modules/helpdesk` = 3 files; `grep -rniE 'sla|firstResponse|breach|macro|csat' apps/server/src/modules/helpdesk/*.ts` = no matches; `grep -c 'db.supportTicket' business-graph.service.ts` = 0.

### 77. Storefront & commerce (Shopify, Square Online)

| | |
|---|---|
| Depth | `workflow` |
| Impact | medium |
| Effort | weeks |

**Today.** Real transactional depth. `site/store-order.service.ts` (786 lines) does cart validation against live stock, `calculateOrderTotals` with promo-code discount, shipping zone with free-shipping threshold, tax and rounding, then `createOrder` with stock reservation and a paymentStatus derived from method. `promo-code.service.ts`, `ShippingZone`, `ProductVariant` (attributes JSON, sku, priceOverride, per-variant trackStock/stockQty/reservedQty) all exist. Payments supports WiPay, Stripe and PayPal. Storefront conversion tracking and a storefront-invoice-attribution listener close the loop to revenue.

**Gap.** Tax is a single `business.defaultTaxRate` applied to the whole basket (store-order.service.ts:135-138) — no per-product tax class, no inclusive/exclusive handling per line, no exempt goods, which matters for T&T VAT on zero-rated food items. No fulfilment or returns/RMA workflow, no multi-channel listing sync, no abandoned-cart recovery emitter (the `store_order.abandoned` default trigger is documented in default-triggers-seeding.spec.ts:113-129 as having no emitter anywhere). No themes/app ecosystem, which is fine — the thing to sell against Shopify is not the storefront, it is that the order posts revenue AND COGS AND VAT liability into a real ledger the moment it is paid, which Shopify needs A2X plus Xero to do. That leg genuinely works here and is not marketed anywhere I can find.

**Evidence.** apps/server/src/modules/site/store-order.service.ts:29-205; packages/db/prisma/schema.prisma:7225-7245 (ProductVariant); apps/server/src/modules/ai/default-triggers-seeding.spec.ts:113-129; payment providers from `grep -rioE 'wipay|stripe|paypal' modules/payments`.

### 78. Reporting & BI (every incumbent; Zoho Analytics, Power BI)

| | |
|---|---|
| Depth | `workflow` |
| Impact | high |
| Effort | weeks |

**Today.** `reports.service.ts` (407 lines) generates 5 narrative report types — executive, pnl, revenue, expenses, clients — by assembling data and asking the LLM to write prose. `ledger-reporting.service.ts` (1,164 lines) is the real one: trial balance, balance sheet as-of a date, ledger-driven P&L, with a spec. `accountant-export.service.ts` produces a period pack with a zip builder and an email delivery service. `analytics-scheduler.service.ts` runs 6 crons rolling up daily/weekly/monthly.

**Gap.** No report builder — a user cannot define a metric, group it, filter it, save it, or schedule it. No dashboards a business can compose. The 5 narrative types are hardcoded string branches (reports.service.ts:244-248), so 'show me margin by product line for the last two quarters' has no answer at any layer: not a saved report, not a tool (`reports_generate` is 1 tool), and not the AI context (which has no ledger). This is the department where the shared schema should be most obviously superior — Odoo and Zoho need three products and an ETL to answer a question that here is one SQL join — and it is the department with the least surface: 1 AI tool against 245, and a report menu of five fixed essays.

**Evidence.** apps/server/src/modules/reports/ (6 files; reports.service.ts 407 lines, ledger-reporting.service.ts 1,164); reports.service.ts:244-248 (the five hardcoded type branches); `grep -oE "name: 'reports_[a-z_]+'" flow-tool-registry.ts` = 1.

### 79. Multi-entity / group consolidation (SAP B1, Dynamics, Odoo multi-company)

| | |
|---|---|
| Depth | `shell` |
| Impact | high |
| Effort | weeks |

**Today.** `Business` is the tenant boundary and a user can belong to several. `cross-business-intelligence.service.ts` (244 lines) does `aggregateForUser(userId)`, walks the user's memberships and builds a per-business snapshot of counts — contacts, invoices, bookings, open tasks — then compares them.

**Gap.** Counts only. No consolidated trial balance, no group P&L, no inter-company elimination, no shared chart of accounts, no cross-entity cash view, no consolidated VAT position. The owner of three related businesses — extremely common in this market, and the exact customer who would otherwise be quoted SAP B1 — gets three separate logins' worth of numbers side by side. This is the clearest place where 'one database' is a structural advantage that is being spent on nothing: every one of those businesses already posts into the same `ledgerEntry` table with a `businessId` column, so a consolidated balance sheet is a GROUP BY, and the tenant extension covers `LedgerEntry` so it would have to be an explicit, audited cross-tenant read — which the repo already has a typed helper for (`skipTenantIsolation`, used deliberately in posting.service.ts).

**Evidence.** apps/server/src/modules/ai/cross-business-intelligence.service.ts:61-155 read in full; `skipTenantIsolation` import at apps/server/src/modules/finance/posting.service.ts:3; no hits for consolidat|intercompany|elimination across apps/server/src.

---

## Lens: Leverage — what NOT to build — 17 findings

**Headline.** This repo has already proved it can buy instead of build — docling, Chatwoot, LiveKit, MinIO and pgvector all run as real production services — but the instinct stops dead at the apps/server boundary, where it hand-rolls a workflow engine, an eight-provider LLM router, a PDF writer, a PKZip writer, OAuth refresh in four places and every UI primitive; the four highest-value fixes in this report each need a dependency that is ALREADY in package.json (BullMQ for the durable timer that flow-runner.service.ts:283 asks for in a TODO comment and for the 78 unguarded in-process cron timers, google-auth-library which has zero imports while token refresh is reimplemented four times, react-hook-form used in 1 file against 2,169 useState calls) — and the single biggest unrealised asset, the 154-line MCP bridge that would answer 'connect and ingest any and every material' without writing a 23rd connector, ships switched off behind an empty MCP_REMOTE_SERVERS env var with the businessId argument deliberately ignored.

### 80. Workflow / automation engine (flow, automation modules)

| | |
|---|---|
| Depth | `crud` |
| Impact | critical |
| Effort | weeks |

**Today.** Two hand-rolled engines. `flow/flow-runner.service.ts` (449 lines) does a BFS over a JSON node/edge graph; `flow/flow-action.registry.ts` (207 lines) registers exactly SIX actions — create_command_item, draft_message, notify_user, create_task, send_message, create_contact. `flow/automation-executor.service.ts` (868 lines) is a second, unrelated engine with a hardcoded switch of ~8 conditions and ~8 actions. Runtime semantics are broken in three specific ways: (1) flow-runner.service.ts:284 — `if (totalMs > 0 && totalMs <= 30000)` — a delay longer than 30 seconds is a NO-OP, with the literal comment on line 283 `// In production, this should queue to BullMQ`; a 'wait 3 days then follow up' node completes instantly. (2) line 241 `if (!shouldContinue) break;` breaks the WHOLE traversal when a condition is false, despite the comment on line 294 claiming it only stops that branch — there is no if/else branching. (3) `key_step` nodes return `{ keyStep: true, simulated: true }` (line 322) — the AI step inside a flow does nothing at all.

**Gap.** DO NOT BUILD a workflow engine. The durable-timer primitive is ALREADY INSTALLED and already used three files away: `ai/queue.service.ts:103` passes `delay` to BullMQ and line 116-125 upserts a repeatable job with `repeat: { pattern, tz: 'UTC' }` and an idempotent jobId. BullMQ (MIT) is in apps/server/package.json and imported in 3 files. Fixing the delay node is `queue.add(job, { delay: totalMs })` plus a resume handler — days, not weeks. For the wider engine, ranked by fit: **Temporal (MIT)** — durable execution, timers, retries, versioning; heaviest integration (a worker process + rewriting flows as code) but it is what the saga/compensation code in key-cortex is already imitating. **Trigger.dev v3 (Apache-2.0)** — closest to the current shape, TypeScript-native, self-hostable, durable waits. **Node-RED (Apache-2.0)** if a visual editor is the point. LICENCE TRAPS: **n8n is NOT open source** — Sustainable Use License, source-available, explicitly restricts hosting it for third parties, which is exactly what a SaaS does. **Windmill is AGPL-3.0** — safe only as a network sidecar (like Chatwoot), never linked in-process.

**Evidence.** Read flow-action.registry.ts in full (207 lines, 6 `this.register(` calls). Read flow-runner.service.ts:200-333 for the delay/condition/key_step semantics and quoted the TODO comment verbatim. Read flow-engine.service.ts in full — 192 lines of pure Prisma CRUD, no execution. Grepped automation-executor.service.ts for `case '` — 8 condition cases, 8 action cases. Confirmed BullMQ already does delay+repeat by reading ai/queue.service.ts:100-130.

### 81. UI primitives and forms (apps/web, packages/ui)

| | |
|---|---|
| Depth | `crud` |
| Impact | high |
| Effort | weeks |

**Today.** Zero headless-UI dependency. `grep '@radix-ui\|shadcn' apps/web/package.json packages/ui/package.json` returns nothing. `packages/ui/src/components/` holds 23 files (12 real components + stories): button, card, badge, input, dialog, drawer, table, toast, shell, layout, momentum-bar, achievement, flow-feed. `apps/web/src/components/` holds 237 more bespoke .tsx files. `packages/ui/src/components/dialog.tsx` sets `aria-modal="true"` but has no focus trap, no portal and no body-scroll lock — it only listens for Escape. `apps/web/src/components/ui/data-table.tsx` is 413 hand-written lines. Most striking: `react-hook-form` + `@hookform/resolvers` + `zod` are all installed and used in exactly ONE file (`apps/web/src/components/contacts/contact-form.tsx`), against **2,169 `useState(` call sites** across the web app — every other form in 209 routes is hand-managed state with no validation layer.

**Gap.** This is the single cheapest route to 'quality and quantity fast' and it is being ignored. **shadcn/ui (MIT)** on **Radix UI (MIT)** — copy-in components, no runtime dependency to be hostage to, accessible dialogs/popovers/selects/comboboxes/date-pickers out of the box. **TanStack Table (MIT)** replaces data-table.tsx wholesale (sorting, filtering, virtualisation, column pinning). **cmdk (MIT)** replaces the hand-rolled `components/command-palette.tsx`. **react-day-picker (MIT)** for dates. And the near-free one: `react-hook-form` is already paid for — adopting the existing contact-form.tsx pattern as the house form standard costs nothing but repetition. No licence traps anywhere in this stack; shadcn in particular is copy-paste so there is no upgrade hostage situation. Integration cost is real but linear and can be done screen-by-screen behind the existing components.

**Evidence.** grep for @radix-ui/shadcn in both package.jsons — no matches. `ls packages/ui/src/components | wc -l` = 23. `find apps/web/src/components -name '*.tsx' | wc -l` = 237. Read dialog.tsx head and grepped it for focus/portal/inert — only aria-modal present. `wc -l apps/web/src/components/ui/data-table.tsx` = 413. `grep -rn react-hook-form apps/web/src -l` = 1 file. `grep -rn 'useState(' apps/web/src --include=*.tsx | wc -l` = 2169.

### 82. LLM gateway, model routing and cost accounting (modules/ai)

| | |
|---|---|
| Depth | `workflow` |
| Impact | critical |
| Effort | weeks |

**Today.** `ai/model-gateway.service.ts` is **2,974 lines** hand-routing eight providers — OpenAI (line 626), Anthropic (1006), Google (1015), xAI via `https://api.x.ai/v1` (1305), Kimi/Moonshot via `https://api.moonshot.cn/v1` (1381), a 'native AI' base URL (1453), OpenRouter (1539) and Ollama (1536) — with per-provider monthly caps, BYOK, fallback chains and circuit-breaking, all bespoke. Cost is computed by `ai/llm-cost.service.ts` (100 lines) from a hand-maintained **9-row** price table (`TOKEN_COST_PER_1K`, lines 22-32) whose newest entries are gpt-4o and claude-3-5-sonnet-20241022. Line 39 is the killer: `const costs = TOKEN_COST_PER_1K[model] || { input: 0, output: 0 }` — **any model not in those 9 rows costs exactly zero**. Meanwhile the registry references 12 distinct model families including o1, o3, gemini-2.5-pro, gpt-realtime and llama-3.1-70b, none of which are priced.

**Gap.** The old analysis said unit economics are unbounded because there is no meter. The sharper truth: the meter exists and silently reads $0 for most traffic. DO NOT keep hand-maintaining a provider router or a price table. **LiteLLM Proxy (MIT)** — one OpenAI-compatible endpoint in front of 100+ providers, upstream-maintained pricing for every model, per-key/per-tenant budgets, rate limits, fallbacks, retries, and semantic caching. It replaces the routing, the caps, the fallback chain and the entire cost table — plausibly 1,500-2,000 of those 2,974 lines — and turns 'aiCreditsPerMonth' from an unenforced field into a proxy-enforced budget. Runs as a sidecar in the compose file they already use. Add **Langfuse (MIT core; the `ee/` directory is not MIT — self-host the OSS build)** or **Helicone (Apache-2.0)** for trace/cost observability. Cheapest interim: OpenRouter is already configured (`OPENROUTER_API_KEY`, model-gateway:1528) and returns real per-request cost in its usage payload — read it instead of guessing.

**Evidence.** `wc -l model-gateway.service.ts` = 2974, `llm-cost.service.ts` = 100. Read llm-cost.service.ts:22-47 — quoted the 9-row table and the `|| { input: 0, output: 0 }` fallback. Grepped model-gateway for `baseURL` and provider cases to enumerate the eight backends. `grep -oE "'(gpt|o[0-9]|claude|llama|deepseek|gemini)[a-z0-9.-]*'"` across the server yields 12 model families vs 9 priced.

### 83. MCP bridge — installed, wired, and shipped switched off

| | |
|---|---|
| Depth | `shell` |
| Impact | critical |
| Effort | days |

**Today.** `modules/mcp/` is 221 lines total. `mcp-client-manager.service.ts` (154 lines) is a correct, security-conscious Streamable-HTTP MCP client — remote-only, no stdio/npx on the API host, tool output capped before it reaches prompts, tools tiered 2/3 by prefix. It IS wired: `ai/flow-orchestrator.service.ts:1056` calls `listBridgedTools(businessId)`. But `mcp.types.ts:24 loadMcpServerConfigs()` reads a single process-wide env var, and `.env.example:134` ships it as `MCP_REMOTE_SERVERS=` — empty. And the signature is `listBridgedTools(_businessId: string)` — the underscore is deliberate: the tenant argument is ignored, so the allowlist is one global list for the entire estate, not per-business.

**Gap.** This is the highest leverage-per-line asset in the repository and it is dark. The vision clause 'connect and ingest any and every material' does not need 22 more hand-written connectors — it needs this file to read from the database instead of an env var. Public MCP servers already exist for Stripe, Google Drive/Sheets/Gmail, Slack, Notion, Linear, GitHub, Cloudflare, Sentry, Postgres and dozens more, most under MIT or Apache-2.0, each maintained by the vendor rather than by you. Work: move `McpServerConfig[]` into a Prisma model scoped by businessId, store the bearer token in the existing keystore (there is a `modules/keystore/`, 14 files), honour the businessId in `listBridgedTools`, and add a screen to paste a URL + token. That is days, and it multiplies the tool surface without adding a single connector file. Risk to manage honestly: MCP tool output is untrusted text entering a prompt that can call 245 typed tools — the 200-char cap at line 78 is not a prompt-injection defence; keep bridged tools at tier 3 (human approval) as the code already does.

**Evidence.** Read mcp.types.ts in full (59 lines) and mcp-client-manager.service.ts structure. `grep MCP_REMOTE_SERVERS .env.example` → line 134, empty value. `grep -rn 'listBridgedTools\|McpClientManager' apps/server/src` → the only caller is flow-orchestrator.service.ts:1056; the parameter is `_businessId`.

### 84. External connectors and OAuth token management (core/connectors)

| | |
|---|---|
| Depth | `workflow` |
| Impact | high |
| Effort | months |

**Today.** 22 hand-written connector classes (`*.connector.ts`) totalling 6,548 lines in `implementations/`, 9,760 lines across `core/connectors/` — gmail, google-calendar, google-contacts, google-drive, google-forms, google-business-profile, outlook-contacts, jotform, typeform, webhook-form, klaviyo, mailchimp, meta-social, linkedin, tiktok, twitter, whatsapp, stripe, paypal, quickbooks, xero, wipay. OAuth refresh is hand-rolled in at least four separate places: `connect/google-token.helper.ts`, `connect/microsoft-token.helper.ts`, `connect/microsoft-oauth.service.ts`, `core/connectors/google-suite.service.ts`. And `google-auth-library@^10.5.0` is a declared dependency of apps/server with **zero imports anywhere in the monorepo** (the single grep hit is a controller method literally named `getGoogleAuthUrl`).

**Gap.** A paid-for dependency doing nothing while its exact job is reimplemented four times is the cheapest available leverage. Step one, hours not days: adopt **google-auth-library (Apache-2.0)** — it already handles refresh-token rotation, ID-token verification, service accounts and clock skew, all of which the helpers approximate. Step two, for the other 18 connectors: **Nango (Apache-2.0 core; some enterprise components are under the Elastic License — check before relying on those)** owns OAuth, token refresh, rate-limit backoff, webhook receipt and incremental sync for 250+ APIs, and you keep your own mapping layer. Cheaper still where an MCP server already exists (see the MCP finding) — Stripe, Google Workspace and Slack all have vendor MCP servers, so those connectors become configuration rather than code. LICENCE TRAP: **Airbyte's platform is Elastic License v2** (its connectors are MIT) — the platform licence forbids providing it as a managed service, so it is not a drop-in for a multi-tenant product.

**Evidence.** `ls implementations/*.connector.ts | wc -l` = 22; `wc -l implementations/*.ts` = 6548; `find core/connectors -name '*.ts' -not -name '*.spec.ts' | xargs wc -l` = 9760. `grep -rn 'google-auth-library\|GoogleAuth\|OAuth2Client' apps/server/src apps/web/src packages` → one match, `crm-google.controller.ts:20 getGoogleAuthUrl`, a method name. Hand-rolled refresh located by grepping for `refresh_token` — 10+ files.

### 85. Search across the product

| | |
|---|---|
| Depth | `shell` |
| Impact | high |
| Effort | days |

**Today.** There is no search infrastructure. `apps/server/src` contains **129 `contains:` filters** (Prisma ILIKE '%x%', unindexable sequential scans) and exactly one full-text path: `crm/crm.service.ts:383 searchContactIdsByTsvector` querying `search_vector @@ plainto_tsquery('english', …)`. That path is dead on any database built from the shipped migrations: `packages/db/prisma/migrations/0_baseline/migration.sql:1392` creates the `search_vector tsvector` column, but grepping the whole `migrations/` directory for `CREATE TRIGGER`, `USING gin` or `to_tsvector` returns **nothing** — the populate trigger and the GIN index live only in `migrations-archived/20260607000000_contact_fulltext_search/`, which is not in the applied history. So the column is permanently NULL, the query matches zero rows, and `crm.service.ts:244 if (tsIds.length > 0)` silently falls back to ILIKE. No user or test can tell the difference, which is why it has survived.

**Gap.** Do not write a search service. Two options, both cheap. (a) Finish what is already half-built: Postgres is already pgvector-enabled (`pgvector/pgvector:pg16` in both compose files) so you have FTS *and* embeddings in the database you already run. One migration restores the trigger and adds `CREATE INDEX … USING gin(search_vector)`; add `pg_trgm` for typo tolerance. Cost: a day, zero new infrastructure, zero licence exposure. (b) If cross-entity search over contacts + invoices + bookings + documents is the goal, **Meilisearch (MIT)** as a sidecar is the right shape — typo-tolerant, sub-50ms, trivially multi-tenant via index-per-business, and it drops into the compose file next to docling. LICENCE NOTES: **Typesense is GPL-3.0** and **ParadeDB's pg_search is AGPL-3.0** — both usable as separate network services, neither safe to link or fork into the product. Elasticsearch/OpenSearch are overkill at this scale and expensive to operate.

**Evidence.** `grep -rn 'contains:' apps/server/src | wc -l` = 129. Read crm.service.ts:241-247 (the fallback) and :383-399 (the raw query). Grepped `packages/db/prisma/migrations` for `CREATE TRIGGER|USING GIN|to_tsvector` → no matches; the same grep over `migrations-archived/` returns the full trigger definition. Column creation confirmed at 0_baseline/migration.sql:1392.

### 86. E-signature

| | |
|---|---|
| Depth | `absent` |
| Impact | high |
| Effort | days |

**Today.** Absent. The schema has `Contract`, `ContractParty`, `ContractTerm`, `ContractVersion`, `ContractAlert`, `ContractTag` (schema.prisma:853-996) and `contracts/contract-clause.service.ts` uses the docling sidecar plus an LLM to detect missing clauses — genuinely useful. But grepping the entire schema for `signedAt`, `signerEmail`, `signatureData` or `esign` returns nothing, and there is no signing route under `apps/web/src/app`. The product can analyse a contract's risk and cannot get it signed.

**Gap.** Never build e-sign. It is a legal-evidence product — audit trail, tamper-evident hashing, certificate of completion, timestamping — and getting it 90% right is worth nothing in a dispute. The self-host options are **Documenso (AGPL-3.0)**, **DocuSeal (AGPL-3.0)** and **OpenSign (AGPL-3.0)**. Note the pattern: the entire category is AGPL. That is fine and this repo already knows the safe shape — run it as a separate container behind Caddy and talk to it over HTTP, exactly as it already does with Chatwoot and docling. AGPL's network clause attaches to the program you serve; calling an unmodified upstream image over its own API does not make KEYFLOWOS a derivative work. Do NOT vendor their React components into apps/web, and do NOT patch their source — either turns a clean integration into an obligation to publish. Hosted alternative if speed matters more: Dropbox Sign and Zoho Sign both have free tiers with APIs. Realistic cost: one container, a webhook, and a `signature_request_id` column — days.

**Evidence.** `grep -niE 'signedAt|signatureData|signerEmail|esign' packages/db/prisma/schema.prisma` → zero relevant hits (the matches are `genomeSignals`, `assignedAt`, `unassignedAt`). `find apps/web/src/app/app -ipath '*sign*'` → only key-autonomy 'proposal' components, unrelated. Contract models located at schema.prisma:853-996.

### 87. Calendar: recurrence, iCalendar and scheduling

| | |
|---|---|
| Depth | `crud` |
| Impact | high |
| Effort | days |

**Today.** `modules/calendar/` is 23 files and `modules/bookings/` is 11, with conflict detection, projections, permissions and insight schedulers. But grepping the whole server for `RRULE`, `icalendar`, `caldav`, `VEVENT` or `BEGIN:VCALENDAR` returns nothing — the only 'ics' matches are the substring inside 'metrics'. The one connector is `calendar/connectors/google-calendar-temporal-sync.service.ts`. In schema.prisma, every `recurring*` field belongs to finance (RecurringInvoice, RecurringExpense, RecurringJournalEntry) — there is no recurring *event* or recurring *booking* anywhere.

**Gap.** 'Weekly team standup' and 'every second Tuesday' are table stakes and RFC 5545 recurrence is notoriously easy to get subtly wrong (DST, EXDATE, COUNT vs UNTIL, floating vs zoned times). Do not write it. **rrule.js (BSD-3-Clause)** is the reference JS implementation of RRULE expansion. **ical-generator (MIT)** produces the .ics files that let a booking land in Outlook/Apple Calendar without any integration at all — that alone is the cheapest 'works with everything' win available, roughly a day. **ical.js (MPL-2.0)** parses inbound .ics. For a full booking front-end, **Cal.com is AGPL-3.0** — same sidecar-only rule as the e-sign tools; embedding their components in apps/web would be the trap. Also worth noting: `date-fns` is installed but `date-fns-tz` is not, and only 14 server files touch timezone at all — for a Trinidad-based product selling to businesses with overseas customers, that will bite.

**Evidence.** `grep -rniE '\bics\b|icalendar|caldav|rrule|VEVENT|BEGIN:VCALENDAR' apps/server/src --include=*.ts -l` → 4 files, all false positives on 'metrics'. `ls modules/calendar/connectors/` → one file. `grep -n 'recurrenc|rrule|recurring' schema.prisma` → all finance models. `grep -rn 'date-fns-tz|luxon' apps/server/src` → absent; 14 files mention timeZone.

### 88. Scheduling / cron leader election

| | |
|---|---|
| Depth | `shell` |
| Impact | high |
| Effort | weeks |

**Today.** **26 `@Cron(` decorators plus 52 `setInterval(` calls = 78 in-process timers**, and `grep -rniE 'pg_advisory|redlock|distributed.?lock|SETNX|acquireLock'` across the server returns **nothing**. The setInterval timers are spread over commerce (8), ai (8), crm (7), social (3), finance (3), calendar (2), email-marketing (2) and more — several sweep every business in the estate, e.g. `email-marketing/campaign-scheduler.service.ts:19` fires every 60s and queries `emailCampaign.findMany({ where: { status: 'SCHEDULED' … } })` with no tenant scope. Two replicas send every scheduled campaign twice.

**Gap.** The old analysis and docs/OPEN_GAPS_2026-08-09.md both flag this and both frame it as 'add leader election'. The leverage framing is better: **you already own the answer**. BullMQ (MIT) is installed and `ai/queue.service.ts:113-128` already registers repeatable jobs with `repeat: { pattern: cronExpression, tz: 'UTC' }` and an idempotent `jobId` — a repeatable job fires exactly once across N workers by construction, and Redis is already in both compose files. Moving 78 timers onto the queue that three files already use costs no new dependency, no new container, and no `pg_advisory_lock` bespoke code. It also unblocks horizontal scale, which is currently structurally impossible. If a Postgres-only answer is preferred, **pg-boss (MIT)** does the same on the database you already have.

**Evidence.** `grep -rn '@Cron(' apps/server/src | wc -l` = 26; `grep -rn 'setInterval(' apps/server/src | grep -v spec | wc -l` = 52, bucketed by module. `grep -rniE 'pg_advisory|redlock|distributed.?lock|SETNX|acquireLock'` → no matches. Read ai/queue.service.ts:100-130 for the existing repeatable-job upsert. Read campaign-scheduler.service.ts in full (70 lines).

### 89. Document generation — PDF and ZIP (three stacks for one job)

| | |
|---|---|
| Depth | `crud` |
| Impact | medium |
| Effort | days |

**Today.** Three separate implementations of 'render a document', and no invoice PDF at all. (1) `jspdf` + `jspdf-autotable` client-side in three files — `app/reports/components/export-pdf.ts`, `revenue-reports-view.tsx`, `lib/contacts-export.ts`. (2) `pdfkit` server-side in `reports/report-formatters.ts:2` and `business-genome/document-pack/genome-document-pack.formatters.ts`. (3) `finance/pdf-builder.ts` — 136 lines writing raw PDF bytes by hand, its header stating *"No external deps — keeps the server bundle slim"* while pdfkit is a declared dependency of the same application. The same pattern repeats in `finance/zip-builder.ts` — 109 lines implementing PKZip with a hand-built CRC32 table, header: *"avoids pulling jszip/archiver into the server bundle just for this one use-case"* — while `exceljs` (already installed, used in 2 server files) ships a full zip writer, as does `docx`. And searching commerce for any PDF output returns nothing: **the invoicing product cannot produce an invoice PDF.**

**Gap.** Delete two of the three stacks. Server-side `pdfkit` (MIT, already installed) is the one to keep; it makes `finance/pdf-builder.ts` and both jspdf packages deletable — which also removes the `jspdf` critical CVE and roughly a megabyte from the client bundle, since the old analysis's claim that jsPDF sits on the invoice path is simply wrong (there is no invoice PDF; jspdf only backs three export buttons). If document *fidelity* matters — branded invoices, quotes, statements — the right answer is HTML→PDF, not a drawing API: **Gotenberg (MIT)** as a container (it is a Chromium/LibreOffice service and drops into the compose file beside docling), or **Puppeteer (Apache-2.0)** in-process, or **Typst (Apache-2.0)** for typeset finance documents. For ZIP: `archiver` (MIT) or `yazl` (MIT), or reuse the exceljs zip writer already in the bundle. This finding is the whole leverage thesis in miniature: the repo pays for a dependency and then hand-rolls the same thing next to it, twice, for stated bundle-size reasons that the already-present dependency invalidates.

**Evidence.** `grep -rn jspdf apps packages --include=*.ts*` → 3 web files. `grep -rn 'pdfkit|PDFDocument' apps/server/src` → 2 files. Read the header comments of finance/pdf-builder.ts (136 lines) and finance/zip-builder.ts (109 lines) verbatim. `grep -rniE '\.pdf|application/pdf' apps/server/src/modules/commerce` → zero matches.

### 90. Email: deliverability, templates and campaign infrastructure

| | |
|---|---|
| Depth | `workflow` |
| Impact | high |
| Effort | days |

**Today.** Better than expected for a hand-roll. `email-marketing/email-marketing.service.ts` (645 lines) does HMAC-signed open pixels and click wrapping (`buildTrackingToken`, constant-time `verifyTrackingToken`), signed unsubscribe tokens with a footer injected into every send, and `unsubscribeContact` sets `contact.doNotContact`. What is missing is the part providers own: `grep -rn 'List-Unsubscribe'` returns **nothing** (Gmail and Yahoo have required a one-click List-Unsubscribe header on bulk mail since 2024), and there is no Resend webhook — `webhooks.controller.ts` exposes only Stripe and generic business webhooks, so `BOUNCED` is set in exactly one place, `communications/delivery-queue.service.ts:265`, from a *send-call* failure. A hard bounce or a spam complaint reported asynchronously by the provider is never recorded, so the suppression list can never learn. HTML bodies are built as string concatenation (see the inline `<div style=…>` footer at email-marketing.service.ts:151).

**Gap.** Three cheap fixes, none of which is 'build an ESP'. (1) Resend is already the provider and already sends `email.bounced` / `email.complained` webhooks for free — one controller and a suppression write, half a day, and it is the difference between a sending domain that survives and one that gets blocklisted. (2) Add the `List-Unsubscribe` and `List-Unsubscribe-Post` headers — an hour, and it is now effectively mandatory at Gmail. (3) Stop concatenating HTML: **react-email (MIT)** or **MJML (MIT)** give client-tested, dark-mode-safe, Outlook-safe templates. Do NOT adopt a campaign platform: **Listmonk is AGPL-3.0** and **Mautic is GPL-3.0** — both are sidecar-only, and neither is worth the operational cost when the tracking layer here already works. If raw sending volume ever becomes the constraint, **Postal (MIT)** is a self-hosted MTA, but Resend's free tier is the right answer for a long time.

**Evidence.** Read email-marketing.service.ts:155-300 (tracking tokens, footer, unsubscribe). `grep -rn 'List-Unsubscribe' apps/server/src` → no matches. `grep -n '@Post|@Get' webhooks.controller.ts` → stripe + business webhooks only. `grep -rniE 'bounce|complained|email.bounced'` → the only write is delivery-queue.service.ts:265 and :587, both from send outcomes.

### 91. Payroll

| | |
|---|---|
| Depth | `shell` |
| Impact | medium |
| Effort | days |

**Today.** `modules/payroll/` is three files, 301 lines total; `payroll.service.ts` is 228 of them. It computes hours × rate or a flat monthly amount into `grossPay` and sums to `totalGross`. Grepping the module for `paye`, `nis`, `health surcharge`, `deduction` or `netPay` returns **nothing**, and no `netPay` field exists on `PayrollItem` (schema.prisma:2394). The doc comment calls it 'Payroll MVP'.

**Gap.** DO NOT BUILD THIS. In Trinidad & Tobago a payroll run has three statutory deductions — NIS (banded, employer + employee), PAYE against the personal allowance, and Health Surcharge — plus TD-1 declarations and monthly PAYE/NIS remittance. That is a compliance product with an annual maintenance obligation as rates change, and there is no open-source engine that knows T&T rates; the OSS payroll projects (OrangeHRM, Odoo payroll localisations, Frappe HR) are all localised elsewhere and would need the same rules written anyway. The leverage move is to *not* be in the payroll business: keep `time-tracking → hours → gross` (which is genuinely useful and already built), export a CSV in the format the local payroll bureaus and accountants already accept, and let the accountant channel — the strongest distribution idea in the earlier analysis — do the statutory part. If it must exist later, the honest shape is a versioned rates *table* maintained by an accountant, not an engine maintained by an engineer.

**Evidence.** `wc -l apps/server/src/modules/payroll/*.ts` = 61 + 12 + 228. `grep -rniE 'paye|nis\b|health surcharge|deduction|net pay|netPay|gross' payroll/*.ts` → 8 hits, all `grossPay`/`totalGross`. `grep -n 'model Pay' schema.prisma` → PayRate:2348, PayrollRun:2368, PayrollItem:2394.

### 92. Document parsing / OCR — already leveraged, badly underused

| | |
|---|---|
| Depth | `workflow` |
| Impact | high |
| Effort | days |

**Today.** The best decision in the repo, and it is running at a fraction of its value. `quay.io/docling-project/docling-serve:latest` (IBM's docling, MIT) is a first-class service in BOTH compose files with healthchecks, and `ingestion/document-parsing.service.ts` (93 lines) is a clean fail-open client that turns PDFs, office docs and *scans* into Markdown plus extracted tables. It has exactly **two** callers: `ai/document-intelligence.service.ts:11` and `contracts/contract-clause.service.ts:4`. Separately, the server still carries `pdf-parse@^1.1.1` (1 file) and `mammoth` (1 file) — the raw-bytes predecessors docling replaces — and there is no OCR reference anywhere in the codebase, because docling already does OCR internally and nobody noticed.

**Gap.** Nothing to build; something to point at. The vision clause 'connect and ingest any and every material' is already technically solved and wired to two features. Route the other ingest paths through it: `crm/crm-import.service.ts` (spreadsheet/contact import), `finance/bank-import.service.ts` and `bank-statement-parsers.ts` (a PDF bank statement is the single most common SMB format and the parser handles only OFX/QIF/MT940/CSV — a scanned statement is unhandled today), `ingestion/data-inbox.service.ts`, and the receipt path in `commerce/payment-evidence.service.ts`. Then delete `pdf-parse` (unmaintained, and it was a source of supply-chain noise) and `mammoth`. If docling's throughput ever becomes the bottleneck, **unstructured.io's core library (Apache-2.0)** and **Tesseract (Apache-2.0)** are the fallbacks — but there is no reason to add either yet.

**Evidence.** Read docker-compose.yml:79-94 and docker-compose.production.yml:170-181 (docling service + DOCLING_URL wiring at line 90). Read ingestion/document-parsing.service.ts in full. `grep -rn DocumentParsingService apps/server/src` → 2 external callers plus the module. `grep -rniE 'tesseract|ocr\b|textract|paddleocr'` → zero genuine hits. Read bank-statement-parsers.ts header: formats are ofx | qif | mt940 | csv, no PDF.

### 93. Live chat / helpdesk — Chatwoot bridge (single-tenant, and a licence trap in the image tag)

| | |
|---|---|
| Depth | `workflow` |
| Impact | medium |
| Effort | days |

**Today.** `modules/chatwoot/` is 185 lines and the integration is real: an agent-bot webhook normalises both Chatwoot payload shapes, routes inbound customer messages into `FlowOrchestratorService.chat()` with a support persona and per-conversation session continuity (`chatwoot-conv-${id}`), and posts KEY's reply back through the Chatwoot API — with a fallback message on failure so a customer is never left silent. But every parameter is a process env var: `CHATWOOT_URL`, `CHATWOOT_ACCOUNT_ID`, `CHATWOOT_API_TOKEN`, `CHATWOOT_WEBHOOK_SECRET` and — decisively — `CHATWOOT_BUSINESS_ID` (chatwoot.service.ts:50). **One business per deployment.** Meanwhile `modules/helpdesk/` is 237 lines across 3 files. Both compose files pin `image: chatwoot/chatwoot:latest`.

**Gap.** Two things, neither of which is building a helpdesk. First, the shape is right and should be generalised: move the five env vars into a per-business connector record (the `keystore` module already exists for secrets) and key the webhook path by business rather than by a single shared secret. Until then this is a demo, not a product feature, and `modules/helpdesk/` should be deleted rather than grown — Chatwoot already has the inbox, canned responses, SLAs, teams, CSAT and mobile apps. Second, a real LICENCE TRAP: Chatwoot's community edition is MIT, but the repository also contains an `enterprise/` directory under a separate commercial licence, and the **`chatwoot/chatwoot:latest` image bundles it**. The MIT-only build is published as **`:latest-ce`**. Pin `:latest-ce` (and pin a version, not `latest`, in production) unless someone has read and accepted the enterprise terms. Same discipline applies to `minio/minio:latest` below.

**Evidence.** Read chatwoot.service.ts in full (152 lines) — the env getters are lines 47-51, `CHATWOOT_BUSINESS_ID` at 50, session key at 122. `.env.example:309-313` lists all five. `ls modules/helpdesk/` = 3 files, 237 lines. Image tags at docker-compose.yml:122 and docker-compose.production.yml:210.

### 94. Reporting and BI

| | |
|---|---|
| Depth | `crud` |
| Impact | low |
| Effort | days |

**Today.** `modules/reports/` is 6 files: `reports.service.ts` (407 lines) with a single `generateReport(businessId, type, startDate, endDate, compare)` entry point, `ledger-reporting.service.ts`, and `report-formatters.ts` (456 lines) producing CSV and pdfkit PDF for P&L, cashflow, balance sheet and tax summary. There is exactly one web route, `apps/web/src/app/app/reports/page.tsx`. `recharts` is installed and imported in 13 files against 209 routes. There is no user-defined report builder, no saved views, no scheduled delivery, and no pivot.

**Gap.** The counter-recommendation matters as much as the recommendations: **do not add a BI layer.** A 1-15 person Caribbean business does not want a dashboard designer; it wants six correct statements and an Excel file its accountant accepts. The fixed reports plus `exceljs` (already installed) and the pdfkit path already cover that — what is missing is *scheduled delivery* (which the BullMQ queue can do) and an accountant-ready export (which `finance/accountant-export.service.ts` already builds). If BI is ever genuinely demanded, the honest options are **Apache Superset (Apache-2.0)** or **Evidence.dev (MIT)**, both safe to embed. LICENCE TRAP: **Metabase's OSS edition is AGPL-3.0** — the interactive-embedding path that most people actually want is what triggers the network clause, and Metabase's own commercial embedding licence exists precisely because of it; it is the single most commonly-tripped AGPL trap in SaaS.

**Evidence.** `ls modules/reports/` = 6 files; `wc -l reports.service.ts` = 407, `report-formatters.ts` = 456. `grep -nE 'async [a-zA-Z]+\(' reports.service.ts` → 3 methods, one public. `find apps/web/src/app/app/reports -name page.tsx` → 1. `grep -rE 'from ["\']recharts' apps/web/src -l | wc -l` = 13.

### 95. Installed-but-unused dependencies (the cheapest leverage in the repo)

| | |
|---|---|
| Depth | `crud` |
| Impact | high |
| Effort | days |

**Today.** Measured by counting importing files. Dead weight: `google-auth-library@^10.5.0` — **0 imports**; `isomorphic-dompurify@^3.12.0` — **0 imports** (while `sanitize-html` does the work in 3 files, so two sanitisers are paid for and one is used); `rehype-highlight@^7.0.2` — **0 imports**. Near-dead: `@trpc/server@^10.45.2` — 1 file, and v10 is a superseded major; `docx@^9.7.1` — 1 file; `mammoth` — 1 file; `pdf-parse@^1.1.1` — 1 file (both superseded by the docling sidecar); `dexie@^4.3.0` — 1 file; `livekit-server-sdk` — 1 file and `livekit-client` — 1 file (an entire realtime A/V stack, plus a `livekit` container in both compose files and a `voice-agent` service in production, for two files). Underused against opportunity: `react-hook-form` + `@hookform/resolvers` — 1 file vs 2,169 `useState` calls; `bullmq` — 3 files vs 78 in-process timers; `pdfkit` — 2 files vs two hand-rolled document writers; `@modelcontextprotocol/sdk` — 1 file, disabled by an empty env var; `@tiptap/*` — **seven** installed packages imported in 2 files; `@dnd-kit/*` — three packages, 2 files; `exceljs` — 4 files, while a hand-rolled PKZip sits beside it.

**Gap.** Two separate actions. (1) Remove what is unused — three packages with zero imports, plus `pdf-parse` and `mammoth` once ingestion routes through docling. This is an afternoon and it shrinks the audit surface that produced the earlier 129-vulnerability count. (2) Far more valuable: *use* what is already paid for. Every one of the four biggest recommendations in this report — durable workflow timers, cron leader election, the connector OAuth layer, and a validated-form standard — is satisfiable by a dependency already in package.json (bullmq, bullmq, google-auth-library, react-hook-form). No procurement, no licence review, no new container, no lockfile risk. A dependency that is installed and barely used is not just cheap leverage; it is leverage that has already cleared every objection.

**Evidence.** Per-dependency importing-file counts derived by `grep -rE "from ['\"]<pkg>" apps/{server,web}/src -l | wc -l`, run quote-agnostically for both apps. Cross-checked the zero-count cases with unquoted greps and dynamic-import greps — that check corrected an initial false negative on `@e2b/code-interpreter`, which IS used via `importEsm('@e2b/code-interpreter')` at code-executor.service.ts:221 and is therefore NOT dead. `google-auth-library` survived the same check: the only match in the monorepo is a method named `getGoogleAuthUrl`.

### 96. Object storage and the AGPL surface already in production

| | |
|---|---|
| Depth | `workflow` |
| Impact | low |
| Effort | days |

**Today.** `minio/minio:latest` runs in both compose files with a persistent volume, and `@aws-sdk/client-s3` is imported in exactly 1 server file. The production stack is otherwise licence-clean: Caddy (Apache-2.0), LiveKit (Apache-2.0), docling (MIT), pgvector/Postgres (PostgreSQL licence), Redis 7 (BSD-3 — note Redis 8 moved to AGPL/RSAL, so `redis:7-alpine` is the safe pin and should stay pinned).

**Gap.** Two honest notes rather than a rebuild. (1) **MinIO's server is AGPL-3.0.** Running an unmodified upstream image and talking to it over the S3 API from a separate process is the accepted safe pattern — the obligation attaches to distributing or serving *modified* MinIO, not to being an S3 client. Do not fork it, do not vendor its console, and pin a version. Separately, MinIO has been removing features from the community build, so the operational risk is larger than the legal one; **SeaweedFS (Apache-2.0)** is the licence-clean self-host swap, and Cloudflare R2 (zero egress) or Backblaze B2 is cheaper than running storage on one VPS at all. (2) The general rule this repo should write down, because it is already following it correctly three times: **AGPL software is fine as a network sidecar and never fine linked into apps/server or apps/web.** That single sentence makes the e-sign, BI, search and workflow decisions above mechanical rather than case-by-case.

**Evidence.** docker-compose.yml:61-77 and docker-compose.production.yml:155-168 (minio service + volume). `grep -rE "from '@aws-sdk/client-s3" apps/server/src -l | wc -l` = 1. Image pins read directly from both compose files.
