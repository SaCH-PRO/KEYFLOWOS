# KEY Capability Map

> **Auto-generated** by `generate.js` from the two authoritative capability sources in the repo. Do not hand-edit — regenerate instead (`node docs/architecture/capability-map/generate.js`).

Projected from **282 governed flow tools** (`ai/flow-tool-registry.ts`) and **207 declared cortex capabilities** (`key-cortex/key-cortex-capability-registry.service.ts`) onto a **12-domain** business-function taxonomy.

**Coverage: 100% declared · 47% active.** Every target capability a complete business OS needs is now *declared* in the model (32/32). **15** are **active** (a real tool covers them today); **17** are **planned** — declared with a full build spec (mode, risk tier, what they compose from, UI surface, evaluator gate) but not yet executable. "Active" is the honest executable-today number; "declared" means the model is complete.

This file is the human-readable view of `key-capability-map.seed.json`, the seed for the M0 capability model.

## What this answers

- **Do we cover the whole business?** 100% declared; per-domain active/planned split below.
- **Manual, smart, or AI — per capability?** The *mode* is **derived, not chosen** — from `family` + `riskTier` (+ cortex `requiresApproval`) for active items, and pinned per spec for planned ones. Money movement, destructive, and irreversible actions stay **Human-gated** by rule — "KEY may create intelligence, but not authority."
- **What integration + UI does each mode imply?** See the legend. The **manual UI already exists** for every tool via its CI-enforced `manualEquivalentRoute`; assisted reuses the existing approval queue; only agentic needs the new Operator Console.
- **What still needs building?** The **build backlog** — every planned capability with its spec.

## Mode legend — derived, governance-bounded

| Mode | Meaning | Integration | UI surface |
|---|---|---|---|
| 🟢 **Agentic** | AI acts autonomously (read-only / low-risk) | Orchestrator + Operator Console | Goal / chat surface + console |
| 🔵 **Assisted** | AI drafts/acts, human-reviewable | Automation + draft review | Product screen + inline suggestions |
| 🟡 **Assisted + Approval** | AI proposes, execution gated | Approval queue (`AiApprovalItem`) | Product screen + approval queue |
| 🔴 **Human-gated** | Money / destructive / irreversible | Manual execution; AI proposes only | Product screen (human decision) |

## Coverage summary

Across **12 domains**: 🟢 212 agentic · 🔵 228 assisted · 🟡 46 assisted+approval · 🔴 3 human-gated (across 489 live capabilities).

| Domain | Tools | Cortex caps | UI surfaces | Active | Planned | Declared | Mode mix |
|---|--:|--:|--:|:--:|:--:|:--:|---|
| **Sales & CRM** | 42 | 17 | 3 | 2/3 | 1 | 100% | 🔵 32 🟢 19 🟡 8 |
| **Marketing & Content** | 32 | 22 | 3 | 2/3 | 1 | 100% | 🔵 28 🟢 16 🟡 8 🔴 2 |
| **Commerce & Fulfillment** | 47 | 15 | 5 | 1/3 | 2 | 100% | 🟢 29 🔵 28 🟡 5 |
| **Finance & Accounting** | 36 | 10 | 4 | 3/4 | 1 | 100% | 🟢 23 🔵 20 🟡 3 |
| **Operations & Delivery** | 45 | 36 | 5 | 1/2 | 1 | 100% | 🔵 41 🟢 34 🟡 5 🔴 1 |
| **Scheduling & Bookings** | 10 | 22 | 2 | 2/2 | 0 | 100% | 🔵 20 🟢 11 🟡 1 |
| **Support & Communications** | 13 | 38 | 3 | 2/3 | 1 | 100% | 🟢 23 🔵 23 🟡 5 |
| **Legal, Contracts & Governance** | 28 | 0 | 6 | 2/3 | 1 | 100% | 🟢 15 🔵 11 🟡 2 |
| **Analytics & Strategy** | 18 | 37 | 6 | 0/3 | 3 | 100% | 🟢 33 🔵 19 🟡 3 |
| **People & HR** | 4 | 0 | 1 | 0/3 | 3 | 100% | 🟡 3 🔵 1 |
| **Assets & Documents** | 7 | 0 | 1 | 0/2 | 2 | 100% | 🟢 5 🔵 1 🟡 1 |
| **Admin & Settings** | 0 | 10 | 0 | 0/1 | 1 | 100% | 🔵 4 🟢 4 🟡 2 |

