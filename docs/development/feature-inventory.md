# KEYFLOWOS Feature Inventory Matrix

**Date:** 2026-08-30  
**Purpose:** A tiered, layered checklist of every user-facing feature/module and its current end-to-end status.  
**Source:** 2026-08-30 full-domain deep scan + architecture registries.

---

## Legend

| Tier | Name | Meaning |
|------|------|---------|
| **P0** | Stop-the-line | Blocks signup, login, onboarding, admin access, payment, or creates a live security/data-leak risk. Must be fixed before any launch. |
| **P1** | Core journey | Breaks the primary day-one or day-seven user flow. A user can log in but cannot complete the thing they came to do. |
| **P2** | Feature completeness | Feature is reachable but incomplete, mock, or has a functional hole that makes it unreliable. |
| **P3** | Polish / architecture | Debt that slows future work, creates operational risk, or clutters the product surface. |

| Status | Meaning |
|--------|---------|
| ✅ Working | Happy path is functional and persisted end-to-end. |
| ⚠️ Partial | Works for some cases but has a known gap or failure mode. |
| ❌ Broken | Does not work; throws, 404s, or silently fails. |
| 🚧 Stub | UI or API exists but the underlying action is faked or not implemented. |
| 🔇 Orphaned | Code exists but is unreachable from nav, gated off, or never imported. |

---

## 1. Auth & Identity

| Feature | Sub-feature | Tier | Status | Evidence / Blocker |
|---------|-------------|------|--------|--------------------|
| Supabase JWT verification | Local HMAC verify | P0 | ✅ Working | `apps/server/src/core/auth/supabase-auth.service.ts:38-46` |
| | Supabase fallback round-trip | P0 | ✅ Working | `supabase-auth.service.ts:101-120` |
| | Claim validation (alg, iss, aud, nbf, iat) | P0 | ✅ Working | R32 mitigated |
| Email/password login | Server-driven login | P0 | ✅ Working | `apps/server/src/modules/identity/identity.controller.ts:191-219` |
| | Rate limiting & audit | P0 | ✅ Working | `auth-security.service.ts` |
| | Friendly error mapping in UI | P0 | ✅ Working | `apps/web/src/app/auth/login/login-form.tsx:157-181` |
| Signup | Supabase user creation | P0 | ✅ Working | `identity-signup.service.ts:87-195` |
| | Password policy (12 chars, HIBP) | P0 | ✅ Working | `password-policy.service.ts` |
| | Verification email via Resend | P0 | ✅ Working | |
| OAuth callback (Google) | PKCE + token exchange | P0 | ✅ Working | `apps/web/src/app/auth/callback/page.tsx:56-228` |
| | Account email conflict screen | P0 | ✅ Working | |
| | Workspace bootstrap | P0 | ✅ Working | |
| Password reset | Forgot password | P0 | ⚠️ Partial | Calls Supabase directly from browser; not rate-limited/audited server-side |
| | Reset page | P0 | ✅ Working | `apps/web/src/app/auth/reset-password/page.tsx:26-124` |
| Session / logout | Server logout + Redis revocation | P0 | ✅ Working | `identity.controller.ts:273-299` |
| | Client cleanup | P0 | ✅ Working | `apps/web/src/lib/workspace.ts:259-271` |
| Token refresh | Refresh + retry | P0 | ✅ Working | `apps/web/src/lib/api.ts:117-149`, `fetchWithAuthRetry:297-315` |
| Edge auth gate | `/app/*` middleware | P0 | ✅ Working | `apps/web/src/middleware.ts:108-141` |
| Client auth boundary | `<RequireAuth>` | P0 | ✅ Working | `apps/web/src/components/require-auth.tsx:24-169` |
| Admin login | Credentials validation | P0 | ✅ Working | `@IsNotEmpty()` on DTO + null-safe `validateCredentials` |
| | Admin token issuance | P0 | ✅ Working | `admin-auth.service.ts` |
| Admin console access | Layout gate | P0 | ✅ Working | `isSuperAdmin()` now falls back to `kf_admin_user_cache` |
| | Server-side admin check | P0 | ⚠️ Partial | Middleware enforces role; layout still client-side only |
| Auth DTO validation | `@IsNotEmpty()` enforcement | P0 | ✅ Working | Added to `AdminLoginDto`, `LoginDto`, `SignupDto` |
| Global auth default | Opt-in vs opt-out | P3 | ⚠️ Partial | 227 public handlers acknowledged; new routes default public |

---

## 2. Onboarding & Business Genesis

