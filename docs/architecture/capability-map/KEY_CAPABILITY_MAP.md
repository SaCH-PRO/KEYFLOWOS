# KEY Capability Map

> **Auto-generated** by `generate.js` from the two authoritative capability sources in the repo. Do not hand-edit — regenerate instead (`node docs/architecture/capability-map/generate.js`).

Projected from **278 governed flow tools** (`ai/flow-tool-registry.ts`) and **207 declared cortex capabilities** (`key-cortex/key-cortex-capability-registry.service.ts`) onto a **12-domain** business-function taxonomy.

This file is three artifacts in one: a **coverage map** (what KEY can do, by domain), a **mode assignment** (manual vs assisted vs agentic, per capability), and a **gap register** (what a complete business OS still needs). Seed for the M0 capability model — `key-capability-map.seed.json` is the machine-loadable form.

## What this answers

- **Do we cover the whole business?** Coverage by domain, below.
- **Manual, smart, or AI — per capability?** The *mode* is **derived, not chosen**: from each tool's `family` + `riskTier` (+ cortex `requiresApproval`). Money movement, destructive, and irreversible actions pin to **Human-gated** by rule — "KEY may create intelligence, but not authority."
- **What integration + UI does each mode imply?** See the legend. The **manual UI already exists** for every tool via its CI-enforced `manualEquivalentRoute`; assisted reuses the existing approval queue; only agentic needs the new Operator Console.
- **What's missing?** The gap register — curated target capabilities with no covering tool or capability anywhere in either registry.

## Mode legend — derived, governance-bounded

| Mode | Meaning | Integration | UI surface |
|---|---|---|---|
| 🟢 **Agentic** | AI acts autonomously (read-only / low-risk) | Orchestrator + Operator Console | Goal / chat surface + console |
| 🔵 **Assisted** | AI drafts/acts, human-reviewable | Automation + draft review | Product screen + inline suggestions |
| 🟡 **Assisted + Approval** | AI proposes, execution gated | Approval queue (`AiApprovalItem`) | Product screen + approval queue |
| 🔴 **Human-gated** | Money / destructive / irreversible | Manual execution; AI proposes only | Product screen (human decision) |

**Derivation rules** (`generate.js`): `read` family → 🟢 Agentic · `organize`@tier1 → 🟢 · tier 4 → 🔴 Human-gated · tier 3 or cortex `requiresApproval` → 🟡 Assisted+Approval · everything else (`draft`/`crud`/`execute`@tier1-2) → 🔵 Assisted.

## Coverage summary

Across **12 domains**: 🟢 211 agentic · 🔵 226 assisted · 🟡 45 assisted+approval · 🔴 3 human-gated. Target-capability coverage: **17/32 (53%)**.

| Domain | Tools | Cortex caps | UI surfaces | Target coverage | Mode mix |
|---|--:|--:|--:|:--:|---|
| **Sales & CRM** | 42 | 17 | 3 | 3/3 | 🔵 32 🟢 19 🟡 8 |
| **Marketing & Content** | 32 | 22 | 3 | 2/3 | 🔵 28 🟢 16 🟡 8 🔴 2 |
| **Commerce & Fulfillment** | 45 | 15 | 5 | 1/3 | 🟢 28 🔵 27 🟡 5 |
| **Finance & Accounting** | 35 | 10 | 4 | 3/4 | 🟢 23 🔵 20 🟡 2 |
| **Operations & Delivery** | 45 | 36 | 5 | 1/2 | 🔵 41 🟢 34 🟡 5 🔴 1 |
| **Scheduling & Bookings** | 10 | 22 | 2 | 2/2 | 🔵 20 🟢 11 🟡 1 |
| **Support & Communications** | 13 | 38 | 3 | 2/3 | 🟢 23 🔵 23 🟡 5 |
| **Legal, Contracts & Governance** | 27 | 0 | 6 | 2/3 | 🟢 15 🔵 10 🟡 2 |
| **Analytics & Strategy** | 18 | 37 | 6 | 1/3 | 🟢 33 🔵 19 🟡 3 |
| **People & HR** | 4 | 0 | 1 | 0/3 | 🟡 3 🔵 1 |
| **Assets & Documents** | 7 | 0 | 1 | 0/2 | 🟢 5 🔵 1 🟡 1 |
| **Admin & Settings** | 0 | 10 | 0 | 0/1 | 🔵 4 🟢 4 🟡 2 |

## Gap register

Curated target capabilities a complete business OS should cover, keyword-checked against **every** tool and capability in both registries. Only *unmatched* targets are listed — the concrete "build or synthesize" backlog. Proposed mode is what the capability *would* take once built.