## Build backlog — planned capabilities

Every gap is now a **declared capability with a spec**. This is the concrete build order. Proposed mode is the governance contract each will inherit.

"Composes from" is **auto-derived, not hand-picked** — real registry tools, preferring the capability's own UI surface, then its domain, then read-only tools registry-wide. Read it as a verified-to-exist starting point, not a vetted design: what is guaranteed is that every tool named is real and the list is never empty, not that it is the right list.

| Domain | Capability | Mode | Tier | Composes from | UI surface | Evaluator gate |
|---|---|---|:--:|---|---|---|
| Sales & CRM | Web lead enrichment / prospecting | 🟢 Agentic | 1 | `crm_find_duplicates`, `crm_list_deals`, `crm_merge_preview` | `/app/crm` | Source-provenance + dedupe checks; enrichment-accuracy sample BLOCKING |
| Marketing & Content | Ad-spend optimization | 🟡 Assisted + Approval | 3 | `social_get_analytics`, `comms_send_broadcast`, `draft_campaign_bundle` | `/app/marketing` | Backtest reallocation vs 90d ROAS; budget-cap + policy BLOCKING |
| Commerce & Fulfillment | Dynamic pricing | 🔴 Human-gated | 4 | `fetch_revenue_risk`, `commerce_convert_quote`, `commerce_create_invoice` | `/app/commerce` | Margin-floor + price-change policy BLOCKING; human sign-off |
| Commerce & Fulfillment | Supplier risk scoring | 🟢 Agentic | 1 | `procurement_get_request`, `procurement_get_stats`, `procurement_list_requests` | `/app/procurement` | Score reproducibility; source-provenance check |
| Finance & Accounting | Tax filing preparation | 🔴 Human-gated | 4 | `finance_list_action_items`, `finance_list_bank_accounts`, `finance_list_bills` | `/app/finance` | Reconciliation ties to ledger; human + accountant sign-off |
| Operations & Delivery | SLA monitoring | 🟢 Agentic | 1 | `fetch_project_status`, `projects_get_budget`, `projects_get_timeline` | `/app/projects` | Breach-threshold unit tests; false-positive ceiling |
| Support & Communications | KB answer synthesis | 🟢 Agentic | 1 | `helpdesk_list_tickets`, `helpdesk_create_ticket`, `helpdesk_delete_ticket` | `/app/helpdesk` | Groundedness/citation check; hallucination guard BLOCKING |
| Legal, Contracts & Governance | Renewal-risk analysis | 🟢 Agentic | 1 | `contract_extract_clauses`, `contract_extract_terms`, `contract_list_tags` | `/app/contracts` | Backtest vs historical renew/churn outcomes |
| Analytics & Strategy | Anomaly detection | 🟢 Agentic | 1 | `finance_balance_sheet`, `finance_cashflow`, `finance_expense_breakdown` | `/app/reports` | Precision/recall on labelled anomalies; alert-noise ceiling |
| Analytics & Strategy | Natural-language KPI Q&A | 🟢 Agentic | 1 | `finance_balance_sheet`, `finance_cashflow`, `finance_expense_breakdown` | `/app/reports` | Query-to-metric accuracy suite; refuse-when-unknown check BLOCKING |
| Analytics & Strategy | Cohort / retention analysis | 🟢 Agentic | 1 | `finance_balance_sheet`, `finance_cashflow`, `finance_expense_breakdown` | `/app/reports` | Cohort-definition reproducibility; retention-math tie-out |
| People & HR | Payroll tax filing | 🔴 Human-gated | 4 | `payroll_approve_run`, `payroll_generate_run`, `payroll_mark_paid` | `/app/payroll` | Withholding recomputation matches; human + compliance sign-off |
| People & HR | Performance-review synthesis | 🔵 Assisted | 2 | `command_list_due_obligations`, `fetch_business_summary`, `finance_balance_sheet` | `/app/performance` | Bias/fairness screen; source-attribution check |
| People & HR | PTO / shift optimization | 🔵 Assisted | 2 | `payroll_list_rates`, `people_list`, `people_org_chart` | `/app/structure` | Coverage-constraint satisfaction; labour-rule check |
| Assets & Documents | Asset depreciation / lifecycle | 🔵 Assisted | 2 | `assets_get`, `assets_list`, `assets_list_folders` | `/app/assets` | Depreciation schedule matches method; ledger tie-out |
| Assets & Documents | License-renewal tracking | 🟢 Agentic | 1 | `assets_get`, `assets_list`, `assets_list_folders` | `/app/assets` | Renewal-date extraction accuracy; reminder-lead-time check |
| Admin & Settings | Anomalous-access / audit alerting | 🟢 Agentic | 1 | `approval_list`, `assets_get`, `assets_list` | `/app/settings` | Detection precision on known-bad patterns; alert-noise ceiling |