| Feature | Sub-feature | Tier | Status | Evidence / Blocker |
|---------|-------------|------|--------|--------------------|
| Onboarding state machine | Step persistence | P0 | ✅ Working | `onboarding-state.service.ts:62-127` |
| | Completion gate | P0 | ✅ Working | `markOnboardingComplete` enforces three-pillar minimum |
| | DTO rejects `complete` step | P0 | ✅ Working | `save-onboarding-step.dto.ts:14` |
| Slim chat-driven funnel | Welcome step | P1 | ✅ Working | Seeds welcome bubble |
| | Deep-link/resume into intake/template/configure | P1 | ✅ Working | Empty-chat step now auto-seeds its card |
| | Template picker | P1 | ✅ Working | `TemplatePickerCard` + `autoConfigureFromTemplate` |
| | Payments/storefront/contacts setup | P1 | ⚠️ Partial | Only path to satisfy contacts is `seedDemoData`, which also creates demo invoice |
| Business Genesis idea extraction | Analyze idea | P1 | ✅ Working | `business-genesis.controller.ts:30-52` |
| | Q&A flow | P1 | ✅ Working | `questions/next`, `answers` |
| | Blueprint/Genome sync | P1 | ✅ Working | `business-genesis.service.ts:224-436` |
| Business Genome intake chat | Section coverage | P1 | ⚠️ Partial | Omits legal/registration/tax/ownership sections |
| | State durability | P1 | ❌ Broken | In-memory `Map` in `blueprint-onboarding.service.ts:122`; refresh restarts interview |
| | Client history | P1 | ❌ Broken | Local React state only |
| BusinessBlueprint CRUD | Lazy create/update | P1 | ✅ Working | `blueprint.service.ts:194-355` |
| | Integrity scoring | P1 | ✅ Working | `key-genome.service.ts:211-355` |
| Genome gate guard | Blocks actions until 50% per pillar | P0 | ✅ Working | `core/auth/genome-gate.guard.ts:9-31` |
| Legacy step components | WelcomeStep, IntakeChatStep, etc. | P3 | 🔇 Orphaned | Defined but never imported |
| Concierge chat/nudges | Server endpoints | P3 | 🔇 Orphaned | Not called by new flow |

---

## 3. Command Center & Navigation

| Feature | Sub-feature | Tier | Status | Evidence / Blocker |
|---------|-------------|------|--------|--------------------|
| Command Center dashboard | Snapshot load | P1 | ✅ Working | `business-command-center.service.ts:126-234` |
| | KPIs, queue, vitals, nudges | P1 | ✅ Working | `command-center/page.tsx:129-459` |
| | Cross-domain panel | P1 | ✅ Working | |
| Snapshot API | `GET /business-command-center/businesses/:id/snapshot` | P1 | ✅ Working | 29 unit tests pass |
| Command item detail | Complete/dismiss/snooze/approve/execute/assign/reopen | P2 | ✅ Working | `command-center/[id]/page.tsx:76-411` |
| | Reachability from priority cards | P2 | ⚠️ Partial | `CommandItemCardV2` does not link to detail |
| Module launcher | Global `Shift+K` shortcut | P2 | ✅ Working | `use-keyboard-shortcuts.ts:39-46` |
| | Bottom-edge swipe | P2 | ✅ Working | `mobile-gesture-provider.tsx:68-70` |
| | Mobile "Flows" button | P2 | ✅ Working | `mobile-bottom-nav-v2.tsx:150-164` |
| | Desktop dialog / mobile bottom sheet | P2 | ✅ Working | `module-launcher-sheet.tsx` |
| Desktop sidebar | Primary rail + drawers | P2 | ✅ Working | `desktop-sidebar.tsx:241-481` |
| Mobile bottom nav v2 | Home/Flows/AI/Inbox/Me | P2 | ✅ Working | `mobile-bottom-nav-v2.tsx:45-223` |
| | Haptic feedback, unread badge | P2 | ✅ Working | |
| Navigation redirects | `/app` → `/app/command-center` | P2 | ✅ Working | |
| | `/app/finance` → `/app/money`, etc. | P2 | ✅ Working | `middleware.ts:41-57` |
| Disclosure mode filtering | Allowlist per mode | P2 | ✅ Working | `disclosure-mode.ts:49-111` |
| Genome gate redirect | Blocks `/app/*` until onboarding complete | P0 | ✅ Working | `use-genome-gate.ts:89-100` |
| KEY awareness/noticed panels | Fetch real endpoints | P2 | ✅ Working | `command-center/page.tsx:454-456` |
| Snapshot silent degradation | `safeResolve` fallbacks | P2 | ⚠️ Partial | Hides downstream failures; no UI warning |
| Legacy genome profile links | Command Center links | P3 | ✅ Working | Nav Profile link and integrity banner now point to `/app/genome` |
| Dead mobile bottom nav v1 | Tests reference unused component | P3 | ✅ Working | `mobile-bottom-nav.tsx` deleted; badge now uses `item.showUnreadBadge` in v2 |

