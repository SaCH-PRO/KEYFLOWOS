/**
 * USAGE-COUNT-SCRIPT (V1-61): the read-only count, per live business, of the
 * rows in every module v1 hides (owner ruling D-152), and the one hidden-module
 * list it reads (packages/shared/src/v1-modules.ts). REAL database
 * (DATABASE_URL), no provider traffic.
 *
 * The owner runs apps/server/scripts/v1-module-usage-count.ts against
 * production (D-148) before NAV-B-HIDE starts, so the hide never makes a
 * business's records look gone. #80 is an issue of a PUBLIC repository and a
 * production business id resolves to the business's name through the public
 * routes (review SEC-V61-1), so only the default output, module-level counts
 * with no business id, is posted there; `--per-business` (the ids) stays with
 * the owner. These cases pin what that run may and may not do:
 *
 *   V61-01  the list: unique keys; every table and column it names exists in
 *           the migrated database; every column a count reads is an id, a
 *           soft-delete marker or a status flag, except businesses.meta_data
 *           (it holds the WhatsApp credentials), which only whatsapp.config
 *           reads, in a WHERE testing a key's presence (review SEC-V61-2);
 *           every route is a page of apps/web; every KEY tool is a registered
 *           FLOW tool, in one module only, and every FLOW tool is in a hidden
 *           module or in the reviewed v1 set below (review SEC-V61-3); every
 *           route NAV-B-HIDE / NAV-B-HIDE-2 name resolves to a module; it is
 *           exported from @keyflow/shared.
 *   V61-02  exact counts: two live tenants with rows in three modules
 *           (projects, payroll, WhatsApp setup) plus contracts and autopilot
 *           loops; a soft-deleted business, a soft-deleted project, a
 *           disabled loop, an unsaved website draft and an empty business are
 *           not counted. The D-144 payroll facet counts DRAFT and APPROVED runs.
 *   V61-03  read only: the run's transaction is READ ONLY (REPEATABLE READ),
 *           an UPDATE or INSERT inside it is refused by Postgres and changes
 *           nothing, and a run writes no row.
 *   V61-04  no PII: every SELECT projects only a business id and a count; the
 *           JSON carries no seeded name, email, title, amount or credential;
 *           and a database role granted SELECT on only the columns the list
 *           names (no name, email, phone or amount column) runs the count to
 *           the same answer, while the same role is refused a name column;
 *           businesses.meta_data is the one grant that is not a flag, and a
 *           role without it still runs, reporting whatsapp.config as
 *           `unreadable`. No outbound request is made.
 *   V61-05  a table the database does not have (production on an older
 *           schema) is reported absent, not a failure.
 *   V61-06  the documented commands: `pnpm usage:v1-modules` from apps/server
 *           with DATABASE_URL only (the aggregate), and the production image
 *           shape (the script and the list mounted alone, no tsconfig.json,
 *           @keyflow/db through node_modules; `--per-business`), each print
 *           the JSON and exit 0.
 *   V61-07  rows the hidden modules' own pages and KEY tools write, through
 *           the HTTP routes with the real guards: a goal created through POST
 *           /api/v1/cortex/goals (what /app/goals lists; review UCS-COR-1) and
 *           a snapshot taken through POST /staff-performance/.../snapshot
 *           (what /app/performance trends; review UCS-COR-2) put the business
 *           on the module's list; KEY chat's cortex evidence write cannot land
 *           in `evidence` (review UCS-COR-3's premise).
 *   V61-08  what may be posted to #80: the default output carries no business
 *           id and the same counts as `--per-business`, which says it is the
 *           owner's alone; the runbook and the script header say so.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeAll, afterAll, vi, onTestFinished } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v61a_';

const SERVER_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SERVER_DIR, '..', '..');
const WEB_APP_DIR = path.join(REPO_ROOT, 'apps', 'web', 'src', 'app');
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const CLI_TIMEOUT_MS = 120_000;

const ID = {
  owner: `${P}owner`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  /** Soft-deleted: rows in every seeded module, none counted. */
  bizGone: `${P}bizGone`,
  /** Live, no rows in any hidden module: on no module's list. */
  bizNone: `${P}bizNone`,
  /**
   * V61-07: rows written through the HTTP routes (a goal, a performance
   * snapshot over a seeded org assignment). Not in OUR_BUSINESSES: V61-02 to
   * V61-06 do not see it.
   */
  bizHttp: `${P}bizHttp`,
  membershipHttp: `${P}m_owner_bizHttp`,
  orgUnitHttp: `${P}unitHttp`,
  jobRoleHttp: `${P}roleHttp`,
  assignmentHttp: `${P}asgHttp`,
};
const OUR_BUSINESSES = [ID.bizA, ID.bizB, ID.bizGone, ID.bizNone];
/** The identity header V61-07's test app reads (seeded v61a_ users only). */
const HEADER = 'x-v61a-user';

/**
 * Every FLOW tool that is NOT in a hidden module's `keyTools`, reviewed one by
 * one against the audit's v1 hubs (review SEC-V61-3). A FLOW tool in neither
 * fails V61-01, so a new tool, or one acting in a hidden module, is classified
 * before KEY-TOOL-ALLOWLIST / KEY-TOOL-DOMAIN-HIDE read the list.
 */
const V1_KEY_TOOLS = new Set([
  // Today: approvals, obligations and the read-outs behind its blocks.
  'approval_create_request', 'approval_decide_step', 'approval_list', 'command_create_item', 'command_discharge_obligation', 'command_list_due_obligations',
  'fetch_business_summary', 'fetch_client_health', 'fetch_expense_pressure', 'fetch_revenue_risk', 'fetch_schedule_health',
  'fetch_storefront_quality',
  // Customers: contacts, notes and tasks on them, follow-ups, segments, tags, messages to a contact.
  'crm_add_note', 'crm_add_task', 'crm_create_contact', 'crm_create_reminder', 'crm_delete_contact', 'crm_find_duplicates', 'crm_list_contacts',
  'crm_merge_execute', 'crm_merge_preview', 'crm_recommend_follow_ups', 'crm_search_contacts', 'crm_update_contact', 'create_followup_queue', 'create_task',
  'draft_followup_message', 'keyflow_create_note', 'segment_contacts', 'send_message_with_approval', 'tag_contact',
  'update_status_with_confirmation',
  // Sales: quotes, invoices, products, store orders and listings, stock (warehouses stay a tab of a v1 hub).
  'commerce_convert_quote', 'commerce_create_invoice', 'commerce_create_product', 'commerce_create_quote', 'commerce_delete_invoice',
  'commerce_list_invoices', 'commerce_mark_invoice_paid', 'commerce_send_invoice', 'commerce_summarize_revenue', 'commerce_update_invoice', 'commerce_update_product',
  'draft_payment_reminder', 'marketplace_list_listings', 'marketplace_list_orders', 'store_list_products', 'store_list_recent_orders',
  'inventory_adjust_stock', 'inventory_list_movements', 'inventory_list_stock', 'inventory_list_warehouses', 'inventory_low_stock_alerts',
  'inventory_summary', 'inventory_transfer_stock',
  // Schedule: bookings and the calendar.
  'bookings_cancel_booking', 'bookings_create_booking', 'bookings_list_bookings', 'bookings_list_services', 'bookings_mark_no_show',
  'bookings_reschedule_booking', 'calendar_check_conflicts', 'calendar_create_event', 'calendar_list_events',
  // Money: expenses, Books, Getting paid, reconciliation, reports.
  'expenses_create', 'expenses_list',
  'finance_auto_match_bank', 'finance_balance_sheet', 'finance_cashflow', 'finance_cashflow_forecast', 'finance_create_bill', 'finance_create_coa_account',
  'finance_create_invoice_reminder_draft', 'finance_customer_balance', 'finance_expense_breakdown', 'finance_list_action_items', 'finance_list_bank_accounts', 'finance_list_bills',
  'finance_list_coa', 'finance_list_overdue_invoices', 'finance_money_moves', 'finance_pay_bill', 'finance_post_journal_entry', 'finance_profit_and_loss', 'finance_revenue_breakdown',
  'finance_safe_to_spend', 'finance_tax_summary', 'finance_view_payables', 'finance_view_receivables',
  'payments_create_link', 'payments_list_gateways', 'payments_list_links', 'payments_list_transactions', 'payments_refund_charge',
  'payments_revoke_link', 'payments_search_transactions',
  'reconcile_connect_statement_source', 'reconcile_list_statement_sources', 'reconcile_list_unmatched', 'reconcile_match_line',
  'reconcile_run_auto_match', 'reconcile_sweep_statements', 'reports_generate',
  // Your page.
  'apply_storefront_recommendation', 'draft_storefront_copy',
  // Settings: the team, the business profile and its documents, onboarding.
  'people_assign_task', 'people_list', 'people_recommend_assignee', 'people_workload', 'update_business_blueprint', 'documents_list',
  'documents_search', 'present_onboarding_card', 'save_onboarding_step',
]);