**17 planned capabilities.** Safe-to-build-first (🟢 agentic, read-only): the analytics/monitoring/detection items. Must-stay-human-gated (🔴): Dynamic pricing, Tax filing preparation, Payroll tax filing — declared, but never auto-promoted to autonomous.

## How to read this into the roadmap

- **The map is a target, not a build queue.** Declared = the model is complete; active = what actually runs. Instantiate planned capabilities on evidence or a seed-worthy bet — not all at once.
- **M0** loads `key-capability-map.seed.json` as the initial capability model. Every skill/agent registered later declares which capability it covers → active coverage climbs from 47% toward 100% as things ship.
- **Mode is the governance contract.** 🔴 Human-gated capabilities must never be promoted to autonomous, regardless of evidence.
- **UI is mostly done.** Manual = existing routes; Assisted = existing approval queue; only the Operator Console (agentic) is net-new.

## Per-domain detail

### Sales & CRM

42 tools · 17 cortex capabilities · **2/3 active**, 1 planned

**UI surfaces:** `/app/call-tasks` · `/app/crm` · `/app/onboarding`

**Target capabilities:**

| Capability | Status | Mode | Detail |
|---|---|---|---|
| Web lead enrichment / prospecting | 🧩 planned | 🟢 Agentic | T1 · composes `crm_find_duplicates`… · /app/crm |
| Predictive lead scoring | ✅ active | 🟡 Assisted + Approval | covered by `crm_merge_execute` |
| Sales pipeline forecasting | ✅ active | 🟢 Agentic | covered by `deals_forecast` |

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

32 tools · 22 cortex capabilities · **2/3 active**, 1 planned

**UI surfaces:** `/app/content-ops` · `/app/marketing` · `/app/seo`

**Target capabilities:**

| Capability | Status | Mode | Detail |
|---|---|---|---|
| Campaign attribution / ROI | ✅ active | 🟢 Agentic | covered by `fetch_seo_revenue_attribution` |
| Audience segmentation | ✅ active | 🔵 Assisted | covered by `tag_contact` |
| Ad-spend optimization | 🧩 planned | 🟡 Assisted + Approval | T3 · composes `social_get_analytics`… · /app/marketing |

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

47 tools · 15 cortex capabilities · **1/3 active**, 2 planned

**UI surfaces:** `/app/commerce` · `/app/inventory` · `/app/marketplace` · `/app/procurement` · `/app/store`

**Target capabilities:**