---

## 4. KEY AI Chat & Voice

| Feature | Sub-feature | Tier | Status | Evidence / Blocker |
|---------|-------------|------|--------|--------------------|
| KEY Chat page (`/app/key/chat`) | V2 shell | P1 | ⚠️ Partial | `key-full-chat-shell-v2.tsx:79` |
| | Mode tabs | P1 | ✅ Working | All 9 roles exposed in `KeyChatModeTabs` |
| | Slash commands | P1 | ✅ Working | `key-chat-command-bar.tsx:25-31` |
| | Attachments | P1 | ✅ Working | |
| | Approvals rail | P1 | ✅ Working | Fetches `/ai/businesses/:id/ai/approvals` |
| | TTS bar | P1 | ⚠️ Partial | Falls back to hard-coded unavailable providers |
| Flow chat backend | Context, memory, triage, tools, governance | P1 | ✅ Working | `flow-orchestrator.service.ts:1903` `streamChat()` |
| Model gateway | Multi-provider routing | P1 | ⚠️ Partial | Only OpenAI configured; key validity needs verification |
| | Fallback chain | P1 | ⚠️ Partial | `'native-key'` fallback masks missing config |
| | BYOK path | P1 | ✅ Working | |
| KEY Autonomy proposals | Proposals/execution | P1 | ✅ Working | `key-action-proposal.controller.ts`, `key-action-executor.service.ts` |
| Approvals in chat | Confirm/reject | P1 | ✅ Working | `use-key-chat-actions.ts:531` |
| Deep Think / consciousness | Stream endpoint | P1 | ⚠️ Partial | Real pipeline, fails if AI key invalid |
| Key Cortex WebSocket gateway | `/key-cortex` namespace | P2 | 🔇 Orphaned | No web client connects |
| Voice input / push-to-talk | STT endpoint | P1 | ⚠️ Partial | Depends on OpenAI Whisper |
| | TTS playback | P1 | ⚠️ Partial | Depends on OpenAI TTS |
| Full-duplex LiveKit voice | `KeyLiveVoice` component | P2 | 🔇 Orphaned | Implemented but never imported |
| | Voice agent worker | P2 | ❌ Broken | Uses model `gpt-realtime`; realtime access unclear |
| | LiveKit room/token dispatch | P2 | ✅ Working | `livekit.service.ts:14-85` |
| Chat simulator | Dev-only canned scenarios | P3 | ✅ Working | `key/chat/simulator/page.tsx:39-134` |
| Missing chat modes | support / marketing / operator | P2 | ✅ Working | Rendered in `KeyChatModeTabs` and `key-full-chat-shell-v2` |
| Finance intelligence scans | `groupBy` soft-delete crash | P1 | ✅ Working | `detectOverspending` now uses `findMany` + in-memory aggregation |

---

## 5. CRM

| Feature | Sub-feature | Tier | Status | Evidence / Blocker |
|---------|-------------|------|--------|--------------------|
| Contacts list / CRUD | List/create/update/delete/bulk | P1 | ✅ Working | `crm.controller.ts:208-436` |
| | Soft-delete, audit, ownership | P1 | ✅ Working | `crm.service.ts:214-878` |
| Contact detail | Notes/tasks/timeline | P1 | ✅ Working | Nested routes + endpoints |
| Deals | Board/list/reports | P1 | ✅ Working | `crm-deals.controller.ts:22-295` |
| | Account pivot | P1 | ✅ Working | `crm-accounts.controller.ts:118-121` |
| | Win/lose/forecast/velocity | P1 | ✅ Working | |
| Pipeline / contact views | Focus/list/kanban/table/data-quality | P1 | ✅ Working | `pipeline-tab-content.tsx:451-503` |
| Sequences builder | CRUD/enrollment/analytics | P1 | ✅ Working | `crm-sequence.controller.ts` |
| Sequence execution | Actual send | P1 | ✅ Working | Wires `sequence.step_due` to `dispatchSendNode`; now works for businesses without Gmail via platform-domain fallback; on `origin/main` |
| | Sent/open/click/convert analytics | P1 | ✅ Working | `sentAt` stamped only after real dispatch; on `origin/main` |
| Data-quality scanner | Scan/upsert issues | P1 | ✅ Working | `crm-data-quality.service.ts:65-257` |
| | Bulk apply/wizard/dismiss | P1 | ✅ Working | `data-quality/page.tsx` |
| | Mark verified | P1 | ✅ Working | Now marks `contact.lastVerifiedAt` and resolves stale issues |
| Duplicate detection | Preview/merge | P1 | ⚠️ Partial | O(n²) in-memory fuzzy; will OOM at scale |
| Contact intelligence | At-risk/scored contacts | P2 | ✅ Working | `crm/intelligence/page.tsx:130-156` |
| CRM tRPC router | Basic contacts | P3 | 🚧 Stub | No deals/sequences/quality/duplicates |
| Sequence feature flag | Guard vs nav mismatch | P2 | ✅ Working | `FeatureFlagGuard` removed from `crm-sequence.controller.ts`; API now matches nav |

