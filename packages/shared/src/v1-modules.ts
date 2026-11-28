/**
 * The modules v1 hides (owner ruling D-152), as ONE list: module -> tables ->
 * web routes -> KEY tool families.
 *
 * Packet USAGE-COUNT-SCRIPT (V1-61) created it. It is derived from the product
 * audit (2026-11-13): every `cut_or_hide` entry whose action is `defer-v1plus`
 * or `hide-advanced`, and every '(hidden)' item of its module map. Entries the
 * audit marks `remove` (harness pages, fake content, empty shells, the global
 * disclosure modes, demo seeding) are not hidden modules and are not here, nor
 * is depth that stays one tab deep inside a v1 hub (the core Books screens,
 * warehouses and stock transfers, custom fields).
 *
 * Who reads it:
 *   - apps/server/scripts/v1-module-usage-count.ts counts, per live business,
 *     the rows of each module's `tables` (read only; the owner runs it against
 *     production, D-148, before NAV-B-HIDE and before the redeploy);
 *   - NAV-B-LEGACY-SERVER answers which hidden modules a business already has
 *     rows in, with one EXISTS per module over the same `tables`;
 *   - NAV-B-HIDE / NAV-B-HIDE-2 gate `routes` and `pages` on the web;
 *   - KEY-TOOL-ALLOWLIST / KEY-TOOL-DOMAIN-HIDE classify KEY tools by `keyTools`;
 *   - SWP-CENSUS-HIDDEN names a module by its key here in its write gate,
 *     @HiddenModuleWrites(<key>, <scope>) on each of the module's controllers
 *     (apps/server/src/core/auth/hidden-module-writes.decorator.ts;
 *     rest-scope-census.spec.ts CEN-12a checks every key against this list).
 *     The permission scope the module's writes need is the decorator's second
 *     argument, a canonical module: this list does not decide authority.
 * Nobody keeps a second list: a change to what v1 hides is a change here.
 *
 * Self-contained on purpose (no imports): the usage-count script imports this
 * file by relative path so that it runs on the production box against the API
 * image already deployed there, whose @keyflow/shared build predates this file
 * (docs/development/operator-data-cleanup-scripts.md).
 *
 * The table entries are constants read by trusted code. `where` is a fixed SQL
 * boolean over the table's own columns (alias `t`), never built from input;
 * every column a count reads is named in `businessColumn`, `softDeleteColumn`
 * or `whereColumns`. All of them are ids, soft-delete markers or status flags
 * except one: `businesses.meta_data`, the JSON bag that holds the WhatsApp
 * provider credentials and sender number, which `whatsapp.config` reads in a
 * WHERE that tests a key's presence and extracts no value (review SEC-V61-2).
 * No count projects anything but a business id and a number. The integration
 * test grants a database role only those columns and runs the count under it,
 * and runs it again without `meta_data` (whatsapp.config is then reported
 * `unreadable`).
 */

/** Where a hidden module's rows live, and which of them mean "the business uses it". */
export interface V1ModuleTable {
  /** The count's name in the report; unique within its module. */
  readonly name: string;
  /** Postgres table (the Prisma model's @@map). */
  readonly table: string;
  /** The column holding the owning business id (`id` when `table` is `businesses`). */
  readonly businessColumn: string;
  /** Soft-delete column: a row with a value there is not counted. */
  readonly softDeleteColumn?: string;
  /** Extra filter, a constant SQL boolean over this table's columns (alias `t`). */
  readonly where?: string;
  /** Every column `where` reads. */
  readonly whereColumns?: readonly string[];
  /** Why these rows (and only these) count. */
  readonly note?: string;
}

export type V1HiddenTreatment =
  /** Hidden in v1; back in a later release. */
  | 'defer-v1plus'
  /** Behind a per-business switch that is off by default (Advanced CRM). */
  | 'hide-advanced';