| Domain | Missing capability | Proposed mode | Why it matters |
|---|---|---|---|
| Marketing & Content | Ad-spend optimization | 🟢 Agentic | Close the loop from spend to conversion; agentic reallocation. |
| Commerce & Fulfillment | Dynamic pricing | 🔴 Human-gated | Margin/velocity-aware pricing; high-risk so gated. |
| Commerce & Fulfillment | Supplier risk scoring | 🟢 Agentic | Score vendors on reliability before commitment. |
| Finance & Accounting | Tax filing preparation | 🔴 Human-gated | Assemble filings; execution stays human-gated by law. |
| Operations & Delivery | SLA monitoring | 🟢 Agentic | Catch breach risk before it happens. |
| Support & Communications | KB answer synthesis | 🟢 Agentic | Deflect support volume with grounded answers. |
| Legal, Contracts & Governance | Renewal-risk analysis | 🟢 Agentic | Flag contracts at churn/renewal risk early. |
| Analytics & Strategy | Anomaly detection | 🟢 Agentic | Surface metric anomalies with no human watching. |
| Analytics & Strategy | Natural-language KPI Q&A | 🟢 Agentic | Ask the business a question in plain language. |
| People & HR | Payroll tax filing | 🔴 Human-gated | Thinnest domain; compliance-heavy. |
| People & HR | Performance-review synthesis | 🟢 Agentic | Aggregate signals into review drafts. |
| People & HR | PTO / shift optimization | 🟢 Agentic | Balance coverage against staff availability. |
| Assets & Documents | Asset depreciation / lifecycle | 🔵 Assisted | Track book value and lifecycle events. |
| Assets & Documents | License-renewal tracking | 🟢 Agentic | Never miss a renewal. |
| Admin & Settings | Anomalous-access / audit alerting | 🟢 Agentic | Detect unusual admin access. |

**15 gaps** across 10 domains. Thinnest domains: **People & HR**, **Assets & Documents**, **Admin & Settings**.

## How to read this into the roadmap

- **The map is a target, not a build queue.** Preload the *map* to 100%; preload *tools* broadly (already done). Instantiate *skills/agents* only for seed-worthy bets or accumulated evidence.
- **M0** loads `key-capability-map.seed.json` as the initial capability model. Every skill/agent registered later declares which capability id(s) it covers → coverage becomes computable and self-reported.
- **Mode is the governance contract.** 🔴 Human-gated capabilities must never be promoted to autonomous, regardless of evidence.
- **UI is mostly done.** Manual = existing routes; Assisted = existing approval queue; only the Operator Console (agentic) is net-new.

## Per-domain detail

### Sales & CRM

Dominant mode: 🔵 **Assisted** · 42 tools · 17 cortex capabilities

**UI surfaces:** `/app/call-tasks` · `/app/crm` · `/app/onboarding`

<details><summary>42 governed tools</summary>

| Tool | Family | Tier | Mode | Manual route |
|---|---|:--:|---|---|
| `call_list_tasks` | read | 1 | 🟢 Agentic | `/app/call-tasks` |
| `crm_find_duplicates` | read | 1 | 🟢 Agentic | `/app/crm/duplicates` |
| `crm_list_deals` | read | 1 | 🟢 Agentic | `/app/crm/deals` |
| `crm_merge_preview` | read | 1 | 🟢 Agentic | `/app/crm/duplicates` |
| `deals_forecast` | read | 1 | 🟢 Agentic | `/app/crm/deals` |
| `deals_get` | read | 1 | 🟢 Agentic | `/app/crm/deals` |
| `deals_list` | read | 1 | 🟢 Agentic | `/app/crm/deals` |
| `deals_list_stages` | read | 1 | 🟢 Agentic | `/app/crm/deals` |
| `deals_pipeline_velocity` | read | 1 | 🟢 Agentic | `/app/crm/deals` |
| `fetch_client_health` | read | 1 | 🟢 Agentic | `/app/crm/contacts` |
| `finance_customer_balance` | read | 1 | 🟢 Agentic | `/app/crm/contacts` |
| `present_onboarding_card` | read | 1 | 🟢 Agentic | `/app/onboarding` |
| `sequence_list` | read | 1 | 🟢 Agentic | `/app/crm/sequences` |
| `call_create_task` | crud | 2 | 🔵 Assisted | `/app/call-tasks` |
| `call_generate_script` | draft | 1 | 🔵 Assisted | `/app/call-tasks` |
| `call_log_outcome` | crud | 2 | 🔵 Assisted | `/app/call-tasks` |
| `call_schedule_followup` | organize | 2 | 🔵 Assisted | `/app/call-tasks` |
| `crm_add_note` | crud | 1 | 🔵 Assisted | `/app/crm/contacts` |
| `crm_add_task` | crud | 1 | 🔵 Assisted | `/app/crm/contacts` |
| `crm_create_contact` | crud | 1 | 🔵 Assisted | `/app/crm/contacts` |
| `crm_list_contacts` | crud | 1 | 🔵 Assisted | `/app/crm/contacts` |
| `crm_move_deal_stage` | organize | 2 | 🔵 Assisted | `/app/crm/deals` |
| `crm_search_contacts` | crud | 1 | 🔵 Assisted | `/app/crm/contacts` |
| `crm_update_contact` | crud | 1 | 🔵 Assisted | `/app/crm/contacts` |
| `crm_update_deal` | crud | 2 | 🔵 Assisted | `/app/crm/deals` |
| `deals_create` | crud | 2 | 🔵 Assisted | `/app/crm/deals` |
| `deals_mark_lost` | execute | 2 | 🔵 Assisted | `/app/crm/deals` |
| `deals_mark_won` | execute | 2 | 🔵 Assisted | `/app/crm/deals` |
| `deals_move_stage` | organize | 2 | 🔵 Assisted | `/app/crm/deals` |
| `deals_update` | crud | 2 | 🔵 Assisted | `/app/crm/deals` |
| `save_onboarding_step` | organize | 2 | 🔵 Assisted | `/app/onboarding` |
| `segment_contacts` | organize | 2 | 🔵 Assisted | `/app/crm/contacts` |
| `sequence_create` | organize | 2 | 🔵 Assisted | `/app/crm/sequences` |
| `sequence_pause_resume` | organize | 2 | 🔵 Assisted | `/app/crm/sequences` |
| `sequence_unenroll` | organize | 2 | 🔵 Assisted | `/app/crm/sequences` |
| `tag_contact` | organize | 2 | 🔵 Assisted | `/app/crm/contacts` |
| `crm_delete_contact` | crud | 3 | 🟡 Assisted + Approval | `/app/crm/contacts` |
| `crm_merge_execute` | execute | 3 | 🟡 Assisted + Approval | `/app/crm/duplicates` |
| `deals_delete` | crud | 3 | 🟡 Assisted + Approval | `/app/crm/deals` |
| `sequence_enroll` | execute | 3 | 🟡 Assisted + Approval | `/app/crm/sequences` |
| `sequence_enroll_overdue` | execute | 3 | 🟡 Assisted + Approval | `/app/crm/sequences` |
| `update_status_with_confirmation` | execute | 3 | 🟡 Assisted + Approval | `/app/crm/contacts` |