/** Canaries: seeded into names, emails, titles, amounts and credentials; never in the report. */
const CANARY = {
  bizAName: 'v61a Canary Bakery',
  bizBName: 'v61a Canary Salon',
  ownerEmail: `${P}owner@test.local`,
  projectName: 'v61a Canary Kitchen Refit',
  taskTitle: 'v61a Canary Tile Order',
  contractTitle: 'v61a Canary Lease',
  payrollGross: '98765.43',
  waFrom: '+18685550161',
  // Built from fragments at run time: a credential-shaped literal never sits in the source.
  waSid: ['v61a', 'sid', 'canary', '7f3e'].join('-'),
  waToken: ['v61a', 'tok', 'canary', '91c2'].join('-'),
  goalTitle: 'v61a Canary Grow repeat customers',
};

/** Every column the V61-04 role may be granted. */
const ALLOWED_GRANT = new Set([
  'business_id', 'poster_business_id', 'from_business_id', 'id', 'deleted_at', 'status', 'connector_type', 'enabled', 'is_active',
  'revoked_at', 'unpublished_at', 'version', 'meta_data', 'migration_name', 'finished_at', 'rolled_back_at',
]);

let db: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM project_tasks WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM projects WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payroll_runs WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contracts WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM delegation_loops WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM site_page_drafts WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_goals WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM staff_performance_snapshots WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM evidence WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM org_assignments WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM job_roles WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM org_units WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

async function seed() {
  await db.user.create({ data: { id: ID.owner, email: CANARY.ownerEmail, name: 'v61a Canary Owner' } });
  const whatsapp = { provider: 'twilio', accountSid: CANARY.waSid, authToken: CANARY.waToken, fromNumber: CANARY.waFrom };
  await db.business.create({ data: { id: ID.bizA, name: CANARY.bizAName, ownerId: ID.owner, slug: `${P}bakery`, email: CANARY.ownerEmail, metaData: { whatsapp } } });
  await db.business.create({ data: { id: ID.bizB, name: CANARY.bizBName, ownerId: ID.owner, slug: `${P}salon`, metaData: { other: 'x' } } });
  await db.business.create({ data: { id: ID.bizGone, name: 'v61a Canary Closed', ownerId: ID.owner, slug: `${P}closed`, metaData: { whatsapp }, deletedAt: new Date() } });
  await db.business.create({ data: { id: ID.bizNone, name: 'v61a Canary Empty', ownerId: ID.owner, slug: `${P}empty` } });

  // Projects: A has one live project with three live tasks (and a soft-deleted
  // project and task); B one live project; the closed business two.
  const project = (id: string, businessId: string, deletedAt: Date | null = null) =>
    db.project.create({ data: { id, businessId, name: CANARY.projectName, budgetAmount: 1234.5, deletedAt } });
  await project(`${P}projA1`, ID.bizA);
  await project(`${P}projA2`, ID.bizA, new Date());
  await project(`${P}projB1`, ID.bizB);
  await project(`${P}projGone1`, ID.bizGone);
  await project(`${P}projGone2`, ID.bizGone);
  for (const [i, deletedAt] of [[1, null], [2, null], [3, null], [4, new Date()]] as const) {
    await db.projectTask.create({ data: { id: `${P}taskA${i}`, projectId: `${P}projA1`, businessId: ID.bizA, title: CANARY.taskTitle, deletedAt } });
  }

  // Payroll (D-144): A has DRAFT, APPROVED and PAID runs; B one PAID run.
  const run = (id: string, businessId: string, status: string) =>
    db.payrollRun.create({
      data: { id, businessId, status, periodStart: new Date('2026-10-01'), periodEnd: new Date('2026-10-31'), totalGross: CANARY.payrollGross, currency: 'TTD' },
    });
  await run(`${P}runA1`, ID.bizA, 'DRAFT');
  await run(`${P}runA2`, ID.bizA, 'APPROVED');
  await run(`${P}runA3`, ID.bizA, 'PAID');
  await run(`${P}runB1`, ID.bizB, 'PAID');
  await run(`${P}runGone1`, ID.bizGone, 'DRAFT');

  // Contracts: B only (and the closed business).
  for (const [id, businessId] of [[`${P}conB1`, ID.bizB], [`${P}conB2`, ID.bizB], [`${P}conGone1`, ID.bizGone]]) {
    await db.contract.create({ data: { id, businessId, title: CANARY.contractTitle, contractValue: 5555.55 } });
  }

  // Autopilot loops: opening Automations creates them all disabled; only A enabled one.
  await db.delegationLoop.create({ data: { id: `${P}loopA`, businessId: ID.bizA, loopType: `${P}loop`, name: 'v61a loop', enabled: true } });
  await db.delegationLoop.create({ data: { id: `${P}loopB`, businessId: ID.bizB, loopType: `${P}loop`, name: 'v61a loop', enabled: false } });

  // Website builder: B opened it (the version-1 draft every business gets) but never saved.
  await db.sitePageDraft.create({ data: { id: `${P}draftB`, businessId: ID.bizB, payload: { title: CANARY.bizBName }, version: 1 } });
}

type Report = {
  report: string;
  formatVersion: number;
  /** 'aggregate' (the default, posted to #80) or 'per-business' (`--per-business`, the owner's only). */
  scope: string;
  notice: string;
  generatedAt: string;
  transaction: { readOnly: boolean; isolation: string };
  schema: { latestMigration: string | null; appliedMigrations: number | null };
  liveBusinesses: number;
  summary: Record<string, number | null>;
  modules: Array<{
    key: string;
    label: string;
    measured: boolean;
    businessCount: number;
    /** Aggregate only: live businesses with each facet above zero. */
    facetBusinessCounts?: Record<string, number>;
    /** Per-business only. */
    businesses: Array<{ businessId: string; rows: Record<string, number>; facets?: Record<string, number> }>;
    absent: string[];
    /** Entries the database role may not read (a column without SELECT). */
    unreadable: string[];
  }>;
};

/** The flag the per-business run takes; the default run prints the aggregate. */
const PER_BUSINESS = '--per-business';

async function script() {
  return import('../scripts/v1-module-usage-count');
}

async function hidden() {
  return import('../../../packages/shared/src/v1-modules');
}

/** Runs main(argv) in process with `deps`; its exit status, its JSON and its stderr. */
async function runMain(argv: string[] = [], deps: Record<string, unknown> = {}): Promise<{ code: number; out: string; err: string; report?: Report }> {
  const mod = await script();
  const out: string[] = [];
  const err: string[] = [];
  const code = await mod.main(argv, { db, out: (s: string) => out.push(s), error: (...a: unknown[]) => err.push(a.map(String).join(' ')), ...deps });
  const text = out.join('');
  let report: Report | undefined;
  try { report = JSON.parse(text); } catch { report = undefined; }
  return { code, out: text, err: err.join('\n'), report };
}

/** Our businesses' entries of a module: businessId -> { rows, facets }. */
function ours(report: Report, key: string, ids: string[] = OUR_BUSINESSES): Record<string, { rows: Record<string, number>; facets?: Record<string, number> }> {
  const module = report.modules.find((m) => m.key === key);
  expect(module, `module ${key} in the report`).toBeTruthy();
  expect(Array.isArray(module!.businesses), `module ${key} carries businesses (a --per-business report)`).toBe(true);
  const out: Record<string, { rows: Record<string, number>; facets?: Record<string, number> }> = {};
  for (const b of module!.businesses) {
    if (ids.includes(b.businessId)) out[b.businessId] = { rows: b.rows, ...(b.facets ? { facets: b.facets } : {}) };
  }
  return out;
}