export interface V1HiddenModule {
  /** Stable key (snake_case). NAV-B-LEGACY-SERVER answers these keys. */
  readonly key: string;
  readonly label: string;
  readonly treatment: V1HiddenTreatment;
  /** The release it comes back in, where the audit or a ruling names one. */
  readonly returnsIn?: string;
  /** The owner rulings behind hiding it. */
  readonly rulings: readonly string[];
  /** Web routes hidden with the module; each covers its sub-routes. */
  readonly routes: readonly string[];
  /** Single pages hidden with the module whose sub-routes stay (`/app/key`: the Worker page, not /app/key/chat). */
  readonly pages?: readonly string[];
  /**
   * The rows that mean a business uses the module. Any one of them counted
   * above zero puts the business on the module's list. Empty: the module has
   * no records of its own (a dashboard or hub derived from other modules), so
   * no business can lose anything by hiding it.
   */
  readonly tables: readonly V1ModuleTable[];
  /** Informative sub-counts, reported but never deciding use. */
  readonly facets?: readonly V1ModuleTable[];
  /**
   * KEY (FLOW) tools that act in this module (apps/server/src/modules/ai/flow-tool-registry.ts).
   * Every FLOW tool is either here, in one module, or in the reviewed v1 set the integration test
   * keeps (review SEC-V61-3), so a new tool is classified before KEY-TOOL-DOMAIN-HIDE reads this.
   */
  readonly keyTools: readonly string[];
  readonly note?: string;
}

const HIDE = 'D-152';