</details>

### Marketing & Content

Dominant mode: 🔵 **Assisted** · 32 tools · 22 cortex capabilities

**UI surfaces:** `/app/content-ops` · `/app/marketing` · `/app/seo`

**Gaps:** ⛔ Ad-spend optimization

<details><summary>32 governed tools</summary>

| Tool | Family | Tier | Mode | Manual route |
|---|---|:--:|---|---|
| `content_get_request` | read | 1 | 🟢 Agentic | `/app/content-ops` |
| `content_list_requests` | read | 1 | 🟢 Agentic | `/app/content-ops` |
| `fetch_content_gaps` | read | 1 | 🟢 Agentic | `/app/seo` |
| `fetch_seo_dashboard` | read | 1 | 🟢 Agentic | `/app/seo` |
| `fetch_seo_issues` | read | 1 | 🟢 Agentic | `/app/seo` |
| `fetch_seo_keywords` | read | 1 | 🟢 Agentic | `/app/seo` |
| `fetch_seo_revenue_attribution` | read | 1 | 🟢 Agentic | `/app/seo` |
| `social_get_analytics` | read | 1 | 🟢 Agentic | `/app/marketing` |
| `content_assign_request` | organize | 2 | 🔵 Assisted | `/app/content-ops` |
| `content_create_request` | crud | 2 | 🔵 Assisted | `/app/content-ops` |
| `content_submit_for_review` | organize | 2 | 🔵 Assisted | `/app/content-ops` |
| `content_transition_status` | organize | 2 | 🔵 Assisted | `/app/content-ops` |
| `draft_campaign_bundle` | draft | 1 | 🔵 Assisted | `/app/marketing` |
| `draft_followup_message` | draft | 1 | 🔵 Assisted | `/app/marketing` |
| `drive_create_document` | organize | 2 | 🔵 Assisted | `/app/content-ops` |
| `drive_create_folder` | organize | 2 | 🔵 Assisted | `/app/content-ops` |
| `generate_content_brief` | draft | 2 | 🔵 Assisted | `/app/seo` |
| `marketing_create_campaign` | crud | 1 | 🔵 Assisted | `/app/marketing` |
| `marketing_list_campaigns` | crud | 1 | 🔵 Assisted | `/app/marketing` |
| `marketing_update_campaign` | crud | 2 | 🔵 Assisted | `/app/marketing` |
| `seo_apply_remediation` | organize | 2 | 🔵 Assisted | `/app/seo` |
| `social_create_post` | crud | 1 | 🔵 Assisted | `/app/marketing` |
| `social_list_posts` | crud | 1 | 🔵 Assisted | `/app/marketing` |
| `social_update_post` | crud | 2 | 🔵 Assisted | `/app/marketing` |
| `sync_seo_pages` | organize | 2 | 🔵 Assisted | `/app/seo` |
| `comms_send_broadcast` | execute | 3 | 🟡 Assisted + Approval | `/app/marketing` |
| `content_deliver_request` | execute | 3 | 🟡 Assisted + Approval | `/app/content-ops` |
| `content_upload_deliverables` | execute | 3 | 🟡 Assisted + Approval | `/app/content-ops` |
| `queue_campaign` | execute | 3 | 🟡 Assisted + Approval | `/app/marketing` |
| `send_message_with_approval` | execute | 3 | 🟡 Assisted + Approval | `/app/marketing` |
| `marketing_send_campaign` | execute | 4 | 🔴 Human-gated | `/app/marketing` |
| `social_publish_post` | execute | 4 | 🔴 Human-gated | `/app/marketing` |