---

## 6. Commerce

| Feature | Sub-feature | Tier | Status | Evidence / Blocker |
|---------|-------------|------|--------|--------------------|
| Invoice/quote CRUD & state machine | Transitions | P1 | ✅ Working | `invoice-workflow.service.ts` |
| | `markInvoicePaid` | P1 | ✅ Working | Creates Payment record |
| Recurring invoices | Hourly scheduler | P1 | ✅ Working | `recurring-invoice.service.ts` |
| | CRUD/pause/resume/cancel | P1 | ✅ Working | |
| Product catalog | CRUD | P1 | ✅ Working | `catalog.service.ts` |
| | Public product list w/ stock | P1 | ✅ Working | |
| | Unconfigured inventory hides products | P1 | ✅ Working | `catalog.service.ts` treated NULL inventory config as restrictive; fixed in `37b2400a` |
| Stripe connector | Checkout/webhooks/refunds | P1 | ✅ Working | `stripe.connector.ts:97-490` |
| PayPal connector | Checkout/capture/webhooks | P1 | ⚠️ Partial | Payment-link list/revoke unsupported |
| WiPay connector | Checkout/callback/transactions | P1 | ⚠️ Partial | Payment links/refunds unsupported |
| Storefront order completion | Invoice + payment + stock decrement | P1 | ✅ Working | `store-order.service.ts:540-634` |
| | Warehouse/stock requirement | P1 | ✅ Working | `store-order` and inventory-risk disagreed on NULL `inventoryMode`; fixed in `bef9eb85` |
| Public invoice/pay/quote pages | `/public/invoice/[token]` | P1 | ✅ Working | |
| | `/pay/[invoiceId]` | P1 | ✅ Working | |
| | `/pay/link/[token]` | P1 | ✅ Working | |
| | `/public/pay` | P1 | ✅ Working | Now redirects to `/pay/${invoiceId}` |
| Invoice creation endpoint | Guards | P0 | ✅ Working | Already fixed in source |
| tRPC `markInvoicePaid` | Direct mutation bypasses workflow | P0 | ✅ Working | Removed dangerous bypass; use server workflow |
| AI product extraction / CSV import | OpenAI vision | P2 | ⚠️ Partial | Fails if AI key invalid |
| Currency / FX feed | Auto refresh | P2 | ❌ Broken | `FX provider response missing TTD rate` |
| Inventory migration | `/app/inventory` | P2 | 🔇 Orphaned | Old redirect abandoned |

---

## 7. Finance & Accounting

| Feature | Sub-feature | Tier | Status | Evidence / Blocker |
|---------|-------------|------|--------|--------------------|
| Navigation / Money hub | `/app/finance` → `/app/financial-flow` | P1 | ✅ Working | `nav-config.ts:161-189` |
| Chart of Accounts / Accounts / Tax Rates / Settings | CRUD | P1 | ✅ Working | `finance.controller.ts:322-444` |
| General Ledger | Endpoint + UI | P1 | ✅ Working | `finance.controller.ts:141-160` |
| Trial Balance | Endpoint + UI | P1 | ✅ Working | `finance.controller.ts:162-193` |
| Tax liabilities | Aggregates `Expense.taxAmount` | P1 | ✅ Working | `tax-liability.service.ts:190-199` |
| | Stale header comment | P3 | ✅ Working | Comment updated to reflect current schema |
| Bank import & reconciliation | OFX/QFX/MT940/QIF/CSV parsers | P1 | ✅ Working | `bank-statement-parsers.ts` |
| | Auto-match/manual match/unmatch | P1 | ✅ Working | |
| Bank rules | UI + backend | P1 | ✅ Working | |
| Recurring journals | UI + run-now | P1 | ✅ Working | |
| Credit notes | UI + backend | P1 | ✅ Working | |
| Fixed assets | UI + depreciation | P1 | ✅ Working | |
| Exchange rates | Manual CRUD | P2 | ✅ Working | |
| | Auto FX scheduler | P2 | ❌ Broken | Missing TTD rate |
| Accounting periods | UI + backend | P2 | ✅ Working | |
| Safe to Spend | KPI | P2 | ⚠️ Partial | Now explicit about unmodeled payroll/debt; still 0 |
| Cash reserve buckets | Schema + UI | P2 | ⚠️ Partial | Service casts `prisma.client as any` |
| Cashflow forecast | Finance endpoint | P1 | ✅ Working | Now queries `recurringExpense` correctly |
| Manual journal entries | Backend endpoints | P2 | 🔇 Orphaned | `/app/finance/journal` redirects to ledger |
| Expense transaction matching | Match button | P2 | ❌ Broken | Fake button removed; reconciliation matching not yet implemented |
| Money moves | Backend endpoint | P2 | 🔇 Orphaned | No UI found |
| Books reports | P&L/cashflow/balance/AR/AP/tax | P1 | ✅ Working | `BooksReportView` |
| Recurring expense scheduler | Auto generation | P2 | ✅ Working | Hourly `setInterval` in `RecurringExpenseService` plus run-now endpoint |