| Capability | Status | Mode | Detail |
|---|---|---|---|
| Demand forecasting / reorder point | ✅ active | 🟢 Agentic | covered by `inventory_low_stock_alerts` |
| Dynamic pricing | 🧩 planned | 🔴 Human-gated | T4 · composes `fetch_revenue_risk`… · /app/commerce |
| Supplier risk scoring | 🧩 planned | 🟢 Agentic | T1 · composes `procurement_get_request`… · /app/procurement |

<details><summary>47 governed tools</summary>

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
| `suppliers_list_products` | read | 1 | 🟢 Agentic | `/app/procurement` |
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
| `suppliers_create_product_from_supplier` | crud | 2 | 🔵 Assisted | `/app/store` |
| `apply_storefront_recommendation` | execute | 3 | 🟡 Assisted + Approval | `/app/store` |
| `commerce_delete_invoice` | crud | 3 | 🟡 Assisted + Approval | `/app/commerce` |
| `commerce_send_invoice` | execute | 3 | 🟡 Assisted + Approval | `/app/commerce` |
| `procurement_issue_po` | execute | 3 | 🟡 Assisted + Approval | `/app/procurement` |

</details>

### Finance & Accounting

36 tools · 10 cortex capabilities · **3/4 active**, 1 planned

**UI surfaces:** `/app/expenses` · `/app/finance` · `/app/payments` · `/app/retainers`

**Target capabilities:**

| Capability | Status | Mode | Detail |
|---|---|---|---|
| Cash-flow forecasting | ✅ active | 🟢 Agentic | covered by `fetch_revenue_risk` |
| Dunning / collections sequencing | ✅ active | 🟡 Assisted + Approval | covered by `sequence_enroll_overdue` |
| Multi-currency / FX handling | ✅ active | 🔵 Assisted | covered by `update_business_blueprint` |
| Tax filing preparation | 🧩 planned | 🔴 Human-gated | T4 · composes `finance_list_action_items`… · /app/finance |

<details><summary>36 governed tools</summary>

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
| `payments_refund_charge` | execute | 3 | 🟡 Assisted + Approval | `/app/payments` |

</details>

### Operations & Delivery

45 tools · 36 cortex capabilities · **1/2 active**, 1 planned

**UI surfaces:** `/app/automations` · `/app/blueprint` · `/app/projects` · `/app/structure` · `/app/time-tracking`

**Target capabilities:**

| Capability | Status | Mode | Detail |
|---|---|---|---|
| Capacity / resource planning | ✅ active | 🟢 Agentic | covered by `fetch_schedule_health` |
| SLA monitoring | 🧩 planned | 🟢 Agentic | T1 · composes `fetch_project_status`… · /app/projects |

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

10 tools · 22 cortex capabilities · **2/2 active**, 0 planned

**UI surfaces:** `/app/bookings` · `/app/calendar`

**Target capabilities:**

| Capability | Status | Mode | Detail |
|---|---|---|---|
| No-show prediction | ✅ active | 🟢 Agentic | covered by `fetch_schedule_health` |
| Smart rescheduling | ✅ active | 🔵 Assisted | covered by `bookings_reschedule_booking` |

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

13 tools · 38 cortex capabilities · **2/3 active**, 1 planned

**UI surfaces:** `/app/community` · `/app/helpdesk` · `/app/key-inbox`

**Target capabilities:**

| Capability | Status | Mode | Detail |
|---|---|---|---|
| Sentiment / escalation detection | ✅ active | 🔵 Assisted | covered by `delegation_payment_recovery` |
| Auto-triage & routing | ✅ active | 🔵 Assisted | covered by `inbox_update_thread_status` |
| KB answer synthesis | 🧩 planned | 🟢 Agentic | T1 · composes `helpdesk_list_tickets`… · /app/helpdesk |

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

28 tools · 0 cortex capabilities · **2/3 active**, 1 planned