</details>

### Commerce & Fulfillment

Dominant mode: 🟢 **Agentic** · 45 tools · 15 cortex capabilities

**UI surfaces:** `/app/commerce` · `/app/inventory` · `/app/marketplace` · `/app/procurement` · `/app/store`

**Gaps:** ⛔ Dynamic pricing · ⛔ Supplier risk scoring

<details><summary>45 governed tools</summary>

| Tool | Family | Tier | Mode | Manual route |
|---|---|:--:|---|---|
| `fetch_revenue_risk` | read | 1 | 🟢 Agentic | `/app/commerce` |
| `fetch_storefront_quality` | read | 1 | 🟢 Agentic | `/app/store` |
| `inventory_list_movements` | read | 1 | 🟢 Agentic | `/app/inventory` |
| `inventory_list_purchase_orders` | read | 1 | 🟢 Agentic | `/app/inventory` |
| `inventory_list_stock` | read | 1 | 🟢 Agentic | `/app/inventory` |
| `inventory_list_warehouses` | read | 1 | 🟢 Agentic | `/app/inventory` |
| `inventory_low_stock_alerts` | read | 1 | 🟢 Agentic | `/app/inventory` |
| `inventory_summary` | read | 1 | 🟢 Agentic | `/app/inventory` |
| `marketplace_list_listings` | read | 1 | 🟢 Agentic | `/app/marketplace` |
| `marketplace_list_orders` | read | 1 | 🟢 Agentic | `/app/marketplace` |
| `procurement_get_request` | read | 1 | 🟢 Agentic | `/app/procurement` |
| `procurement_get_stats` | read | 1 | 🟢 Agentic | `/app/procurement` |
| `procurement_list_requests` | read | 1 | 🟢 Agentic | `/app/procurement` |
| `procurement_list_suppliers` | read | 1 | 🟢 Agentic | `/app/procurement/suppliers` |
| `store_list_products` | read | 1 | 🟢 Agentic | `/app/store` |
| `store_list_recent_orders` | read | 1 | 🟢 Agentic | `/app/store` |
| `suppliers_get_connection` | read | 1 | 🟢 Agentic | `/app/procurement` |
| `suppliers_get_cost_profile` | read | 1 | 🟢 Agentic | `/app/store` |
| `suppliers_get_margins` | read | 1 | 🟢 Agentic | `/app/store` |
| `suppliers_list_connections` | read | 1 | 🟢 Agentic | `/app/procurement` |
| `commerce_convert_quote` | organize | 2 | 🔵 Assisted | `/app/commerce` |
| `commerce_create_invoice` | crud | 2 | 🔵 Assisted | `/app/commerce` |
| `commerce_create_product` | crud | 1 | 🔵 Assisted | `/app/commerce` |
| `commerce_create_quote` | crud | 2 | 🔵 Assisted | `/app/commerce` |
| `commerce_list_invoices` | crud | 1 | 🔵 Assisted | `/app/commerce` |
| `commerce_mark_invoice_paid` | crud | 2 | 🔵 Assisted | `/app/commerce` |
| `commerce_update_invoice` | crud | 2 | 🔵 Assisted | `/app/commerce` |
| `commerce_update_product` | crud | 2 | 🔵 Assisted | `/app/store` |
| `draft_payment_reminder` | draft | 1 | 🔵 Assisted | `/app/commerce` |
| `draft_storefront_copy` | draft | 1 | 🔵 Assisted | `/app/store` |
| `inventory_adjust_stock` | organize | 2 | 🔵 Assisted | `/app/inventory` |
| `inventory_advance_purchase_order` | execute | 2 | 🔵 Assisted | `/app/inventory` |
| `inventory_create_purchase_order` | crud | 2 | 🔵 Assisted | `/app/inventory` |
| `inventory_transfer_stock` | organize | 2 | 🔵 Assisted | `/app/inventory` |
| `procurement_acknowledge_vendor` | crud | 2 | 🔵 Assisted | `/app/procurement` |
| `procurement_create_request` | crud | 2 | 🔵 Assisted | `/app/procurement/new` |
| `procurement_mark_fulfilled` | crud | 2 | 🔵 Assisted | `/app/procurement` |
| `procurement_mark_invoiced` | crud | 2 | 🔵 Assisted | `/app/procurement` |
| `procurement_select_vendor` | crud | 2 | 🔵 Assisted | `/app/procurement` |
| `procurement_submit_for_review` | execute | 2 | 🔵 Assisted | `/app/procurement` |
| `procurement_update_request` | crud | 2 | 🔵 Assisted | `/app/procurement` |
| `apply_storefront_recommendation` | execute | 3 | 🟡 Assisted + Approval | `/app/store` |
| `commerce_delete_invoice` | crud | 3 | 🟡 Assisted + Approval | `/app/commerce` |
| `commerce_send_invoice` | execute | 3 | 🟡 Assisted + Approval | `/app/commerce` |
| `procurement_issue_po` | execute | 3 | 🟡 Assisted + Approval | `/app/procurement` |