/** A db whose $transaction records every statement the script sends. */
function recordingDb(statements: string[], before?: (tx: any) => Promise<void>) {
  return {
    $transaction: (fn: (tx: any) => Promise<unknown>, options?: unknown) =>
      db.$transaction(async (tx: any) => {
        if (before) await before(tx);
        const proxy = {
          $queryRawUnsafe: (sql: string, ...values: unknown[]) => { statements.push(sql); return tx.$queryRawUnsafe(sql, ...values); },
          $executeRawUnsafe: (sql: string, ...values: unknown[]) => { statements.push(sql); return tx.$executeRawUnsafe(sql, ...values); },
        };
        return fn(proxy);
      }, options),
  };
}

/** The Postgres error code an error carries, wherever the client put it. */
function pgCode(err: unknown): string {
  const e = err as { code?: unknown; meta?: { code?: unknown }; cause?: { code?: unknown; originalCode?: unknown } } | null;
  const text = `${String((err as Error)?.message ?? '')} ${JSON.stringify(e?.meta ?? {})}`;
  if (/read-only transaction|25006/.test(text)) return '25006';
  if (/permission denied|42501/.test(text)) return '42501';
  return String(e?.cause?.originalCode ?? e?.meta?.code ?? e?.code ?? text);
}

beforeAll(async () => {
  expect(DATABASE_URL, 'DATABASE_URL must name the test database').not.toBe('');
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  await cleanup();
  await seed();
});

afterAll(async () => {
  await cleanup();
});