**UI surfaces:** `/app/approvals` · `/app/contracts` · `/app/document-intelligence` · `/app/evidence` · `/app/governance-flow` · `/app/portal`

**Target capabilities:**

| Capability | Status | Mode | Detail |
|---|---|---|---|
| Contract redlining / clause-risk analysis | ✅ active | 🟢 Agentic | covered by `contract_extract_clauses` |
| Obligation extraction & tracking | ✅ active | 🟢 Agentic | covered by `command_list_due_obligations` |
| Renewal-risk analysis | 🧩 planned | 🟢 Agentic | T1 · composes `contract_extract_clauses`… · /app/contracts |

<details><summary>28 governed tools</summary>

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
| `portal_revoke_access` | crud | 2 | 🔵 Assisted | `/app/portal` |
| `portal_update_settings` | crud | 2 | 🔵 Assisted | `/app/portal` |
| `approval_decide_step` | execute | 3 | 🟡 Assisted + Approval | `/app/approvals` |
| `contracts_delete` | crud | 3 | 🟡 Assisted + Approval | `/app/contracts` |

</details>

### Analytics & Strategy

18 tools · 37 cortex capabilities · **0/3 active**, 3 planned

**UI surfaces:** `/app/command-center` · `/app/goals` · `/app/key` · `/app/keyflow-command` · `/app/performance` · `/app/reports`

**Target capabilities:**

| Capability | Status | Mode | Detail |
|---|---|---|---|
| Anomaly detection | 🧩 planned | 🟢 Agentic | T1 · composes `finance_balance_sheet`… · /app/reports |
| Natural-language KPI Q&A | 🧩 planned | 🟢 Agentic | T1 · composes `finance_balance_sheet`… · /app/reports |
| Cohort / retention analysis | 🧩 planned | 🟢 Agentic | T1 · composes `finance_balance_sheet`… · /app/reports |

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

4 tools · 0 cortex capabilities · **0/3 active**, 3 planned

**UI surfaces:** `/app/payroll`

**Target capabilities:**

| Capability | Status | Mode | Detail |
|---|---|---|---|
| Payroll tax filing | 🧩 planned | 🔴 Human-gated | T4 · composes `payroll_approve_run`… · /app/payroll |
| Performance-review synthesis | 🧩 planned | 🔵 Assisted | T2 · composes `command_list_due_obligations`… · /app/performance |
| PTO / shift optimization | 🧩 planned | 🔵 Assisted | T2 · composes `payroll_list_rates`… · /app/structure |

<details><summary>4 governed tools</summary>

| Tool | Family | Tier | Mode | Manual route |
|---|---|:--:|---|---|
| `payroll_set_rate` | organize | 2 | 🔵 Assisted | `/app/payroll` |
| `payroll_approve_run` | execute | 3 | 🟡 Assisted + Approval | `/app/payroll` |
| `payroll_generate_run` | execute | 3 | 🟡 Assisted + Approval | `/app/payroll` |
| `payroll_mark_paid` | execute | 3 | 🟡 Assisted + Approval | `/app/payroll` |

</details>

### Assets & Documents

7 tools · 0 cortex capabilities · **0/2 active**, 2 planned

**UI surfaces:** `/app/assets`

**Target capabilities:**

| Capability | Status | Mode | Detail |
|---|---|---|---|
| Asset depreciation / lifecycle | 🧩 planned | 🔵 Assisted | T2 · composes `assets_get`… · /app/assets |
| License-renewal tracking | 🧩 planned | 🟢 Agentic | T1 · composes `assets_get`… · /app/assets |

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

0 tools · 10 cortex capabilities · **0/1 active**, 1 planned

**UI surfaces:** _(cortex-only, no dedicated flow tools)_

**Target capabilities:**

| Capability | Status | Mode | Detail |
|---|---|---|---|
| Anomalous-access / audit alerting | 🧩 planned | 🟢 Agentic | T1 · composes `approval_list`… · /app/settings |