</details>

### Finance & Accounting

Dominant mode: 🟢 **Agentic** · 35 tools · 10 cortex capabilities

**UI surfaces:** `/app/expenses` · `/app/finance` · `/app/payments` · `/app/retainers`

**Gaps:** ⛔ Tax filing preparation

<details><summary>35 governed tools</summary>

| Tool | Family | Tier | Mode | Manual route |
|---|---|:--:|---|---|
| `expenses_list` | read | 1 | 🟢 Agentic | `/app/expenses` |
| `fetch_expense_pressure` | read | 1 | 🟢 Agentic | `/app/expenses` |
| `finance_list_action_items` | read | 1 | 🟢 Agentic | `/app/finance` |
| `finance_list_bank_accounts` | read | 1 | 🟢 Agentic | `/app/finance` |
| `finance_list_bills` | read | 1 | 🟢 Agentic | `/app/finance` |
| `finance_list_coa` | read | 1 | 🟢 Agentic | `/app/finance` |
| `finance_view_payables` | read | 1 | 🟢 Agentic | `/app/finance` |
| `finance_view_receivables` | read | 1 | 🟢 Agentic | `/app/finance` |
| `payments_list_gateways` | read | 1 | 🟢 Agentic | `/app/payments` |
| `payments_list_links` | read | 1 | 🟢 Agentic | `/app/payments` |
| `payments_list_transactions` | read | 1 | 🟢 Agentic | `/app/payments` |
| `payments_search_transactions` | read | 1 | 🟢 Agentic | `/app/payments` |
| `payroll_get_run` | read | 1 | 🟢 Agentic | `/app/finance` |
| `payroll_list_runs` | read | 1 | 🟢 Agentic | `/app/finance` |
| `reconcile_list_statement_sources` | read | 1 | 🟢 Agentic | `/app/finance/reconciliation` |
| `reconcile_list_unmatched` | read | 1 | 🟢 Agentic | `/app/finance/reconciliation` |
| `retainers_get` | read | 1 | 🟢 Agentic | `/app/retainers` |
| `retainers_list` | read | 1 | 🟢 Agentic | `/app/retainers` |
| `retainers_summary` | read | 1 | 🟢 Agentic | `/app/retainers` |
| `expenses_create` | crud | 2 | 🔵 Assisted | `/app/expenses` |
| `finance_auto_match_bank` | organize | 2 | 🔵 Assisted | `/app/finance` |
| `finance_create_bill` | organize | 2 | 🔵 Assisted | `/app/finance` |
| `finance_create_coa_account` | organize | 2 | 🔵 Assisted | `/app/finance` |
| `payments_create_link` | crud | 2 | 🔵 Assisted | `/app/payments` |
| `payments_revoke_link` | organize | 2 | 🔵 Assisted | `/app/payments` |
| `reconcile_connect_statement_source` | execute | 2 | 🔵 Assisted | `/app/finance/reconciliation` |
| `reconcile_match_line` | organize | 2 | 🔵 Assisted | `/app/finance/reconciliation` |
| `reconcile_run_auto_match` | organize | 2 | 🔵 Assisted | `/app/finance/reconciliation` |
| `reconcile_sweep_statements` | execute | 2 | 🔵 Assisted | `/app/finance/reconciliation` |
| `retainers_create` | crud | 2 | 🔵 Assisted | `/app/retainers` |
| `retainers_log_period` | organize | 2 | 🔵 Assisted | `/app/retainers` |
| `retainers_update` | crud | 2 | 🔵 Assisted | `/app/retainers` |
| `retainers_update_period` | organize | 2 | 🔵 Assisted | `/app/retainers` |
| `finance_pay_bill` | execute | 3 | 🟡 Assisted + Approval | `/app/finance` |
| `finance_post_journal_entry` | organize | 3 | 🟡 Assisted + Approval | `/app/finance` |

</details>

### Operations & Delivery

Dominant mode: 🔵 **Assisted** · 45 tools · 36 cortex capabilities

**UI surfaces:** `/app/automations` · `/app/blueprint` · `/app/projects` · `/app/structure` · `/app/time-tracking`

**Gaps:** ⛔ SLA monitoring

<details><summary>45 governed tools</summary>