// ---------------------------------------------------------------------------
describe('V61-01 the hidden-module list (packages/shared/src/v1-modules.ts)', () => {
  /** The only columns a count may read: ids, soft-delete markers, status flags (and the WhatsApp key test). */
  const ALLOWED_READ_COLUMNS = new Set([
    'business_id', 'poster_business_id', 'from_business_id', 'id', 'deleted_at',
    'status', 'connector_type', 'enabled', 'is_active', 'revoked_at', 'unpublished_at', 'version', 'meta_data',
  ]);

  it('keys and count names are unique, snake_case, and every identifier is a plain SQL name', async () => {
    const { V1_HIDDEN_MODULES, V1_HIDDEN_MODULE_KEYS } = await hidden();
    const keys = V1_HIDDEN_MODULES.map((m: any) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...V1_HIDDEN_MODULE_KEYS]).toEqual(keys);
    for (const m of V1_HIDDEN_MODULES as any[]) {
      expect(m.key).toMatch(/^[a-z][a-z0-9_]*$/);
      const names = [...m.tables, ...(m.facets ?? [])].map((t: any) => t.name);
      expect(new Set(names).size, `${m.key}: count names unique`).toBe(names.length);
      for (const t of [...m.tables, ...(m.facets ?? [])]) {
        for (const ident of [t.table, t.businessColumn, t.softDeleteColumn, ...(t.whereColumns ?? [])].filter(Boolean)) {
          expect(ident, `${m.key}.${t.name}`).toMatch(/^[a-z_][a-z0-9_]*$/);
        }
        // A filter reads only the columns it declares (quoted as t."<col>"), so the grant in V61-04 is exact.
        for (const used of (t.where ?? '').matchAll(/t\."([a-z_][a-z0-9_]*)"/g)) {
          expect(t.whereColumns ?? [], `${m.key}.${t.name}: where reads ${used[1]}`).toContain(used[1]);
        }
        expect(t.where ?? '', `${m.key}.${t.name}: no statement separator or comment in a filter`).not.toMatch(/;|--|\/\*/);
      }
    }
    // The modules the packet scope names, and the keys NAV-B-LEGACY-SERVER answers with.
    for (const key of ['projects', 'payroll', 'contracts', 'marketing', 'procurement', 'events', 'whatsapp', 'webhooks', 'api_keys',
      'time_tracking', 'assets', 'portal', 'automations', 'budgets', 'waitlist', 'advanced_crm', 'presence_pages']) {
      expect(keys, key).toContain(key);
    }
  });

  it('every table and column the list names exists in the migrated database', async () => {
    const { V1_HIDDEN_MODULES } = await hidden();
    const rows: Array<{ table_name: string; column_name: string }> = await db.$queryRawUnsafe(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()`,
    );
    const have = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
    const missing: string[] = [];
    for (const m of V1_HIDDEN_MODULES as any[]) {
      for (const t of [...m.tables, ...(m.facets ?? [])]) {
        for (const col of [t.businessColumn, t.softDeleteColumn, ...(t.whereColumns ?? [])].filter(Boolean)) {
          if (!have.has(`${t.table}.${col}`)) missing.push(`${m.key}.${t.name}: ${t.table}.${col}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('every column a count reads is an id, a soft-delete marker or a status flag, except businesses.meta_data (credentials-bearing), which only whatsapp.config reads, in a WHERE testing a key\'s presence', async () => {
    const { V1_HIDDEN_MODULES } = await hidden();
    const read: string[] = [];
    for (const m of V1_HIDDEN_MODULES as any[]) {
      for (const t of [...m.tables, ...(m.facets ?? [])]) {
        for (const col of [t.businessColumn, t.softDeleteColumn, ...(t.whereColumns ?? [])].filter(Boolean)) {
          if (!ALLOWED_READ_COLUMNS.has(col)) read.push(`${m.key}.${t.name}: ${t.table}.${col}`);
        }
      }
    }
    expect(read).toEqual([]);
    // businesses.meta_data is NOT a flag: it is the JSON bag that holds the WhatsApp provider
    // credentials and sender number (review SEC-V61-2). Only the WhatsApp setup count reads it, in a
    // WHERE that tests the key's presence and extracts no value (the projection is pinned in V61-04).
    const metaReaders = (V1_HIDDEN_MODULES as any[]).flatMap((m) => [...m.tables, ...(m.facets ?? [])].filter((t: any) => (t.whereColumns ?? []).includes('meta_data')).map((t: any) => ({ at: `${m.key}.${t.name}`, table: t.table, where: t.where })));
    expect(metaReaders).toEqual([{ at: 'whatsapp.config', table: 'businesses', where: "jsonb_typeof(t.\"meta_data\" -> 'whatsapp') = 'object'" }]);
    // The list says so where an operator reads it.
    const config = (V1_HIDDEN_MODULES as any[]).find((m) => m.key === 'whatsapp').tables.find((t: any) => t.name === 'config');
    expect(config.note).toMatch(/credential/i);
  });

  it('every route and page is a page of apps/web, and no route belongs to two modules', async () => {
    const { V1_HIDDEN_MODULES } = await hidden();
    const seen = new Map<string, string>();
    const problems: string[] = [];
    for (const m of V1_HIDDEN_MODULES as any[]) {
      for (const route of [...m.routes, ...(m.pages ?? [])]) {
        const dir = path.join(WEB_APP_DIR, ...route.split('/').filter(Boolean));
        if (!existsSync(dir) || !statSync(dir).isDirectory()) problems.push(`${m.key}: ${route} has no apps/web/src/app directory`);
        if (seen.has(route)) problems.push(`${route} in ${seen.get(route)} and ${m.key}`);
        seen.set(route, m.key);
      }
    }
    expect(problems).toEqual([]);
  });

  it('every KEY tool is a registered FLOW tool and belongs to one module only', async () => {
    const { V1_HIDDEN_MODULES } = await hidden();
    const { FLOW_TOOLS } = await import('../src/modules/ai/flow-tool-registry');
    const registered = new Set(FLOW_TOOLS.map((t: { name: string }) => t.name));
    const owner = new Map<string, string>();
    const problems: string[] = [];
    for (const m of V1_HIDDEN_MODULES as any[]) {
      for (const tool of m.keyTools) {
        if (!registered.has(tool)) problems.push(`${m.key}: ${tool} is not in FLOW_TOOLS`);
        if (owner.has(tool)) problems.push(`${tool} in ${owner.get(tool)} and ${m.key}`);
        owner.set(tool, m.key);
      }
    }
    expect(problems).toEqual([]);
    // The removals KEY-TOOL-ALLOWLIST lands now are classified here.
    expect(owner.get('execute_custom_logic')).toBe('key_extras');
    for (const tool of ['payroll_generate_run', 'payroll_approve_run', 'payroll_mark_paid']) expect(owner.get(tool)).toBe('payroll');
  });

  it('every FLOW tool is classified: in one hidden module, or in the reviewed v1 set (review SEC-V61-3)', async () => {
    const { V1_HIDDEN_MODULES } = await hidden();
    const { FLOW_TOOLS } = await import('../src/modules/ai/flow-tool-registry');
    const registered = new Set<string>(FLOW_TOOLS.map((t: { name: string }) => t.name));
    const owner = new Map<string, string>();
    for (const m of V1_HIDDEN_MODULES as any[]) for (const tool of m.keyTools) owner.set(tool, m.key);
    // A tool in neither is unclassified: KEY-TOOL-DOMAIN-HIDE, which takes its families only from the
    // list, would keep offering and dispatching it whatever module it acts in.
    expect([...registered].filter((t) => !owner.has(t) && !V1_KEY_TOOLS.has(t)).sort(), 'unclassified FLOW tools').toEqual([]);
    expect([...V1_KEY_TOOLS].filter((t) => owner.has(t)).sort(), 'in a hidden module and in the v1 set').toEqual([]);
    expect([...V1_KEY_TOOLS].filter((t) => !registered.has(t)).sort(), 'v1 set names a tool FLOW_TOOLS does not have').toEqual([]);
    // The three the review found: Google Drive writes (a key-connect tile v1 defers) and the org chart (Structure).
    expect(owner.get('drive_create_folder')).toBe('connectors');
    expect(owner.get('drive_create_document')).toBe('connectors');
    expect(owner.get('people_org_chart')).toBe('structure');
  });

  it('every route NAV-B-HIDE and NAV-B-HIDE-2 gate resolves to a module; v1 routes resolve to none', async () => {
    const { v1HiddenModuleForPath } = await hidden();
    // The audit-derived route lists of the plan's NAV-B-HIDE (part 1) and NAV-B-HIDE-2 (part 2).
    const part1 = ['/app/sales-team', '/app/call-tasks', '/app/retainers', '/app/crm/intelligence', '/app/crm/network', '/app/crm/sequences',
      '/app/helpdesk', '/app/inbox', '/app/events', '/app/time-tracking', '/app/budgeting', '/app/accounting', '/app/payroll',
      '/app/continental-ops', '/app/presence/pages', '/app/seo', '/app/settings/insights', '/app/settings/conversion', '/app/structure',
      '/app/finance/fixed-assets', '/app/finance/accounting-periods', '/app/finance/recurring-journals', '/app/finance/exchange-rates', '/me/refer'];
    const part2 = ['/app/marketing', '/app/communicate', '/app/content-ops', '/app/social', '/app/marketing-flow', '/app/whatsapp', '/app/key-inbox',
      '/app/projects', '/app/plans', '/app/change-orders', '/app/performance', '/app/operations-flow', '/app/operations', '/app/contracts',
      '/app/legal', '/app/evidence', '/app/governance-flow', '/app/market', '/app/goals', '/app/intelligence', '/app/procurement', '/app/assets',
      '/app/portal', '/app/capture', '/app/data-inbox', '/app/flows', '/app/automations', '/app/key-flows', '/app/workflows', '/app/people-flow',
      '/app/temporal-flow', '/app/key-modes', '/app/key/voice-sessions', '/app/key/voice-settings', '/app/key',
      // dormant already, hidden by the same list
      '/app/community', '/app/learn', '/app/marketplace', '/app/settings/developers', '/app/settings/webhooks', '/app/crm/deals', '/app/crm/accounts'];
    const unresolved = [...part1, ...part2].filter((p) => !v1HiddenModuleForPath(p));
    expect(unresolved).toEqual([]);
    expect(v1HiddenModuleForPath('/app/payroll')?.key).toBe('payroll');
    expect(v1HiddenModuleForPath('/app/projects/abc/tasks')?.key).toBe('projects');
    expect(v1HiddenModuleForPath('/app/procurement/suppliers')?.key).toBe('suppliers');
    expect(v1HiddenModuleForPath('/app/procurement/req_1')?.key).toBe('procurement');
    expect(v1HiddenModuleForPath('/app/key')?.key).toBe('key_extras');
    expect(v1HiddenModuleForPath('/app/key/voice-sessions?x=1')?.key).toBe('key_voice');
    for (const v1 of ['/app/key/chat', '/app/crm/contacts', '/app/crm', '/app/commerce', '/app/command-center', '/app/bookings', '/app/money',
      '/app/store', '/app/presence', '/app/settings', '/app/settings/team', '/app/key-connect', '/app/expenses', '/app/finance', '/app/projectsx']) {
      expect(v1HiddenModuleForPath(v1)?.key, v1).toBeUndefined();
    }
  });

  it('@keyflow/shared exports the list (packages/shared/src/index.ts)', async () => {
    const shared = await import('../../../packages/shared/src/index');
    const { V1_HIDDEN_MODULES } = await hidden();
    expect((shared as any).V1_HIDDEN_MODULES).toBe(V1_HIDDEN_MODULES);
    expect(typeof (shared as any).v1HiddenModuleForPath).toBe('function');
    expect(typeof (shared as any).v1HiddenModule).toBe('function');
    expect((shared as any).v1HiddenModule('payroll')?.label).toBe('Payroll');
  });
});

// ---------------------------------------------------------------------------
describe('V61-02 exact counts per live business', () => {
  it('two tenants with rows in projects, payroll and the WhatsApp setup (plus contracts and loops) are counted exactly; the closed and the empty business are not', async () => {
    const { code, out, err, report } = await runMain([PER_BUSINESS]);
    expect(code, `${err}\n${out}`).toBe(0);
    expect(report?.report).toBe('v1-module-usage-count');
    expect(report?.formatVersion).toBe(2);
    expect(report?.scope).toBe('per-business');
    const r = report!;
    expect(r.liveBusinesses).toBeGreaterThanOrEqual(3);

    expect(ours(r, 'projects')).toEqual({
      [ID.bizA]: { rows: { projects: 1, tasks: 3, plans: 0, deliverables: 0, templates: 0 } },
      [ID.bizB]: { rows: { projects: 1, tasks: 0, plans: 0, deliverables: 0, templates: 0 } },
    });
    expect(ours(r, 'payroll')).toEqual({
      [ID.bizA]: { rows: { payroll_runs: 3, pay_rates: 0 }, facets: { runs_reserving_safe_to_spend: 2 } },
      [ID.bizB]: { rows: { payroll_runs: 1, pay_rates: 0 }, facets: { runs_reserving_safe_to_spend: 0 } },
    });
    expect(ours(r, 'whatsapp')).toEqual({ [ID.bizA]: { rows: { config: 1, messages: 0, contacts: 0 } } });
    expect(ours(r, 'contracts')).toEqual({ [ID.bizB]: { rows: { contracts: 2 } } });
    expect(ours(r, 'automations')).toEqual({ [ID.bizA]: { rows: { automations: 0, flows: 0, enabled_autopilot_loops: 1 } } });
    expect(ours(r, 'presence_pages')).toEqual({});

    // No other module lists any of our businesses, and the closed and empty ones are on no list.
    for (const m of r.modules) {
      const listed = m.businesses.map((b) => b.businessId).filter((id) => OUR_BUSINESSES.includes(id));
      expect(listed, m.key).not.toContain(ID.bizGone);
      expect(listed, m.key).not.toContain(ID.bizNone);
      if (!['projects', 'payroll', 'whatsapp', 'contracts', 'automations'].includes(m.key)) expect(listed, m.key).toEqual([]);
      expect(m.absent, `${m.key}: every table exists in this database`).toEqual([]);
      expect(m.unreadable, `${m.key}: the full role reads every column`).toEqual([]);
      expect(m.businessCount).toBe(m.businesses.length);
      expect(r.summary[m.key]).toBe(m.measured ? m.businessCount : null);
    }

    // Every module of the list is in the report, in list order; a module with no tables is unmeasured.
    const { V1_HIDDEN_MODULES } = await hidden();
    expect(r.modules.map((m) => m.key)).toEqual(V1_HIDDEN_MODULES.map((m: any) => m.key));
    expect(r.modules.find((m) => m.key === 'intelligence')).toMatchObject({ measured: false, businessCount: 0, businesses: [] });
    // Business ids sorted, so two runs diff cleanly.
    for (const m of r.modules) {
      const ids = m.businesses.map((b) => b.businessId);
      expect(ids).toEqual([...ids].sort());
    }
    expect(r.schema.latestMigration).toMatch(/^\d{14}_|^0_baseline$/);
    expect(r.schema.appliedMigrations).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
describe('V61-03 the transaction is read only', () => {
  it('the run reports a READ ONLY, REPEATABLE READ transaction, and its first statement sets it', async () => {
    const statements: string[] = [];
    const { code, report, err } = await runMain([], { db: recordingDb(statements) });
    expect(code, err).toBe(0);
    expect(report?.transaction).toEqual({ readOnly: true, isolation: 'repeatable read' });
    expect(statements[0]).toMatch(/^SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY$/);
  });

  it('an UPDATE or INSERT attempted inside the transaction is refused by Postgres (25006) and changes nothing', async () => {
    const { runReadOnly } = await script();
    const before = await db.$queryRawUnsafe(`SELECT name, updated_at FROM businesses WHERE id = $1`, ID.bizA);
    let updateErr: unknown;
    try {
      await runReadOnly(db, (tx: any) => tx.$executeRawUnsafe(`UPDATE businesses SET name = 'v61a written' WHERE id = $1`, ID.bizA));
    } catch (e) { updateErr = e; }
    expect(updateErr, 'the UPDATE must be refused').toBeTruthy();
    expect(pgCode(updateErr)).toBe('25006');

    let insertErr: unknown;
    try {
      await runReadOnly(db, (tx: any) => tx.$executeRawUnsafe(
        `INSERT INTO contracts (id, business_id, title, status, created_at, updated_at) VALUES ($1, $2, 'v61a written', 'DRAFT', now(), now())`,
        `${P}conWritten`, ID.bizA,
      ));
    } catch (e) { insertErr = e; }
    expect(insertErr, 'the INSERT must be refused').toBeTruthy();
    expect(pgCode(insertErr)).toBe('25006');

    expect(await db.$queryRawUnsafe(`SELECT name, updated_at FROM businesses WHERE id = $1`, ID.bizA)).toEqual(before);
    expect(await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM contracts WHERE id = $1`, `${P}conWritten`)).toEqual([{ n: 0 }]);
  });

  it('a run writes no row: the seeded rows, the loops and the website draft are as before', async () => {
    const snapshot = () => db.$queryRawUnsafe(
      `SELECT 'b' AS k, id, updated_at::text AS v FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}
       UNION ALL SELECT 'l', id, updated_at::text FROM delegation_loops WHERE business_id LIKE ${sqlLikePrefix(P)}
       UNION ALL SELECT 'd', id, version::text FROM site_page_drafts WHERE business_id LIKE ${sqlLikePrefix(P)}
       UNION ALL SELECT 'r', id, updated_at::text FROM payroll_runs WHERE business_id LIKE ${sqlLikePrefix(P)}
       ORDER BY 1, 2`,
    );
    const before = await snapshot();
    const { code } = await runMain();
    expect(code).toBe(0);
    expect(await snapshot()).toEqual(before);
  });

  it('refuses to count when the transaction is not read only (the self-check)', async () => {
    const { main } = await script();
    const errors: string[] = [];
    const out: string[] = [];
    // A transaction whose SET TRANSACTION is swallowed: the self-check must catch it.
    const lying = {
      $transaction: (fn: (tx: any) => Promise<unknown>, options?: unknown) =>
        db.$transaction((tx: any) => fn({
          $queryRawUnsafe: (sql: string, ...v: unknown[]) => tx.$queryRawUnsafe(sql, ...v),
          $executeRawUnsafe: (sql: string, ...v: unknown[]) => (/^SET TRANSACTION/.test(sql) ? Promise.resolve(0) : tx.$executeRawUnsafe(sql, ...v)),
        }), options),
    };
    const code = await main([], { db: lying, out: (s: string) => out.push(s), error: (...a: unknown[]) => errors.push(a.map(String).join(' ')) });
    expect(code).toBe(1);
    expect(out.join('')).toBe('');
    expect(errors.join('\n')).toMatch(/not read only/i);
  });
});

// ---------------------------------------------------------------------------
describe('V61-04 no PII column is selected, and nothing leaves the process', () => {
  it('every SELECT projects only a business id and a count (or schema metadata), and no statement writes', async () => {
    const statements: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { code, err } = await runMain([PER_BUSINESS], { db: recordingDb(statements) });
    expect(code, err).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();

    expect(statements.length).toBeGreaterThan(10);
    const problems: string[] = [];
    for (const sql of statements) {
      const flat = sql.replace(/\s+/g, ' ').trim();
      if (/\b(insert|update|delete|merge|alter|create|drop|truncate|grant|revoke|copy|call|do|lock|vacuum|refresh|comment|nextval|setval)\b/i.test(flat.replace(/'[^']*'/g, "''"))) {
        problems.push(`writes or changes something: ${flat}`);
        continue;
      }
      if (/^SET (TRANSACTION|LOCAL)\b/.test(flat)) continue;
      const projection = /^SELECT (.+?)(?: FROM .*)?$/i.exec(flat)?.[1];
      if (!projection) { problems.push(`not a SELECT: ${flat}`); continue; }
      const allowed = [
        /^t\."[a-z_]+" AS business_id, count\(\*\)::int AS n$/, // a count
        /^count\(\*\)::int AS n$/, // live businesses, applied migrations
        /^current_setting\('transaction_read_only'\) AS read_only, current_setting\('transaction_isolation'\) AS isolation$/,
        // pg_catalog: names of columns and whether this role may read them, not their data
        /^c\.relname AS table_name, a\.attname AS column_name, has_column_privilege\(c\.oid, a\.attnum, 'SELECT'\) AS readable$/,
        /^migration_name AS latest$/, // _prisma_migrations: the schema level, no business data
      ];
      if (!allowed.some((re) => re.test(projection))) problems.push(`projects something else: ${projection}`);
    }
    expect(problems).toEqual([]);
  });

  it('the JSON carries business ids and counts only: no seeded name, email, title, amount or credential', async () => {
    for (const argv of [[], [PER_BUSINESS]]) {
      const { code, out } = await runMain(argv);
      expect(code, argv.join(' ')).toBe(0);
      for (const [what, value] of Object.entries(CANARY)) expect(out, `${what} leaked (${argv.join(' ')})`).not.toContain(value);
      for (const fragment of ['Canary', '@test.local', '98765', '1234.5', '5555', 'twilio', '+1868']) expect(out).not.toContain(fragment);
      if (DATABASE_URL) expect(out).not.toContain(DATABASE_URL);
    }
  });

  it('a role granted SELECT on only the columns the list names gets the same answer; the same role is refused a name column', async () => {
    const { V1_HIDDEN_MODULES } = await hidden();
    const role = `${P}reader${randomBytes(4).toString('hex')}`;
    const grants = new Map<string, Set<string>>([
      ['businesses', new Set(['id', 'deleted_at'])],
      ['_prisma_migrations', new Set(['migration_name', 'finished_at', 'rolled_back_at'])],
    ]);
    for (const m of V1_HIDDEN_MODULES as any[]) {
      for (const t of [...m.tables, ...(m.facets ?? [])]) {
        const cols = grants.get(t.table) ?? new Set<string>();
        for (const c of [t.businessColumn, t.softDeleteColumn, ...(t.whereColumns ?? [])].filter(Boolean)) cols.add(c);
        grants.set(t.table, cols);
      }
    }
    await db.$executeRawUnsafe(`CREATE ROLE "${role}" NOLOGIN`);
    onTestFinished(async () => {
      try { await db.$executeRawUnsafe(`DROP OWNED BY "${role}"`); } catch { /* best-effort */ }
      try { await db.$executeRawUnsafe(`DROP ROLE IF EXISTS "${role}"`); } catch { /* best-effort */ }
    });
    await db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    for (const [table, cols] of grants) {
      await db.$executeRawUnsafe(`GRANT SELECT (${[...cols].map((c) => `"${c}"`).join(', ')}) ON "${table}" TO "${role}"`);
    }
    // Not a vacuous grant: no name, email or amount column was given.
    for (const [table, cols] of grants) for (const c of cols) expect(ALLOWED_GRANT.has(c), `${table}.${c}`).toBe(true);
    // ...and exactly one column that is not an id, a soft-delete marker or a status flag:
    // businesses.meta_data, which holds the WhatsApp credentials (review SEC-V61-2). A role granted it
    // can read them, so the runbook's role recipe names it.
    const flags = new Set([...ALLOWED_GRANT].filter((c) => c !== 'meta_data'));
    const notFlags = [...grants].flatMap(([table, cols]) => [...cols].filter((c) => !flags.has(c)).map((c) => `${table}.${c}`));
    expect(notFlags).toEqual(['businesses.meta_data']);

    const asRole = recordingDb([], (tx) => tx.$executeRawUnsafe(`SET LOCAL ROLE "${role}"`));
    const restricted = await runMain([PER_BUSINESS], { db: asRole });
    expect(restricted.code, restricted.err).toBe(0);
    const full = await runMain([PER_BUSINESS]);
    for (const key of ['projects', 'payroll', 'whatsapp', 'contracts', 'automations']) {
      expect(ours(restricted.report!, key), key).toEqual(ours(full.report!, key));
    }
    for (const m of restricted.report!.modules) expect(m.absent, m.key).toEqual([]);

    // The negative control: the same role cannot read a business's name.
    let refused: unknown;
    try {
      await db.$transaction(async (tx: any) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE "${role}"`);
        await tx.$queryRawUnsafe(`SELECT name FROM businesses WHERE id = $1`, ID.bizA);
      });
    } catch (e) { refused = e; }
    expect(refused, 'the reader role must not read businesses.name').toBeTruthy();
    expect(pgCode(refused)).toBe('42501');
  });

  it('a role granted the same columns WITHOUT businesses.meta_data (no credential read) still runs: whatsapp.config is reported unreadable, everything else is counted as before', async () => {
    const { V1_HIDDEN_MODULES } = await hidden();
    const role = `${P}nometa${randomBytes(4).toString('hex')}`;
    const grants = new Map<string, Set<string>>([
      ['businesses', new Set(['id', 'deleted_at'])],
      ['_prisma_migrations', new Set(['migration_name', 'finished_at', 'rolled_back_at'])],
    ]);
    for (const m of V1_HIDDEN_MODULES as any[]) {
      for (const t of [...m.tables, ...(m.facets ?? [])]) {
        const cols = grants.get(t.table) ?? new Set<string>();
        for (const c of [t.businessColumn, t.softDeleteColumn, ...(t.whereColumns ?? [])].filter(Boolean)) if (c !== 'meta_data') cols.add(c);
        grants.set(t.table, cols);
      }
    }
    await db.$executeRawUnsafe(`CREATE ROLE "${role}" NOLOGIN`);
    onTestFinished(async () => {
      try { await db.$executeRawUnsafe(`DROP OWNED BY "${role}"`); } catch { /* best-effort */ }
      try { await db.$executeRawUnsafe(`DROP ROLE IF EXISTS "${role}"`); } catch { /* best-effort */ }
    });
    await db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    for (const [table, cols] of grants) {
      await db.$executeRawUnsafe(`GRANT SELECT (${[...cols].map((c) => `"${c}"`).join(', ')}) ON "${table}" TO "${role}"`);
    }
    // The role cannot read the credentials.
    let refused: unknown;
    try {
      await db.$transaction(async (tx: any) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE "${role}"`);
        await tx.$queryRawUnsafe(`SELECT meta_data FROM businesses WHERE id = $1`, ID.bizA);
      });
    } catch (e) { refused = e; }
    expect(pgCode(refused)).toBe('42501');

    const restricted = await runMain([PER_BUSINESS], { db: recordingDb([], (tx) => tx.$executeRawUnsafe(`SET LOCAL ROLE "${role}"`)) });
    expect(restricted.code, restricted.err).toBe(0);
    const full = await runMain([PER_BUSINESS]);
    const whatsapp = restricted.report!.modules.find((m) => m.key === 'whatsapp')!;
    expect(whatsapp.unreadable).toEqual(['config: businesses.meta_data']);
    expect(whatsapp.absent).toEqual([]);
    // A, listed for its setup alone, is not listed when the setup cannot be read: the owner reads `unreadable`.
    expect(ours(restricted.report!, 'whatsapp')).toEqual({});
    for (const m of restricted.report!.modules) {
      if (m.key === 'whatsapp') continue;
      expect(m.unreadable, m.key).toEqual([]);
      expect(ours(restricted.report!, m.key), m.key).toEqual(ours(full.report!, m.key));
    }
    expect(restricted.err).toMatch(/1 count\(s\) unreadable/);
  });
});

// ---------------------------------------------------------------------------
describe('V61-05 an older schema', () => {
  it('a table this database does not have is reported absent, and the rest is still counted', async () => {
    const { runReadOnly, countModuleUsage } = await script();
    const { V1_HIDDEN_MODULES } = await hidden();
    const projects = (V1_HIDDEN_MODULES as any[]).find((m) => m.key === 'projects');
    const modules = [
      projects,
      { key: 'later', label: 'A later module', treatment: 'defer-v1plus', rulings: [], routes: [], keyTools: [],
        tables: [{ name: 'rows', table: 'v61a_not_in_this_schema', businessColumn: 'business_id' }] },
      { key: 'later_column', label: 'A later column', treatment: 'defer-v1plus', rulings: [], routes: [], keyTools: [],
        tables: [{ name: 'rows', table: 'projects', businessColumn: 'business_id', whereColumns: ['v61a_flag'], where: 't."v61a_flag" = true' }] },
    ];
    const report = await runReadOnly(db, (tx: any) => countModuleUsage(tx, modules, new Date('2026-11-13T00:00:00Z')));
    expect(ours(report as Report, 'projects')[ID.bizA]).toEqual({ rows: { projects: 1, tasks: 3, plans: 0, deliverables: 0, templates: 0 } });
    expect((report as Report).modules.find((m) => m.key === 'later')).toMatchObject({ measured: true, businessCount: 0, absent: ['rows: v61a_not_in_this_schema'] });
    expect((report as Report).modules.find((m) => m.key === 'later_column')).toMatchObject({ businessCount: 0, absent: ['rows: projects.v61a_flag'] });
    expect((report as Report).generatedAt).toBe('2026-11-13T00:00:00.000Z');
  });

  it('refuses arguments it does not know (exit 2) without touching the database', async () => {
    const touched: string[] = [];
    for (const argv of [['--apply'], [PER_BUSINESS, '--apply'], ['--per-busines'], [PER_BUSINESS, PER_BUSINESS]]) {
      const { code, out, err } = await runMain(argv, { db: recordingDb(touched) });
      expect(code, argv.join(' ')).toBe(2);
      expect(out).toBe('');
      expect(err).toMatch(/Usage/);
    }
    expect(touched).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The CLI runs linger about 30 s after printing (the @keyflow/db pool's idle
// timeout), so the two share that wait.
describe.concurrent('V61-06 the documented commands', () => {
  const binPath = () => [path.join(SERVER_DIR, 'node_modules', '.bin'), path.join(REPO_ROOT, 'node_modules', '.bin'), process.env.PATH ?? ''].join(':');
  const operatorEnv = (): NodeJS.ProcessEnv => ({
    PATH: binPath(),
    HOME: process.env.HOME ?? tmpdir(),
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    DATABASE_URL,
  });
  const runCommand = (command: string, cwd: string): Promise<{ code: number | null; out: string; err: string }> =>
    new Promise((resolve, reject) => {
      const child = spawn('sh', ['-c', command], { cwd, env: operatorEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), CLI_TIMEOUT_MS - 5_000);
      child.stdout.setEncoding('utf8').on('data', (s: string) => (out += s));
      child.stderr.setEncoding('utf8').on('data', (s: string) => (err += s));
      child.once('error', reject);
      child.once('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    });
  const expectReport = (exp: typeof expect, run: { code: number | null; out: string; err: string }, scope: 'aggregate' | 'per-business') => {
    exp(run.code, `${run.out}\n${run.err}`).toBe(0);
    const report = JSON.parse(run.out) as Report;
    exp(report.report).toBe('v1-module-usage-count');
    exp(report.scope).toBe(scope);
    exp(report.transaction).toEqual({ readOnly: true, isolation: 'repeatable read' });
    if (scope === 'per-business') {
      exp(Object.keys(ours(report, 'projects')).sort()).toEqual([ID.bizA, ID.bizB]);
    } else {
      // The output posted to #80: the count, and no business id.
      exp(report.summary.projects).toBeGreaterThanOrEqual(2);
      for (const id of [ID.bizA, ID.bizB]) exp(run.out).not.toContain(id);
    }
    exp(`${run.out}\n${run.err}`).not.toMatch(/TypeError|Cannot read properties of undefined|\.env: not found/);
    if (DATABASE_URL) exp(`${run.out}\n${run.err}`).not.toContain(DATABASE_URL);
  };

  it('pnpm usage:v1-modules from apps/server (DATABASE_URL only) prints the aggregate JSON and exits 0', async ({ expect: exp }) => {
    const scripts = JSON.parse(readFileSync(path.join(SERVER_DIR, 'package.json'), 'utf8')).scripts as Record<string, string>;
    const command = scripts['usage:v1-modules'];
    exp(command, 'apps/server/package.json has a usage:v1-modules script').toBeTruthy();
    exp(command).toContain('scripts/v1-module-usage-count.ts');
    expectReport(exp, await runCommand(command, SERVER_DIR), 'aggregate');
  }, CLI_TIMEOUT_MS);

  it('the production image shape: the script and the list mounted alone, no tsconfig.json, @keyflow/db through node_modules (--per-business)', async ({ expect: exp }) => {
    const scratch = mkdtempSync(path.join(tmpdir(), 'v61-image-'));
    onTestFinished(() => rmSync(scratch, { recursive: true, force: true }));
    for (let dir = scratch; ; dir = path.dirname(dir)) {
      exp(existsSync(path.join(dir, 'tsconfig.json')), `${dir}/tsconfig.json would be applied by tsx`).toBe(false);
      if (dir === path.parse(dir).root) break;
    }
    // /app in the image: apps/server (package.json, node_modules, the mounted scripts/) and the mounted list.
    const app = path.join(scratch, 'apps', 'server');
    mkdirSync(path.join(app, 'scripts'), { recursive: true });
    mkdirSync(path.join(scratch, 'packages', 'shared', 'src'), { recursive: true });
    copyFileSync(path.join(SERVER_DIR, 'package.json'), path.join(app, 'package.json'));
    symlinkSync(path.join(SERVER_DIR, 'node_modules'), path.join(app, 'node_modules'), 'dir');
    symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(scratch, 'node_modules'), 'dir');
    copyFileSync(path.join(SERVER_DIR, 'scripts', 'v1-module-usage-count.ts'), path.join(app, 'scripts', 'v1-module-usage-count.ts'));
    copyFileSync(path.join(REPO_ROOT, 'packages', 'shared', 'src', 'v1-modules.ts'), path.join(scratch, 'packages', 'shared', 'src', 'v1-modules.ts'));
    expectReport(exp, await runCommand(`tsx scripts/v1-module-usage-count.ts ${PER_BUSINESS}`, app), 'per-business');
  }, CLI_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// V61-07: the rows a hidden module's own page and KEY tools write, written the
// way the page writes them: through the HTTP route, behind the real AuthGuard,
// BusinessGuard and ModuleScopeGuard, the production ValidationPipe and
// exception filter, PrismaService, KeyCortexPlannerService and
// StaffPerformanceService. Identity is a test middleware (HEADER, seeded v61a_
// users only), as AuthMiddleware attaches it after token verification.
describe('V61-07 rows the module pages and KEY tools write through the HTTP routes are counted', () => {
  let app: any;

  /** One business's entries of a module in a --per-business run. */
  const forBusiness = async (key: string) => {
    const run = await runMain([PER_BUSINESS]);
    expect(run.code, run.err).toBe(0);
    return { run, entries: ours(run.report!, key, [ID.bizHttp]) };
  };

  beforeAll(async () => {
    await db.business.create({ data: { id: ID.bizHttp, name: 'v61a Canary Studio', ownerId: ID.owner, slug: `${P}studio` } });
    await db.membership.create({ data: { id: ID.membershipHttp, userId: ID.owner, businessId: ID.bizHttp, role: 'OWNER' } });
    await db.orgUnit.create({ data: { id: ID.orgUnitHttp, businessId: ID.bizHttp, name: 'v61a Canary Floor' } });
    await db.jobRole.create({ data: { id: ID.jobRoleHttp, businessId: ID.bizHttp, name: 'v61a Canary Stylist' } });
    await db.orgAssignment.create({
      data: { id: ID.assignmentHttp, businessId: ID.bizHttp, orgUnitId: ID.orgUnitHttp, jobRoleId: ID.jobRoleHttp, membershipId: ID.membershipHttp, userId: ID.owner },
    });

    const { Test } = await import('@nestjs/testing');
    const { ValidationPipe } = await import('@nestjs/common');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const { AuthGuard } = await import('../src/core/auth/auth.guard');
    const { BusinessGuard } = await import('../src/core/auth/business.guard');
    const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
    const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
    const goals = await import('../src/modules/key-cortex/key-cortex-goals.controller');
    const { KeyCortexPlannerService } = await import('../src/modules/key-cortex/key-cortex-planner.service');
    const { KeyCortexTriggerService } = await import('../src/modules/key-cortex/key-cortex-trigger.service');
    const { StaffPerformanceController } = await import('../src/modules/staff-performance/staff-performance.controller');
    const { StaffPerformanceService } = await import('../src/modules/staff-performance/staff-performance.service');

    // Vitest's transform emits no design:paramtypes; these are the types tsc emits (as
    // key-cortex-tenant-binding.integration.test.ts writes them), so DI and the ValidationPipe see
    // what production sees.
    if (!Reflect.getMetadata('design:paramtypes', goals.KeyCortexGoalsController)) {
      Reflect.defineMetadata('design:paramtypes', [KeyCortexPlannerService, KeyCortexTriggerService, PrismaService], goals.KeyCortexGoalsController);
    }
    if (!Reflect.getMetadata('design:paramtypes', goals.KeyCortexGoalsController.prototype, 'createGoal')) {
      Reflect.defineMetadata('design:paramtypes', [goals.CreateGoalDto, String], goals.KeyCortexGoalsController.prototype, 'createGoal');
    }

    const ref = await Test.createTestingModule({
      controllers: [goals.KeyCortexGoalsController, StaffPerformanceController],
      providers: [
        PrismaService, AuthGuard, BusinessGuard, ModuleScopeGuard,
        // The planner's goal create and list touch only Prisma; its executor, saga and legacy planner are not reached.
        { provide: KeyCortexPlannerService, inject: [PrismaService], useFactory: (prisma: any) => new (KeyCortexPlannerService as any)(prisma, {}, {}, {}) },
        { provide: KeyCortexTriggerService, useValue: {} },
        { provide: StaffPerformanceService, inject: [PrismaService], useFactory: (prisma: any) => new (StaffPerformanceService as any)(prisma) },
      ],
    })
      .useMocker(() => ({}))
      .compile();
    app = ref.createNestApplication();
    app.use(async (req: any, _res: any, next: any) => {
      const header = req.headers[HEADER];
      if (typeof header === 'string' && header.startsWith(P)) {
        const user = await db.user.findUnique({ where: { id: header }, select: { id: true, email: true, role: true } });
        if (user) req.user = { id: user.id, email: user.email, role: user.role };
      }
      next();
    });
    app.useGlobalFilters(new GlobalHttpExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('UCS-COR-1: a goal created through POST /api/v1/cortex/goals (the store /app/goals and the goals_* KEY tools use) puts the business on the goals list', async () => {
    expect((await forBusiness('goals')).entries).toEqual({});

    const created = await request(app.getHttpServer())
      .post('/api/v1/cortex/goals')
      .set(HEADER, ID.owner)
      .send({ businessId: ID.bizHttp, title: CANARY.goalTitle });
    expect(created.status, created.text).toBe(201);
    // What /app/goals lists (GET /api/v1/cortex/goals?businessId=, app/goals/page.tsx).
    const listed = await request(app.getHttpServer()).get(`/api/v1/cortex/goals?businessId=${ID.bizHttp}`).set(HEADER, ID.owner);
    expect(listed.status, listed.text).toBe(200);
    expect(listed.body.map((g: any) => g.id)).toEqual([created.body.id]);

    const { run, entries } = await forBusiness('goals');
    expect(entries).toEqual({ [ID.bizHttp]: { rows: { ai_goals: 1, business_goals: 0 } } });
    expect(run.out).not.toContain(CANARY.goalTitle);
    // NAV-B-LEGACY-SERVER reads the same tables: v1HiddenModuleForPath('/app/goals') is this module.
    const { v1HiddenModuleForPath } = await hidden();
    expect(v1HiddenModuleForPath('/app/goals')?.tables.map((t) => t.table)).toContain('ai_goals');
  });

  it('UCS-COR-2: a snapshot taken through POST /staff-performance/businesses/:id/snapshot (what /app/performance trends) puts the business on the performance list', async () => {
    expect((await forBusiness('performance')).entries).toEqual({});

    const taken = await request(app.getHttpServer())
      .post(`/staff-performance/businesses/${ID.bizHttp}/snapshot`)
      .set(HEADER, ID.owner)
      .send({ assignmentId: ID.assignmentHttp, periodStart: '2026-10-01T00:00:00.000Z', periodEnd: '2026-11-01T00:00:00.000Z' });
    expect(taken.status, taken.text).toBe(201);
    // What /app/performance's trend reads (GET .../trend?assignmentId=).
    const trend = await request(app.getHttpServer())
      .get(`/staff-performance/businesses/${ID.bizHttp}/trend?assignmentId=${ID.assignmentHttp}`)
      .set(HEADER, ID.owner);
    expect(trend.status, trend.text).toBe(200);
    expect(JSON.stringify(trend.body)).toContain('2026-10-01');

    const { run, entries } = await forBusiness('performance');
    expect(entries).toEqual({ [ID.bizHttp]: { rows: { snapshots: 1 } } });
    const performance = run.report!.modules.find((m) => m.key === 'performance')!;
    expect(performance.measured).toBe(true);
    expect(run.report!.summary.performance).toBe(performance.businessCount);
  });

  it("UCS-COR-3 (the premise does not hold): KEY chat's cortex evidence write cannot land in `evidence`, so that count holds only rows EvidenceService.submit wrote", async () => {
    const { KeyCortexEvidenceService } = await import('../src/modules/key-cortex/key-cortex-evidence.service');
    // The step-11 write processConsciously makes through KeyCortexMetacognitionService.trackCapability.
    const cortex = new KeyCortexEvidenceService({ client: db } as any);
    await expect(cortex.createEvidence({
      businessId: ID.bizHttp,
      claim: 'Capability "conscious_response" executed with result: success',
      claimType: 'TASK_COMPLETED' as any,
      proof: { capability: 'conscious_response', result: 'success', businessId: ID.bizHttp },
      confidence: 1,
      source: 'metacognition',
      relatedModule: 'key_cortex',
    })).rejects.toThrow();
    expect(await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM evidence WHERE business_id = $1`, ID.bizHttp)).toEqual([{ n: 0 }]);
    // The table has none of the columns that write needs; if it ever gains them, the evidence
    // count must leave the cortex rows out (a fixed filter on the new source column).
    const columns: Array<{ column_name: string }> = await db.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'evidence'`,
    );
    const names = columns.map((c) => c.column_name);
    for (const cortexOnly of ['claim', 'claim_type', 'proof', 'source', 'related_module']) expect(names, cortexOnly).not.toContain(cortexOnly);
    expect((await forBusiness('evidence')).entries).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// V61-08 (review SEC-V61-1): #80 is an issue of a PUBLIC repository, and a
// production business id resolves to the business's name through the public
// routes (/site/storefront/public/<slug>, /bookings/public/businesses/:id/...).
// So the output the owner posts there carries module-level counts only; the
// ids stay in the `--per-business` file the owner keeps.
describe('V61-08 what is posted to #80 carries no business id', () => {
  it('the default output is the aggregate: no business id anywhere, and the same counts as the --per-business run', async () => {
    // Both runs read one REPEATABLE READ snapshot, so a business another suite creates between them
    // (the full suite runs files in parallel on this database) cannot change the counts compared below.
    const { agg, detail } = await db.$transaction(
      async (outer: any) => {
        await outer.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
        const tx = {
          $queryRawUnsafe: (sql: string, ...values: unknown[]) => outer.$queryRawUnsafe(sql, ...values),
          // The snapshot is already REPEATABLE READ and READ ONLY; a second SET TRANSACTION after a query is refused.
          $executeRawUnsafe: (sql: string, ...values: unknown[]) =>
            /^\s*SET TRANSACTION\b/i.test(sql) ? Promise.resolve(0) : outer.$executeRawUnsafe(sql, ...values),
        };
        const snapshot = { $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
        return { agg: await runMain([], { db: snapshot }), detail: await runMain([PER_BUSINESS], { db: snapshot }) };
      },
      { maxWait: 30_000, timeout: 120_000 },
    );
    expect(agg.code, agg.err).toBe(0);
    expect(detail.code, detail.err).toBe(0);
    const a = agg.report!;
    const d = detail.report!;
    expect(a.scope).toBe('aggregate');
    expect(a.formatVersion).toBe(2);
    expect(a.notice).toMatch(/no business id/i);

    const ids: Array<{ id: string }> = await db.$queryRawUnsafe(`SELECT id FROM businesses`);
    expect(ids.length).toBeGreaterThan(0);
    for (const { id } of ids) expect(agg.out, `business id ${id} in the aggregate`).not.toContain(id);
    expect(agg.out).not.toMatch(/"businessId"|"businesses"/);

    expect(a.liveBusinesses).toBe(d.liveBusinesses);
    expect(a.summary).toEqual(d.summary);
    expect(a.schema).toEqual(d.schema);
    expect(a.modules.map((m) => m.key)).toEqual(d.modules.map((m) => m.key));
    for (const m of a.modules) {
      const full = d.modules.find((x) => x.key === m.key)!;
      expect(Object.keys(m).sort(), m.key).toEqual(
        ['absent', 'businessCount', 'key', 'label', 'measured', 'returnsIn', 'treatment', 'unreadable', ...(m.facetBusinessCounts ? ['facetBusinessCounts'] : [])].sort(),
      );
      expect(m.businessCount, m.key).toBe(full.businessCount);
      expect(m.absent, m.key).toEqual(full.absent);
      expect(m.unreadable, m.key).toEqual(full.unreadable);
      // A facet is aggregated as the number of businesses with it above zero.
      const facetNames = [...new Set(full.businesses.flatMap((b) => Object.keys(b.facets ?? {})))];
      if (facetNames.length) {
        expect(m.facetBusinessCounts, m.key).toEqual(
          Object.fromEntries(facetNames.map((f) => [f, full.businesses.filter((b) => (b.facets?.[f] ?? 0) > 0).length])),
        );
      }
    }
    // The D-144 facet survives aggregation: A has DRAFT and APPROVED runs.
    expect(a.modules.find((m) => m.key === 'payroll')!.facetBusinessCounts!.runs_reserving_safe_to_spend).toBeGreaterThanOrEqual(1);
  });

  it('--per-business holds the ids and says it is the owner\'s alone, never posted to #80', async () => {
    const { code, report, err } = await runMain([PER_BUSINESS]);
    expect(code, err).toBe(0);
    expect(report!.scope).toBe('per-business');
    expect(report!.notice).toMatch(/business ids/i);
    expect(report!.notice).toMatch(/#80/);
    expect(report!.notice).toMatch(/public/i);
    expect(err).toMatch(/per-business/i);
  });

  it('the runbook and the script header post only the aggregate to #80 and keep --per-business private; the role recipe names meta_data', async () => {
    const doc = readFileSync(path.join(REPO_ROOT, 'docs', 'development', 'operator-data-cleanup-scripts.md'), 'utf8');
    const start = doc.indexOf('## 3.');
    const section = doc.slice(start, doc.indexOf('## Proof', start));
    expect(start).toBeGreaterThan(-1);
    expect(section).not.toMatch(/posted to #80 as it is/);
    expect(section).not.toMatch(/never a name, an email, a phone number, an amount or free text/);
    expect(section).toContain(PER_BUSINESS);
    expect(section).toMatch(/public repository/);
    expect(section).toMatch(/GRANT SELECT \([^)]*meta_data/);
    const script = readFileSync(path.join(SERVER_DIR, 'scripts', 'v1-module-usage-count.ts'), 'utf8');
    const header = script.slice(0, script.indexOf('*/'));
    expect(header).not.toMatch(/posts its JSON to #80/);
    expect(header).toContain(PER_BUSINESS);
    expect(header).toMatch(/public/);
  });
});