---

## 8. Bookings & Calendar

| Feature | Sub-feature | Tier | Status | Evidence / Blocker |
|---------|-------------|------|--------|--------------------|
| Internal bookings CRUD | Create/read/update/status/notes/location | P1 | ✅ Working | `bookings.controller.ts`, `bookings.service.ts` |
| | Conflict/availability/business-hours checks | P1 | ❌ Broken | Internal `createBooking` still bypasses checks; public path and rescheduling now enforce overlap/lead-time/staff availability/business hours |
| Public booking widget | `/book/[slug]` | P1 | ⚠️ Partial | Full checkout flow exists |
| | Slot generation | P1 | ❌ Broken | Uses `businessHours` only; ignores staff availability/occupancy |
| Availability / free-slot API | Public/internal endpoint | P1 | ✅ Working | `GET /public/businesses/:businessId/slots` is live |
| Waitlist | Add/list/match/offer/convert/cancel | P2 | ✅ Working | `booking-waitlist.service.ts` |
| | Auto-offer on cancel/reschedule | P2 | ✅ Working | `booking-waitlist.listener.ts:25` |
| | Expiry/notification for offered slots | P2 | ❌ Broken | No listener/cron |
| Google Calendar sync | OAuth/refresh/push/pull/conflict | P1 | ✅ Working | `calendar-sync.service.ts` |
| Master Calendar | Read/write/filters/agenda/insights | P1 | ✅ Working | `calendar.controller.ts`, `calendar-query.service.ts` |
| Booking reminders | 5-min scheduler | P2 | ✅ Working | `bookings.service.ts:85` |
| Booking AI tools | NL search/optimizer/no-show predictor | P2 | ✅ Working | `bookings-ai.service.ts` |
| Calendar AI assistant | interpret/build/execute/talk | P2 | ✅ Working | `calendar.controller.ts:437` |
| Public booking API contract | Required contact fields | P1 | ✅ Working | DTO now matches controller requirements |
| tRPC bookings router | Minimal duplicate | P3 | 🔇 Orphaned | No validation/plan-limit/event emission |

---

## 9. Communications & Marketing

| Feature | Sub-feature | Tier | Status | Evidence / Blocker |
|---------|-------------|------|--------|--------------------|
| Email campaigns | CRUD/schedule/send/stats | P1 | ✅ Working | `email-marketing.service.ts:26-645` |
| | Actual delivery | P1 | ✅ Working | Platform-domain ESP fallback; `connect Gmail` remains the recommended path for branded sending; fixed in `c3cec37b` |
| Transactional customer notifications | 25+ templates | P1 | ✅ Working | `transactional-email.service.ts` |
| | Preference merge / do-not-contact | P1 | ✅ Working | |
| | Gmail + Resend fallback | P1 | ✅ Working | |
| WhatsApp two-way inbox | Twilio/Meta/mock | P1 | ✅ Working | `whatsapp.service.ts:74-390` |
| | 24h window + templates UI | P1 | ✅ Working | |
| | Booking/invoice/payment event listeners | P1 | ✅ Working | `whatsapp-notifications.listener.ts` |
| | Template creation in UI | P2 | ❌ Broken | No screen to create/edit templates |
| Social publishing | FB/IG/LinkedIn/X/TikTok publishers | P1 | ✅ Working | `social/publishers/*.ts` |
| | OAuth flows | P1 | ⚠️ Partial | Requires self-hosted app credentials |
| | Scheduler/analytics | P2 | ✅ Working | `social-scheduler.service.ts`, `social-analytics.service.ts` |
| Push notifications | VAPID subscribe/unsubscribe/test | P2 | ✅ Working | `push-notification.service.ts` |
| Marketing AI hub | 7 AI tools | P2 | ✅ Working | `marketing-ai.controller.ts` |
| Campaign plans | Basic CRUD | P2 | ⚠️ Partial | Not linked to actual campaigns/posts |
| Social composer page | `/app/social` | P3 | 🔇 Orphaned | Marked `// @keyflow:dormant` |
| Communications module (broadcasts) | Backend | P3 | 🔇 Orphaned | No dedicated UI |
| SMS channel | Dedicated path | P3 | 🚧 Stub | Falls back to WhatsApp/Twilio |
| `/app/notifications` page | Empty shell | P2 | ✅ Working | Redirects to `/app/settings/notifications` |
| `/app/communicate/campaigns` | Alias | P3 | 🔇 Orphaned | Re-exports marketing page |
| `SocialConnectionsService.exchangeOAuthCode` | Dead stub | P3 | ✅ Working | Removed dead stub; controller handles exchange |
| Duplicate `@Inject` in `AiMessageSenderService` | DI hazard | P3 | ✅ Working | Duplicate decorator removed |