| Tool | Family | Tier | Mode | Manual route |
|---|---|:--:|---|---|
| `delegation_weekly_hygiene` | organize | 1 | 🟢 Agentic | `/app/automations` |
| `fetch_project_status` | read | 1 | 🟢 Agentic | `/app/projects` |
| `payroll_list_rates` | read | 1 | 🟢 Agentic | `/app/structure` |
| `people_list` | read | 1 | 🟢 Agentic | `/app/structure` |
| `people_org_chart` | read | 1 | 🟢 Agentic | `/app/structure` |
| `people_recommend_assignee` | read | 1 | 🟢 Agentic | `/app/structure` |
| `people_workload` | read | 1 | 🟢 Agentic | `/app/structure` |
| `performance_scorecard` | read | 1 | 🟢 Agentic | `/app/structure` |
| `performance_team_summary` | read | 1 | 🟢 Agentic | `/app/structure` |
| `performance_trend` | read | 1 | 🟢 Agentic | `/app/structure` |
| `projects_get_budget` | read | 1 | 🟢 Agentic | `/app/projects` |
| `projects_get_timeline` | read | 1 | 🟢 Agentic | `/app/projects` |
| `projects_list` | read | 1 | 🟢 Agentic | `/app/projects` |
| `projects_list_tasks` | read | 1 | 🟢 Agentic | `/app/projects` |
| `structure_find_person` | read | 1 | 🟢 Agentic | `/app/structure` |
| `structure_get_org_tree` | read | 1 | 🟢 Agentic | `/app/structure` |
| `structure_get_stats` | read | 1 | 🟢 Agentic | `/app/structure` |
| `structure_list_assignments` | read | 1 | 🟢 Agentic | `/app/structure` |
| `structure_list_delegation_rules` | read | 1 | 🟢 Agentic | `/app/structure` |
| `structure_list_job_roles` | read | 1 | 🟢 Agentic | `/app/structure` |
| `structure_list_org_units` | read | 1 | 🟢 Agentic | `/app/structure` |
| `automations_create_playbook` | crud | 2 | 🔵 Assisted | `/app/automations` |
| `automations_list_playbooks` | crud | 1 | 🔵 Assisted | `/app/automations` |
| `automations_toggle_playbook` | crud | 2 | 🔵 Assisted | `/app/automations` |
| `create_followup_queue` | organize | 2 | 🔵 Assisted | `/app/automations` |
| `create_task` | organize | 2 | 🔵 Assisted | `/app/projects` |
| `delegation_booking_prep` | execute | 1 | 🔵 Assisted | `/app/automations` |
| `delegation_lead_reactivation` | execute | 2 | 🔵 Assisted | `/app/automations` |
| `delegation_payment_recovery` | execute | 2 | 🔵 Assisted | `/app/automations` |
| `delegation_post_purchase` | execute | 1 | 🔵 Assisted | `/app/automations` |
| `draft_project_update` | draft | 1 | 🔵 Assisted | `/app/projects` |
| `people_assign_task` | execute | 2 | 🔵 Assisted | `/app/projects` |
| `projects_complete_task` | crud | 2 | 🔵 Assisted | `/app/projects` |
| `projects_create_task` | crud | 2 | 🔵 Assisted | `/app/projects` |
| `projects_update_task` | crud | 2 | 🔵 Assisted | `/app/projects` |
| `time_log_entry` | organize | 2 | 🔵 Assisted | `/app/time-tracking` |
| `time_mark_billed` | organize | 2 | 🔵 Assisted | `/app/time-tracking` |
| `time_start_timer` | organize | 2 | 🔵 Assisted | `/app/time-tracking` |
| `time_stop_timer` | organize | 2 | 🔵 Assisted | `/app/time-tracking` |
| `time_update_entry` | crud | 2 | 🔵 Assisted | `/app/time-tracking` |
| `update_business_blueprint` | crud | 1 | 🔵 Assisted | `/app/blueprint` |
| `projects_delete_task` | crud | 3 | 🟡 Assisted + Approval | `/app/projects` |
| `structure_create_delegation_rule` | crud | 3 | 🟡 Assisted + Approval | `/app/structure` |
| `structure_update_delegation_rule` | crud | 3 | 🟡 Assisted + Approval | `/app/structure` |
| `enable_flow_with_approval` | execute | 4 | 🔴 Human-gated | `/app/automations` |

</details>

### Scheduling & Bookings

Dominant mode: 🔵 **Assisted** · 10 tools · 22 cortex capabilities

**UI surfaces:** `/app/bookings` · `/app/calendar`

<details><summary>10 governed tools</summary>