export const V1_HIDDEN_MODULES = [
  // ---------------------------------------------------------------- Customers
  {
    key: 'advanced_crm',
    label: 'Deals board and Companies (Advanced CRM)',
    treatment: 'hide-advanced',
    rulings: [HIDE, 'D-150'],
    routes: ['/app/crm/deals', '/app/crm/accounts'],
    tables: [
      { name: 'deals', table: 'deals', businessColumn: 'business_id', softDeleteColumn: 'deleted_at' },
      { name: 'companies', table: 'accounts', businessColumn: 'business_id', softDeleteColumn: 'deleted_at' },
    ],
    keyTools: [
      'deals_create', 'deals_delete', 'deals_forecast', 'deals_get', 'deals_list', 'deals_list_stages',
      'deals_mark_lost', 'deals_mark_won', 'deals_move_stage', 'deals_pipeline_velocity', 'deals_update',
      'crm_list_deals', 'crm_move_deal_stage', 'crm_update_deal',
    ],
    note: 'Deal stages are not counted: they are created for every business that opens the board.',
  },
  {
    key: 'sequences',
    label: 'CRM sequences',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/crm/sequences'],
    tables: [{ name: 'sequences', table: 'crm_sequences', businessColumn: 'business_id' }],
    keyTools: ['sequence_create', 'sequence_enroll', 'sequence_enroll_overdue', 'sequence_list', 'sequence_pause_resume', 'sequence_unenroll'],
  },
  {
    key: 'crm_intelligence',
    label: 'CRM intelligence',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/crm/intelligence'],
    tables: [],
    keyTools: [],
    note: 'Derived from contacts; no records of its own.',
  },
  {
    key: 'crm_network',
    label: 'Contact network',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/crm/network'],
    tables: [{ name: 'relationships', table: 'contact_relationships', businessColumn: 'business_id' }],
    keyTools: [],
  },
  {
    key: 'sales_team',
    label: 'Sales team',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/sales-team'],
    tables: [],
    keyTools: [],
    note: 'Derived from team members and deals; no records of its own.',
  },
  {
    key: 'call_tasks',
    label: 'Call tasks',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/call-tasks'],
    tables: [{ name: 'call_logs', table: 'call_logs', businessColumn: 'business_id' }],
    keyTools: ['call_create_task', 'call_generate_script', 'call_list_tasks', 'call_log_outcome', 'call_schedule_followup'],
  },
  {
    key: 'helpdesk',
    label: 'Helpdesk',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/helpdesk'],
    tables: [{ name: 'tickets', table: 'support_tickets', businessColumn: 'business_id', softDeleteColumn: 'deleted_at' }],
    keyTools: [
      'helpdesk_create_ticket', 'helpdesk_delete_ticket', 'helpdesk_draft_reply', 'helpdesk_list_tickets',
      'helpdesk_reply_to_ticket', 'helpdesk_update_ticket',
    ],
  },
  {
    key: 'inbox',
    label: 'Message intake inbox',
    treatment: 'defer-v1plus',
    returnsIn: 'V1.1',
    rulings: [HIDE, 'D-153'],
    routes: ['/app/inbox'],
    tables: [{ name: 'message_intakes', table: 'message_intakes', businessColumn: 'business_id' }],
    keyTools: [],
  },
  // ---------------------------------------------------------------- Sales
  {
    key: 'retainers',
    label: 'Retainers',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/retainers'],
    tables: [{ name: 'agreements', table: 'retainer_agreements', businessColumn: 'business_id' }],
    keyTools: ['retainers_create', 'retainers_get', 'retainers_list', 'retainers_log_period', 'retainers_summary', 'retainers_update', 'retainers_update_period'],
  },
  // ---------------------------------------------------------------- Schedule
  {
    key: 'events',
    label: 'Events and tickets',
    treatment: 'defer-v1plus',
    returnsIn: 'V1.3',
    rulings: [HIDE],
    routes: ['/app/events'],
    tables: [
      { name: 'events', table: 'events', businessColumn: 'business_id' },
      { name: 'attendees', table: 'event_attendees', businessColumn: 'business_id' },
    ],
    keyTools: [],
  },
  {
    key: 'time_tracking',
    label: 'Time tracking',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/time-tracking'],
    tables: [{ name: 'time_entries', table: 'time_entries', businessColumn: 'business_id' }],
    keyTools: ['time_log_entry', 'time_mark_billed', 'time_start_timer', 'time_stop_timer', 'time_update_entry'],
  },
  {
    key: 'waitlist',
    label: 'Bookings waitlist',
    treatment: 'defer-v1plus',
    returnsIn: 'V1.2',
    rulings: [HIDE],
    routes: [],
    tables: [{ name: 'entries', table: 'booking_waitlist_entries', businessColumn: 'business_id', softDeleteColumn: 'deleted_at' }],
    keyTools: ['bookings_add_to_waitlist', 'bookings_cancel_waitlist_entry', 'bookings_list_waitlist', 'bookings_offer_waitlist_slot'],
    note: 'A tab inside Bookings, not a route of its own.',
  },
  // ---------------------------------------------------------------- Money
  {
    key: 'payroll',
    label: 'Payroll',
    treatment: 'defer-v1plus',
    returnsIn: 'V1.2',
    rulings: [HIDE, 'D-156', 'D-144'],
    routes: ['/app/payroll'],
    tables: [
      { name: 'payroll_runs', table: 'payroll_runs', businessColumn: 'business_id' },
      { name: 'pay_rates', table: 'pay_rates', businessColumn: 'business_id' },
    ],
    facets: [
      {
        name: 'runs_reserving_safe_to_spend',
        table: 'payroll_runs',
        businessColumn: 'business_id',
        where: "t.\"status\" IN ('DRAFT', 'APPROVED')",
        whereColumns: ['status'],
        note: 'D-144: DRAFT and APPROVED runs are reserved in safe-to-spend, so Money > Overview must say so.',
      },
    ],
    keyTools: ['payroll_approve_run', 'payroll_generate_run', 'payroll_get_run', 'payroll_list_rates', 'payroll_list_runs', 'payroll_mark_paid', 'payroll_set_rate'],
  },
  {
    key: 'budgets',
    label: 'Expense budgets',
    treatment: 'defer-v1plus',
    returnsIn: 'V1.2',
    rulings: [HIDE],
    routes: ['/app/budgeting'],
    tables: [{ name: 'budgets', table: 'expense_budgets', businessColumn: 'business_id' }],
    keyTools: [],
  },
  {
    key: 'accounting_sync',
    label: 'Accounting sync (QuickBooks, Xero)',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/accounting'],
    tables: [
      {
        name: 'connected_providers',
        table: 'connector_statuses',
        businessColumn: 'business_id',
        where: "t.\"status\" = 'connected' AND t.\"connector_type\" IN ('quickbooks', 'xero')",
        whereColumns: ['status', 'connector_type'],
      },
    ],
    keyTools: [],
  },
  {
    key: 'fixed_assets',
    label: 'Fixed assets',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/finance/fixed-assets'],
    tables: [{ name: 'fixed_assets', table: 'fixed_assets', businessColumn: 'business_id' }],
    keyTools: [],
  },
  {
    key: 'accounting_periods',
    label: 'Accounting periods',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/finance/accounting-periods'],
    tables: [{ name: 'periods', table: 'accounting_periods', businessColumn: 'business_id' }],
    keyTools: [],
  },
  {
    key: 'recurring_journals',
    label: 'Recurring journals',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/finance/recurring-journals'],
    tables: [{ name: 'recurring_journals', table: 'recurring_journal_entries', businessColumn: 'business_id' }],
    keyTools: [],
  },
  {
    key: 'exchange_rates',
    label: 'Exchange rates',
    treatment: 'defer-v1plus',
    rulings: [HIDE, 'D-13'],
    routes: ['/app/finance/exchange-rates'],
    tables: [{ name: 'rates', table: 'exchange_rates', businessColumn: 'business_id' }],
    keyTools: [],
  },
  {
    key: 'continental_ops',
    label: 'Continental operations',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/continental-ops'],
    tables: [
      { name: 'delivery_notes', table: 'delivery_notes', businessColumn: 'business_id' },
      { name: 'goods_receipts', table: 'goods_receipts', businessColumn: 'business_id' },
      { name: 'stock_counts', table: 'stock_counts', businessColumn: 'business_id' },
      { name: 'receipts', table: 'receipts', businessColumn: 'business_id' },
    ],
    keyTools: [],
  },
  // ---------------------------------------------------------------- Selling online
  {
    key: 'store',
    label: 'Store checkout, Sales > Orders and Quick sale',
    treatment: 'defer-v1plus',
    rulings: ['D-263'],
    routes: [],
    tables: [{ name: 'orders', table: 'marketplace_orders', businessColumn: 'business_id' }],
    keyTools: [],
    note:
      'WEDGE-HIDE-STORE (D-263): a business that has taken a store order or a quick sale (both are marketplace_orders ' +
      'rows; a quick sale\'s number starts QS-) keeps selling online, read and write; any other business is not offered ' +
      'it at launch. Every row counts, whatever its status: the table has no soft delete, and a cancelled order still ' +
      'means the business sold online. No route is hidden here: /app/store also manages the booking page (journey F). ' +
      'The gates land with the entries (the public store checkout, SALES-ORDERS-TAB, QUICK-SALE-WEB), each reading the ' +
      'legacy answer through apps/web/src/lib/api/legacy-modules.ts. No KEY tool is classified here.',
  },
  // ---------------------------------------------------------------- Your page
  {
    key: 'presence_pages',
    label: 'Website pages builder',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/presence/pages'],
    tables: [
      {
        name: 'saved_drafts',
        table: 'site_page_drafts',
        businessColumn: 'business_id',
        where: 't."version" > 1',
        whereColumns: ['version'],
        note: 'Opening the builder creates a version-1 draft for every business; a save makes version 2.',
      },
      { name: 'published', table: 'site_pages_published', businessColumn: 'business_id' },
    ],
    facets: [
      {
        name: 'published_live',
        table: 'site_pages_published',
        businessColumn: 'business_id',
        where: 't."unpublished_at" IS NULL',
        whereColumns: ['unpublished_at'],
        note: 'Served at /site/<slug> today.',
      },
    ],
    keyTools: [],
  },
  {
    key: 'seo',
    label: 'SEO',
    treatment: 'defer-v1plus',
    returnsIn: 'V1.3',
    rulings: [HIDE],
    routes: ['/app/seo'],
    tables: [
      { name: 'pages', table: 'seo_pages', businessColumn: 'business_id' },
      { name: 'keywords', table: 'seo_keywords', businessColumn: 'business_id' },
      { name: 'briefs', table: 'content_briefs', businessColumn: 'business_id' },
    ],
    keyTools: [
      'fetch_seo_dashboard', 'fetch_seo_issues', 'fetch_seo_keywords', 'fetch_seo_revenue_attribution',
      'fetch_content_gaps', 'generate_content_brief', 'seo_apply_remediation', 'sync_seo_pages',
    ],
  },
  // ---------------------------------------------------------------- Settings
  {
    key: 'api_keys',
    label: 'API keys (Settings > Developers)',
    treatment: 'defer-v1plus',
    returnsIn: 'V1.5',
    rulings: [HIDE, 'D-158'],
    routes: ['/app/settings/developers'],
    tables: [{ name: 'api_keys', table: 'api_keys', businessColumn: 'business_id' }],
    facets: [
      { name: 'active', table: 'api_keys', businessColumn: 'business_id', where: 't."revoked_at" IS NULL', whereColumns: ['revoked_at'] },
    ],
    keyTools: [],
  },
  {
    key: 'webhooks',
    label: 'Webhooks',
    treatment: 'defer-v1plus',
    returnsIn: 'V1.5',
    rulings: [HIDE, 'D-158'],
    routes: ['/app/settings/webhooks'],
    tables: [{ name: 'webhooks', table: 'webhooks', businessColumn: 'business_id' }],
    facets: [
      { name: 'active', table: 'webhooks', businessColumn: 'business_id', where: 't."is_active" = true', whereColumns: ['is_active'] },
    ],
    keyTools: [],
  },
  {
    key: 'settings_insights',
    label: 'Settings insights',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/settings/insights'],
    tables: [],
    keyTools: [],
    note: 'Product analytics read-outs; no records of the business.',
  },
  {
    key: 'referrals',
    label: 'Referrals and conversion',
    treatment: 'defer-v1plus',
    returnsIn: 'V1.3',
    rulings: [HIDE],
    routes: ['/app/settings/conversion', '/me/refer'],
    tables: [],
    keyTools: [],
    note: 'No rows of its own: a referral code is stamped on the customer, and no owner screen shows the results.',
  },
  {
    key: 'structure',
    label: 'Structure (org units, job roles, delegation)',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/structure'],
    tables: [
      { name: 'org_units', table: 'org_units', businessColumn: 'business_id' },
      { name: 'job_roles', table: 'job_roles', businessColumn: 'business_id' },
      { name: 'assignments', table: 'org_assignments', businessColumn: 'business_id' },
      { name: 'delegation_rules', table: 'delegation_rules', businessColumn: 'business_id' },
    ],
    keyTools: [
      'structure_create_delegation_rule', 'structure_find_person', 'structure_get_org_tree', 'structure_get_stats',
      'structure_list_assignments', 'structure_list_delegation_rules', 'structure_list_job_roles', 'structure_list_org_units',
      'structure_update_delegation_rule', 'people_org_chart',
    ],
    note: 'people_org_chart reads the org tree and its stats (StructureService.getOrgTree, getStats).',
  },
  {
    key: 'connectors',
    label: 'Connections other than Gmail',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: [],
    tables: [
      {
        name: 'connected',
        table: 'connector_statuses',
        businessColumn: 'business_id',
        where: "t.\"status\" = 'connected' AND t.\"connector_type\" NOT IN ('gmail', 'whatsapp', 'paypal', 'wipay', 'stripe')",
        whereColumns: ['status', 'connector_type'],
        note: 'Gmail stays in v1, payment keys live in Getting paid, WhatsApp is its own module.',
      },
    ],
    keyTools: ['drive_create_document', 'drive_create_folder'],
    note:
      'Tiles inside /app/key-connect, which v1 keeps showing Gmail only; Google Calendar sync and Google Drive are two of them. ' +
      'The Drive tools write to Google Drive (GoogleDriveService.createFolder, createDoc). A Drive connection made through ' +
      'the OAuth route is kept on the business row (drive_* token columns) and may have no connected connector_statuses ' +
      'row, so it is not counted here: counting it would read a credential column.',
  },
  // ---------------------------------------------------------------- Projects and operations
  {
    key: 'projects',
    label: 'Projects and tasks',
    treatment: 'defer-v1plus',
    returnsIn: 'V1.2',
    rulings: [HIDE, 'D-178'],
    routes: ['/app/projects', '/app/plans', '/app/change-orders'],
    tables: [
      { name: 'projects', table: 'projects', businessColumn: 'business_id', softDeleteColumn: 'deleted_at' },
      { name: 'tasks', table: 'project_tasks', businessColumn: 'business_id', softDeleteColumn: 'deleted_at' },
      { name: 'plans', table: 'project_plans', businessColumn: 'business_id' },
      { name: 'deliverables', table: 'project_deliverables', businessColumn: 'business_id' },
      { name: 'templates', table: 'project_templates', businessColumn: 'business_id' },
    ],
    keyTools: [
      'projects_complete_task', 'projects_create_task', 'projects_delete_task', 'projects_get_budget', 'projects_get_timeline',
      'projects_list', 'projects_list_tasks', 'projects_update_task', 'fetch_project_status', 'draft_project_update',
    ],
    note: 'Change orders and milestones hang off a project (no business column), so a business with them has projects.',
  },
  {
    key: 'performance',
    label: 'Team performance',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/performance'],
    tables: [
      {
        name: 'snapshots',
        table: 'staff_performance_snapshots',
        businessColumn: 'business_id',
        note: 'Taken by POST /staff-performance/businesses/:id/snapshot (the page) and performance_take_snapshot; the page trends them.',
      },
    ],
    keyTools: ['performance_scorecard', 'performance_take_snapshot', 'performance_team_summary', 'performance_trend'],
    note: 'Live scores are derived from tasks and time; the saved snapshots are the history the trend shows (review UCS-COR-2).',
  },
  {
    key: 'operations',
    label: 'Operations hubs',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/operations', '/app/operations-flow'],
    tables: [],
    keyTools: [],
    note: 'Dashboards over other modules.',
  },
  {
    key: 'contracts',
    label: 'Contracts',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/contracts'],
    tables: [{ name: 'contracts', table: 'contracts', businessColumn: 'business_id' }],
    keyTools: [
      'contracts_acknowledge_alert', 'contracts_create', 'contracts_delete', 'contracts_get', 'contracts_list', 'contracts_stats',
      'contracts_update', 'contract_create_tag', 'contract_extract_clauses', 'contract_extract_terms', 'contract_list_tags',
    ],
  },
  {
    key: 'legal',
    label: 'Legal checklist',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/legal'],
    tables: [],
    keyTools: [],
    note:
      'Read-out of the blueprint and the risk register. The genesis document pack it generates is document_instances rows, ' +
      'which v1 still lists in Settings > Business profile (Documents: GET /documents/businesses/:id/instances, /app/documents ' +
      'redirecting to /app/profile?tab=outputs) and opens at /app/documents/<id>; onboarding links them too. Hiding /app/legal ' +
      'therefore makes none of them look gone, so they are deliberately not counted (review UCS-COR-2).',
  },
  {
    key: 'evidence',
    label: 'Evidence (Compliance Pack)',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/evidence'],
    tables: [
      {
        name: 'evidence',
        table: 'evidence',
        businessColumn: 'business_id',
        note:
          'Only EvidenceService.submit writes here. KEY chat\'s cortex write (KeyCortexEvidenceService.createEvidence, ' +
          'processConsciously step 11) names columns this table does not have and fails, so no row is auto-created (review UCS-COR-3).',
      },
    ],
    keyTools: ['evidence_list', 'evidence_submit', 'evidence_verify'],
  },
  {
    key: 'governance',
    label: 'Governance and risks',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/governance-flow'],
    tables: [{ name: 'risks', table: 'business_risks', businessColumn: 'business_id' }],
    keyTools: ['governance_get_risk', 'governance_list_risks', 'governance_log_risk', 'governance_risk_summary', 'governance_update_risk'],
  },
  {
    key: 'market',
    label: 'Market strategy',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/market'],
    tables: [
      { name: 'strategies', table: 'market_strategies', businessColumn: 'business_id' },
      { name: 'competitors', table: 'competitors', businessColumn: 'business_id' },
    ],
    keyTools: [],
  },
  {
    key: 'goals',
    label: 'Goals',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/goals'],
    tables: [
      {
        name: 'ai_goals',
        table: 'ai_goals',
        businessColumn: 'business_id',
        note:
          'What /app/goals lists and the goals_* KEY tools write: KeyCortexPlannerService behind /api/v1/cortex/goals ' +
          '(also trigger rules and goal intents in KEY chat, which the page shows too). Review UCS-COR-1.',
      },
      {
        name: 'business_goals',
        table: 'business_goals',
        businessColumn: 'business_id',
        note: 'The older store: POST /ai/businesses/:id/goals (no web page calls it).',
      },
    ],
    keyTools: ['goals_create', 'goals_create_plan', 'goals_delete', 'goals_get', 'goals_list'],
  },
  {
    key: 'intelligence',
    label: 'Intelligence',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/intelligence'],
    tables: [],
    keyTools: [],
    note: 'Read-outs over other modules; its four sub-routes fold into Today.',
  },
  {
    key: 'procurement',
    label: 'Procurement and purchase orders',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/procurement'],
    tables: [
      { name: 'requests', table: 'procurement_requests', businessColumn: 'business_id' },
      { name: 'purchase_orders', table: 'purchase_orders', businessColumn: 'business_id' },
    ],
    keyTools: [
      'procurement_acknowledge_vendor', 'procurement_create_request', 'procurement_get_request', 'procurement_get_stats',
      'procurement_issue_po', 'procurement_list_requests', 'procurement_list_suppliers', 'procurement_mark_fulfilled',
      'procurement_mark_invoiced', 'procurement_select_vendor', 'procurement_submit_for_review', 'procurement_update_request',
      'inventory_advance_purchase_order', 'inventory_create_purchase_order', 'inventory_list_purchase_orders',
    ],
    note: 'Also the Purchase Orders tab of inventory (W11-WEB-INVENTORY-REFUSALS reads this module).',
  },
  {
    key: 'suppliers',
    label: 'Suppliers',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/procurement/suppliers'],
    tables: [{ name: 'connections', table: 'supplier_connections', businessColumn: 'business_id' }],
    keyTools: [
      'suppliers_create_product_from_supplier', 'suppliers_get_connection', 'suppliers_get_cost_profile', 'suppliers_get_margins',
      'suppliers_list_connections', 'suppliers_list_products',
    ],
  },
  {
    key: 'assets',
    label: 'Assets library',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/assets'],
    tables: [{ name: 'assets', table: 'assets', businessColumn: 'business_id' }],
    keyTools: ['assets_delete', 'assets_get', 'assets_list', 'assets_list_folders', 'assets_tag', 'assets_untag', 'assets_update'],
  },
  {
    key: 'portal',
    label: 'Client portal',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/portal'],
    tables: [{ name: 'grants', table: 'portal_access', businessColumn: 'business_id' }],
    keyTools: ['portal_grant_access', 'portal_list_access', 'portal_revoke_access', 'portal_update_settings'],
  },
  {
    key: 'capture',
    label: 'Capture',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/capture'],
    tables: [{ name: 'captures', table: 'visual_intakes', businessColumn: 'business_id' }],
    keyTools: [],
  },
  {
    key: 'data_inbox',
    label: 'Data inbox',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/data-inbox'],
    tables: [{ name: 'items', table: 'ingestion_items', businessColumn: 'business_id' }],
    keyTools: [],
  },
  // ---------------------------------------------------------------- Marketing
  {
    key: 'marketing',
    label: 'Campaigns and email marketing',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/marketing', '/app/communicate'],
    tables: [
      { name: 'email_campaigns', table: 'email_campaigns', businessColumn: 'business_id', softDeleteColumn: 'deleted_at' },
      { name: 'lists', table: 'contact_lists', businessColumn: 'business_id' },
      { name: 'campaign_plans', table: 'marketing_campaign_plans', businessColumn: 'business_id' },
    ],
    keyTools: [
      'marketing_create_campaign', 'marketing_list_campaigns', 'marketing_send_campaign', 'marketing_update_campaign',
      'draft_campaign_bundle', 'queue_campaign', 'comms_send_broadcast',
    ],
  },
  {
    key: 'content',
    label: 'Content operations',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/content-ops'],
    tables: [{ name: 'requests', table: 'content_requests', businessColumn: 'business_id' }],
    keyTools: [
      'content_assign_request', 'content_create_request', 'content_deliver_request', 'content_get_request', 'content_list_requests',
      'content_submit_for_review', 'content_transition_status', 'content_upload_deliverables',
    ],
  },
  {
    key: 'social',
    label: 'Social',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/social'],
    tables: [
      { name: 'posts', table: 'social_posts', businessColumn: 'business_id', softDeleteColumn: 'deleted_at' },
      { name: 'connections', table: 'social_connections', businessColumn: 'business_id' },
    ],
    keyTools: ['social_create_post', 'social_get_analytics', 'social_list_posts', 'social_publish_post', 'social_update_post'],
  },
  {
    key: 'community',
    label: 'Community, Learn, Marketplace and Keystore',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/community', '/app/learn', '/app/marketplace'],
    tables: [
      { name: 'posts', table: 'community_posts', businessColumn: 'business_id', softDeleteColumn: 'deleted_at' },
      { name: 'opportunities', table: 'community_opportunities', businessColumn: 'poster_business_id', softDeleteColumn: 'deleted_at' },
      { name: 'referrals_sent', table: 'community_referrals', businessColumn: 'from_business_id' },
      { name: 'keystore_orders', table: 'keystore_service_orders', businessColumn: 'business_id' },
    ],
    keyTools: ['community_list_posts'],
    note: 'Already dormant in production. /app/marketplace here is the dormant warehouses page, not the store listing.',
  },
  // ---------------------------------------------------------------- Inboxes
  {
    key: 'whatsapp',
    label: 'WhatsApp Cloud inbox and setup',
    treatment: 'defer-v1plus',
    returnsIn: 'V1.1',
    rulings: [HIDE, 'D-153'],
    routes: ['/app/whatsapp'],
    tables: [
      {
        name: 'config',
        table: 'businesses',
        businessColumn: 'id',
        where: "jsonb_typeof(t.\"meta_data\" -> 'whatsapp') = 'object'",
        whereColumns: ['meta_data'],
        note:
          'The Twilio or Meta setup WhatsAppNotificationsListener sends booking and invoice messages with. meta_data holds ' +
          'its credentials (and other settings): the count tests the key\'s presence in a WHERE and projects no value; a ' +
          'database role without SELECT on meta_data gets this entry under `unreadable` (review SEC-V61-2).',
      },
      { name: 'messages', table: 'whatsapp_messages', businessColumn: 'business_id' },
      { name: 'contacts', table: 'whatsapp_contacts', businessColumn: 'business_id' },
    ],
    keyTools: [],
    note: 'A business with the setup keeps the listener working and sees /app/whatsapp read-only (the audit).',
  },
  {
    key: 'key_inbox',
    label: 'KEY inbox',
    treatment: 'defer-v1plus',
    returnsIn: 'V1.1',
    rulings: [HIDE, 'D-153'],
    routes: ['/app/key-inbox'],
    tables: [{ name: 'threads', table: 'key_inbox_threads', businessColumn: 'business_id' }],
    keyTools: ['inbox_brief', 'inbox_list_threads', 'inbox_mark_resolved', 'inbox_read_thread', 'inbox_reply_thread', 'inbox_update_thread_status'],
  },
  // ---------------------------------------------------------------- Automation and KEY extras
  {
    key: 'automations',
    label: 'Flows and automations',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/flows', '/app/automations', '/app/workflows'],
    tables: [
      { name: 'automations', table: 'automations', businessColumn: 'business_id', softDeleteColumn: 'deleted_at' },
      { name: 'flows', table: 'automation_flows', businessColumn: 'business_id', softDeleteColumn: 'deleted_at' },
      {
        name: 'enabled_autopilot_loops',
        table: 'delegation_loops',
        businessColumn: 'business_id',
        where: 't."enabled" = true',
        whereColumns: ['enabled'],
        note: 'Opening Automations creates every loop, disabled, for the business; only an enabled one is use.',
      },
    ],
    keyTools: [
      'automations_create_playbook', 'automations_list_playbooks', 'automations_toggle_playbook', 'enable_flow_with_approval',
      'delegation_booking_prep', 'delegation_lead_reactivation', 'delegation_payment_recovery', 'delegation_post_purchase',
      'delegation_weekly_hygiene',
    ],
  },
  {
    key: 'key_flows',
    label: 'KEY flows (role signals)',
    treatment: 'defer-v1plus',
    rulings: [HIDE, 'D-163'],
    routes: ['/app/key-flows'],
    tables: [],
    keyTools: [],
    note: 'Signals the schedulers produce; no records the business made.',
  },
  {
    key: 'flow_hubs',
    label: 'People, temporal and marketing flow hubs',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/people-flow', '/app/temporal-flow', '/app/marketing-flow'],
    tables: [],
    keyTools: [],
    note: 'Their numbers duplicate the hubs (BUG-079); no records of their own.',
  },
  {
    key: 'key_voice',
    label: 'KEY voice',
    treatment: 'defer-v1plus',
    returnsIn: 'V1.4',
    rulings: [HIDE],
    routes: ['/app/key/voice-sessions', '/app/key/voice-settings'],
    tables: [{ name: 'sessions', table: 'voice_sessions', businessColumn: 'business_id' }],
    keyTools: [],
  },
  {
    key: 'key_extras',
    label: 'KEY Worker, modes and code execution',
    treatment: 'defer-v1plus',
    rulings: [HIDE],
    routes: ['/app/key-modes'],
    pages: ['/app/key'],
    tables: [],
    keyTools: ['execute_custom_logic'],
    note: '/app/key (the Worker page) only; /app/key/chat is v1.',
  },
] as const satisfies readonly V1HiddenModule[];