---

## 10. Projects & Tasks

| Feature | Sub-feature | Tier | Status | Evidence / Blocker |
|---------|-------------|------|--------|--------------------|
| Project CRUD | Board/list/detail | P1 | ✅ Working | `projects.controller.ts:20-217` |
| Tasks within projects | Create/update/delete/toggle | P1 | ⚠️ Partial | `status` not synced with `isCompleted` |
| Project templates | Create from template | P1 | ✅ Working | `projects.service.ts:449-503` |
| Project milestones | UI | P1 | ✅ Working | Wired to existing create/update/delete endpoints |
| Project notes | UI | P1 | ✅ Working | Wired to GET/POST/DELETE `/keyflow/businesses/:businessId/notes` with `targetType: 'Project'` |
| Project deliverables | UI | P1 | ❌ Broken | React state only |
| Project budget view | Component | P2 | 🔇 Orphaned | Exported but never imported |
| Task kanban view | Component | P2 | 🔇 Orphaned | Exported but never imported |
| Task assignments / workload | Backend | P2 | ✅ Working | `task-assignment.service.ts`, recommender |
| | UI | P2 | ❌ Broken | No assignment UI |
| Project revenue auto-progression | Invoice.paid/booking.completed | P2 | ✅ Working | `project-revenue.listener.ts` |
| AI project plan generation | LLM → ProjectPlan | P2 | ✅ Working | `project-planner.service.ts:96-255` |
| Plan materialization | Create project with tasks/milestones | P2 | ✅ Working | `project-plan-executor.service.ts:24-131` |
| Plan event execution | Run tool | P2 | ✅ Working | Honest unavailable path: blocked + timeline + no task mutation |
| Plan detail UI | `/app/projects/plans/[planId]` | P2 | ✅ Working | |
| | Plans list in Projects tab | P2 | ❌ Broken | Only generator shown |
| Legacy `/app/plans/[planId]` | Detail page | P3 | 🔇 Orphaned | No index; back link to non-existent `/app/plans` |
| Time tracking | Timer/entries/summary | P1 | ✅ Working | `time-entry.service.ts` |
| Time → invoice billing | Invoice unbilled time | P1 | ✅ Working | `time-entry.service.ts:352-460` |
| AI tools for projects/time | Tool execution | P2 | ✅ Working | `flow-orchestrator.service.ts` |
| Project intelligence tab | Metrics/insights | P2 | 🚧 Stub | Hard-coded demo data |

---

## 11. Documents & Intelligence

| Feature | Sub-feature | Tier | Status | Evidence / Blocker |
|---------|-------------|------|--------|--------------------|
| AI document generation | Prompt → DocumentInstance | P1 | ✅ Working | `documents.service.ts:92` |
| Document versioning & editing | Update/tweak/compare/delete | P1 | ✅ Working | `documents.service.ts:335-474` |
| Document health / impact detection | Health status updates | P2 | ✅ Working | `documents.service.ts:505-565` |
| Google Drive round-trip sync | Link/import/pull/status | P2 | ⚠️ Partial | Requires Drive connector |
| `/app/documents` top-level | Production gate | P2 | ✅ Working | Gate removed; canonical entry point |
| | Index redirect | P2 | ✅ Working | Redirects to `/app/profile?tab=outputs` |
| `/app/document-intelligence` dashboard | Stats/templates/recent/insights | P1 | ✅ Working | Now redirects to `/app/documents` |
| Evidence backend | Submit/verify/list | P1 | ✅ Working | `evidence.service.ts` |
| Evidence UI | `/app/evidence` | P2 | 🔇 Orphaned | Gated by `compliancePack` |
| Evidence client path | `/evidence/check` | P2 | ✅ Working | Path now matches server route |
| Content request lifecycle | State machine | P2 | ✅ Working | `content-request.service.ts` |
| Content ops UI | `/app/content-ops` | P2 | 🔇 Orphaned | Gated by `agencyPack` |
| | Deliverable upload | P2 | ⚠️ Partial | Wired via `window.prompt` + `uploadDeliverables()` |
| Document extraction / intelligence | docling + GPT-4o vision | P1 | ✅ Working | `document-intelligence.service.ts:155` |
| Document parsing sidecar | `DOCLING_URL` | P2 | ⚠️ Partial | Fail-open to raw vision |