| Tool | Family | Tier | Mode | Manual route |
|---|---|:--:|---|---|
| `calendar_check_conflicts` | read | 1 | 🟢 Agentic | `/app/calendar` |
| `calendar_list_events` | read | 1 | 🟢 Agentic | `/app/calendar` |
| `fetch_schedule_health` | read | 1 | 🟢 Agentic | `/app/bookings` |
| `bookings_create_booking` | crud | 2 | 🔵 Assisted | `/app/bookings` |
| `bookings_list_bookings` | crud | 1 | 🔵 Assisted | `/app/bookings` |
| `bookings_list_services` | crud | 1 | 🔵 Assisted | `/app/bookings` |
| `bookings_mark_no_show` | organize | 2 | 🔵 Assisted | `/app/bookings` |
| `bookings_reschedule_booking` | crud | 2 | 🔵 Assisted | `/app/bookings` |
| `calendar_create_event` | crud | 2 | 🔵 Assisted | `/app/calendar` |
| `bookings_cancel_booking` | crud | 3 | 🟡 Assisted + Approval | `/app/bookings` |

</details>

### Support & Communications

Dominant mode: 🟢 **Agentic** · 13 tools · 38 cortex capabilities

**UI surfaces:** `/app/community` · `/app/helpdesk` · `/app/key-inbox`

**Gaps:** ⛔ KB answer synthesis

<details><summary>13 governed tools</summary>

| Tool | Family | Tier | Mode | Manual route |
|---|---|:--:|---|---|
| `community_list_posts` | read | 1 | 🟢 Agentic | `/app/community` |
| `helpdesk_list_tickets` | read | 1 | 🟢 Agentic | `/app/helpdesk` |
| `inbox_brief` | read | 1 | 🟢 Agentic | `/app/key-inbox` |
| `inbox_list_threads` | read | 1 | 🟢 Agentic | `/app/key-inbox` |
| `inbox_mark_resolved` | organize | 1 | 🟢 Agentic | `/app/key-inbox` |
| `inbox_read_thread` | read | 1 | 🟢 Agentic | `/app/key-inbox` |
| `helpdesk_create_ticket` | crud | 2 | 🔵 Assisted | `/app/helpdesk` |
| `helpdesk_draft_reply` | draft | 1 | 🔵 Assisted | `/app/helpdesk` |
| `helpdesk_reply_to_ticket` | organize | 2 | 🔵 Assisted | `/app/helpdesk` |
| `helpdesk_update_ticket` | crud | 2 | 🔵 Assisted | `/app/helpdesk` |
| `inbox_update_thread_status` | organize | 2 | 🔵 Assisted | `/app/key-inbox` |
| `helpdesk_delete_ticket` | execute | 3 | 🟡 Assisted + Approval | `/app/helpdesk` |
| `inbox_reply_thread` | execute | 3 | 🟡 Assisted + Approval | `/app/key-inbox` |

</details>

### Legal, Contracts & Governance

Dominant mode: 🟢 **Agentic** · 27 tools · 0 cortex capabilities

**UI surfaces:** `/app/approvals` · `/app/contracts` · `/app/document-intelligence` · `/app/evidence` · `/app/governance-flow` · `/app/portal`

**Gaps:** ⛔ Renewal-risk analysis

<details><summary>27 governed tools</summary>

| Tool | Family | Tier | Mode | Manual route |
|---|---|:--:|---|---|
| `approval_list` | read | 1 | 🟢 Agentic | `/app/approvals` |
| `contract_extract_clauses` | read | 2 | 🟢 Agentic | `/app/contracts` |
| `contract_extract_terms` | read | 2 | 🟢 Agentic | `/app/contracts` |
| `contract_list_tags` | read | 1 | 🟢 Agentic | `/app/contracts` |
| `contracts_acknowledge_alert` | organize | 1 | 🟢 Agentic | `/app/contracts` |
| `contracts_get` | read | 1 | 🟢 Agentic | `/app/contracts` |
| `contracts_list` | read | 1 | 🟢 Agentic | `/app/contracts` |
| `contracts_stats` | read | 1 | 🟢 Agentic | `/app/contracts` |
| `documents_list` | read | 1 | 🟢 Agentic | `/app/document-intelligence` |
| `documents_search` | read | 1 | 🟢 Agentic | `/app/document-intelligence` |
| `evidence_list` | read | 1 | 🟢 Agentic | `/app/evidence` |
| `governance_get_risk` | read | 1 | 🟢 Agentic | `/app/governance-flow` |
| `governance_list_risks` | read | 1 | 🟢 Agentic | `/app/governance-flow` |
| `governance_risk_summary` | read | 1 | 🟢 Agentic | `/app/governance-flow` |
| `portal_list_access` | read | 1 | 🟢 Agentic | `/app/portal` |
| `approval_create_request` | crud | 2 | 🔵 Assisted | `/app/approvals` |
| `contract_create_tag` | organize | 2 | 🔵 Assisted | `/app/contracts` |
| `contracts_create` | crud | 2 | 🔵 Assisted | `/app/contracts` |
| `contracts_update` | crud | 2 | 🔵 Assisted | `/app/contracts` |
| `evidence_submit` | crud | 2 | 🔵 Assisted | `/app/evidence` |
| `evidence_verify` | crud | 2 | 🔵 Assisted | `/app/evidence` |
| `governance_log_risk` | crud | 2 | 🔵 Assisted | `/app/governance-flow` |
| `governance_update_risk` | crud | 2 | 🔵 Assisted | `/app/governance-flow` |
| `portal_grant_access` | crud | 2 | 🔵 Assisted | `/app/portal` |
| `portal_update_settings` | crud | 2 | 🔵 Assisted | `/app/portal` |
| `approval_decide_step` | execute | 3 | 🟡 Assisted + Approval | `/app/approvals` |
| `contracts_delete` | crud | 3 | 🟡 Assisted + Approval | `/app/contracts` |