export type V1HiddenModuleKey = (typeof V1_HIDDEN_MODULES)[number]['key'];

export const V1_HIDDEN_MODULE_KEYS: readonly V1HiddenModuleKey[] = V1_HIDDEN_MODULES.map((m) => m.key);

/** The hidden module with this key, or undefined. */
export function v1HiddenModule(key: string): V1HiddenModule | undefined {
  return (V1_HIDDEN_MODULES as readonly V1HiddenModule[]).find((m) => m.key === key);
}

/**
 * The hidden module a web path belongs to, or undefined for a v1 path. A route
 * covers its sub-routes and the longest matching route wins
 * (`/app/procurement/suppliers` is `suppliers`, `/app/procurement/x` is
 * `procurement`); a page matches only itself.
 */
export function v1HiddenModuleForPath(path: string): V1HiddenModule | undefined {
  const clean = path.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  let best: { module: V1HiddenModule; length: number } | undefined;
  for (const module of V1_HIDDEN_MODULES as readonly V1HiddenModule[]) {
    for (const page of module.pages ?? []) {
      if (clean === page && (!best || page.length > best.length)) best = { module, length: page.length };
    }
    for (const route of module.routes) {
      if ((clean === route || clean.startsWith(`${route}/`)) && (!best || route.length > best.length)) best = { module, length: route.length };
    }
  }
  return best?.module;
}