---

## 12. Settings & Admin

| Feature | Sub-feature | Tier | Status | Evidence / Blocker |
|---------|-------------|------|--------|--------------------|
| Settings tab navigation | 18 tabs | P2 | ✅ Working | `settings/layout.tsx`, `page.tsx` |
| Team management | Invite/role/permissions/remove | P1 | ✅ Working | `identity.controller.ts:588-667` |
| Billing plan display | UI | P2 | ✅ Working | AI credit numbers aligned with `apps/server/src/modules/subscriptions/plans.ts` |
| Billing checkout | Manual/bank/cash | P2 | ✅ Working | `subscriptions.service.ts:286-316` |
| | Card payment (WiPay) | P1 | ❌ Broken | Disabled in UI |
| Customer payment gateways | Config storage | P2 | ⚠️ Partial | Stores secrets in `business.metaData`; no live verification |
| Admin console pages | UI + REST endpoints | P2 | ✅ Working | `/api/admin/...` |
| Admin login | Request handling | P0 | ✅ Working | `@IsNotEmpty()` + null-safe validation |
| Admin console access | Layout gate | P0 | ✅ Working | `isSuperAdmin()` reads `kf_admin_user_cache` |
| Server feature flags | DB-backed CRUD | P2 | ✅ Working | `feature-flags.controller.ts:34-68` |
| Client feature flags | Build-time env | P2 | ⚠️ Partial | Not connected to server DB flags |
| `packages/api` admin router | Mock data | P3 | 🚧 Stub | Not imported by admin UI |
| Security audit | Endpoint | P2 | ✅ Working | `security-audit.service.ts` |
| | MFA/inactive user checks | P2 | 🚧 Stub | Hard-coded because User model lacks fields |
| Developers page | API Docs / App Store cards | P3 | 🚧 Stub | Placeholders |

---

## 13. External Integrations

| Feature | Sub-feature | Tier | Status | Evidence / Blocker |
|---------|-------------|------|--------|--------------------|
| Key Connect UI | Calls legacy `/connectors/*` | P1 | ⚠️ Partial | `lib/api/key-connect.ts:24-64` |
| Legacy connector registry | 22 connectors | P2 | ✅ Working | `connector-initializer.service.ts:60-86` |
| Legacy Google OAuth | Token exchange + verification | P1 | ✅ Working | `google-suite.service.ts:130-258` |
| Legacy connector pull sync | Gmail/Forms | P1 | ⚠️ Partial | Real |
| | Other 16 connectors | P2 | ❌ Broken | `PULL_SYNC_NOT_IMPLEMENTED` |
| New Key Connector backend | `/key-connector` controller | P2 | 🚧 Stub | Credential validation missing |
| | Sync engine | P2 | 🚧 Stub | Returns zero-row placeholder |
| | AI gateway | P2 | 🚧 Stub | Returns placeholder objects |
| Payments (Stripe/PayPal/WiPay) | Checkout + ledger posting | P1 | ✅ Working | `payments.service.ts` |
| Public payment links | `/pay/link/:token` | P1 | ✅ Working | |
| Currency conversion | Live fetch + fallback | P1 | ⚠️ Partial | TTD rate missing |
| Outgoing webhooks | HMAC dispatch | P2 | ✅ Working | `webhook-dispatcher.service.ts:45-58` |
| | Delivery log persistence | P2 | ❌ Broken | In-memory array only |
| LiveKit in-app voice | Room/token/agent dispatch | P2 | ✅ Working | `livekit.service.ts:14-85` |
| Phone voice | Twilio bridge | P2 | ✅ Working | Fail-closed without token |
| WhatsApp connector health | Multi-tenant config | P2 | ❌ Broken | Reads global env instead of per-business config |
| Social OAuth + publishing | Real publishers | P1 | ✅ Working | `social.controller.ts`, `social-publishing.service.ts` |
| | Self-serve credentials | P2 | ⚠️ Partial | Requires env vars per business |

---

## 14. Database & Migrations