</details>

### Analytics & Strategy

Dominant mode: 🟢 **Agentic** · 18 tools · 37 cortex capabilities

**UI surfaces:** `/app/command-center` · `/app/goals` · `/app/key` · `/app/keyflow-command` · `/app/performance` · `/app/reports`

**Gaps:** ⛔ Anomaly detection · ⛔ Natural-language KPI Q&A

<details><summary>18 governed tools</summary>

| Tool | Family | Tier | Mode | Manual route |
|---|---|:--:|---|---|
| `command_list_due_obligations` | read | 1 | 🟢 Agentic | `/app/command-center` |
| `fetch_business_summary` | read | 1 | 🟢 Agentic | `/app/keyflow-command` |
| `finance_balance_sheet` | read | 1 | 🟢 Agentic | `/app/reports` |
| `finance_cashflow` | read | 1 | 🟢 Agentic | `/app/reports` |
| `finance_expense_breakdown` | read | 1 | 🟢 Agentic | `/app/reports` |
| `finance_profit_and_loss` | read | 1 | 🟢 Agentic | `/app/reports` |
| `finance_revenue_breakdown` | read | 1 | 🟢 Agentic | `/app/reports` |
| `finance_tax_summary` | read | 1 | 🟢 Agentic | `/app/reports` |
| `goals_get` | read | 1 | 🟢 Agentic | `/app/goals` |
| `goals_list` | read | 1 | 🟢 Agentic | `/app/goals` |
| `reports_generate` | read | 1 | 🟢 Agentic | `/app/reports` |
| `command_discharge_obligation` | organize | 2 | 🔵 Assisted | `/app/command-center` |
| `goals_create` | crud | 2 | 🔵 Assisted | `/app/goals` |
| `goals_create_plan` | organize | 2 | 🔵 Assisted | `/app/goals` |
| `goals_delete` | crud | 2 | 🔵 Assisted | `/app/goals` |
| `keyflow_create_note` | crud | 1 | 🔵 Assisted | `/app/keyflow-command` |
| `performance_take_snapshot` | organize | 2 | 🔵 Assisted | `/app/performance` |
| `execute_custom_logic` | execute | 3 | 🟡 Assisted + Approval | `/app/key/chat` |

</details>

### People & HR

Dominant mode: 🟡 **Assisted + Approval** · 4 tools · 0 cortex capabilities

**UI surfaces:** `/app/payroll`

**Gaps:** ⛔ Payroll tax filing · ⛔ Performance-review synthesis · ⛔ PTO / shift optimization

<details><summary>4 governed tools</summary>

| Tool | Family | Tier | Mode | Manual route |
|---|---|:--:|---|---|
| `payroll_set_rate` | organize | 2 | 🔵 Assisted | `/app/payroll` |
| `payroll_approve_run` | execute | 3 | 🟡 Assisted + Approval | `/app/payroll` |
| `payroll_generate_run` | execute | 3 | 🟡 Assisted + Approval | `/app/payroll` |
| `payroll_mark_paid` | execute | 3 | 🟡 Assisted + Approval | `/app/payroll` |

</details>

### Assets & Documents

Dominant mode: 🟢 **Agentic** · 7 tools · 0 cortex capabilities

**UI surfaces:** `/app/assets`

**Gaps:** ⛔ Asset depreciation / lifecycle · ⛔ License-renewal tracking

<details><summary>7 governed tools</summary>

| Tool | Family | Tier | Mode | Manual route |
|---|---|:--:|---|---|
| `assets_get` | read | 1 | 🟢 Agentic | `/app/assets` |
| `assets_list` | read | 1 | 🟢 Agentic | `/app/assets` |
| `assets_list_folders` | read | 1 | 🟢 Agentic | `/app/assets` |
| `assets_tag` | organize | 1 | 🟢 Agentic | `/app/assets` |
| `assets_untag` | organize | 1 | 🟢 Agentic | `/app/assets` |
| `assets_update` | crud | 2 | 🔵 Assisted | `/app/assets` |
| `assets_delete` | crud | 3 | 🟡 Assisted + Approval | `/app/assets` |

</details>

### Admin & Settings

Dominant mode: 🔵 **Assisted** · 0 tools · 10 cortex capabilities

**UI surfaces:** _(cortex-only, no dedicated flow tools)_

**Gaps:** ⛔ Anomalous-access / audit alerting