| Feature | Sub-feature | Tier | Status | Evidence / Blocker |
|---------|-------------|------|--------|--------------------|
| Prisma schema validation | 440 models / 16 enums | P0 | ✅ Working | `prisma validate` passes |
| Migration baseline & deploy | 19 migrations | P0 | ✅ Working | Schema up to date |
| DB connection / health | Retry + health check | P0 | ✅ Working | `prisma.service.ts:11-37` |
| Tenant isolation extension | 302 business-scoped models | P0 | ⚠️ Partial | 42 unscoped + 3 never-scope remain |
| | Background path scoping gate | P0 | ⚠️ Partial | Cron/queue/WebSocket handlers use explicit `businessId`; no static gate catches a missing one |
| Soft-delete middleware | 15 models | P0 | ⚠️ Partial | Many `deletedAt` models not covered |
| | `groupBy`/`aggregate` | P0 | ✅ Working | Hooked in `packages/db/src/client.ts:613-616`; integration tests assert tenant scoping |
| Token encryption at rest | Single-row CRUD on 4 models | P0 | ⚠️ Partial | `createMany`/`updateMany`/`deleteMany` not covered |
| | Version skew | P3 | ⚠️ Partial | `@prisma/adapter-pg@7.3.0` vs `prisma@6.19.0` |
| Seed script | Templates idempotently | P0 | ✅ Working | `packages/db/prisma/seed.ts` |
| One-off migration helpers | Tag backfill scripts | P3 | 🔇 Orphaned | No tag backfill scripts found; item stale |
| Migration documentation | Repair doc | P3 | ✅ Working | Updated to reference `0_baseline` |

---

## 15. Build / Dev / Test / CI

| Feature | Sub-feature | Tier | Status | Evidence / Blocker |
|---------|-------------|------|--------|--------------------|
| pnpm workspace / engines | Node 20.18.1 / pnpm 9.15.0 | P0 | ✅ Working | `.nvmrc`, `package.json` |
| Root turbo pipeline | `typecheck`/`build`/`test:*` | P3 | ✅ Working | Works when dev server is not holding the Prisma engine DLL; EPERM is an operational note, not a blocker |
| Per-app builds | server/web/voice-agent/packages | P0 | ✅ Working | All compile cleanly |
| Dev launcher | `scripts/launch-dev.sh` | P0 | ✅ Working | |
| Server typecheck | `tsc --noEmit` | P0 | ✅ Working | |
| Web typecheck | `tsc --noEmit` | P0 | ✅ Working | |
| Server unit tests | 350 files / 3,366 tests | P0 | ✅ Working | Pass in ~61s |
| Web unit tests | 17 files / 180 tests | P0 | ✅ Working | Pass in ~18s |
| Integration tests | Postgres+Redis | P0 | ⚠️ Partial | CI only; local blocked by EPERM |
| Smoke tests | | P0 | ⚠️ Partial | CI only |
| E2E tests (Playwright) | Config exists | P3 | 🔇 Orphaned | Not wired into CI |
| Server lint | Debt ratchet | P3 | ⚠️ Partial | Non-blocking; 3,344 warnings |
| Web lint | | P3 | ⚠️ Partial | Slow locally; non-blocking in CI |
| Security scan | `pnpm audit` + TruffleHog | P3 | ⚠️ Partial | `continue-on-error: true` |
| DAST (HawkScan) | | P3 | 🔇 Orphaned | Gated by missing secret |
| Production deploy | Manual Hetzner deploy | P3 | ✅ Working | Deployed via `scripts/deploy.sh`; commented-out Vercel block is stale; `deploy-drift.yml` catches drift |
| Branch divergence guard | | P3 | ✅ Working | |
| Uptime monitor | | P3 | ✅ Working | Configured |
| Env validation | Preflight script | P0 | ⚠️ Partial | `SUPABASE_JWT_SECRET` placeholder in `.env` |
| Pre-commit hooks | Husky/lint-staged | P3 | ❌ Broken | Missing |

---

## Summary Counts

| Tier | Working | Partial | Broken | Stub | Orphaned | Total |
|------|---------|---------|--------|------|----------|-------|
| P0 | 43 | 9 | 0 | 0 | 0 | 52 |
| P1 | 91 | 18 | 6 | 0 | 0 | 115 |
| P2 | 50 | 12 | 11 | 5 | 9 | 87 |
| P3 | 11 | 5 | 1 | 4 | 10 | 31 |
| **Total** | **195** | **44** | **17** | **9** | **19** | **284** |

---

## How to use this matrix

1. **P0 items** are the launch blockers. Start with the 4 broken + 8 partial P0 items.
2. **P1 items** are the core user journeys. A user can sign in, but cannot reliably complete their work.
3. **P2 items** make the product feel complete and trustworthy.
4. **P3 items** are cleanup, CI, and architecture debt.

Cross-reference each item with `docs/development/e2e-hardening-plan.md` for the fix plan, file references, and sprint assignment.
