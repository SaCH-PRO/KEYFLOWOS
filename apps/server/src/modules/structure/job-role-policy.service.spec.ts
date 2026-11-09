/**
 * JobRolePolicyService.envelopeForJobRole — the position-scoped KEY envelope
 * (V1-21b-JOBROLE-TOOL-FAMILIES, V1-21 review CR-V21-01, and the V1-21b review repairs
 * SEC-V21b-01..04 / CR-1).
 *
 * V1-21 holds JobRole.permissions to the canonical module vocabulary on every write
 * (create-job-role.dto.ts jobRolePermissionsProblem), but the envelope used to read that
 * column only in the KEY tool-family vocabulary (finance, sales, hr, ...), which overlaps
 * the canonical list on crm, bookings, projects and content alone. A role authored after
 * V1-21 as {revenue: 'write'} therefore granted KEY no commerce_* tool, {team: 'write'} no
 * structure_*, {expenses: 'write'} no expenses_*.
 *
 * The review of the first fix found that a grant was bounded by the STRONGEST key in the
 * map (one global maxRiskTier) rather than by the key that made it, so {crm: 'read',
 * team: 'admin'} let KEY delete contacts; that whole families were granted although some of
 * their tools back no route (payroll_set_rate); and that a read grant reached write tools
 * whose routes require write (assets_tag). These cases pin, per canonical module and level,
 * what is reached and what is not; that a grant on one key never widens another; the same
 * outcomes through the real AiOversightService.evaluate; the legacy tool-family keys that
 * rows written before V1-21 still carry; the level-to-tier ladder; and deny-by-default.
 * Which tools each module grants, and at which level, is derived from the HTTP route
 * decorators in job-role-tool-families.spec.ts.
 *
 * The second review (ESC-1..4, C1..C3) and a re-probe of its repair (ESC-5) are pinned at
 * the end, each next to the real ModuleScopeGuard / resolveCrmAccess answer for the same
 * scope map, with a property over some 2,800 maps: a governed tool KEY reaches is one HTTP
 * allows. Cases above that encoded the defects were corrected in place (crm_add_note at
 * crm:read, `Revenue: 'WRITE'`, legacy keys reaching governed tools, the C1/C2 tools in
 * the deny lists).
 *
 * The third review (IC-1, IC-2) is pinned last: a crm_view 'owned' position against the
 * real CrmService, and a staff position whose JobRole is gone, through the real
 * StaffChatBridgeService and the real RoleEngineService crews. The fourth (DRV-1, IC3-1) and
 * fifth (INP4-1: a soft-deleted or banned holder, through the real AuthMiddleware) follow, then
 * the sixth (INP5-1: an assignment naming a membership in another business or of another user,
 * through the real BusinessGuard and ModuleScopeGuard), then the seventh: the membership looked
 * up as the guard does (INP4-2), a position on a member's own phone (INP4-3), inbox_brief at the
 * level that forces a brief (DRV-BRIEF / DRV5-1) and commerce_send_invoice granted by no key
 * (DRV5-2). The seventh's client-forged envelope (ENV-FORGE / INP5-2 / DRV5-3) is pinned in
 * ai/flow-chat-envelope.spec.ts; every bridge harness here reads the envelope from chat()'s
 * server-only argument, never from the client-shaped pageContext. The eighth (DD8-1: tools that
 * find their row by a bare id, which on the bridge, with no tenant context, is any business's) is
 * pinned last, beside ai/call-tools-tenant.spec.ts; its forged webhook (FB-1) is pinned in
 * whatsapp/whatsapp-shared-webhook.spec.ts.
 */
import { describe, it, expect } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FLOW_TOOLS } from '../ai/flow-tool-registry';
import { AiOversightService, type AutonomySettingsReader } from '../ai/ai-oversight.service';
import { RoleEngineService, type BusinessRole } from '../ai/role-engine.service';
import { FlowOrchestratorService } from '../ai/flow-orchestrator.service';
import { DefaultTriggersService } from '../ai/default-triggers.service';
import { AuthMiddleware } from '../../core/auth/auth.middleware';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CANONICAL_MODULES, defaultScopesForRole, type CanonicalModule } from '../../core/authority/module-vocabulary';
import { ModuleScopeGuard, MODULE_SCOPE_KEY } from '../../core/auth/module-scope.guard';
import { resolveCrmAccess, visibilityClause } from '../crm/crm-permissions.helper';
import { CrmService } from '../crm/crm.service';
import { StaffChatBridgeService } from './staff-chat-bridge.service';
import { StructureService } from './structure.service';
import { jobRolePermissionsProblem } from './dto/create-job-role.dto';
import * as policyExports from './job-role-policy.service';
import { CANONICAL_MODULE_TOOLS, JobRolePolicyService, type JobRoleEnvelope } from './job-role-policy.service';

const policy = new JobRolePolicyService();

function envelope(permissions: unknown): JobRoleEnvelope {
  return policy.envelopeForJobRole({ id: 'jr_1', name: 'Position', permissions: permissions as any });
}

const allows = (env: JobRoleEnvelope, tool: string) => policy.isToolAllowed(env, tool);

/** Baseline reads every position keeps regardless of grants (unchanged). */
const BASELINE = ['fetch_*', 'calendar_check_conflicts', 'documents_list'];

const REGISTRY = FLOW_TOOLS.map((t) => t.name);
const TIER = new Map(FLOW_TOOLS.map((t) => [t.name, t.riskTier as number]));

/**
 * Both envelope checks AiOversightService.evaluate applies to a position holder
 * (ai-oversight.service.ts: isToolAllowed, then tier <= envelope.maxRiskTier).
 */
const passes = (env: JobRoleEnvelope, tool: string) => allows(env, tool) && TIER.get(tool)! <= env.maxRiskTier;

type Level = 'read' | 'write' | 'admin';
const LEVELS: Level[] = ['read', 'write', 'admin'];

/**
 * Per canonical module: tools reached from `read` up, tools reached from `write` up (and
 * NOT at read), tools reached only at `admin`, and tools reached at no level. Every name is
 * a real registry tool (asserted below), so a rename cannot turn a case into a vacuous pass.
 */
const CASES: Record<CanonicalModule, { read: string[]; write: string[]; admin: string[]; deny: string[] }> = {
  crm: {
    // crm_list_contacts / crm_search_contacts read what GET .../contacts (crm:read) lists (review 2 ESC-5).
    read: ['deals_list', 'deals_get', 'deals_forecast', 'call_list_tasks', 'crm_find_duplicates', 'crm_merge_preview', 'crm_list_contacts', 'crm_search_contacts'],
    // tier 1, but the routes require crm:write (SEC-V21b-03)
    // crm_add_note / crm_add_task: CrmService forwards to CrmTimelineService, whose routes need crm:write (review 2 ESC-1)
    write: ['crm_create_contact', 'call_generate_script', 'deals_create', 'deals_mark_won', 'crm_update_deal', 'call_log_outcome', 'crm_add_note', 'crm_add_task'],
    admin: ['crm_merge_execute', 'deals_delete'],
    // crm_update_contact / tag_contact / crm_delete_contact: their service bounds the row by
    // visibilityClause for every member but the OWNER, and KEY passes no actor (review 4 DRV-1)
    deny: ['commerce_create_invoice', 'structure_list_job_roles', 'payments_refund_charge', 'sequence_enroll', 'crm_update_contact', 'tag_contact', 'crm_delete_contact'],
  },
  revenue: {
    // commerce_list_invoices reads what GET .../invoices (revenue:read) lists (review 2 C2)
    read: [
      'payments_list_links', 'payments_list_transactions', 'payments_list_gateways', 'payments_search_transactions', 'commerce_list_invoices',
      // the money report routes require revenue:read (owner ruling D-57, V1-81 FOLLOW3-A7 item 9)
      'finance_profit_and_loss', 'finance_cashflow', 'finance_balance_sheet', 'finance_tax_summary', 'finance_revenue_breakdown', 'reports_generate',
    ],
    // commerce_mark_invoice_paid: PATCH invoices/:id/paid needs revenue:write; the Stripe
    // webhook that also calls it is not a member route (review 2 C1)
    write: ['commerce_create_invoice', 'commerce_create_quote', 'commerce_convert_quote', 'commerce_update_invoice', 'payments_create_link', 'payments_revoke_link', 'commerce_mark_invoice_paid'],
    admin: ['commerce_delete_invoice', 'payments_refund_charge'],
    deny: [
      // mails the customer through a call no member route makes for a customer: GOVERNED_UNGRANTED (review 7 DRV5-2)
      'commerce_send_invoice',
      // reached unscoped (catalog.controller)
      'commerce_create_product',
      'finance_post_journal_entry',
      // GET reports/expense-by carries no revenue and declares no scope (V1-81 D-57)
      'finance_expense_breakdown',
      'crm_create_contact',
      'expenses_create',
      'structure_get_org_tree',
    ],
  },
  bookings: {
    // calendar_create_event is what the `bookings` scope governs over HTTP; bookings_* and
    // calendar_* are the legacy `bookings` key's own grant (the key is in both vocabularies).
    read: ['calendar_list_events', 'bookings_list_bookings'],
    write: ['calendar_create_event', 'bookings_create_booking'],
    admin: ['bookings_cancel_booking'],
    deny: ['commerce_create_invoice', 'crm_create_contact', 'projects_create_task'],
  },
  projects: {
    // No `projects` scope is declared on any route; the legacy key's grant is kept.
    read: ['projects_list', 'projects_list_tasks'],
    write: ['projects_create_task', 'time_log_entry'],
    admin: ['projects_delete_task'],
    deny: ['commerce_create_invoice', 'calendar_create_event', 'structure_get_org_tree'],
  },
  content: {
    // assets_get calls AssetService.getAsset through the assetWithinBusiness helper (review 2 C2)
    read: ['assets_list', 'assets_list_folders', 'content_list_requests', 'assets_get'],
    // assets_tag / assets_untag are tier 1, but POST .../tag and .../untag need content:write
    write: ['assets_tag', 'assets_untag', 'assets_update', 'content_create_request'],
    admin: ['assets_delete'],
    // content_deliver_request finds its request by a bare id, which on the staff bridge is any
    // business's (TENANT_UNBOUND_TOOLS, review 8 DD8-1)
    deny: ['social_publish_post', 'marketing_send_campaign', 'commerce_create_invoice', 'content_deliver_request'],
  },
  expenses: {
    // expenses_list reads what GET .../expenses (expenses:read) lists (review 2 C2)
    read: ['finance_list_bills', 'finance_view_payables', 'expenses_list'],
    write: ['expenses_create', 'finance_create_bill'],
    admin: ['finance_pay_bill'],
    deny: [
      'finance_post_journal_entry',
      'finance_profit_and_loss',
      'finance_create_coa_account',
      'finance_auto_match_bank',
      'commerce_create_invoice',
    ],
  },
  automations: {
    read: [],
    write: [],
    admin: [],
    deny: ['automations_create_playbook', 'automations_toggle_playbook', 'enable_flow_with_approval', 'commerce_create_invoice'],
  },
  storefront: {
    read: [],
    write: [],
    admin: [],
    deny: ['commerce_create_product', 'apply_storefront_recommendation', 'store_list_products', 'crm_create_contact'],
  },
  settings: {
    read: [],
    write: [],
    admin: [],
    deny: ['update_business_blueprint', 'commerce_create_invoice', 'structure_get_org_tree'],
  },
  ai: {
    read: [],
    write: [],
    admin: [],
    deny: ['goals_create', 'execute_custom_logic', 'commerce_create_invoice'],
  },
  team: {
    read: ['structure_get_org_tree', 'structure_list_job_roles', 'structure_list_assignments', 'structure_get_stats'],
    write: [],
    admin: ['structure_create_delegation_rule', 'structure_update_delegation_rule'],
    deny: ['structure_find_person', 'people_assign_task', 'payroll_approve_run', 'payroll_list_rates', 'commerce_create_invoice', 'crm_create_contact'],
  },
  analytics: {
    read: [],
    write: [],
    admin: [],
    deny: ['reports_generate', 'finance_profit_and_loss', 'commerce_create_invoice'],
  },
  operations: {
    read: [
      'contracts_list', 'contracts_get', 'contract_list_tags', 'inbox_list_threads', 'inbox_read_thread', 'payroll_list_rates', 'payroll_get_run', 'performance_scorecard',
      // D-40 (R0-13g): the command-centre item and procurement routes require operations
      'command_list_due_obligations', 'procurement_list_requests', 'procurement_get_request', 'procurement_list_suppliers', 'procurement_get_stats',
    ],
    // contracts_acknowledge_alert / inbox_mark_resolved are tier 1, but their routes need operations:write
    // inbox_brief: GET brief generates only on a cache miss; POST brief/generate needs write (review 7 DRV-BRIEF)
    write: [
      'contracts_acknowledge_alert', 'inbox_mark_resolved', 'contracts_create', 'contract_create_tag', 'inbox_update_thread_status', 'performance_take_snapshot', 'inbox_brief',
      'command_discharge_obligation', 'procurement_create_request', 'procurement_update_request', 'procurement_submit_for_review', 'procurement_select_vendor',
      // FOLLOW3-D15: ProcurementService writes the request where { id, businessId }, so the three vendor
      // transitions rejoin operations at their route level (GOVERNED_UNGRANTED from R0-13g until then)
      'procurement_acknowledge_vendor', 'procurement_mark_fulfilled', 'procurement_mark_invoiced',
    ],
    // procurement_issue_po: its route needs operations:write, its tier (3) needs admin (C3 ladder)
    admin: ['contracts_delete', 'inbox_reply_thread', 'payroll_approve_run', 'payroll_mark_paid', 'procurement_issue_po'],
    // PayrollService.setRate / generateRun and ContractClauseService.extractClauses back no route
    deny: [
      'payroll_set_rate', 'payroll_generate_run', 'contract_extract_clauses', 'helpdesk_create_ticket', 'commerce_create_invoice', 'structure_get_org_tree',
    ],
  },
  connect: {
    read: [],
    write: [],
    admin: [],
    deny: ['drive_create_document', 'commerce_create_invoice', 'crm_create_contact'],
  },
};

const reachedAt = (module: CanonicalModule, level: Level) => {
  const c = CASES[module];
  return level === 'read' ? c.read : level === 'write' ? [...c.read, ...c.write] : [...c.read, ...c.write, ...c.admin];
};
const notReachedAt = (module: CanonicalModule, level: Level) => {
  const c = CASES[module];
  return level === 'read' ? [...c.write, ...c.admin, ...c.deny] : level === 'write' ? [...c.admin, ...c.deny] : c.deny;
};

describe('JobRolePolicyService — canonical module vocabulary (V1-21b)', () => {
  it('covers every canonical module and names only real registry tools', () => {
    expect(Object.keys(CASES).sort()).toEqual([...CANONICAL_MODULES].sort());
    for (const lists of Object.values(CASES)) {
      for (const tool of Object.values(lists).flat()) expect(REGISTRY, tool).toContain(tool);
    }
  });

  for (const module of CANONICAL_MODULES) {
    const governsNothing = !reachedAt(module, 'admin').length;
    describe(`{ ${module}: <level> }`, () => {
      for (const level of LEVELS) {
        it(`{ ${module}: '${level}' } is a permissions map V1-21 accepts on create/update`, () => {
          expect(jobRolePermissionsProblem({ [module]: level })).toBeNull();
        });

        if (governsNothing) {
          it(`{ ${module}: '${level}' } governs no KEY tool, so it keeps only the baseline reads and tier 1`, () => {
            const env = envelope({ [module]: level });
            expect([...env.approvedTools].sort()).toEqual([...BASELINE].sort());
            expect(env.maxRiskTier).toBe(1);
            expect(allows(env, 'fetch_business_summary')).toBe(true);
          });
        } else {
          it(`{ ${module}: '${level}' } reaches exactly the tools its level and tier cover`, () => {
            const env = envelope({ [module]: level });
            for (const tool of reachedAt(module, level)) {
              expect(passes(env, tool), `${module}:${level} -> ${tool}`).toBe(true);
              expect(TIER.get(tool)!, `${tool} tier`).toBeLessThanOrEqual(LEVELS.indexOf(level) + 1);
            }
            for (const tool of notReachedAt(module, level)) {
              expect(allows(env, tool), `${module}:${level} -/-> ${tool}`).toBe(false);
            }
            expect(env.maxRiskTier).toBe(LEVELS.indexOf(level) + 1);
          });
        }
      }

      it("grants nothing at level 'none'", () => {
        const env = envelope({ [module]: 'none' });
        expect([...env.approvedTools].sort()).toEqual([...BASELINE].sort());
        expect(env.maxRiskTier).toBe(1);
        for (const tool of reachedAt(module, 'admin')) expect(allows(env, tool), `${module}:none -/-> ${tool}`).toBe(false);
      });
    });
  }

  it('a role authored today in the canonical vocabulary grants KEY its tools (CR-V21-01)', () => {
    const permissions = { revenue: 'write', team: 'read', expenses: 'write', crm: 'read', crm_view: 'owned' };
    expect(jobRolePermissionsProblem(permissions)).toBeNull();
    const env = envelope(permissions);
    expect(passes(env, 'commerce_create_invoice')).toBe(true);
    expect(passes(env, 'payments_list_links')).toBe(true);
    expect(passes(env, 'structure_get_org_tree')).toBe(true);
    expect(passes(env, 'expenses_create')).toBe(true);
    expect(passes(env, 'deals_list')).toBe(true);
    expect(allows(env, 'payroll_approve_run')).toBe(false);
    // crm is held at read: revenue/expenses at write do not lift it (SEC-V21b-01)
    expect(allows(env, 'deals_mark_won')).toBe(false);
    expect(allows(env, 'crm_create_contact')).toBe(false);
    expect(env.maxRiskTier).toBe(2);
  });

  it('keeps the level-to-tier ladder: read 1, write 2, admin 3, strongest grant sets maxRiskTier', () => {
    expect(envelope({ revenue: 'read' }).maxRiskTier).toBe(1);
    expect(envelope({ revenue: 'write' }).maxRiskTier).toBe(2);
    expect(envelope({ revenue: 'admin' }).maxRiskTier).toBe(3);
    expect(envelope({ revenue: 'read', team: 'admin' }).maxRiskTier).toBe(3);
    // ...but maxRiskTier is only the coarse cap: each tool is held to the key that grants it.
    expect(allows(envelope({ revenue: 'read', team: 'admin' }), 'payments_refund_charge')).toBe(false);
    // A read grant reaches neither a tier-2 write nor a tier-1 tool whose route needs write.
    expect(allows(envelope({ revenue: 'read' }), 'commerce_create_invoice')).toBe(false);
    expect(allows(envelope({ content: 'read' }), 'assets_tag')).toBe(false);
  });
});

describe('a grant on one key never widens another (SEC-V21b-01, CR-1)', () => {
  it.each([
    [{ crm: 'read', team: 'write' }, ['deals_mark_won', 'deals_create', 'crm_update_deal']],
    [{ crm: 'read', operations: 'admin' }, ['crm_delete_contact', 'deals_delete']],
    [{ revenue: 'read', team: 'admin' }, ['payments_refund_charge', 'commerce_create_invoice']],
    [{ crm: 'read', expenses: 'admin' }, ['crm_delete_contact', 'deals_delete', 'deals_create', 'deals_mark_won']],
    [{ crm: 'read', revenue: 'write' }, ['deals_mark_won', 'crm_move_deal_stage']],
    [{ bookings: 'read', revenue: 'admin' }, ['bookings_cancel_booking', 'calendar_create_event']],
    [{ content: 'read', operations: 'admin' }, ['content_deliver_request', 'assets_delete']],
    // SEC-V21b-04: a legacy row
    [{ crm: 'read', finance: 'write' }, ['deals_mark_won']],
    [{ crm: 'read', finance: 'admin' }, ['crm_delete_contact']],
  ])('%j does not reach %j', (permissions, tools) => {
    const env = envelope(permissions);
    // maxRiskTier is the strongest key's tier and would let these through on its own.
    expect(tools.some((t) => TIER.get(t)! <= env.maxRiskTier)).toBe(true);
    for (const tool of tools) {
      expect(allows(env, tool), tool).toBe(false);
      expect(passes(env, tool), tool).toBe(false);
    }
  });

  it('the same tools are reached once the granting module itself holds the level', () => {
    expect(passes(envelope({ crm: 'write' }), 'deals_mark_won')).toBe(true);
    expect(passes(envelope({ crm: 'admin' }), 'deals_delete')).toBe(true);
    expect(passes(envelope({ revenue: 'admin' }), 'payments_refund_charge')).toBe(true);
    expect(passes(envelope({ bookings: 'admin' }), 'bookings_cancel_booking')).toBe(true);
    expect(passes(envelope({ content: 'admin', operations: 'read' }), 'assets_delete')).toBe(true);
  });

  it('for every pair of keys, what the pair reaches is exactly what each key reaches alone', () => {
    const keys = [...new Set([...CANONICAL_MODULES, 'finance', 'sales', 'commerce', 'calendar', 'time', 'marketing', 'social', 'helpdesk', 'comms', 'inbox', 'structure', 'hr', 'contracts', 'legal', 'procurement', 'documents'])];
    const reached = (permissions: Record<string, string>) => {
      const env = envelope(permissions);
      return new Set(REGISTRY.filter((t) => passes(env, t)));
    };
    const alone = new Map<string, Set<string>>();
    for (const k of keys) for (const l of LEVELS) alone.set(`${k}:${l}`, reached({ [k]: l }));
    for (const a of keys) {
      for (const b of keys) {
        if (a >= b) continue;
        for (const [la, lb] of [['read', 'admin'], ['admin', 'read'], ['read', 'write'], ['write', 'read']] as const) {
          const both = [...reached({ [a]: la, [b]: lb })].sort();
          const union = [...new Set([...alone.get(`${a}:${la}`)!, ...alone.get(`${b}:${lb}`)!])].sort();
          expect(both, `{${a}:${la}, ${b}:${lb}}`).toEqual(union);
        }
      }
    }
  });
});

describe('an ungoverned tool is never granted by a canonical key (SEC-V21b-02)', () => {
  it.each(['payroll_set_rate', 'payroll_generate_run', 'contract_extract_clauses', 'structure_find_person'])(
    '%s is reached by no canonical key at any level',
    (tool) => {
      for (const m of CANONICAL_MODULES) for (const l of LEVELS) expect(allows(envelope({ [m]: l }), tool), `${m}:${l}`).toBe(false);
      expect(allows(envelope(Object.fromEntries(CANONICAL_MODULES.map((m) => [m, 'admin']))), tool)).toBe(false);
    },
  );

  it('crm_add_note is reached by crm at write, as POST contacts/:id/notes, and not at read (review 2 ESC-1)', () => {
    // CrmService.addNote only forwards to CrmTimelineService.addNote, which that route
    // (crm:write) calls; the legacy crm_* family no longer reaches it, being governed.
    for (const m of CANONICAL_MODULES.filter((k) => k !== 'crm')) expect(allows(envelope({ [m]: 'admin' }), 'crm_add_note'), m).toBe(false);
    expect(allows(envelope({ crm: 'read' }), 'crm_add_note')).toBe(false);
    expect(allows(envelope({ sales: 'admin' }), 'crm_add_note')).toBe(false);
    expect(passes(envelope({ crm: 'write' }), 'crm_add_note')).toBe(true);
  });
});

describe('through the real AiOversightService.evaluate (the review repros)', () => {
  const oversight = new AiOversightService({ client: {} } as any, {} as any, {} as any, {} as any, {} as any, policy);
  /** No AutopilotSettings row (DEFAULT_AUTONOMY), or one at the given autonomy level. */
  const reader = (autonomyLevel?: number): AutonomySettingsReader => ({
    autopilotSettings: {
      findUnique: async () =>
        autonomyLevel === undefined ? null : { autonomyLevel, blockedTools: [], approvedTools: [], approvalTimeoutHours: 24 },
    },
    aiMemory: { findUnique: async () => null },
  });
  const evaluate = (permissions: Record<string, string>, tool: string, autonomyLevel?: number) =>
    oversight.evaluate('biz_1', tool, undefined, [], envelope(permissions), reader(autonomyLevel));

  it.each([
    // SEC-V21b-01 / CR-1: one module's level lifted another's
    [{ crm: 'read', team: 'write' }, 'deals_mark_won'],
    [{ crm: 'read', team: 'write' }, 'deals_create'],
    [{ crm: 'read', team: 'write' }, 'crm_update_deal'],
    [{ crm: 'read', operations: 'admin' }, 'crm_delete_contact'],
    [{ crm: 'read', operations: 'admin' }, 'deals_delete'],
    [{ revenue: 'read', team: 'admin' }, 'payments_refund_charge'],
    [{ bookings: 'read', revenue: 'admin' }, 'bookings_cancel_booking'],
    // SEC-V21b-02: tools that back no route
    [{ operations: 'write' }, 'payroll_set_rate'],
    [{ operations: 'admin' }, 'payroll_set_rate'],
    [{ operations: 'admin' }, 'payroll_generate_run'],
    [{ operations: 'admin' }, 'contract_extract_clauses'],
    [{ team: 'admin' }, 'structure_find_person'],
    // SEC-V21b-03: tier-1 tools whose route needs write
    [{ content: 'read' }, 'assets_tag'],
    [{ content: 'read' }, 'assets_untag'],
    [{ operations: 'read' }, 'contracts_acknowledge_alert'],
    [{ crm: 'read' }, 'crm_create_contact'],
    // SEC-V21b-04: a legacy row
    [{ crm: 'read', finance: 'write' }, 'deals_mark_won'],
  ])('%j refuses %s, under the default policy and at autonomy level 2', async (permissions, tool) => {
    for (const autonomyLevel of [undefined, 2]) {
      const d = await evaluate(permissions, tool, autonomyLevel);
      expect(d.allowed, `${tool} @ autonomy ${autonomyLevel}`).toBe(false);
      expect(d.reason).toMatch(/Position position's (scope|tier)/);
    }
  });

  it.each([
    [{ crm: 'write' }, 'deals_mark_won', { requiresQuickConfirm: true }],
    [{ crm: 'admin' }, 'deals_delete', { requiresFormalApproval: true }],
    [{ revenue: 'admin' }, 'payments_refund_charge', { requiresFormalApproval: true }],
    [{ revenue: 'write', team: 'read' }, 'commerce_create_invoice', { requiresQuickConfirm: true }],
    [{ content: 'write' }, 'assets_tag', { requiresQuickConfirm: false, requiresFormalApproval: false }],
    [{ operations: 'write' }, 'contracts_acknowledge_alert', { requiresQuickConfirm: false }],
    [{ operations: 'read' }, 'contracts_list', { requiresQuickConfirm: false }],
    [{ team: 'read' }, 'structure_get_org_tree', { requiresQuickConfirm: false }],
  ])('positive control: %j reaches %s', async (permissions, tool, extra) => {
    expect(await evaluate(permissions, tool)).toMatchObject({ allowed: true, ...extra });
  });

  it.each([
    [{ settings: 'admin' }, 'update_business_blueprint'],
    [{ ai: 'admin', analytics: 'admin', connect: 'admin', automations: 'admin', storefront: 'admin' }, 'commerce_create_invoice'],
    [{ crm: 'none' }, 'crm_create_contact'],
    [{ team: 'admin' }, 'payroll_list_rates'],
    [{ expenses: 'admin' }, 'finance_post_journal_entry'],
  ])('negative control: %j refuses %s', async (permissions, tool) => {
    expect((await evaluate(permissions, tool)).allowed).toBe(false);
  });
});

describe('JobRolePolicyService — legacy tool-family keys keep working', () => {
  /** The pre-V1-21 table, verbatim: rows written before V1-21 carry these keys. */
  const LEGACY: Record<string, string[]> = {
    finance: ['finance_*', 'expenses_*'],
    crm: ['crm_*'],
    sales: ['crm_*', 'commerce_*'],
    commerce: ['commerce_*'],
    bookings: ['bookings_*', 'calendar_*'],
    calendar: ['calendar_*'],
    projects: ['projects_*', 'time_*'],
    time: ['time_*'],
    marketing: ['marketing_*', 'social_*', 'content_*'],
    social: ['social_*'],
    content: ['content_*'],
    helpdesk: ['helpdesk_*'],
    comms: ['comms_*', 'inbox_*'],
    inbox: ['inbox_*'],
    structure: ['structure_*'],
    hr: ['structure_*'],
    contracts: ['contract_*'],
    legal: ['contract_*'],
    procurement: ['procurement_*'],
    documents: ['documents_*', 'drive_*'],
  };

  for (const [key, families] of Object.entries(LEGACY)) {
    it(`{ ${key}: 'write' } still approves ${families.join(', ')}`, () => {
      const env = envelope({ [key]: 'write' });
      for (const f of families) expect(env.approvedTools).toContain(f);
      for (const b of BASELINE) expect(env.approvedTools).toContain(b);
      expect(env.maxRiskTier).toBe(2);
    });
  }

  it('a non-canonical legacy key grants exactly its pre-V1-21 families, nothing more', () => {
    expect([...envelope({ finance: 'write' }).approvedTools].sort()).toEqual([...BASELINE, 'finance_*', 'expenses_*'].sort());
    expect([...envelope({ hr: 'admin' }).approvedTools].sort()).toEqual([...BASELINE, 'structure_*'].sort());
    expect([...envelope({ sales: 'read' }).approvedTools].sort()).toEqual([...BASELINE, 'crm_*', 'commerce_*'].sort());
  });

  it('a legacy key is still refused on write by V1-21, but an existing row is still read', () => {
    expect(jobRolePermissionsProblem({ finance: 'write' })).toMatch(/Invalid module: finance/);
    expect(passes(envelope({ finance: 'write' }), 'finance_expense_breakdown')).toBe(true);
    expect(passes(envelope({ finance: 'write' }), 'finance_create_coa_account')).toBe(true);
    // V1-81 (D-57): the money reports are governed by revenue:read now, so the legacy key loses them
    expect(allows(envelope({ finance: 'write' }), 'finance_cashflow')).toBe(false);
    // Tier 3: {finance: 'write'} was refused it at the gate before (maxRiskTier 2); the
    // envelope now says so itself, and {finance: 'admin'} still reaches it.
    expect(allows(envelope({ finance: 'write' }), 'finance_post_journal_entry')).toBe(false);
    expect(passes(envelope({ finance: 'admin' }), 'finance_post_journal_entry')).toBe(true);
  });

  /** What a legacy row reached before the V1-21b repair: family match, capped by its tier. */
  const reachedBefore = (families: readonly string[], level: Level) =>
    REGISTRY.filter(
      (t) => [...families, ...BASELINE].some((p) => (p.endsWith('*') ? t.startsWith(p.slice(0, -1)) : p === t)) && TIER.get(t)! <= LEVELS.indexOf(level) + 1,
    ).sort();
  const reachedNow = (permissions: Record<string, string>) => {
    const env = envelope(permissions);
    return REGISTRY.filter((t) => passes(env, t)).sort();
  };
  /**
   * Every tool a route governs (the table, and GOVERNED_UNGRANTED): a legacy key no longer
   * reaches one, whatever its level - only the governing canonical module does (review 2
   * ESC-3; before it, `finance` reached the expenses tools, `inbox` the operations ones).
   */
  const ROUTE_GOVERNED = new Set([
    ...Object.values(CANONICAL_MODULE_TOOLS).flatMap((tools) => Object.keys(tools)),
    ...Object.keys(((policyExports as Record<string, unknown>).GOVERNED_UNGRANTED ?? {}) as Record<string, string>),
  ]);

  /** Tools that find their row by a bare id, which on the staff bridge is any business's: no key reaches them (review 8 DD8-1). */
  const TENANT_UNBOUND = new Set(Object.keys(((policyExports as Record<string, unknown>).TENANT_UNBOUND_TOOLS ?? {}) as Record<string, string>));

  for (const [key, families] of Object.entries(LEGACY).filter(([k]) => !(CANONICAL_MODULES as readonly string[]).includes(k))) {
    it(`{ ${key}: <level> } reaches what it reached before the repair, less the tools a route governs and those that find their row by a bare id`, () => {
      for (const level of LEVELS) {
        expect(reachedNow({ [key]: level }), level).toEqual(reachedBefore(families, level).filter((t) => !ROUTE_GOVERNED.has(t) && !TENANT_UNBOUND.has(t)));
      }
    });
  }

  it('the governed tools a legacy key loses, pinned (an owner decision whether to migrate such rows)', () => {
    const lost = (key: string) => reachedBefore(LEGACY[key], 'admin').filter((t) => ROUTE_GOVERNED.has(t));
    // V1-81 (owner ruling D-57): the five money report tools and finance_view_receivables (FOLLOW3-A6) are governed by revenue:read
    expect(lost('finance')).toEqual([
      'expenses_create', 'expenses_list', 'finance_balance_sheet', 'finance_cashflow', 'finance_create_bill', 'finance_list_bills',
      'finance_pay_bill', 'finance_profit_and_loss', 'finance_revenue_breakdown', 'finance_tax_summary', 'finance_view_payables',
      'finance_view_receivables',
    ]);
    expect(lost('commerce')).toEqual([
      'commerce_convert_quote', 'commerce_create_invoice', 'commerce_create_quote', 'commerce_delete_invoice',
      'commerce_list_invoices', 'commerce_mark_invoice_paid', 'commerce_send_invoice', 'commerce_update_invoice',
    ]);
    expect(lost('calendar')).toEqual(['calendar_create_event', 'calendar_list_events']);
    expect(lost('sales').filter((t) => t.startsWith('crm_'))).toEqual([
      'crm_add_note', 'crm_add_task', 'crm_create_contact', 'crm_delete_contact', 'crm_find_duplicates', 'crm_list_contacts',
      'crm_list_deals', 'crm_merge_execute', 'crm_merge_preview', 'crm_move_deal_stage', 'crm_search_contacts', 'crm_update_contact', 'crm_update_deal',
    ]);
    expect(lost('inbox')).toEqual(['inbox_brief', 'inbox_list_threads', 'inbox_mark_resolved', 'inbox_read_thread', 'inbox_reply_thread', 'inbox_update_thread_status']);
    expect(lost('hr')).toEqual(lost('structure'));
    expect(lost('legal')).toEqual(lost('contracts'));
    expect(lost('contracts')).toEqual(['contract_create_tag', 'contract_extract_terms', 'contract_list_tags']);
  });

  it('a legacy grant no longer reaches a tool a route governs, at any level (SEC-V21b-03, review 2 ESC-3)', () => {
    expect(allows(envelope({ crm: 'read' }), 'crm_create_contact')).toBe(false);
    expect(allows(envelope({ crm: 'read' }), 'crm_update_contact')).toBe(false);
    expect(allows(envelope({ sales: 'read' }), 'crm_create_contact')).toBe(false);
    expect(allows(envelope({ inbox: 'read' }), 'inbox_mark_resolved')).toBe(false);
    expect(allows(envelope({ inbox: 'write' }), 'inbox_mark_resolved')).toBe(false);
    expect(allows(envelope({ sales: 'write' }), 'crm_create_contact')).toBe(false);
    expect(passes(envelope({ crm: 'write' }), 'crm_create_contact')).toBe(true);
    expect(passes(envelope({ operations: 'write' }), 'inbox_mark_resolved')).toBe(true);
  });

  it('matches a legacy key case-insensitively, as before, but a canonical key only exactly (review 2 ESC-2)', () => {
    expect(allows(envelope({ Revenue: 'WRITE' }), 'commerce_create_invoice')).toBe(false);
    expect(allows(envelope({ revenue: 'WRITE' }), 'commerce_create_invoice')).toBe(false);
    expect(allows(envelope({ revenue: 'write' }), 'commerce_create_invoice')).toBe(true);
    expect(allows(envelope({ FINANCE: 'Write' }), 'finance_expense_breakdown')).toBe(true);
    expect(allows(envelope({ HELPDESK: 'Write' }), 'helpdesk_create_ticket')).toBe(true);
    // `CRM` is the legacy crm_* family alone: every crm_* tool is governed, so it reaches none (review 2 ESC-5)
    expect(allows(envelope({ CRM: 'admin' }), 'crm_list_contacts')).toBe(false);
    expect(allows(envelope({ CRM: 'admin' }), 'crm_delete_contact')).toBe(false);
  });
});

describe('JobRolePolicyService — deny by default', () => {
  it('an empty or missing map keeps only the baseline reads', () => {
    for (const p of [{}, null, undefined]) {
      const env = envelope(p);
      expect([...env.approvedTools].sort()).toEqual([...BASELINE].sort());
      expect(env.maxRiskTier).toBe(1);
      expect(env.blockedTools).toEqual([]);
    }
  });

  it('an unknown key or an unknown level grants nothing', () => {
    for (const p of [{ widgets: 'admin' }, { revenue: 'superuser' }, { crm: 'owner' }, { revenue: '' }]) {
      const env = envelope(p);
      expect([...env.approvedTools].sort(), JSON.stringify(p)).toEqual([...BASELINE].sort());
      expect(env.maxRiskTier).toBe(1);
    }
  });

  it('CRM ownership sub-permissions are not module grants', () => {
    const env = envelope({ crm_view: 'all', crm_edit: 'any', crm_delete: 'any', crm_reassign: 'true' });
    expect([...env.approvedTools].sort()).toEqual([...BASELINE].sort());
    expect(allows(env, 'crm_delete_contact')).toBe(false);
  });

  it('Object.prototype names are neither keys nor levels (no throw, no unbounded tier)', () => {
    const cases: unknown[] = [
      { constructor: 'write' },
      { toString: 'admin' },
      JSON.parse('{"__proto__": "write"}'),
      { crm: 'constructor' },
      { crm: '__proto__' },
      { revenue: 'hasOwnProperty' },
    ];
    for (const p of cases) {
      const env = envelope(p);
      expect(env.maxRiskTier, JSON.stringify(p)).toBe(1);
      expect([...env.approvedTools].sort(), JSON.stringify(p)).toEqual([...BASELINE].sort());
    }
  });

  it('a non-string level grants nothing and does not throw', () => {
    for (const p of [{ revenue: 2 }, { crm: true }, { team: { level: 'admin' } }, { expenses: null }]) {
      const env = envelope(p);
      expect([...env.approvedTools].sort(), JSON.stringify(p)).toEqual([...BASELINE].sort());
      expect(env.maxRiskTier).toBe(1);
    }
  });
});

/**
 * V1-21b second review (ESC-1..4, C1..C3). Kernel K2: a position never lets KEY do what
 * its holder could not do over HTTP with the same scope map, and the union of keys
 * reaches exactly the union of what each key reaches alone. Each repro below is the
 * review's own input, run through the real AiOversightService.evaluate, next to the real
 * ModuleScopeGuard (and, for the CRM sub-permissions, the real resolveCrmAccess) on a
 * membership carrying the same map: the HTTP answer the envelope must not exceed.
 */
describe('V1-21b review 2 — KEY never exceeds HTTP on the same scope map (K2)', () => {
  const oversight = new AiOversightService({ client: {} } as any, {} as any, {} as any, {} as any, {} as any, policy);
  const reader = (autonomyLevel?: number): AutonomySettingsReader => ({
    autopilotSettings: {
      findUnique: async () =>
        autonomyLevel === undefined ? null : { autonomyLevel, blockedTools: [], approvedTools: [], approvalTimeoutHours: 24 },
    },
    aiMemory: { findUnique: async () => null },
  });
  const evaluate = (permissions: Record<string, unknown>, tool: string, autonomyLevel?: number) =>
    oversight.evaluate('biz_1', tool, undefined, [], envelope(permissions), reader(autonomyLevel));

  /** A STAFF membership whose permissionScopes is `scopes`, as ModuleScopeGuard and resolveCrmAccess read it. */
  const membershipPrisma = (scopes: Record<string, unknown>) =>
    ({
      client: {
        membership: { findUnique: async () => ({ userId: 'u_1', businessId: 'biz_1', role: 'STAFF', permissionScopes: scopes }) },
        user: { findUnique: async () => ({ id: 'u_1', role: 'STAFF' }) },
      },
    }) as any;

  /** The real ModuleScopeGuard on a route that requires `module` at `minLevel`. */
  const httpAllows = async (scopes: Record<string, unknown>, module: string, minLevel: Level): Promise<boolean> => {
    const reflector = { get: (key: string) => (key === MODULE_SCOPE_KEY ? { module, minLevel } : undefined) } as any;
    const guard = new ModuleScopeGuard(membershipPrisma(scopes), reflector);
    const ctx = {
      getHandler: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u_1', role: 'STAFF' }, params: { businessId: 'biz_1' } }) }),
    } as any;
    try {
      return await guard.canActivate(ctx);
    } catch {
      return false;
    }
  };

  const GOVERNED_UNGRANTED = ((policyExports as Record<string, unknown>).GOVERNED_UNGRANTED ?? {}) as Record<string, string>;

  /** Every tool the canonical table grants, with the module and the level its routes require. */
  const ROUTED: Array<[string, CanonicalModule, Level]> = Object.entries(CANONICAL_MODULE_TOOLS).flatMap(([m, tools]) =>
    Object.entries(tools).map(([t, l]) => [t, m as CanonicalModule, l as Level] as [string, CanonicalModule, Level]),
  );
  const routeOf = new Map(ROUTED.map(([t, m, l]) => [t, { module: m, level: l }]));

  describe('ESC-1 — crm:read does not write CRM notes or tasks', () => {
    it.each(['crm_add_note', 'crm_add_task'])('%s needs crm:write, as POST contacts/:id/notes|tasks does', async (tool) => {
      expect(jobRolePermissionsProblem({ crm: 'read' })).toBeNull();
      expect(await httpAllows({ crm: 'read' }, 'crm', 'write')).toBe(false);
      for (const autonomyLevel of [undefined, 3]) {
        const d = await evaluate({ crm: 'read' }, tool, autonomyLevel);
        expect(d.allowed, `${tool} @ ${autonomyLevel}`).toBe(false);
        expect(d.reason).toMatch(/outside the Position position's scope/);
      }
      expect(routeOf.get(tool)).toEqual({ module: 'crm', level: 'write' });
      // positive control: the holder who may add a note by hand may ask KEY to
      expect(await httpAllows({ crm: 'write' }, 'crm', 'write')).toBe(true);
      expect(await evaluate({ crm: 'write' }, tool)).toMatchObject({ allowed: true });
    });
  });

  describe('ESC-2 — a canonical key and its level are matched exactly, as ModuleScopeGuard reads them', () => {
    it.each([
      [{ Operations: 'Write' }, 'inbox_mark_resolved', 'operations', 'write'],
      [{ Operations: 'Write' }, 'contracts_create', 'operations', 'write'],
      [{ Operations: 'Write' }, 'performance_take_snapshot', 'operations', 'write'],
      [{ Operations: 'Write' }, 'contracts_list', 'operations', 'read'],
      [{ REVENUE: 'ADMIN' }, 'payments_create_link', 'revenue', 'write'],
      [{ REVENUE: 'ADMIN' }, 'payments_refund_charge', 'revenue', 'write'],
      [{ REVENUE: 'ADMIN' }, 'commerce_delete_invoice', 'revenue', 'write'],
      [{ TEAM: 'admin' }, 'structure_create_delegation_rule', 'team', 'write'],
      [{ Expenses: 'write' }, 'finance_create_bill', 'expenses', 'write'],
      [{ crm: 'WRITE' }, 'crm_update_contact', 'crm', 'write'],
      [{ crm: 'Admin' }, 'deals_delete', 'crm', 'write'],
      [{ crm: 'read', CRM: 'admin' }, 'crm_delete_contact', 'crm', 'write'],
      [{ crm: 'read', Crm: 'write' }, 'crm_create_contact', 'crm', 'write'],
      [{ content: 'read', CONTENT: 'admin' }, 'assets_delete', 'content', 'write'],
      [{ bookings: 'read', Bookings: 'write' }, 'calendar_create_event', 'bookings', 'write'],
    ] as const)('%j: HTTP refuses %s (%s:%s), so KEY does too', async (permissions, tool, module, level) => {
      expect(await httpAllows(permissions, module, level)).toBe(false);
      for (const autonomyLevel of [undefined, 2, 3]) {
        expect((await evaluate(permissions, tool, autonomyLevel)).allowed, `${tool} @ ${autonomyLevel}`).toBe(false);
      }
    });

    it('a key that is canonical only once lower-cased grants no more than an empty map', () => {
      const reached = (p: Record<string, string>) => {
        const env = envelope(p);
        return REGISTRY.filter((t) => passes(env, t)).sort();
      };
      const none = reached({});
      const maps: Record<string, string>[] = [{ Operations: 'Write' }, { REVENUE: 'ADMIN' }, { TEAM: 'write' }, { Expenses: 'admin' }, { Revenue: 'write' }];
      for (const p of maps) {
        expect(reached(p), JSON.stringify(p)).toEqual(none);
      }
    });

    it('the exact key and level still grant (positive control)', async () => {
      expect(await evaluate({ operations: 'write' }, 'inbox_mark_resolved')).toMatchObject({ allowed: true });
      expect(await evaluate({ revenue: 'admin' }, 'payments_create_link')).toMatchObject({ allowed: true });
      expect(await evaluate({ crm: 'write' }, 'deals_mark_won')).toMatchObject({ allowed: true });
    });
  });

  describe('ESC-3 — a legacy key never reaches a tool a canonical module governs', () => {
    it.each([
      [{ operations: 'none', inbox: 'write' }, 'inbox_mark_resolved', 'operations', 'write'],
      [{ operations: 'none', comms: 'admin' }, 'inbox_reply_thread', 'operations', 'write'],
      [{ inbox: 'write' }, 'inbox_update_thread_status', 'operations', 'write'],
      [{ expenses: 'read', finance: 'write' }, 'finance_create_bill', 'expenses', 'write'],
      [{ expenses: 'none', finance: 'admin' }, 'finance_pay_bill', 'expenses', 'write'],
      [{ finance: 'write' }, 'expenses_create', 'expenses', 'write'],
      [{ revenue: 'read', commerce: 'write' }, 'commerce_update_invoice', 'revenue', 'write'],
      [{ revenue: 'none', sales: 'admin' }, 'commerce_delete_invoice', 'revenue', 'write'],
      [{ sales: 'write' }, 'crm_create_contact', 'crm', 'write'],
      [{ crm: 'read', sales: 'write' }, 'crm_update_contact', 'crm', 'write'],
      [{ bookings: 'read', calendar: 'write' }, 'calendar_create_event', 'bookings', 'write'],
      [{ team: 'read', hr: 'admin' }, 'structure_create_delegation_rule', 'team', 'write'],
      [{ team: 'none', structure: 'read' }, 'structure_get_org_tree', 'team', 'read'],
      [{ operations: 'read', contracts: 'write' }, 'contract_create_tag', 'operations', 'write'],
      [{ operations: 'none', legal: 'write' }, 'contract_extract_terms', 'operations', 'write'],
    ] as const)('%j: HTTP refuses %s (%s:%s), so KEY does too', async (permissions, tool, module, level) => {
      expect(await httpAllows(permissions, module, level)).toBe(false);
      for (const autonomyLevel of [undefined, 2, 3]) {
        expect((await evaluate(permissions, tool, autonomyLevel)).allowed, `${tool} @ ${autonomyLevel}`).toBe(false);
      }
    });

    it('the governing module itself still grants it (positive control)', async () => {
      expect(await evaluate({ operations: 'write', inbox: 'read' }, 'inbox_mark_resolved')).toMatchObject({ allowed: true });
      expect(await evaluate({ expenses: 'write', finance: 'read' }, 'finance_create_bill')).toMatchObject({ allowed: true });
      expect(await evaluate({ revenue: 'write', commerce: 'read' }, 'commerce_update_invoice')).toMatchObject({ allowed: true });
    });

    it('a legacy key keeps the tools a member reaches over HTTP with no module (finance_expense_breakdown, commerce_create_product, helpdesk_*)', async () => {
      expect(await evaluate({ finance: 'write' }, 'finance_expense_breakdown')).toMatchObject({ allowed: true });
      expect(await evaluate({ sales: 'read' }, 'commerce_create_product')).toMatchObject({ allowed: true });
      expect(await evaluate({ helpdesk: 'read' }, 'helpdesk_list_tickets')).toMatchObject({ allowed: true });
      expect(await evaluate({ helpdesk: 'write' }, 'helpdesk_create_ticket')).toMatchObject({ allowed: true });
    });
  });

  /**
   * V1-81 (FOLLOW3-A7-MONEY-REPORTS review A7-SEC-1 / CRR-A7-1, owner ruling D-57): GET
   * reports/{pnl, cashflow, balance-sheet, tax-summary, revenue-by, generate} require
   * revenue:read. Before the companion table change the legacy `finance` key (which carries no
   * revenue scope) still reached the five finance report tools, and analytics reached
   * reports_generate, while the same scope map got 403 over HTTP.
   */
  describe('V1-81 (D-57) — the money reports need revenue:read on KEY as over HTTP', () => {
    const REPORT_TOOLS = ['finance_profit_and_loss', 'finance_balance_sheet', 'finance_cashflow', 'finance_tax_summary', 'finance_revenue_breakdown', 'reports_generate'];

    it.each([
      ...REPORT_TOOLS.map((t) => [{ finance: 'read' }, t] as const),
      ...REPORT_TOOLS.map((t) => [{ revenue: 'none', finance: 'admin', expenses: 'admin' }, t] as const),
      ...REPORT_TOOLS.map((t) => [{ revenue: 'none', analytics: 'admin' }, t] as const),
      ...REPORT_TOOLS.map((t) => [{ Revenue: 'read' }, t] as const),
    ])('%j: HTTP refuses %s (revenue:read), so KEY does too', async (permissions, tool) => {
      expect(routeOf.get(tool)).toEqual({ module: 'revenue', level: 'read' });
      expect(await httpAllows(permissions, 'revenue', 'read')).toBe(false);
      for (const autonomyLevel of [undefined, 2, 3]) {
        expect((await evaluate(permissions, tool, autonomyLevel)).allowed, `${tool} @ ${autonomyLevel}`).toBe(false);
      }
    });

    it.each(REPORT_TOOLS)('revenue:read reaches %s, as the route does (positive control)', async (tool) => {
      expect(await httpAllows({ revenue: 'read' }, 'revenue', 'read')).toBe(true);
      expect(await evaluate({ revenue: 'read' }, tool)).toMatchObject({ allowed: true });
    });

    it('expense-by carries no revenue and declares no scope: the legacy key keeps finance_expense_breakdown', async () => {
      expect(routeOf.has('finance_expense_breakdown')).toBe(false);
      expect(await evaluate({ finance: 'read' }, 'finance_expense_breakdown')).toMatchObject({ allowed: true });
    });
  });

  describe('ESC-4 — the crm_edit / crm_delete sub-permissions bound the KEY CRM writes', () => {
    const access = (scopes: Record<string, unknown>) => resolveCrmAccess(membershipPrisma(scopes), 'biz_1', 'u_1');

    it.each([
      [{ crm: 'write', crm_edit: 'none' }, 'crm_update_contact'],
      [{ crm: 'write', crm_edit: 'none' }, 'tag_contact'],
      [{ crm: 'write', crm_edit: 'none' }, 'crm_create_contact'],
      [{ crm: 'admin', crm_edit: 'none' }, 'crm_update_contact'],
    ])('%j refuses %s: resolveCrmAccess gives editScope none', async (permissions, tool) => {
      expect(jobRolePermissionsProblem(permissions)).toBeNull();
      expect((await access(permissions)).editScope).toBe('none');
      for (const autonomyLevel of [undefined, 3]) {
        expect((await evaluate(permissions, tool, autonomyLevel)).allowed, `${tool} @ ${autonomyLevel}`).toBe(false);
      }
    });

    it.each([
      [{ crm: 'admin', crm_delete: 'none' }, 'none'],
      [{ crm: 'admin', crm_delete: 'owned' }, 'owned'],
    ])('%j refuses crm_delete_contact at autonomy 3: deleteScope %s', async (permissions, scope) => {
      expect(jobRolePermissionsProblem(permissions)).toBeNull();
      expect((await access(permissions)).deleteScope).toBe(scope);
      for (const autonomyLevel of [undefined, 3]) {
        expect((await evaluate(permissions, 'crm_delete_contact', autonomyLevel)).allowed).toBe(false);
      }
    });

    it("an 'owned' edit scope is refused too: the dispatcher passes no actor, so KEY cannot keep to the holder's own contacts", async () => {
      const permissions = { crm: 'write', crm_edit: 'owned' };
      expect((await access(permissions)).editScope).toBe('owned');
      expect((await evaluate(permissions, 'crm_update_contact')).allowed).toBe(false);
      expect((await evaluate(permissions, 'tag_contact')).allowed).toBe(false);
    });

    it('positive controls: the defaults of the crm level, and an explicit any', async () => {
      expect((await access({ crm: 'write' })).editScope).toBe('any');
      expect(await evaluate({ crm: 'write' }, 'crm_create_contact')).toMatchObject({ allowed: true });
      expect(await evaluate({ crm: 'write', crm_edit: 'any' }, 'crm_create_contact')).toMatchObject({ allowed: true });
      // an edit or delete scope of any no longer releases crm_update_contact / tag_contact /
      // crm_delete_contact: their service also bounds the row by visibilityClause (review 4 DRV-1)
      expect((await access({ crm: 'admin' })).deleteScope).toBe('any');
      for (const tool of ['crm_update_contact', 'tag_contact']) {
        expect((await evaluate({ crm: 'write', crm_edit: 'any' }, tool)).allowed, tool).toBe(false);
      }
      expect((await evaluate({ crm: 'admin' }, 'crm_delete_contact', 3)).allowed).toBe(false);
      expect((await evaluate({ crm: 'admin', crm_delete: 'any' }, 'crm_delete_contact', 3)).allowed).toBe(false);
      // the sub-permissions bound only the tools whose service checks them: deals and notes need crm:write alone
      expect(await evaluate({ crm: 'write', crm_edit: 'none' }, 'deals_mark_won')).toMatchObject({ allowed: true });
      expect(await evaluate({ crm: 'write', crm_edit: 'none' }, 'crm_add_note')).toMatchObject({ allowed: true });
    });
  });

  describe('C1 — a revenue position records a payment through KEY', () => {
    it.each(['write', 'admin'])('{ revenue: %s } reaches commerce_mark_invoice_paid with a quick confirm, as PATCH invoices/:id/paid', async (level) => {
      expect(await httpAllows({ revenue: level }, 'revenue', 'write')).toBe(true);
      expect(await evaluate({ revenue: level }, 'commerce_mark_invoice_paid')).toMatchObject({ allowed: true, requiresQuickConfirm: true });
    });

    it('{ revenue: read } does not', async () => {
      expect(await httpAllows({ revenue: 'read' }, 'revenue', 'write')).toBe(false);
      expect((await evaluate({ revenue: 'read' }, 'commerce_mark_invoice_paid')).allowed).toBe(false);
    });
  });

  describe('C2 — a read tool whose HTTP equivalent needs read is reached at read', () => {
    it.each([
      ['revenue', 'commerce_list_invoices'],
      ['expenses', 'expenses_list'],
      ['content', 'assets_get'],
    ] as const)('{ %s: read | write | admin } reaches %s', async (module, tool) => {
      for (const level of LEVELS) {
        expect(await httpAllows({ [module]: level }, module, 'read')).toBe(true);
        expect(await evaluate({ [module]: level }, tool), `${module}:${level}`).toMatchObject({ allowed: true });
      }
      expect((await evaluate({ [module]: 'none' }, tool)).allowed).toBe(false);
    });
  });

  describe('ESC-5 (found re-probing this repair) — a legacy or case-variant key does not read what crm:read / bookings:read guard', () => {
    // crm_list_contacts / crm_search_contacts / crm_list_deals / calendar_list_events read
    // Prisma directly, so the first derivation called them ungoverned and every legacy
    // alias of crm_* / calendar_* reached them — beside an explicit crm:'none'.
    it.each([
      [{ crm: 'none', CRM: 'admin' }, 'crm_list_contacts', 'crm'],
      [{ crm: 'none', sales: 'read' }, 'crm_search_contacts', 'crm'],
      [{ crm: 'none', sales: 'read' }, 'crm_list_deals', 'crm'],
      [{ Crm: 'read' }, 'crm_list_contacts', 'crm'],
      [{ bookings: 'none', calendar: 'read' }, 'calendar_list_events', 'bookings'],
      [{ bookings: 'none', Bookings: 'read' }, 'calendar_list_events', 'bookings'],
    ] as const)('%j: HTTP refuses %s (%s:read), so KEY does too', async (permissions, tool, module) => {
      expect(await httpAllows(permissions, module, 'read')).toBe(false);
      expect((await evaluate(permissions, tool)).allowed).toBe(false);
    });

    it.each([
      [{ crm: 'read' }, 'crm_list_contacts'],
      [{ crm: 'read' }, 'crm_search_contacts'],
      [{ crm: 'read' }, 'crm_list_deals'],
      [{ bookings: 'read' }, 'calendar_list_events'],
    ])('positive control: %j reaches %s', async (permissions, tool) => {
      expect(await evaluate(permissions, tool)).toMatchObject({ allowed: true });
    });
  });

  describe('C3 — kept: the level-to-tier ladder caps a write grant at tier 2 (owner decision)', () => {
    /** Table entries a write grant meets by route level but not by tier: they need admin. */
    const tierCapped = ROUTED.filter(([t, , l]) => l !== 'admin' && TIER.get(t)! > 2).map(([t, m]) => `${m}:${t}`).sort();

    it('pins exactly which write-route tools need admin, so a change to the ladder is a reviewed change', () => {
      expect(tierCapped).toEqual(
        [
          'content:assets_delete',
          'crm:crm_delete_contact',
          'crm:crm_merge_execute',
          'crm:deals_delete',
          'expenses:finance_pay_bill',
          'operations:contracts_delete',
          'operations:inbox_reply_thread',
          'operations:payroll_approve_run',
          'operations:payroll_mark_paid',
          'operations:procurement_issue_po',
          'revenue:commerce_delete_invoice',
          'revenue:payments_refund_charge',
          'team:structure_create_delegation_rule',
          'team:structure_update_delegation_rule',
        ].sort(),
      );
      for (const entry of tierCapped) {
        const [m, t] = entry.split(':');
        expect(allows(envelope({ [m]: 'write' }), t), `${entry} @ write`).toBe(false);
        // crm_delete_contact is withheld at every level (review 4 DRV-1)
        expect(passes(envelope({ [m]: 'admin' }), t), `${entry} @ admin`).toBe(t !== 'crm_delete_contact');
      }
    });
  });

  describe('K2 property: over many scope maps, every governed tool KEY reaches is one HTTP gives the same map', () => {
    const levelSpellings = ['read', 'write', 'admin', 'none', 'READ', 'Write', 'ADMIN'];
    const legacyKeys = ['finance', 'sales', 'commerce', 'calendar', 'time', 'marketing', 'social', 'helpdesk', 'comms', 'inbox', 'structure', 'hr', 'contracts', 'legal', 'procurement', 'documents'];
    const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
    const maps: Record<string, unknown>[] = [];
    for (const m of CANONICAL_MODULES) {
      for (const l of levelSpellings) maps.push({ [m]: l }, { [m.toUpperCase()]: l }, { [cap(m)]: l });
    }
    for (const k of legacyKeys) for (const l of levelSpellings) maps.push({ [k]: l }, { [k.toUpperCase()]: l });
    for (const m of CANONICAL_MODULES) {
      for (const k of [...legacyKeys, 'crm', 'bookings', 'content', 'projects']) {
        for (const [lm, lk] of [['none', 'admin'], ['read', 'admin'], ['read', 'write'], ['write', 'admin']]) {
          maps.push({ [m]: lm, [k]: lk }, { [m]: lm, [k.toUpperCase()]: lk });
        }
      }
    }
    // crm_view varies too (review 3 IC-1): resolveCrmAccess reads it as viewAll, and the
    // visibility clause it drives bounds the same contact writes crm_edit / crm_delete do.
    for (const view of [undefined, 'all', 'owned', 'ALL', 'bogus', '']) {
      for (const edit of [undefined, 'any', 'owned', 'none', 'ANY', 'bogus']) {
        for (const del of [undefined, 'any', 'owned', 'none']) {
          for (const crm of ['read', 'write', 'admin']) {
            const p: Record<string, unknown> = { crm };
            if (view !== undefined) p.crm_view = view;
            if (edit !== undefined) p.crm_edit = edit;
            if (del !== undefined) p.crm_delete = del;
            maps.push(p);
          }
        }
      }
    }
    maps.push(Object.fromEntries(CANONICAL_MODULES.map((m) => [m.toUpperCase(), 'admin'])));
    maps.push(Object.fromEntries(legacyKeys.map((k) => [k, 'admin'])));

    /** The tools whose service call makes resolveCrmAccess's edit / delete check over HTTP. */
    const CRM_EDIT = ['crm_create_contact', 'crm_update_contact', 'tag_contact'];
    const CRM_DELETE = ['crm_delete_contact'];
    /** The tools whose service ANDs visibilityClause onto the row it writes (review 4 DRV-1). */
    const CRM_ROW_VISIBILITY = ['crm_update_contact', 'tag_contact', 'crm_delete_contact'];

    it(`over ${maps.length} maps: a governed tool KEY reaches is allowed over HTTP`, async () => {
      const memo = new Map<string, boolean>();
      const violations: string[] = [];
      for (const p of maps) {
        const env = envelope(p);
        for (const [tool, module, level] of ROUTED) {
          if (!passes(env, tool)) continue;
          const key = `${JSON.stringify(p)}|${module}|${level}`;
          if (!memo.has(key)) memo.set(key, await httpAllows(p, module, level));
          if (!memo.get(key)) violations.push(`${JSON.stringify(p)} -> ${tool} (${module}:${level})`);
          if (CRM_EDIT.includes(tool) && (await resolveCrmAccess(membershipPrisma(p), 'biz_1', 'u_1')).editScope !== 'any') {
            violations.push(`${JSON.stringify(p)} -> ${tool} (crm_edit is not any)`);
          }
          if (CRM_DELETE.includes(tool) && (await resolveCrmAccess(membershipPrisma(p), 'biz_1', 'u_1')).deleteScope !== 'any') {
            violations.push(`${JSON.stringify(p)} -> ${tool} (crm_delete is not any)`);
          }
          if ([...CRM_EDIT, ...CRM_DELETE].includes(tool) && !(await resolveCrmAccess(membershipPrisma(p), 'biz_1', 'u_1')).viewAll) {
            violations.push(`${JSON.stringify(p)} -> ${tool} (crm_view is not all)`);
          }
          // review 4 DRV-1: the clause hides other members' PRIVATE rows from this STAFF holder whatever crm_view says
          if (CRM_ROW_VISIBILITY.includes(tool) && visibilityClause(await resolveCrmAccess(membershipPrisma(p), 'biz_1', 'u_1'), 'u_1') !== null) {
            violations.push(`${JSON.stringify(p)} -> ${tool} (the service bounds the row by visibilityClause)`);
          }
        }
      }
      expect(violations).toEqual([]);
    });

    it('a tool the routes govern but no single module grants is reached by no map', () => {
      expect(Object.keys(GOVERNED_UNGRANTED)).toEqual(expect.arrayContaining(['update_status_with_confirmation', 'send_message_with_approval']));
      for (const p of maps) {
        const env = envelope(p);
        for (const tool of Object.keys(GOVERNED_UNGRANTED)) expect(passes(env, tool), `${JSON.stringify(p)} -> ${tool}`).toBe(false);
      }
    });
  });
});

/**
 * V1-21b review 3 (IC-1, IC-2). Each case is the review's repro, next to the HTTP answer
 * for the same holder: the real CrmService (with the actor crm.controller passes, and with
 * none, as the dispatcher calls it) for IC-1, and the real StaffChatBridgeService and
 * RoleEngineService crews for IC-2.
 */
describe('V1-21b review 3 — KEY never exceeds HTTP on the same scope map (IC-1, IC-2)', () => {
  const roleEngine = new RoleEngineService({} as never, {} as never, {} as never);
  const oversight = new AiOversightService({ client: {} } as any, {} as any, {} as any, roleEngine, {} as any, policy);
  const reader = (autonomyLevel?: number): AutonomySettingsReader => ({
    autopilotSettings: {
      findUnique: async () =>
        autonomyLevel === undefined ? null : { autonomyLevel, blockedTools: [], approvedTools: [], approvalTimeoutHours: 24 },
    },
    aiMemory: { findUnique: async () => null },
  });

  /** A STAFF membership whose permissionScopes is `scopes` (null: no membership at all). */
  const membershipPrisma = (scopes: Record<string, unknown> | null, extra: Record<string, unknown> = {}) =>
    ({
      client: {
        membership: {
          findUnique: async () => (scopes === null ? null : { userId: 'u_1', businessId: 'biz_1', role: 'STAFF', permissionScopes: scopes }),
        },
        user: { findUnique: async () => ({ id: 'u_1', role: 'STAFF' }) },
        ...extra,
      },
    }) as any;

  /** The real ModuleScopeGuard on a route requiring `module` at `minLevel`: true, or the refusal message. */
  const httpAnswer = async (scopes: Record<string, unknown> | null, module: string, minLevel: Level): Promise<true | string> => {
    const reflector = { get: (key: string) => (key === MODULE_SCOPE_KEY ? { module, minLevel } : undefined) } as any;
    const guard = new ModuleScopeGuard(membershipPrisma(scopes), reflector);
    const ctx = {
      getHandler: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u_1', role: 'STAFF' }, params: { businessId: 'biz_1' } }) }),
    } as any;
    try {
      return (await guard.canActivate(ctx)) as true;
    } catch (err) {
      return (err as Error).message;
    }
  };

  describe("IC-1 — a crm_view 'owned' (my book) position does not create, edit, tag or delete contacts through KEY", () => {
    /** Just enough of Prisma's `where` to evaluate the tenant predicate and visibilityClause on one row. */
    const matches = (row: Record<string, any>, where: Record<string, any> | undefined): boolean =>
      Object.entries(where ?? {}).every(([k, v]) => {
        if (k === 'AND') return (v as Record<string, any>[]).every((w) => matches(row, w));
        if (k === 'OR') return (v as Record<string, any>[]).some((w) => matches(row, w));
        if (k === 'shares') return (row.shares as { userId: string }[]).some((s) => s.userId === v.some.userId);
        if (v && typeof v === 'object' && 'in' in v) return (v.in as unknown[]).includes(row[k]);
        return row[k] === v;
      });

    /** The real CrmService over one contact; a write that gets past every check throws REACHED_WRITE. */
    const crmOn = (scopes: Record<string, unknown>, contact: Record<string, any>) =>
      new CrmService(
        membershipPrisma(scopes, {
          contact: { findFirst: async ({ where }: { where: Record<string, any> }) => (matches(contact, where) ? contact : null) },
          $transaction: async () => {
            throw new Error('REACHED_WRITE');
          },
        }),
        ...([{}, {}, {}, {}, {}, {}, {}, {}, {}] as never[]),
      );

    const OTHERS = { id: 'c_other', businessId: 'biz_1', deletedAt: null, ownerId: 'u_2', visibility: 'TEAM', shares: [] };
    const MINE = { id: 'c_mine', businessId: 'biz_1', deletedAt: null, ownerId: 'u_1', visibility: 'TEAM', shares: [] };
    const SUB_TOOLS = ['crm_create_contact', 'crm_update_contact', 'tag_contact', 'crm_delete_contact'];

    it.each([[{ crm: 'admin', crm_view: 'owned' }], [{ crm: 'write', crm_view: 'owned' }]])(
      "%j: HTTP answers 404 on another member's contact, the dispatcher's call reaches it, so KEY refuses the contact writes",
      async (permissions) => {
        expect(jobRolePermissionsProblem(permissions)).toBeNull();
        expect(await httpAnswer(permissions, 'crm', 'write')).toBe(true);
        const access = await resolveCrmAccess(membershipPrisma(permissions), 'biz_1', 'u_1');
        expect(access).toMatchObject({ viewAll: false, editScope: 'any' });

        const crm = crmOn(permissions, OTHERS);
        // HTTP: crm.controller passes the member as the actor (PATCH / DELETE contacts/:contactId)
        await expect(crm.updateContact({ businessId: 'biz_1', contactId: 'c_other', firstName: 'X', actorUserId: 'u_1' })).rejects.toThrow(NotFoundException);
        await expect(crm.softDeleteContact({ businessId: 'biz_1', contactId: 'c_other', actorUserId: 'u_1' })).rejects.toThrow(NotFoundException);
        // KEY: the dispatcher's arguments carry no actor, so the visibility clause never runs
        await expect(crm.updateContact({ businessId: 'biz_1', contactId: 'c_other', firstName: 'X' })).rejects.toThrow('REACHED_WRITE');
        await expect(crm.softDeleteContact({ businessId: 'biz_1', contactId: 'c_other' })).rejects.toThrow('REACHED_WRITE');
        // the holder edits their own book over HTTP; KEY cannot be kept to it, so it is withheld whole
        await expect(
          crmOn(permissions, MINE).updateContact({ businessId: 'biz_1', contactId: 'c_mine', firstName: 'X', actorUserId: 'u_1' }),
        ).rejects.toThrow('REACHED_WRITE');

        for (const tool of SUB_TOOLS) {
          for (const autonomyLevel of [undefined, 3]) {
            const d = await oversight.evaluate('biz_1', tool, undefined, [], envelope(permissions), reader(autonomyLevel));
            expect(d.allowed, `${tool} @ ${autonomyLevel}`).toBe(false);
            expect(d.reason).toMatch(/outside the Position position's scope/);
          }
        }
      },
    );

    it.each([
      [{ crm: 'admin', crm_view: 'ALL' }],
      [{ crm: 'admin', crm_view: 'bogus' }],
      [{ crm: 'write', crm_view: 'owned', crm_edit: 'any', crm_delete: 'any' }],
    ])('%j: any crm_view resolveCrmAccess does not read as all withholds them too', async (permissions) => {
      expect((await resolveCrmAccess(membershipPrisma(permissions), 'biz_1', 'u_1')).viewAll).toBe(false);
      for (const tool of SUB_TOOLS) expect(passes(envelope(permissions), tool), tool).toBe(false);
    });

    it('positive controls: crm_view all, or the level default, keeps them; tools crm_view does not bound stay reached', async () => {
      // of SUB_TOOLS only crm_create_contact: the others' service also bounds the row by
      // visibilityClause, which crm_view 'all' does not lift (review 4 DRV-1)
      for (const permissions of [{ crm: 'admin' }, { crm: 'admin', crm_view: 'all' }]) {
        expect((await resolveCrmAccess(membershipPrisma(permissions), 'biz_1', 'u_1')).viewAll).toBe(true);
        for (const tool of SUB_TOOLS) {
          expect(passes(envelope(permissions), tool), `${JSON.stringify(permissions)} ${tool}`).toBe(tool === 'crm_create_contact');
        }
      }
      expect(
        await oversight.evaluate('biz_1', 'crm_create_contact', undefined, [], envelope({ crm: 'write', crm_view: 'all' }), reader()),
      ).toMatchObject({ allowed: true });
      // CrmDealsService and CrmTimelineService.addNote apply no CRM visibility over HTTP either
      const owned = envelope({ crm: 'write', crm_view: 'owned' });
      for (const tool of ['deals_mark_won', 'crm_add_note', 'deals_list']) expect(passes(owned, tool), tool).toBe(true);
    });
  });

  describe('IC-2 — a staff position with no JobRole gets the baseline envelope, not the text-detected crew', () => {
    const PHONE = '+18685550100';
    const MESSAGE = 'update the deal pipeline and create an invoice for the lead';

    /** The real StaffChatBridgeService over one assignment; returns the pageContext KEY chat was given. */
    const routeThroughBridge = async (jobRole: { id: string; name: string; permissions: unknown } | null) => {
      const assignment = {
        id: 'as_1',
        businessId: 'biz_1',
        contactPhone: PHONE,
        contactName: 'Pat',
        contactEmail: null,
        userId: null,
        jobRoleId: jobRole?.id ?? null,
        jobRole,
        autoApprovalViaReply: false,
        activeFlowSessionId: null,
      };
      let pageContext: { jobRoleEnvelope?: JobRoleEnvelope } | undefined;
      /** Review 7 ENV-FORGE: the envelope is a server-only argument of chat(), never in pageContext. */
      let trusted: { jobRoleEnvelope?: JobRoleEnvelope } | undefined;
      const orchestrator = {
        getConversationHistory: async () => [],
        chat: async (_b: string, _m: string, _h: unknown, _a: unknown, ctx: typeof pageContext, _r?: unknown, _at?: unknown, _s?: unknown, _u?: unknown, server?: typeof trusted) => {
          trusted = server;
          pageContext = ctx;
          return { reply: 'ok', sessionId: 's_1' };
        },
      };
      const moduleRef = {
        get: (token: unknown) =>
          token === FlowOrchestratorService
            ? orchestrator
            : token === JobRolePolicyService
              ? policy
              : token === AiOversightService
                ? oversight
                : undefined,
      };
      const structure = { resolveStaffByPhone: async () => assignment, setActiveFlowSession: async () => undefined };
      const bridge = new StaffChatBridgeService(structure as any, { client: {} } as any, moduleRef as any);
      expect(await bridge.routeInboundMessage('biz_1', PHONE, MESSAGE, 'whatsapp')).toMatchObject({ handled: true });
      expect(pageContext?.jobRoleEnvelope, 'no envelope in the client-shaped pageContext').toBeUndefined();
      return trusted;
    };

    it('OrgAssignment.jobRole is SetNull on delete, so deleting a JobRole leaves its holders with none', () => {
      const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'OrgAssignment');
      expect(model?.fields.find((f) => f.name === 'jobRole')?.relationOnDelete).toBe('SetNull');
    });

    it.each([
      [['general'], ['crm_update_contact', 'commerce_create_invoice', 'payments_refund_charge', 'deals_mark_won']],
      [['operator'], ['payments_refund_charge', 'execute_custom_logic']],
      [['finance'], ['payroll_approve_run']],
    ] as Array<[BusinessRole[], string[]]>)('crew %j: a role-less position reaches none of %j, as HTTP gives it nothing', async (crew, tools) => {
      // HTTP: the holder has no membership, so every scoped route refuses
      expect(await httpAnswer(null, 'crm', 'write')).toBe('Not a member of this business');
      const ctx = await routeThroughBridge(null);
      expect(ctx?.jobRoleEnvelope, 'the bridge passes an envelope').toBeDefined();
      for (const tool of tools) {
        // the repro: without an envelope the crew answers, and grants it
        expect((await oversight.evaluate('biz_1', tool, undefined, crew, undefined, reader(3))).allowed, `${tool} without an envelope`).toBe(true);
        const d = await oversight.evaluate('biz_1', tool, undefined, crew, ctx!.jobRoleEnvelope, reader(3));
        expect(d.allowed, `${crew} ${tool}`).toBe(false);
        expect(d.reason).toMatch(/outside the .* position's scope/);
      }
    });

    it('the role-less envelope is the baseline exactly: what an empty permissions map reaches', async () => {
      const env = (await routeThroughBridge(null))!.jobRoleEnvelope!;
      expect(REGISTRY.filter((t) => passes(env, t)).sort()).toEqual(REGISTRY.filter((t) => passes(envelope({}), t)).sort());
      expect(env.maxRiskTier).toBe(1);
      expect(await oversight.evaluate('biz_1', 'documents_list', undefined, ['general'], env, reader(3))).toMatchObject({ allowed: true });
    });

    it('control: the same position while its role existed is scoped by it', async () => {
      const ctx = await routeThroughBridge({ id: 'jr_1', name: 'Position', permissions: { bookings: 'read' } });
      const d = await oversight.evaluate('biz_1', 'commerce_create_invoice', undefined, ['general'], ctx!.jobRoleEnvelope, reader(3));
      expect(d).toMatchObject({ allowed: false });
      expect(d.reason).toMatch(/outside the Position position's scope/);
      expect(
        await oversight.evaluate('biz_1', 'calendar_list_events', undefined, ['general'], ctx!.jobRoleEnvelope, reader(3)),
      ).toMatchObject({ allowed: true });
    });
  });
});

/**
 * V1-21b review 4 (DRV-1, IC3-1). Each case is the review's repro next to the HTTP answer
 * for the same holder.
 *
 * DRV-1: crm_view 'all' does not mean the whole book. For every member but the OWNER,
 * visibilityClause keeps another member's PRIVATE contact out of what updateContact and
 * softDeleteContact reach with an actor (PATCH / DELETE contacts/:contactId answer 404). The
 * dispatcher passes no actor, so KEY reached that row on the default { crm: 'write' } map.
 *
 * IC3-1: the bridge built the envelope from the phone's position's JobRole alone, while
 * ModuleScopeGuard and resolveCrmAccess enforce the holder's Membership.permissionScopes.
 * The two drift apart when the member holds a second position, is narrowed by PATCH
 * team/:m/permissions, or changes role; a membership-backed position is now bounded by the
 * membership's own scopes.
 */
describe('V1-21b review 4 — KEY never exceeds HTTP for the same holder (DRV-1, IC3-1)', () => {
  const roleEngine = new RoleEngineService({} as never, {} as never, {} as never);
  const oversight = new AiOversightService({ client: {} } as any, {} as any, {} as any, roleEngine, {} as any, policy);
  const reader = (autonomyLevel?: number): AutonomySettingsReader => ({
    autopilotSettings: {
      findUnique: async () =>
        autonomyLevel === undefined ? null : { autonomyLevel, blockedTools: [], approvedTools: [], approvalTimeoutHours: 24 },
    },
    aiMemory: { findUnique: async () => null },
  });

  /** A membership row as ModuleScopeGuard and resolveCrmAccess read it (null: none at all). */
  type MembershipRow = { role: string; permissionScopes: unknown };
  const STAFF = (permissionScopes: unknown): MembershipRow => ({ role: 'STAFF', permissionScopes });
  const memberPrisma = (m: MembershipRow | null, extra: Record<string, unknown> = {}) =>
    ({
      client: {
        membership: { findUnique: async () => (m === null ? null : { userId: 'u_1', businessId: 'biz_1', ...m }) },
        user: { findUnique: async () => ({ id: 'u_1', role: 'USER' }) },
        ...extra,
      },
    }) as any;

  /** The real ModuleScopeGuard on a route requiring `module` at `minLevel`: true, or the refusal message. */
  const httpAnswer = async (m: MembershipRow | null, module: string, minLevel: Level): Promise<true | string> => {
    const reflector = { get: (key: string) => (key === MODULE_SCOPE_KEY ? { module, minLevel } : undefined) } as any;
    const guard = new ModuleScopeGuard(memberPrisma(m), reflector);
    const ctx = {
      getHandler: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u_1', role: 'USER' }, params: { businessId: 'biz_1' } }) }),
    } as any;
    try {
      return (await guard.canActivate(ctx)) as true;
    } catch (err) {
      return (err as Error).message;
    }
  };

  const ROW_VISIBILITY = ((policyExports as Record<string, unknown>).CRM_ROW_VISIBILITY_TOOLS ?? []) as readonly string[];
  const VISIBILITY_BOUND = ['crm_delete_contact', 'crm_update_contact', 'tag_contact'];

  describe("DRV-1 — crm_view 'all' is not the whole book: KEY does not edit, tag or delete contacts", () => {
    /** Just enough of Prisma's `where` to evaluate the tenant predicate and visibilityClause on one row. */
    const rowMatches = (row: Record<string, any>, where: Record<string, any> | null | undefined): boolean =>
      Object.entries(where ?? {}).every(([k, v]) => {
        if (k === 'AND') return (v as Record<string, any>[]).every((w) => rowMatches(row, w));
        if (k === 'OR') return (v as Record<string, any>[]).some((w) => rowMatches(row, w));
        if (k === 'shares') return (row.shares as { userId: string }[]).some((s) => s.userId === v.some.userId);
        if (v && typeof v === 'object' && 'in' in v) return (v.in as unknown[]).includes(row[k]);
        return row[k] === v;
      });

    /** The real CrmService over one contact; a write that gets past every check throws REACHED_WRITE. */
    const crmOn = (m: MembershipRow, contact: Record<string, any>) =>
      new CrmService(
        memberPrisma(m, {
          contact: { findFirst: async ({ where }: { where: Record<string, any> }) => (rowMatches(contact, where) ? contact : null) },
          $transaction: async () => {
            throw new Error('REACHED_WRITE');
          },
        }),
        ...([{}, {}, {}, {}, {}, {}, {}, {}, {}] as never[]),
      );

    // staffB's PRIVATE contact; the holder is u_1
    const PRIVATE_OF_B = { id: 'c', businessId: 'biz_1', deletedAt: null, ownerId: 'u_staffB', visibility: 'PRIVATE', shares: [], notesInternal: 'secret' };
    const TEAM_OF_B = { ...PRIVATE_OF_B, id: 'c_team', visibility: 'TEAM' };

    it('the policy names the tools whose service bounds the row by visibilityClause', () => {
      expect([...ROW_VISIBILITY].sort()).toEqual(VISIBILITY_BOUND);
    });

    it.each([
      [{ crm: 'write' }, 'crm_update_contact', { companyName: 'KEY-EDIT' }],
      [{ crm: 'write' }, 'tag_contact', { tags: ['vip'] }],
      [{ crm: 'admin' }, 'crm_update_contact', { companyName: 'KEY-EDIT' }],
      [{ crm: 'write', crm_view: 'all', crm_edit: 'any' }, 'crm_update_contact', { companyName: 'KEY-EDIT' }],
      [{ crm: 'admin', crm_view: 'all', crm_edit: 'any' }, 'tag_contact', { tags: ['vip'] }],
    ])("%j: PATCH answers 404 on another member's PRIVATE contact, the dispatcher's call reaches it, so KEY refuses %s", async (permissions, tool, patch) => {
      expect(jobRolePermissionsProblem(permissions)).toBeNull();
      expect(await httpAnswer(STAFF(permissions), 'crm', 'write')).toBe(true);
      expect(await resolveCrmAccess(memberPrisma(STAFF(permissions)), 'biz_1', 'u_1')).toMatchObject({ viewAll: true, editScope: 'any' });

      const crm = crmOn(STAFF(permissions), PRIVATE_OF_B);
      // HTTP: crm.controller passes the member as the actor; the visibility clause hides the row
      await expect(crm.updateContact({ businessId: 'biz_1', contactId: 'c', ...patch, actorUserId: 'u_1' })).rejects.toThrow('Contact not found');
      // KEY: the dispatcher passes no actor, so the clause never runs and the row is written
      await expect(crm.updateContact({ businessId: 'biz_1', contactId: 'c', ...patch })).rejects.toThrow('REACHED_WRITE');

      for (const autonomyLevel of [undefined, 3]) {
        const d = await oversight.evaluate('biz_1', tool, undefined, [], envelope(permissions), reader(autonomyLevel));
        expect(d.allowed, `${tool} @ ${autonomyLevel}`).toBe(false);
        expect(d.reason).toMatch(/outside the Position position's scope/);
      }
    });

    it.each([[{ crm: 'admin' }], [{ crm: 'admin', crm_view: 'all', crm_delete: 'any' }]])(
      "%j: DELETE answers 404 on another member's PRIVATE contact, the dispatcher's call reaches it, so KEY refuses crm_delete_contact",
      async (permissions) => {
        expect(await httpAnswer(STAFF(permissions), 'crm', 'write')).toBe(true);
        expect(await resolveCrmAccess(memberPrisma(STAFF(permissions)), 'biz_1', 'u_1')).toMatchObject({ viewAll: true, deleteScope: 'any' });
        const crm = crmOn(STAFF(permissions), PRIVATE_OF_B);
        await expect(crm.softDeleteContact({ businessId: 'biz_1', contactId: 'c', actorUserId: 'u_1' })).rejects.toThrow(NotFoundException);
        await expect(crm.softDeleteContact({ businessId: 'biz_1', contactId: 'c' })).rejects.toThrow('REACHED_WRITE');
        for (const autonomyLevel of [undefined, 3]) {
          const d = await oversight.evaluate('biz_1', 'crm_delete_contact', undefined, [], envelope(permissions), reader(autonomyLevel));
          expect(d.allowed, `crm_delete_contact @ ${autonomyLevel}`).toBe(false);
          expect(d.reason).toMatch(/outside the Position position's scope/);
        }
      },
    );

    it('no member but the OWNER escapes the clause, so no scope map reaches these tools', async () => {
      for (const role of ['STAFF', 'ADMIN', 'MANAGER']) {
        for (const scopes of [null, { crm: 'admin' }, { crm: 'admin', crm_view: 'all' }, { crm: 'write', crm_view: 'all', crm_edit: 'any', crm_delete: 'any' }]) {
          const access = await resolveCrmAccess(memberPrisma({ role, permissionScopes: scopes }), 'biz_1', 'u_1');
          const clause = visibilityClause(access, 'u_1');
          expect(clause, `${role} ${JSON.stringify(scopes)}`).not.toBeNull();
          expect(rowMatches(PRIVATE_OF_B, clause), `${role} ${JSON.stringify(scopes)}`).toBe(false);
        }
      }
      // the OWNER sees the whole book; a JobRole map cannot say who holds it (an owner decision)
      expect(visibilityClause(await resolveCrmAccess(memberPrisma({ role: 'OWNER', permissionScopes: { crm: 'write' } }), 'biz_1', 'u_1'), 'u_1')).toBeNull();

      const maps: Record<string, unknown>[] = [Object.fromEntries(CANONICAL_MODULES.map((m) => [m, 'admin'])), { crm: 'admin', sales: 'admin', finance: 'admin' }];
      for (const crm of LEVELS) {
        for (const view of [undefined, 'all', 'owned']) {
          for (const edit of [undefined, 'any', 'owned', 'none']) {
            for (const del of [undefined, 'any', 'owned', 'none']) {
              const p: Record<string, unknown> = { crm };
              if (view) p.crm_view = view;
              if (edit) p.crm_edit = edit;
              if (del) p.crm_delete = del;
              maps.push(p);
            }
          }
        }
      }
      for (const k of ['CRM', 'Crm', 'sales', 'SALES']) for (const l of ['read', 'write', 'admin', 'ADMIN']) maps.push({ [k]: l });
      for (const p of maps) {
        for (const tool of VISIBILITY_BOUND) expect(passes(envelope(p), tool), `${JSON.stringify(p)} -> ${tool}`).toBe(false);
      }
    });

    it('positive controls: the CRM tools the clause does not bound on the KEY path stay reached', async () => {
      // the holder does edit a TEAM contact by hand; KEY still cannot be kept to the rows the holder sees
      await expect(
        crmOn(STAFF({ crm: 'write' }), TEAM_OF_B).updateContact({ businessId: 'biz_1', contactId: 'c_team', companyName: 'X', actorUserId: 'u_1' }),
      ).rejects.toThrow('REACHED_WRITE');
      // createContact applies the clause only to name the holder of a 409, and the dispatcher returns error.message alone
      expect(await oversight.evaluate('biz_1', 'crm_create_contact', undefined, [], envelope({ crm: 'write' }), reader())).toMatchObject({ allowed: true });
      for (const tool of ['deals_mark_won', 'crm_add_note', 'crm_add_task', 'deals_create', 'crm_update_deal']) {
        expect(passes(envelope({ crm: 'write' }), tool), tool).toBe(true);
      }
      expect(await oversight.evaluate('biz_1', 'deals_delete', undefined, [], envelope({ crm: 'admin' }), reader())).toMatchObject({
        allowed: true,
        requiresFormalApproval: true,
      });
    });
  });

  describe('IC3-1 — a membership-backed position is bounded by the membership HTTP enforces', () => {
    const PHONE = '+18685550100';
    const MESSAGE = 'invoice the lead, send a payment link, mark the deal won and update the contact';
    const SALES_LEAD = { id: 'jr_A', name: 'Sales Lead', permissions: { revenue: 'admin', crm: 'admin' } };
    const BOOKINGS_READ = { id: 'jr_B', name: 'Front desk', permissions: { bookings: 'read' } };
    const REVENUE_WRITES = ['commerce_create_invoice', 'payments_create_link', 'commerce_mark_invoice_paid', 'payments_refund_charge'];
    const CRM_WRITES = ['deals_mark_won', 'crm_create_contact', 'crm_add_note', 'deals_delete'];

    type Position = { membershipId: string | null; userId: string | null; jobRole: typeof SALES_LEAD | null };

    /**
     * The holder's User row (an active account) on the membership, when resolveStaffByPhone
     * asks Prisma for it, with only the fields it selects (review 5 INP4-1).
     */
    const activeUserFor = (membershipInclude: unknown): { user?: Record<string, unknown> } => {
      const userInclude = (membershipInclude as { include?: { user?: true | { select?: Record<string, boolean> } } })?.include?.user;
      if (!userInclude) return {};
      const row: Record<string, unknown> = { id: 'u_1', role: 'USER', deletedAt: null, bannedAt: null };
      const select = userInclude === true ? undefined : userInclude.select;
      return { user: select ? Object.fromEntries(Object.entries(row).filter(([k]) => select[k])) : row };
    };

    /**
     * The real StructureService.resolveStaffByPhone over one assignment row (Prisma answers only
     * the relations it asks for), then the real StaffChatBridgeService; returns the envelope KEY
     * chat was given and the include resolveStaffByPhone asked for.
     */
    const routeThroughBridge = async (position: Position, membership: MembershipRow | null) => {
      let include: Record<string, unknown> | undefined;
      const prisma = {
        client: {
          orgAssignment: {
            findFirst: async (args: { include?: Record<string, unknown> }) => {
              include = args.include;
              return {
                id: 'as_1',
                businessId: 'biz_1',
                contactPhone: PHONE,
                contactName: null,
                contactEmail: null,
                isContactOnly: position.membershipId === null,
                membershipId: position.membershipId,
                userId: position.userId,
                jobRoleId: position.jobRole?.id ?? null,
                orgUnitId: 'ou_1',
                autoApprovalViaReply: false,
                activeFlowSessionId: null,
                ...(args.include?.jobRole ? { jobRole: position.jobRole } : {}),
                ...(args.include?.orgUnit ? { orgUnit: { id: 'ou_1' } } : {}),
                ...(args.include?.membership
                  ? {
                      // the holder's row in this business, as the HTTP harness reads it (review 6 INP5-1)
                      membership:
                        membership === null
                          ? null
                          : { id: position.membershipId, userId: 'u_1', businessId: 'biz_1', ...membership, ...activeUserFor(args.include.membership) },
                    }
                  : {}),
              };
            },
            update: async () => ({}),
          },
          // review 7 INP4-3: no member's account phone is this phone
          membership: { findMany: async () => [] },
        },
      };
      const structure = new StructureService(prisma as any);
      let pageContext: { jobRoleEnvelope?: JobRoleEnvelope } | undefined;
      /** Review 7 ENV-FORGE: the envelope is a server-only argument of chat(), never in pageContext. */
      let trusted: { jobRoleEnvelope?: JobRoleEnvelope } | undefined;
      const orchestrator = {
        getConversationHistory: async () => [],
        chat: async (_b: string, _m: string, _h: unknown, _a: unknown, ctx: typeof pageContext, _r?: unknown, _at?: unknown, _s?: unknown, _u?: unknown, server?: typeof trusted) => {
          trusted = server;
          pageContext = ctx;
          return { reply: 'ok', sessionId: 's_1' };
        },
      };
      const moduleRef = {
        get: (token: unknown) =>
          token === FlowOrchestratorService ? orchestrator : token === JobRolePolicyService ? policy : token === AiOversightService ? oversight : undefined,
      };
      const bridge = new StaffChatBridgeService(structure, { client: {} } as any, moduleRef as any);
      expect(await bridge.routeInboundMessage('biz_1', PHONE, MESSAGE, 'whatsapp')).toMatchObject({ handled: true });
      expect(pageContext?.jobRoleEnvelope, 'no envelope in the client-shaped pageContext').toBeUndefined();
      expect(trusted?.jobRoleEnvelope, 'the bridge passes an envelope, as a server-only argument').toBeDefined();
      return { env: trusted!.jobRoleEnvelope!, include };
    };
    const MEMBER: Position = { membershipId: 'm_1', userId: 'u_1', jobRole: SALES_LEAD };
    const reachedBy = (env: JobRoleEnvelope) => REGISTRY.filter((t) => passes(env, t)).sort();

    it('the repro: the Sales Lead envelope alone lets KEY take revenue and CRM writes', async () => {
      expect(jobRolePermissionsProblem(SALES_LEAD.permissions)).toBeNull();
      expect(jobRolePermissionsProblem(BOOKINGS_READ.permissions)).toBeNull();
      const alone = policy.envelopeForJobRole(SALES_LEAD);
      expect(await oversight.evaluate('biz_1', 'commerce_create_invoice', undefined, [], alone, reader())).toMatchObject({
        allowed: true,
        tier: 2,
        requiresQuickConfirm: true,
      });
      expect(await oversight.evaluate('biz_1', 'deals_mark_won', undefined, [], alone, reader())).toMatchObject({ allowed: true, requiresQuickConfirm: true });
      expect(await oversight.evaluate('biz_1', 'payments_refund_charge', undefined, [], alone, reader())).toMatchObject({
        allowed: true,
        requiresFormalApproval: true,
      });
    });

    it.each([
      // (a) the member's primary position (Front desk) holds the membership copy; the phone sits on Sales Lead
      ['(a) a second, primary position holds the copy', 'revenue', STAFF(BOOKINGS_READ.permissions), 'Insufficient permissions: revenue requires write access (you have none)'],
      ['(a) a second, primary position holds the copy', 'crm', STAFF(BOOKINGS_READ.permissions), 'Insufficient permissions: crm requires write access (you have none)'],
      // (b) PATCH team/:m/permissions narrowed the member
      ['(b) narrowed by updateMemberPermissions', 'crm', STAFF({ crm: 'read' }), 'Insufficient permissions: crm requires write access (you have read)'],
      ['(b) narrowed by updateMemberPermissions', 'revenue', STAFF({ crm: 'read' }), 'Insufficient permissions: revenue requires write access (you have none)'],
      // (c) updateMemberRole reset the scopes to the STAFF defaults (written out, or left to the role)
      ['(c) role change to the STAFF defaults', 'revenue', STAFF(defaultScopesForRole('STAFF')), 'Insufficient permissions: revenue requires write access (you have read)'],
      ['(c) role change to the STAFF defaults', 'crm', STAFF(defaultScopesForRole('STAFF')), 'Insufficient permissions: crm requires write access (you have read)'],
      ['(c) role defaults, no explicit map', 'revenue', STAFF(null), 'Insufficient permissions: revenue requires write access (you have read)'],
    ] as Array<[string, 'revenue' | 'crm', MembershipRow, string]>)('%s: HTTP refuses %s:write, and so does KEY', async (_label, module, membership, refusal) => {
      expect(await httpAnswer(membership, module, 'write')).toBe(refusal);
      const { env, include } = await routeThroughBridge(MEMBER, membership);
      // and the holder's account state with it (review 5 INP4-1)
      expect(include, 'resolveStaffByPhone loads the holder membership with the position').toMatchObject({
        jobRole: true,
        membership: { include: { user: { select: { deletedAt: true, bannedAt: true } } } },
      });
      expect(env.jobRoleName).toBe('Sales Lead');
      for (const tool of module === 'revenue' ? REVENUE_WRITES : CRM_WRITES) {
        for (const autonomyLevel of [undefined, 3]) {
          const d = await oversight.evaluate('biz_1', tool, undefined, ['general'], env, reader(autonomyLevel));
          expect(d.allowed, `${tool} @ ${autonomyLevel}`).toBe(false);
          expect(d.reason).toMatch(/Sales Lead position's (scope|tier)/);
        }
      }
    });

    it('what the bounded envelope still reaches is what both the position and the membership reach', async () => {
      // (a) the membership copy is { bookings: read }, which Sales Lead does not hold: the baseline is left
      expect(reachedBy((await routeThroughBridge(MEMBER, STAFF(BOOKINGS_READ.permissions))).env)).toEqual(reachedBy(envelope({})));
      // (b) crm:read: the CRM reads both reach stay reached
      const narrowed = (await routeThroughBridge(MEMBER, STAFF({ crm: 'read' }))).env;
      for (const tool of ['deals_list', 'crm_list_contacts', 'call_list_tasks']) expect(passes(narrowed, tool), tool).toBe(true);
      expect(narrowed.maxRiskTier).toBe(1);
      // (c) the STAFF defaults read revenue and crm: the reads stay reached, the writes do not
      for (const scopes of [defaultScopesForRole('STAFF'), null]) {
        const reset = (await routeThroughBridge(MEMBER, STAFF(scopes))).env;
        for (const tool of ['payments_list_transactions', 'commerce_list_invoices', 'deals_list']) expect(passes(reset, tool), `${tool} ${scopes}`).toBe(true);
        expect(reachedBy(reset)).toEqual(
          reachedBy(policy.envelopeForJobRole(SALES_LEAD)).filter((t) => passes(envelope(defaultScopesForRole('STAFF')), t)),
        );
      }
    });

    it('controls: a membership holding the position copy, and a contact-only position, keep the JobRole envelope', async () => {
      const copy = (await routeThroughBridge(MEMBER, STAFF(SALES_LEAD.permissions))).env;
      expect(reachedBy(copy)).toEqual(reachedBy(policy.envelopeForJobRole(SALES_LEAD)));
      expect(await oversight.evaluate('biz_1', 'commerce_create_invoice', undefined, [], copy, reader())).toMatchObject({
        allowed: true,
        requiresQuickConfirm: true,
      });
      const contactOnly = (await routeThroughBridge({ membershipId: null, userId: null, jobRole: SALES_LEAD }, null)).env;
      expect(reachedBy(contactOnly)).toEqual(reachedBy(policy.envelopeForJobRole(SALES_LEAD)));
    });

    it('fail closed: a membership-backed position whose membership cannot be read keeps the baseline only', async () => {
      expect(await httpAnswer(null, 'revenue', 'write')).toBe('Not a member of this business');
      const env = (await routeThroughBridge(MEMBER, null)).env;
      expect(reachedBy(env)).toEqual(reachedBy(envelope({})));
      expect(env.maxRiskTier).toBe(1);
      // the same position with the membership not loaded at all
      expect(reachedBy(policy.envelopeForPosition({ jobRole: SALES_LEAD, membershipId: 'm_1' } as any))).toEqual(reachedBy(envelope({})));
      expect(reachedBy(policy.envelopeForPosition({ jobRole: SALES_LEAD, membershipId: null, userId: 'u_1' } as any))).toEqual(reachedBy(envelope({})));
    });

    it('K2 property: over position x membership maps, a governed tool KEY reaches is one HTTP gives the holder', async () => {
      const ROUTED = Object.entries(CANONICAL_MODULE_TOOLS).flatMap(([m, tools]) =>
        Object.entries(tools).map(([t, l]) => [t, m, l] as [string, string, Level]),
      );
      const positions: Record<string, unknown>[] = [
        SALES_LEAD.permissions,
        { crm: 'write' },
        { revenue: 'write', crm: 'read' },
        { operations: 'admin', team: 'read', expenses: 'write' },
        Object.fromEntries(CANONICAL_MODULES.map((m) => [m, 'admin'])),
        { sales: 'admin', finance: 'admin', crm: 'admin' },
      ];
      const memberships: MembershipRow[] = [];
      for (const role of ['STAFF', 'ADMIN', 'OWNER', 'MANAGER']) memberships.push({ role, permissionScopes: null }, { role, permissionScopes: {} });
      for (const m of CANONICAL_MODULES) for (const l of [...LEVELS, 'none', 'WRITE']) memberships.push(STAFF({ [m]: l }));
      for (const p of positions) memberships.push(STAFF(p));
      memberships.push(
        STAFF({ crm: 'admin', crm_edit: 'none', crm_delete: 'none' }),
        STAFF({ crm: 'write', crm_view: 'owned' }),
        STAFF({ REVENUE: 'admin', CRM: 'admin' }),
        STAFF(['admin']),
      );

      const memo = new Map<string, true | string>();
      const violations: string[] = [];
      let reached = 0;
      for (const p of positions) {
        const jobRole = { id: 'jr_1', name: 'Position', permissions: p as any };
        const alone = policy.envelopeForJobRole(jobRole);
        for (const membership of memberships) {
          // an active account (review 5 INP4-1 pins the deleted and banned ones)
          // the holder's own row in the assignment's business (review 6 INP5-1 pins the others)
          const env = policy.envelopeForPosition({
            jobRole,
            businessId: 'biz_1',
            membershipId: 'm_1',
            membership: { userId: 'u_1', businessId: 'biz_1', ...membership, user: { deletedAt: null, bannedAt: null } },
          } as any);
          const access = await resolveCrmAccess(memberPrisma(membership), 'biz_1', 'u_1');
          const at = `${JSON.stringify(p)} / ${JSON.stringify(membership)}`;
          for (const [tool, module, level] of ROUTED) {
            if (!passes(env, tool)) continue;
            reached++;
            if (!passes(alone, tool)) violations.push(`${at} -> ${tool} (beyond the position)`);
            const key = `${JSON.stringify(membership)}|${module}|${level}`;
            if (!memo.has(key)) memo.set(key, await httpAnswer(membership, module, level));
            if (memo.get(key) !== true) violations.push(`${at} -> ${tool} (${memo.get(key)})`);
            if (['crm_create_contact', 'crm_update_contact', 'tag_contact'].includes(tool) && !access.isOwner && access.editScope !== 'any') {
              violations.push(`${at} -> ${tool} (crm_edit ${access.editScope})`);
            }
            if (tool === 'crm_create_contact' && !access.isOwner && !access.viewAll) violations.push(`${at} -> ${tool} (crm_view)`);
            if (VISIBILITY_BOUND.includes(tool)) violations.push(`${at} -> ${tool} (row visibility)`);
          }
        }
      }
      expect(reached, 'the property is not vacuous').toBeGreaterThan(100);
      expect(violations).toEqual([]);
    });
  });
});

/**
 * V1-21b review 5 (INP4-1). HTTP checks the account before any scope: AuthMiddleware drops a
 * token whose User row is soft-deleted (deletedAt) or banned (bannedAt), so ModuleScopeGuard
 * answers 'Authentication required' on every route and the holder can do nothing. The bridge
 * bounded a member-held position by the membership's scopes but never read the membership's
 * user, so a banned or deleted holder kept the whole JobRole ∩ membership reach over
 * WhatsApp/SMS. Such a holder, and one whose account state was not loaded, now keeps the
 * baseline only, as a holder with no membership does.
 */
describe('V1-21b review 5 — a deleted or banned holder reaches over KEY nothing HTTP refuses (INP4-1)', () => {
  const roleEngine = new RoleEngineService({} as never, {} as never, {} as never);
  const oversight = new AiOversightService({ client: {} } as any, {} as any, {} as any, roleEngine, {} as any, policy);

  const PHONE = '+18685551901';
  const MESSAGE = 'invoice the client 500 and mark the deal won';
  const SALES_LEAD = { id: 'jr_A', name: 'Sales Lead', permissions: { revenue: 'admin', crm: 'admin' } };
  type MembershipRow = { role: string; permissionScopes: unknown };
  /** The copy StructureService.createAssignment writes on the membership for this role. */
  const COPY: MembershipRow = { role: 'STAFF', permissionScopes: { crm: 'admin', revenue: 'admin' } };
  type UserState = { deletedAt: Date | null; bannedAt: Date | null };
  const ACTIVE: UserState = { deletedAt: null, bannedAt: null };
  const BANNED: UserState = { deletedAt: null, bannedAt: new Date('2026-10-30T12:00:00Z') };
  const DELETED: UserState = { deletedAt: new Date('2026-10-30T12:00:00Z'), bannedAt: null };
  const BOTH: UserState = { deletedAt: new Date('2026-10-30T12:00:00Z'), bannedAt: new Date('2026-10-30T12:00:00Z') };

  const ROUTED = Object.entries(CANONICAL_MODULE_TOOLS).flatMap(([m, tools]) => Object.entries(tools).map(([t, l]) => [t, m, l] as [string, string, Level]));
  const reachedBy = (env: JobRoleEnvelope) => REGISTRY.filter((t) => passes(env, t)).sort();

  /** The AutopilotSettings row the real DefaultTriggersService.seedForBusiness writes for a new business. */
  const seededSettings = async (): Promise<Record<string, unknown>> => {
    let row: Record<string, unknown> | undefined;
    const prisma = {
      client: {
        agentTrigger: { count: async () => 0, create: async () => ({}) },
        autopilotSettings: {
          upsert: async (args: { create: Record<string, unknown> }) => {
            row = args.create;
            return row;
          },
        },
      },
    };
    await new DefaultTriggersService(prisma as any).seedForBusiness('biz_1');
    expect(row, 'seedForBusiness writes the AutopilotSettings row').toBeDefined();
    return row!;
  };
  const reader = (row: Record<string, unknown>): AutonomySettingsReader => ({
    autopilotSettings: { findUnique: async () => row as any },
    aiMemory: { findUnique: async () => null },
  });

  /**
   * The HTTP answer for the holder: the real AuthMiddleware on a bearer token Supabase verifies
   * as u_1 (no logout marker), then the real ModuleScopeGuard on a route requiring `module` at
   * `minLevel` with the request the middleware left. True, or the refusal message.
   */
  const httpAnswer = async (user: UserState, membership: MembershipRow, module: string, minLevel: Level): Promise<true | string> => {
    const prisma = {
      client: {
        user: { findUnique: async () => ({ id: 'u_1', role: 'USER', ...user }) },
        membership: { findUnique: async () => ({ userId: 'u_1', businessId: 'biz_1', ...membership }) },
      },
    } as any;
    const supabase = { getUserFromToken: async () => ({ id: 'u_1', email: 'lead@example.com' }) } as any;
    const redis = { get: async () => null, pttl: async () => -2 } as any;
    const req: Record<string, any> = { headers: { authorization: 'Bearer token-of-u_1' }, params: { businessId: 'biz_1' } };
    await new AuthMiddleware(supabase, prisma, redis).use(req as any, {} as any, () => undefined);
    const reflector = { get: (key: string) => (key === MODULE_SCOPE_KEY ? { module, minLevel } : undefined) } as any;
    const ctx = { getHandler: () => ({}), switchToHttp: () => ({ getRequest: () => req }) } as any;
    try {
      return (await new ModuleScopeGuard(prisma, reflector).canActivate(ctx)) as true;
    } catch (err) {
      return (err as Error).message;
    }
  };

  /**
   * The real StructureService.resolveStaffByPhone over the member-held Sales Lead position
   * (Prisma answers only the relations, and the user fields, it asks for), then the real
   * StaffChatBridgeService; returns the envelope KEY chat was given and the include asked for.
   */
  const routeThroughBridge = async (user: UserState) => {
    let include: Record<string, any> | undefined;
    const prisma = {
      client: {
        orgAssignment: {
          findFirst: async (args: { include?: Record<string, any> }) => {
            include = args.include;
            const userInclude = args.include?.membership?.include?.user;
            const userRow: Record<string, unknown> = { id: 'u_1', role: 'USER', ...user };
            const select: Record<string, boolean> | undefined = userInclude === true ? undefined : userInclude?.select;
            return {
              id: 'as_1',
              businessId: 'biz_1',
              contactPhone: PHONE,
              contactName: null,
              contactEmail: null,
              isContactOnly: false,
              membershipId: 'm_1',
              userId: 'u_1',
              jobRoleId: SALES_LEAD.id,
              orgUnitId: 'ou_1',
              autoApprovalViaReply: false,
              activeFlowSessionId: null,
              ...(args.include?.jobRole ? { jobRole: SALES_LEAD } : {}),
              ...(args.include?.orgUnit ? { orgUnit: { id: 'ou_1' } } : {}),
              ...(args.include?.membership
                ? {
                    membership: {
                      id: 'm_1',
                      userId: 'u_1',
                      businessId: 'biz_1',
                      ...COPY,
                      ...(userInclude ? { user: select ? Object.fromEntries(Object.entries(userRow).filter(([k]) => select[k])) : userRow } : {}),
                    },
                  }
                : {}),
            };
          },
          update: async () => ({}),
        },
        // review 7 INP4-3: no member's account phone is this phone
        membership: { findMany: async () => [] },
      },
    };
    const structure = new StructureService(prisma as any);
    let pageContext: { jobRoleEnvelope?: JobRoleEnvelope } | undefined;
    /** Review 7 ENV-FORGE: the envelope is a server-only argument of chat(), never in pageContext. */
    let trusted: { jobRoleEnvelope?: JobRoleEnvelope } | undefined;
    const orchestrator = {
      getConversationHistory: async () => [],
      chat: async (_b: string, _m: string, _h: unknown, _a: unknown, ctx: typeof pageContext, _r?: unknown, _at?: unknown, _s?: unknown, _u?: unknown, server?: typeof trusted) => {
        trusted = server;
        pageContext = ctx;
        return { reply: 'ok', sessionId: 's_1' };
      },
    };
    const moduleRef = {
      get: (token: unknown) =>
        token === FlowOrchestratorService ? orchestrator : token === JobRolePolicyService ? policy : token === AiOversightService ? oversight : undefined,
    };
    const bridge = new StaffChatBridgeService(structure, { client: {} } as any, moduleRef as any);
    expect(await bridge.routeInboundMessage('biz_1', PHONE, MESSAGE, 'whatsapp')).toMatchObject({ handled: true });
    expect(pageContext?.jobRoleEnvelope, 'no envelope in the client-shaped pageContext').toBeUndefined();
    expect(trusted?.jobRoleEnvelope, 'the bridge passes an envelope, as a server-only argument').toBeDefined();
    return { env: trusted!.jobRoleEnvelope!, include };
  };

  const REPRO_TOOLS = ['commerce_create_invoice', 'deals_mark_won', 'crm_list_contacts', 'payments_list_transactions', 'payments_refund_charge'];
  const CREWS: BusinessRole[][] = [[], ['finance'], ['sales']];

  it.each([
    ['banned', BANNED],
    ['soft-deleted', DELETED],
    ['deleted and banned', BOTH],
  ] as Array<[string, UserState]>)('the repro, %s holder: HTTP refuses every route, and KEY keeps the baseline only', async (_label, user) => {
    expect(jobRolePermissionsProblem(SALES_LEAD.permissions)).toBeNull();
    // HTTP: AuthMiddleware leaves no user on the request, so the guard refuses before any scope
    for (const [module, level] of [['revenue', 'write'], ['crm', 'read'], ['revenue', 'read'], ['crm', 'admin']] as Array<[string, Level]>) {
      expect(await httpAnswer(user, COPY, module, level), `${module}:${level}`).toBe('Authentication required');
    }

    const { env, include } = await routeThroughBridge(user);
    expect(include, 'resolveStaffByPhone loads the holder account state with the membership').toMatchObject({
      jobRole: true,
      membership: { include: { user: { select: { deletedAt: true, bannedAt: true } } } },
    });
    expect(env.jobRoleName).toBe('Sales Lead');
    expect(env.maxRiskTier).toBe(1);
    expect(reachedBy(env)).toEqual(reachedBy(envelope({})));
    for (const [tool] of ROUTED) expect(passes(env, tool), tool).toBe(false);

    const seeded = await seededSettings();
    expect(seeded).toMatchObject({ autonomyLevel: 2 });
    expect(seeded.approvedTools).toContain('commerce_create_invoice');
    for (const tool of REPRO_TOOLS) {
      for (const crew of CREWS) {
        const d = await oversight.evaluate('biz_1', tool, undefined, crew, env, reader(seeded));
        expect(d.allowed, `${tool} crew ${JSON.stringify(crew)}`).toBe(false);
        expect(d.reason).toMatch(/Sales Lead position's (scope|tier)/);
      }
    }
  });

  it('control: the same holder with an active account keeps the Sales Lead envelope, as HTTP does', async () => {
    expect(await httpAnswer(ACTIVE, COPY, 'revenue', 'write')).toBe(true);
    expect(await httpAnswer(ACTIVE, COPY, 'crm', 'admin')).toBe(true);
    const { env } = await routeThroughBridge(ACTIVE);
    expect(reachedBy(env)).toEqual(reachedBy(policy.envelopeForJobRole(SALES_LEAD)));
    expect(env.maxRiskTier).toBe(3);
    const seeded = await seededSettings();
    expect(await oversight.evaluate('biz_1', 'commerce_create_invoice', undefined, [], env, reader(seeded))).toMatchObject({ allowed: true });
    expect(await oversight.evaluate('biz_1', 'payments_refund_charge', undefined, [], env, reader(seeded))).toMatchObject({
      allowed: true,
      requiresFormalApproval: true,
    });
  });

  it('fail closed: a membership whose account state was not loaded keeps the baseline only', () => {
    const baseline = reachedBy(envelope({}));
    for (const membership of [COPY, { ...COPY, user: null }, { ...COPY, user: undefined }]) {
      const env = policy.envelopeForPosition({ jobRole: SALES_LEAD, membershipId: 'm_1', userId: 'u_1', membership } as any);
      expect(reachedBy(env), JSON.stringify(membership)).toEqual(baseline);
      expect(env.maxRiskTier).toBe(1);
    }
    // a contact-only position has no account; its JobRole map is its whole scope, as before
    expect(reachedBy(policy.envelopeForPosition({ jobRole: SALES_LEAD, membershipId: null, userId: null }))).toEqual(
      reachedBy(policy.envelopeForJobRole(SALES_LEAD)),
    );
  });

  it('K2 property: over account states x memberships x positions, a governed tool KEY reaches is one HTTP gives the holder', async () => {
    const positions: Record<string, unknown>[] = [
      SALES_LEAD.permissions,
      { crm: 'write' },
      { operations: 'admin', team: 'read', expenses: 'write' },
      Object.fromEntries(CANONICAL_MODULES.map((m) => [m, 'admin'])),
    ];
    const memberships: MembershipRow[] = [COPY, { role: 'STAFF', permissionScopes: null }, { role: 'ADMIN', permissionScopes: null }, { role: 'OWNER', permissionScopes: null }];
    for (const p of positions) memberships.push({ role: 'STAFF', permissionScopes: p });
    const states: UserState[] = [ACTIVE, BANNED, DELETED, BOTH];

    const memo = new Map<string, true | string>();
    const violations: string[] = [];
    let reachedActive = 0;
    for (const p of positions) {
      const jobRole = { id: 'jr_1', name: 'Position', permissions: p as any };
      for (const membership of memberships) {
        for (const user of states) {
          // the holder's own row in the assignment's business (review 6 INP5-1 pins the others)
          const env = policy.envelopeForPosition({
            jobRole,
            businessId: 'biz_1',
            membershipId: 'm_1',
            userId: 'u_1',
            membership: { userId: 'u_1', businessId: 'biz_1', ...membership, user },
          } as any);
          const at = `${JSON.stringify(p)} / ${JSON.stringify(membership)} / ${JSON.stringify(user)}`;
          for (const [tool, module, level] of ROUTED) {
            if (!passes(env, tool)) continue;
            if (user === ACTIVE) reachedActive++;
            const key = `${JSON.stringify(user)}|${JSON.stringify(membership)}|${module}|${level}`;
            if (!memo.has(key)) memo.set(key, await httpAnswer(user, membership, module, level));
            if (memo.get(key) !== true) violations.push(`${at} -> ${tool} (${memo.get(key)})`);
          }
        }
      }
    }
    expect(reachedActive, 'the property is not vacuous').toBeGreaterThan(100);
    expect(violations).toEqual([]);
  });
});

/**
 * V1-21b review 6 (INP5-1). HTTP reads the holder's Membership in the business the request
 * names (ModuleScopeGuard: membership.findUnique({ userId_businessId })), and BusinessGuard
 * admits a user only to a business they own or are a member of. The bridge capped a
 * member-held position by whatever Membership the OrgAssignment row names, and an assignment
 * written before assertAssignmentRefs can name a membership in ANOTHER business (see
 * StructureService.listPeople). The holder then got the JobRole map capped by their scopes
 * in business B while KEY acted in business A, where HTTP gives them nothing. A membership
 * that is not the holder's own in the assignment's business (another business, another user,
 * or either not given) now caps the position to the baseline, as no membership does.
 */
describe("V1-21b review 6 — a position is capped only by the membership HTTP reads in the assignment's business (INP5-1)", () => {
  const roleEngine = new RoleEngineService({} as never, {} as never, {} as never);
  const oversight = new AiOversightService({ client: {} } as any, {} as any, {} as any, roleEngine, {} as any, policy);

  const PHONE = '+18685551977';
  const MESSAGE = 'invoice the client 500, mark the deal won and refund the deposit';
  const BIZ_A = 'biz_A';
  const BIZ_B = 'biz_B';
  const HOLDER = 'u_holder';
  const SALES_LEAD = { id: 'jr_A', name: 'Sales Lead', permissions: { revenue: 'admin', crm: 'admin' } };
  const BUSINESSES = [
    { id: BIZ_A, ownerId: 'u_ownerA' },
    { id: BIZ_B, ownerId: 'u_ownerB' },
  ];

  /** A Membership row as Prisma returns it, every scalar the bridge's include loads. */
  type Member = { id: string; userId: string; businessId: string; role: string; permissionScopes: unknown };
  /** The holder's STAFF membership in business B, the one the older assignment in A names. */
  const IN_B: Member = { id: 'm_B', userId: HOLDER, businessId: BIZ_B, role: 'STAFF', permissionScopes: { revenue: 'admin', crm: 'admin' } };
  /** The control: the holder's own (narrower) membership in A. */
  const IN_A_READ: Member = { id: 'm_A_read', userId: HOLDER, businessId: BIZ_A, role: 'STAFF', permissionScopes: { crm: 'read' } };
  /** The holder's own membership in A holding the position copy (positive control). */
  const IN_A_COPY: Member = { id: 'm_A', userId: HOLDER, businessId: BIZ_A, role: 'STAFF', permissionScopes: { crm: 'admin', revenue: 'admin' } };
  /** Another user's membership in A, holding the position copy. */
  const OTHER_IN_A: Member = { id: 'm_A_other', userId: 'u_other', businessId: BIZ_A, role: 'STAFF', permissionScopes: { crm: 'admin', revenue: 'admin' } };
  const ACTIVE = { deletedAt: null, bannedAt: null };

  const ROUTED = Object.entries(CANONICAL_MODULE_TOOLS).flatMap(([m, tools]) => Object.entries(tools).map(([t, l]) => [t, m, l] as [string, string, Level]));
  const reachedBy = (env: JobRoleEnvelope) => REGISTRY.filter((t) => passes(env, t)).sort();
  const REPRO_TOOLS = ['commerce_create_invoice', 'deals_mark_won', 'crm_list_contacts', 'payments_list_transactions', 'payments_refund_charge'];
  const CREWS: BusinessRole[][] = [[], ['finance'], ['sales']];

  /** The AutopilotSettings row the real DefaultTriggersService.seedForBusiness writes for business A. */
  const seededSettings = async (): Promise<Record<string, unknown>> => {
    let row: Record<string, unknown> | undefined;
    const prisma = {
      client: {
        agentTrigger: { count: async () => 0, create: async () => ({}) },
        autopilotSettings: {
          upsert: async (args: { create: Record<string, unknown> }) => {
            row = args.create;
            return row;
          },
        },
      },
    };
    await new DefaultTriggersService(prisma as any).seedForBusiness(BIZ_A);
    expect(row, 'seedForBusiness writes the AutopilotSettings row').toBeDefined();
    return row!;
  };
  const reader = (row: Record<string, unknown>): AutonomySettingsReader => ({
    autopilotSettings: { findUnique: async () => row as any },
    aiMemory: { findUnique: async () => null },
  });

  /**
   * The HTTP answer for `userId` on a route of `businessId`: the real AuthMiddleware on a bearer
   * token Supabase verifies as that user (an active account), then the real BusinessGuard and,
   * for a scoped route, the real ModuleScopeGuard, over a world holding `memberships`. True, or
   * the first refusal.
   */
  const httpAnswer = async (memberships: Member[], userId: string, businessId: string, scope?: { module: string; minLevel: Level }): Promise<true | string> => {
    const prisma = {
      client: {
        user: { findUnique: async (args: { where: { id: string } }) => ({ id: args.where.id, role: 'USER', ...ACTIVE }) },
        membership: {
          findUnique: async (args: { where: { userId_businessId: { userId: string; businessId: string } } }) => {
            const key = args.where.userId_businessId;
            return memberships.find((m) => m.userId === key.userId && m.businessId === key.businessId) ?? null;
          },
        },
        business: {
          findFirst: async (args: { where: { id: string; OR: [{ ownerId: string }, { members: { some: { userId: string } } }] } }) => {
            const b = BUSINESSES.find((x) => x.id === args.where.id);
            const uid = args.where.OR[0].ownerId;
            expect(args.where.OR[1].members.some.userId).toBe(uid);
            return b && (b.ownerId === uid || memberships.some((m) => m.businessId === b.id && m.userId === uid)) ? b : null;
          },
        },
      },
    } as any;
    const supabase = { getUserFromToken: async () => ({ id: userId, email: `${userId}@example.com` }) } as any;
    const redis = { get: async () => null, pttl: async () => -2 } as any;
    const req: Record<string, any> = { headers: { authorization: `Bearer token-of-${userId}` }, params: { businessId } };
    await new AuthMiddleware(supabase, prisma, redis).use(req as any, {} as any, () => undefined);
    const ctx = { getHandler: () => ({}), switchToHttp: () => ({ getRequest: () => req }) } as any;
    try {
      await new BusinessGuard(prisma).canActivate(ctx);
      if (!scope) return true;
      const reflector = { get: (key: string) => (key === MODULE_SCOPE_KEY ? scope : undefined) } as any;
      return (await new ModuleScopeGuard(prisma, reflector).canActivate(ctx)) as true;
    } catch (err) {
      return (err as Error).message;
    }
  };

  /**
   * The real StructureService.resolveStaffByPhone over one OrgAssignment row in the business
   * the bridge asks for (Prisma answers only the relations, and the user fields, it asks for),
   * naming `membership` (its Membership relation, as stored: in any business), then the real
   * StaffChatBridgeService. Returns the envelope KEY chat was given, the business it acts in
   * and the query resolveStaffByPhone made.
   */
  /**
   * `world`: every membership row (default: the one the assignment names), for the lookup by
   * (user, business) the guard makes (review 7 INP4-2).
   */
  const routeThroughBridge = async (assignment: { userId: string | null; membership: Member | null; world?: Member[] }) => {
    let query: { where?: Record<string, any>; include?: Record<string, any> } = {};
    const prisma = {
      client: {
        orgAssignment: {
          findFirst: async (args: { where: Record<string, any>; include?: Record<string, any> }) => {
            query = args;
            const userInclude = args.include?.membership?.include?.user;
            const m = assignment.membership;
            const userRow: Record<string, unknown> = { id: m?.userId, role: 'USER', ...ACTIVE };
            const select: Record<string, boolean> | undefined = userInclude === true ? undefined : userInclude?.select;
            return {
              id: 'as_A',
              businessId: args.where.businessId,
              contactPhone: PHONE,
              contactName: null,
              contactEmail: null,
              isContactOnly: false,
              membershipId: m?.id ?? 'm_gone',
              userId: assignment.userId,
              jobRoleId: SALES_LEAD.id,
              orgUnitId: 'ou_A',
              autoApprovalViaReply: false,
              activeFlowSessionId: null,
              endedAt: null,
              ...(args.include?.jobRole ? { jobRole: SALES_LEAD } : {}),
              ...(args.include?.orgUnit ? { orgUnit: { id: 'ou_A', businessId: args.where.businessId } } : {}),
              ...(args.include?.membership
                ? {
                    membership: m
                      ? { ...m, ...(userInclude ? { user: select ? Object.fromEntries(Object.entries(userRow).filter(([k]) => select[k])) : userRow } : {}) }
                      : null,
                  }
                : {}),
            };
          },
          update: async () => ({}),
        },
        // review 7 INP4-2: the membership HTTP reads, looked up by (user, business); and the members whose account phone this is (INP4-3: none)
        membership: {
          findUnique: async (args: { where: { userId_businessId: { userId: string; businessId: string } }; include?: Record<string, any> }) => {
            const key = args.where.userId_businessId;
            const row = (assignment.world ?? [assignment.membership]).find((m) => m && m.userId === key.userId && m.businessId === key.businessId);
            const userInclude = args.include?.user;
            const select: Record<string, boolean> | undefined = userInclude === true ? undefined : userInclude?.select;
            const userRow: Record<string, unknown> = { id: key.userId, role: 'USER', ...ACTIVE };
            return row ? { ...row, ...(userInclude ? { user: select ? Object.fromEntries(Object.entries(userRow).filter(([k]) => select[k])) : userRow } : {}) } : null;
          },
          findMany: async () => [],
        },
      },
    };
    const structure = new StructureService(prisma as any);
    let pageContext: { jobRoleEnvelope?: JobRoleEnvelope } | undefined;
    /** Review 7 ENV-FORGE: the envelope is a server-only argument of chat(), never in pageContext. */
    let trusted: { jobRoleEnvelope?: JobRoleEnvelope } | undefined;
    let actsIn: string | undefined;
    const orchestrator = {
      getConversationHistory: async () => [],
      chat: async (b: string, _m: string, _h: unknown, _a: unknown, ctx: typeof pageContext, _r?: unknown, _at?: unknown, _s?: unknown, _u?: unknown, server?: typeof trusted) => {
        trusted = server;
        actsIn = b;
        pageContext = ctx;
        return { reply: 'ok', sessionId: 's_1' };
      },
    };
    const moduleRef = {
      get: (token: unknown) =>
        token === FlowOrchestratorService ? orchestrator : token === JobRolePolicyService ? policy : token === AiOversightService ? oversight : undefined,
    };
    const bridge = new StaffChatBridgeService(structure, { client: {} } as any, moduleRef as any);
    expect(await bridge.routeInboundMessage(BIZ_A, PHONE, MESSAGE, 'whatsapp')).toMatchObject({ handled: true });
    expect(pageContext?.jobRoleEnvelope, 'no envelope in the client-shaped pageContext').toBeUndefined();
    expect(trusted?.jobRoleEnvelope, 'the bridge passes an envelope, as a server-only argument').toBeDefined();
    return { env: trusted!.jobRoleEnvelope!, actsIn, query };
  };

  /** Every refusal KEY must make for `tools`, under the seeded autopilot row, for every crew. */
  const expectKeyRefuses = async (env: JobRoleEnvelope, tools: string[]) => {
    const seeded = await seededSettings();
    expect(seeded).toMatchObject({ autonomyLevel: 2 });
    expect(seeded.approvedTools).toContain('commerce_create_invoice');
    for (const tool of tools) {
      for (const crew of CREWS) {
        const d = await oversight.evaluate(BIZ_A, tool, undefined, crew, env, reader(seeded));
        expect(d.allowed, `${tool} crew ${JSON.stringify(crew)}: ${d.reason}`).toBe(false);
        expect(d.reason).toMatch(/Sales Lead position's (scope|tier)/);
      }
    }
  };

  it("the repro: an assignment in A naming the holder's membership in B; HTTP gives nothing in A, and KEY keeps the baseline only", async () => {
    expect(jobRolePermissionsProblem(SALES_LEAD.permissions)).toBeNull();
    // HTTP in A: no membership there, not the owner
    expect(await httpAnswer([IN_B], HOLDER, BIZ_A)).toBe('No access to this business');
    for (const [module, minLevel] of [['revenue', 'write'], ['crm', 'write'], ['revenue', 'read'], ['crm', 'read']] as Array<[string, Level]>) {
      expect(await httpAnswer([IN_B], HOLDER, BIZ_A, { module, minLevel }), `${module}:${minLevel}`).toBe('No access to this business');
    }
    // the B membership is the one HTTP reads only in B
    expect(await httpAnswer([IN_B], HOLDER, BIZ_B, { module: 'revenue', minLevel: 'write' })).toBe(true);

    const { env, actsIn, query } = await routeThroughBridge({ userId: HOLDER, membership: IN_B });
    expect(query.where).toMatchObject({ businessId: BIZ_A, contactPhone: PHONE, endedAt: null });
    expect(query.include).toMatchObject({ jobRole: true, membership: { include: { user: { select: { deletedAt: true, bannedAt: true } } } } });
    expect(actsIn, 'KEY acts in the assignment business').toBe(BIZ_A);
    expect(env.jobRoleName).toBe('Sales Lead');
    expect(env.maxRiskTier).toBe(1);
    expect(reachedBy(env)).toEqual(reachedBy(envelope({})));
    for (const [tool] of ROUTED) expect(passes(env, tool), tool).toBe(false);
    await expectKeyRefuses(env, REPRO_TOOLS);
  });

  it('control: the holder also holds a narrower membership in A; HTTP reads that one, so the B membership does not cap KEY', async () => {
    const world = [IN_B, IN_A_READ];
    expect(await httpAnswer(world, HOLDER, BIZ_A, { module: 'revenue', minLevel: 'write' })).toBe(
      'Insufficient permissions: revenue requires write access (you have none)',
    );
    expect(await httpAnswer(world, HOLDER, BIZ_A, { module: 'crm', minLevel: 'write' })).toBe(
      'Insufficient permissions: crm requires write access (you have read)',
    );
    // the assignment still names the B membership, which is not the one HTTP reads. Review 7 INP4-2: the bridge looks the
    // holder's membership up as the guard does, (holder, A), and caps the position by that one; before review 7 it kept the
    // baseline here (fail closed, also K2-safe, but below what HTTP gives the holder)
    const { env } = await routeThroughBridge({ userId: HOLDER, membership: IN_B, world });
    expect(env.maxRiskTier).toBe(1);
    expect(reachedBy(env)).toEqual(
      reachedBy(policy.envelopeForPosition({ jobRole: SALES_LEAD, businessId: BIZ_A, membershipId: IN_A_READ.id, userId: HOLDER, membership: { ...IN_A_READ, user: ACTIVE } } as any)),
    );
    expect(passes(env, 'deals_list'), 'crm:read as HTTP reads it in A').toBe(true);
    for (const [tool, module, level] of ROUTED) {
      if (passes(env, tool)) expect(await httpAnswer(world, HOLDER, BIZ_A, { module, minLevel: level }), tool).toBe(true);
    }
    await expectKeyRefuses(env, ['commerce_create_invoice', 'deals_mark_won', 'payments_refund_charge']);
  });

  it("a membership in A whose user is not the assignment's user does not cap the holder's position: KEY keeps the baseline only", async () => {
    // HTTP for the assignment's user in A: no membership there
    expect(await httpAnswer([OTHER_IN_A], HOLDER, BIZ_A, { module: 'revenue', minLevel: 'write' })).toBe('No access to this business');
    const { env } = await routeThroughBridge({ userId: HOLDER, membership: OTHER_IN_A });
    expect(env.maxRiskTier).toBe(1);
    expect(reachedBy(env)).toEqual(reachedBy(envelope({})));
    await expectKeyRefuses(env, REPRO_TOOLS);
  });

  it("positive control: the holder's own membership in A keeps the Sales Lead envelope, as HTTP does", async () => {
    expect(await httpAnswer([IN_A_COPY, IN_B], HOLDER, BIZ_A, { module: 'revenue', minLevel: 'write' })).toBe(true);
    expect(await httpAnswer([IN_A_COPY, IN_B], HOLDER, BIZ_A, { module: 'crm', minLevel: 'admin' })).toBe(true);
    // with the denormalized userId, and on the membership path keyed by membershipId alone
    for (const userId of [HOLDER, null]) {
      const { env } = await routeThroughBridge({ userId, membership: IN_A_COPY });
      expect(reachedBy(env), String(userId)).toEqual(reachedBy(policy.envelopeForJobRole(SALES_LEAD)));
      expect(env.maxRiskTier).toBe(3);
      const seeded = await seededSettings();
      expect(await oversight.evaluate(BIZ_A, 'commerce_create_invoice', undefined, [], env, reader(seeded))).toMatchObject({ allowed: true });
      expect(await oversight.evaluate(BIZ_A, 'payments_refund_charge', undefined, [], env, reader(seeded))).toMatchObject({
        allowed: true,
        requiresFormalApproval: true,
      });
    }
  });

  it('fail closed: a membership whose business or user was not loaded, or a position whose business was not given, keeps the baseline only', () => {
    const baseline = reachedBy(envelope({}));
    const held = { role: 'STAFF', permissionScopes: { crm: 'admin', revenue: 'admin' }, user: ACTIVE };
    const cases: Array<[string, unknown]> = [
      ['membership without businessId or userId', { jobRole: SALES_LEAD, businessId: BIZ_A, membershipId: 'm_A', userId: HOLDER, membership: held }],
      ['membership without businessId', { jobRole: SALES_LEAD, businessId: BIZ_A, membershipId: 'm_A', userId: HOLDER, membership: { ...held, userId: HOLDER } }],
      ['membership without userId', { jobRole: SALES_LEAD, businessId: BIZ_A, membershipId: 'm_A', userId: HOLDER, membership: { ...held, businessId: BIZ_A } }],
      ['position without businessId', { jobRole: SALES_LEAD, membershipId: 'm_A', userId: HOLDER, membership: { ...held, businessId: BIZ_A, userId: HOLDER } }],
      ['empty businessId on both', { jobRole: SALES_LEAD, businessId: '', membershipId: 'm_A', userId: HOLDER, membership: { ...held, businessId: '', userId: HOLDER } }],
      ['membership in B', { jobRole: SALES_LEAD, businessId: BIZ_A, membershipId: 'm_B', userId: HOLDER, membership: { ...held, businessId: BIZ_B, userId: HOLDER } }],
      ["another user's membership", { jobRole: SALES_LEAD, businessId: BIZ_A, membershipId: 'm_A', userId: HOLDER, membership: { ...held, businessId: BIZ_A, userId: 'u_other' } }],
    ];
    for (const [label, position] of cases) {
      const env = policy.envelopeForPosition(position as any);
      expect(reachedBy(env), label).toEqual(baseline);
      expect(env.maxRiskTier, label).toBe(1);
    }
    // the same position with the holder's own membership in A keeps the Sales Lead envelope
    expect(
      reachedBy(
        policy.envelopeForPosition({
          jobRole: SALES_LEAD,
          businessId: BIZ_A,
          membershipId: 'm_A',
          userId: HOLDER,
          membership: { ...held, businessId: BIZ_A, userId: HOLDER },
        } as any),
      ),
    ).toEqual(reachedBy(policy.envelopeForJobRole(SALES_LEAD)));
    // a contact-only position has no account; its JobRole map is its whole scope, as before
    expect(reachedBy(policy.envelopeForPosition({ jobRole: SALES_LEAD, businessId: BIZ_A, membershipId: null, userId: null } as any))).toEqual(
      reachedBy(policy.envelopeForJobRole(SALES_LEAD)),
    );
  });

  it("K2 property: over membership business x membership user x assignment user x position, a governed tool KEY reaches is one HTTP gives the holder in the assignment's business", async () => {
    const positions: Record<string, unknown>[] = [
      SALES_LEAD.permissions,
      { crm: 'write' },
      { operations: 'admin', team: 'read', expenses: 'write' },
      Object.fromEntries(CANONICAL_MODULES.map((m) => [m, 'admin'])),
    ];
    const scopeSets: Array<[string, unknown]> = [
      ['STAFF', SALES_LEAD.permissions],
      ['STAFF', { crm: 'read' }],
      ['STAFF', null],
      ['ADMIN', null],
      ['OWNER', null],
      ['STAFF', Object.fromEntries(CANONICAL_MODULES.map((m) => [m, 'admin']))],
    ];
    const named: Member[] = [];
    for (const businessId of [BIZ_A, BIZ_B]) {
      for (const userId of [HOLDER, 'u_other']) {
        for (const [role, permissionScopes] of scopeSets) named.push({ id: `m_${named.length}`, userId, businessId, role, permissionScopes });
      }
    }
    const extras: Member[][] = [[], [IN_A_READ]];
    const assignmentUsers: Array<string | null> = [HOLDER, null, 'u_other'];

    const memo = new Map<string, true | string>();
    const violations: string[] = [];
    let reached = 0;
    for (const p of positions) {
      const jobRole = { id: 'jr_1', name: 'Position', permissions: p as any };
      const alone = policy.envelopeForJobRole(jobRole);
      for (const m of named) {
        for (const assignmentUser of assignmentUsers) {
          const env = policy.envelopeForPosition({ jobRole, businessId: BIZ_A, membershipId: m.id, userId: assignmentUser, membership: { ...m, user: ACTIVE } } as any);
          // whoever the holder is (the assignment's user, else the membership's), HTTP in A must allow it
          const holders = [...new Set([assignmentUser ?? m.userId, m.userId])];
          for (const extra of extras) {
            const world = [m, ...extra.filter((e) => !(e.userId === m.userId && e.businessId === m.businessId))];
            const at = `${JSON.stringify(p)} / ${m.businessId} ${m.userId} ${m.role} ${JSON.stringify(m.permissionScopes)} / assignment user ${assignmentUser} / extra ${extra.length}`;
            for (const [tool, module, level] of ROUTED) {
              if (!passes(env, tool)) continue;
              reached++;
              if (!passes(alone, tool)) violations.push(`${at} -> ${tool} (beyond the position)`);
              for (const holder of holders) {
                const key = `${JSON.stringify(world)}|${holder}|${module}|${level}`;
                if (!memo.has(key)) memo.set(key, await httpAnswer(world, holder, BIZ_A, { module, minLevel: level }));
                if (memo.get(key) !== true) violations.push(`${at} -> ${tool} for ${holder} (${memo.get(key)})`);
              }
            }
          }
        }
      }
    }
    expect(reached, 'the property is not vacuous').toBeGreaterThan(100);
    expect(violations.length, violations.slice(0, 20).join('\n')).toBe(0);
  });
});

/**
 * V1-21b review 7 (INP4-2, INP4-3, DRV-BRIEF / DRV5-1, DRV5-2; the client-forged envelope,
 * ENV-FORGE / INP5-2 / DRV5-3, is pinned in ai/flow-chat-envelope.spec.ts). The bridge cases
 * run the real StructureService (resolveStaffByPhone, createAssignment, updateAssignment) and
 * the real StaffChatBridgeService over a fake Prisma that answers the queries they make from
 * one world of users, memberships and assignments; the HTTP answer is the real AuthMiddleware,
 * BusinessGuard and ModuleScopeGuard over the same world; KEY's answer is the real
 * AiOversightService.evaluate.
 *
 * INP4-2: the IC3-1 cap read the membership OrgAssignment.membershipId names, not the
 * (user, business) row ModuleScopeGuard reads, and an assignment written before
 * assertAssignmentRefs can name a membership in another business. Review 6 kept such a
 * position at the baseline; the bridge now looks the holder's membership up as the guard does,
 * so a foreign OWNER membership with no scope map never uncaps the position, and the holder's
 * own row in the business KEY acts in caps it.
 *
 * INP4-3: a contact-only position on a member's own phone had no membership to cap it, so
 * narrowing the member over HTTP left KEY where it was, and the same when a contact is later
 * invited with their phone. A position is now bounded by every member of its business whose
 * account phone it carries, and createAssignment / updateAssignment refuse a contact-only
 * position on a member's phone.
 */
describe('V1-21b review 7 — KEY is capped by the membership HTTP reads for whoever holds the phone (INP4-2, INP4-3, DRV-BRIEF, DRV5-2)', () => {
  const roleEngine = new RoleEngineService({} as never, {} as never, {} as never);
  const oversight = new AiOversightService({ client: {} } as any, {} as any, {} as any, roleEngine, {} as any, policy);

  const BIZ_A = 'biz_A';
  const BIZ_B = 'biz_B';
  const SALES_LEAD = { id: 'jr_sales', businessId: BIZ_A, name: 'Sales Lead', permissions: { revenue: 'admin', crm: 'admin' }, defaultApprovalTier: 2 };
  type AccountState = { deletedAt: Date | null; bannedAt: Date | null };
  const ACTIVE: AccountState = { deletedAt: null, bannedAt: null };
  const BANNED: AccountState = { deletedAt: null, bannedAt: new Date('2026-10-30T12:00:00Z') };
  const DELETED: AccountState = { deletedAt: new Date('2026-10-30T12:00:00Z'), bannedAt: null };

  type UserRow = { id: string; email: string; phone: string | null; role: string } & AccountState;
  type MemberRow = { id: string; userId: string; businessId: string; role: string; permissionScopes: unknown; maxApprovalTier: number | null };
  type AssignmentRow = {
    id: string;
    businessId: string;
    contactPhone: string | null;
    contactName: string | null;
    contactEmail: string | null;
    isContactOnly: boolean;
    membershipId: string | null;
    userId: string | null;
    jobRoleId: string | null;
    orgUnitId: string;
    reportsToId: string | null;
    autoApprovalViaReply: boolean;
    activeFlowSessionId: string | null;
    endedAt: Date | null;
    isPrimary: boolean;
  };
  interface World {
    users: UserRow[];
    memberships: MemberRow[];
    assignments: AssignmentRow[];
  }

  const user = (id: string, phone: string | null, state: AccountState = ACTIVE): UserRow => ({ id, email: `${id}@example.com`, phone, role: 'USER', ...state });
  const member = (id: string, userId: string, businessId: string, role: string, permissionScopes: unknown): MemberRow => ({
    id,
    userId,
    businessId,
    role,
    permissionScopes,
    maxApprovalTier: null,
  });
  const position = (over: Partial<AssignmentRow>): AssignmentRow => ({
    id: 'as_1',
    businessId: BIZ_A,
    contactPhone: null,
    contactName: null,
    contactEmail: null,
    isContactOnly: false,
    membershipId: null,
    userId: null,
    jobRoleId: SALES_LEAD.id,
    orgUnitId: 'ou_A',
    reportsToId: null,
    autoApprovalViaReply: false,
    activeFlowSessionId: null,
    endedAt: null,
    isPrimary: true,
    ...over,
  });
  const OWNER_A = 'u_ownerA';
  const BUSINESSES = [
    { id: BIZ_A, ownerId: OWNER_A },
    { id: BIZ_B, ownerId: 'u_ownerB' },
  ];
  const ORG_UNITS = [{ id: 'ou_A', businessId: BIZ_A }];
  const JOB_ROLES = [SALES_LEAD];

  type Query = { model: string; op: string; args: any };

  /** A Prisma client over `w`: the queries StructureService, AuthMiddleware and the guards make, answered from the world. */
  const prismaOver = (w: World, log: Query[] = []) => {
    const rel = (row: Record<string, any>, key: string): any => {
      if (key === 'user') return w.users.find((u) => u.id === row.userId) ?? null;
      if (key === 'jobRole') return JOB_ROLES.find((j) => j.id === row.jobRoleId) ?? null;
      if (key === 'orgUnit') return ORG_UNITS.find((o) => o.id === row.orgUnitId) ?? null;
      if (key === 'membership') return w.memberships.find((m) => m.id === row.membershipId) ?? null;
      if (key === 'reportsTo') return null;
      throw new Error(`relation ${key} is not modelled`);
    };
    const matches = (row: Record<string, any> | null, where: Record<string, any> = {}): boolean => {
      if (!row) return false;
      for (const [k, v] of Object.entries(where)) {
        if (k === 'userId_businessId') {
          if (row.userId !== v.userId || row.businessId !== v.businessId) return false;
        } else if (v === null) {
          if (row[k] != null) return false;
        } else if (typeof v === 'object' && !(v instanceof Date)) {
          if ('not' in v) {
            if (v.not === null ? row[k] == null : row[k] === v.not) return false;
          } else if (!matches(rel(row, k), v)) {
            return false;
          }
        } else if (row[k] !== v) {
          return false;
        }
      }
      return true;
    };
    const shape = (row: Record<string, any> | null, args: { select?: Record<string, any>; include?: Record<string, any> } | undefined): any => {
      if (!row) return null;
      if (args?.select) {
        const out: Record<string, any> = {};
        for (const [k, s] of Object.entries(args.select)) if (s) out[k] = typeof s === 'object' ? shape(rel(row, k), s) : row[k];
        return out;
      }
      const out: Record<string, any> = { ...row };
      for (const [k, s] of Object.entries(args?.include ?? {})) if (s) out[k] = shape(rel(row, k), s === true ? undefined : s);
      return out;
    };
    const model = <T extends Record<string, any>>(name: string, rows: () => T[]) => ({
      findFirst: async (args: any) => {
        log.push({ model: name, op: 'findFirst', args });
        return shape(rows().find((r) => matches(r, args?.where)) ?? null, args);
      },
      findUnique: async (args: any) => {
        log.push({ model: name, op: 'findUnique', args });
        return shape(rows().find((r) => matches(r, args?.where)) ?? null, args);
      },
      findMany: async (args: any) => {
        log.push({ model: name, op: 'findMany', args });
        return rows()
          .filter((r) => matches(r, args?.where))
          .map((r) => shape(r, args));
      },
    });
    return {
      client: {
        user: model('user', () => w.users),
        membership: {
          ...model('membership', () => w.memberships),
          update: async (args: any) => {
            log.push({ model: 'membership', op: 'update', args });
            const row = w.memberships.find((m) => m.id === args.where.id)!;
            Object.assign(row, args.data);
            return row;
          },
        },
        jobRole: model('jobRole', () => JOB_ROLES),
        orgUnit: model('orgUnit', () => ORG_UNITS),
        orgAssignment: {
          ...model('orgAssignment', () => w.assignments),
          create: async (args: any) => {
            log.push({ model: 'orgAssignment', op: 'create', args });
            const row = position({ id: `as_new_${w.assignments.length + 1}`, ...args.data });
            w.assignments.push(row);
            return shape(row, args);
          },
          update: async (args: any) => {
            log.push({ model: 'orgAssignment', op: 'update', args });
            const row = w.assignments.find((a) => a.id === args.where.id)!;
            for (const [k, v] of Object.entries(args.data)) if (v !== undefined) (row as Record<string, unknown>)[k] = v;
            return shape(row, args);
          },
        },
        business: {
          findFirst: async (args: { where: { id: string; OR: [{ ownerId: string }, { members: { some: { userId: string } } }] } }) => {
            const b = BUSINESSES.find((x) => x.id === args.where.id);
            const uid = args.where.OR[0].ownerId;
            return b && (b.ownerId === uid || w.memberships.some((m) => m.businessId === b.id && m.userId === uid)) ? b : null;
          },
        },
        teamActivityLog: { create: async () => ({}) },
      },
    } as any;
  };

  /**
   * The HTTP answer for `userId` on a route of `businessId` over the world: the real
   * AuthMiddleware (a token Supabase verifies as that user), then the real BusinessGuard (unless
   * `moduleScopeOnly`) and, for a scoped route, the real ModuleScopeGuard. True, or the refusal.
   */
  const httpAnswer = async (w: World, userId: string, businessId: string, scope?: { module: string; minLevel: Level }, moduleScopeOnly = false): Promise<true | string> => {
    const prisma = prismaOver(w);
    const supabase = { getUserFromToken: async () => ({ id: userId, email: `${userId}@example.com` }) } as any;
    const redis = { get: async () => null, pttl: async () => -2 } as any;
    const req: Record<string, any> = { headers: { authorization: `Bearer token-of-${userId}` }, params: { businessId } };
    await new AuthMiddleware(supabase, prisma, redis).use(req as any, {} as any, () => undefined);
    const ctx = { getHandler: () => ({}), switchToHttp: () => ({ getRequest: () => req }) } as any;
    try {
      if (!moduleScopeOnly) await new BusinessGuard(prisma).canActivate(ctx);
      if (!scope) return true;
      const reflector = { get: (key: string) => (key === MODULE_SCOPE_KEY ? scope : undefined) } as any;
      return (await new ModuleScopeGuard(prisma, reflector).canActivate(ctx)) as true;
    } catch (err) {
      return (err as Error).message;
    }
  };

  /**
   * The real StructureService.resolveStaffByPhone and StaffChatBridgeService over the world, for
   * an inbound message from `phone` to business A. Returns the envelope KEY chat was given (the
   * server-only argument; before review 7 the bridge passed it in pageContext, and the argument
   * itself is pinned in ai/flow-chat-envelope.spec.ts) and every query Prisma answered.
   */
  const routeThroughBridge = async (w: World, phone: string) => {
    const log: Query[] = [];
    const structure = new StructureService(prismaOver(w, log));
    let pageContext: { jobRoleEnvelope?: JobRoleEnvelope } | undefined;
    let trusted: { jobRoleEnvelope?: JobRoleEnvelope } | undefined;
    const orchestrator = {
      getConversationHistory: async () => [],
      chat: async (_b: string, _m: string, _h: unknown, _a: unknown, ctx: typeof pageContext, _r?: unknown, _at?: unknown, _s?: unknown, _u?: unknown, server?: typeof trusted) => {
        pageContext = ctx;
        trusted = server;
        return { reply: 'ok', sessionId: 's_1' };
      },
    };
    const moduleRef = {
      get: (token: unknown) =>
        token === FlowOrchestratorService ? orchestrator : token === JobRolePolicyService ? policy : token === AiOversightService ? oversight : undefined,
    };
    const bridge = new StaffChatBridgeService(structure, { client: {} } as any, moduleRef as any);
    expect(await bridge.routeInboundMessage(BIZ_A, phone, 'invoice the client 500, mark the deal won and refund the deposit', 'whatsapp')).toMatchObject({ handled: true });
    const env = trusted?.jobRoleEnvelope ?? pageContext?.jobRoleEnvelope;
    expect(env, 'the bridge passes an envelope').toBeDefined();
    return { env: env!, log };
  };

  const reader = (autonomyLevel: number): AutonomySettingsReader => ({
    autopilotSettings: { findUnique: async () => ({ autonomyLevel, approvedTools: [], blockedTools: [], approvalTimeoutHours: 24 }) as any },
    aiMemory: { findUnique: async () => null },
  });
  const ROUTED = Object.entries(CANONICAL_MODULE_TOOLS).flatMap(([m, tools]) => Object.entries(tools).map(([t, l]) => [t, m, l] as [string, string, Level]));
  const reachedBy = (env: JobRoleEnvelope) => REGISTRY.filter((t) => passes(env, t)).sort();
  const scopesOf = (m: MemberRow) => (m.permissionScopes && typeof m.permissionScopes === 'object' ? m.permissionScopes : defaultScopesForRole(m.role));
  /** What the Sales Lead position reaches bounded by each of `ms` (as HTTP reads each): the precise answer. */
  const capped = (...ms: MemberRow[]) =>
    REGISTRY.filter((t) => passes(policy.envelopeForJobRole(SALES_LEAD), t) && ms.every((m) => passes(envelope(scopesOf(m)), t))).sort();
  const BASELINE_REACH = reachedBy(envelope({}));

  /** K2: every governed tool KEY reaches is one HTTP gives each of `holders` in business A. */
  const expectWithinHttp = async (w: World, env: JobRoleEnvelope, holders: string[]) => {
    const violations: string[] = [];
    for (const [tool, module, level] of ROUTED) {
      if (!passes(env, tool)) continue;
      for (const h of holders) {
        const a = await httpAnswer(w, h, BIZ_A, { module, minLevel: level });
        if (a !== true) violations.push(`${tool} for ${h}: ${a}`);
      }
    }
    expect(violations).toEqual([]);
  };

  describe('INP4-2 — the membership is the (user, business) row HTTP reads, not the row the assignment names', () => {
    const PHONE = '+18685551902';
    const X = 'u_x';
    const OWNER_IN_B = member('m_xB', X, BIZ_B, 'OWNER', null);
    const naming = (m: MemberRow, userId: string | null = X) => position({ contactPhone: PHONE, membershipId: m.id, userId });

    it("the repro: an assignment in A names X's OWNER membership in B (no scope map); HTTP gives X nothing in A, and KEY keeps the baseline", async () => {
      const w: World = { users: [user(X, null)], memberships: [OWNER_IN_B], assignments: [naming(OWNER_IN_B)] };
      expect(await httpAnswer(w, X, BIZ_A)).toBe('No access to this business');
      for (const [module, minLevel] of [['revenue', 'write'], ['crm', 'read']] as Array<[string, Level]>) {
        expect(await httpAnswer(w, X, BIZ_A, { module, minLevel }, true), `${module}:${minLevel}`).toBe('Not a member of this business');
      }
      const { env } = await routeThroughBridge(w, PHONE);
      expect(env.maxRiskTier).toBe(1);
      expect(reachedBy(env)).toEqual(BASELINE_REACH);
      for (const tool of ['commerce_create_invoice', 'deals_mark_won', 'payments_refund_charge', 'deals_list']) {
        const d = await oversight.evaluate(BIZ_A, tool, undefined, ['general'], env, reader(4));
        expect(d.allowed, `${tool}: ${d.reason}`).toBe(false);
        expect(d.reason).toMatch(/Sales Lead position's (scope|tier)/);
      }
    });

    it("the bridge looks the holder's membership up as the guard does, by (X, A): X's own STAFF row in A caps the position, the OWNER row in B never uncaps it", async () => {
      const IN_A = member('m_xA', X, BIZ_A, 'STAFF', { crm: 'read' });
      const w: World = { users: [user(X, null)], memberships: [OWNER_IN_B, IN_A], assignments: [naming(OWNER_IN_B)] };
      expect(await httpAnswer(w, X, BIZ_A, { module: 'crm', minLevel: 'read' })).toBe(true);
      expect(await httpAnswer(w, X, BIZ_A, { module: 'revenue', minLevel: 'write' })).toBe('Insufficient permissions: revenue requires write access (you have none)');
      const { env, log } = await routeThroughBridge(w, PHONE);
      expect(log.filter((q) => q.model === 'membership' && q.op === 'findUnique').map((q) => q.args.where)).toContainEqual({
        userId_businessId: { userId: X, businessId: BIZ_A },
      });
      expect(reachedBy(env)).toEqual(capped(IN_A));
      expect(passes(env, 'deals_list')).toBe(true);
      await expectWithinHttp(w, env, [X]);
      for (const tool of ['commerce_create_invoice', 'deals_mark_won', 'payments_refund_charge']) {
        const d = await oversight.evaluate(BIZ_A, tool, undefined, ['general'], env, reader(4));
        expect(d.allowed, `${tool}: ${d.reason}`).toBe(false);
      }
      expect(await oversight.evaluate(BIZ_A, 'deals_list', undefined, ['general'], env, reader(4))).toMatchObject({ allowed: true });
    });

    it("K2 property: over the named membership x the holder's own row in A x the assignment's user, KEY reaches exactly the position capped by the row HTTP reads, and nothing HTTP refuses", async () => {
      const OTHER = 'u_other';
      const named: MemberRow[] = [
        OWNER_IN_B,
        member('m_xB_admin', X, BIZ_B, 'ADMIN', null),
        member('m_xB_full', X, BIZ_B, 'STAFF', Object.fromEntries(CANONICAL_MODULES.map((m) => [m, 'admin']))),
        member('m_oB', OTHER, BIZ_B, 'OWNER', null),
        member('m_oA', OTHER, BIZ_A, 'STAFF', { crm: 'admin', revenue: 'admin' }),
      ];
      const own: Array<MemberRow | null> = [
        null,
        member('m_xA_none', X, BIZ_A, 'STAFF', {}),
        member('m_xA_crm', X, BIZ_A, 'STAFF', { crm: 'read' }),
        member('m_xA_rev', X, BIZ_A, 'STAFF', { revenue: 'write', crm: 'write' }),
        member('m_xA_admin', X, BIZ_A, 'ADMIN', null),
        member('m_xA_owner', X, BIZ_A, 'OWNER', null),
      ];
      let reached = 0;
      for (const n of named) {
        for (const o of own) {
          for (const assignmentUser of [X, null, OTHER]) {
            const memberships = [n, ...(o && !(o.userId === n.userId && o.businessId === n.businessId) ? [o] : [])];
            const w: World = { users: [user(X, null), user(OTHER, null)], memberships, assignments: [naming(n, assignmentUser)] };
            const at = `named ${n.id} / own ${o?.id ?? 'none'} / assignment user ${assignmentUser}`;
            const { env } = await routeThroughBridge(w, PHONE);
            const holders = [...new Set([assignmentUser, n.userId].filter((u): u is string => !!u))];
            const row = holders.length === 1 ? w.memberships.find((m) => m.userId === holders[0] && m.businessId === BIZ_A) : undefined;
            expect(reachedBy(env), at).toEqual(row ? capped(row) : BASELINE_REACH);
            reached += reachedBy(env).length;
            for (const h of holders) await expectWithinHttp(w, env, [h]);
          }
        }
      }
      expect(reached, 'the property is not vacuous').toBeGreaterThan(BASELINE_REACH.length * 90);
    });
  });

  describe("INP4-3 — a position on a member's own phone is capped by that member's membership", () => {
    const PHONE = '+18685551904';
    const ADMIN = 'u_admin';
    const ADMIN_USER = user(ADMIN, PHONE);
    const ADMIN_FULL = member('m_admin', ADMIN, BIZ_A, 'ADMIN', null);
    const ADMIN_NARROWED = { ...ADMIN_FULL, permissionScopes: { crm: 'read' } };
    const OWNER_ROW = member('m_ownerA', OWNER_A, BIZ_A, 'OWNER', null);
    const CONTACT_ONLY = { isContactOnly: true, contactName: 'Night desk', contactPhone: PHONE, orgUnitId: 'ou_A', jobRoleId: SALES_LEAD.id };
    const contactOnly = (phone: string, id = 'as_c') => position({ id, isContactOnly: true, contactName: 'Night desk', contactPhone: phone });
    const REFUSED = /A member of this business uses this phone number/;

    it("the repro, at the door: createAssignment refuses a contact-only position on a member's own phone (in any format), and writes nothing", async () => {
      const w: World = { users: [ADMIN_USER, user(OWNER_A, null)], memberships: [ADMIN_FULL, OWNER_ROW], assignments: [] };
      const structure = new StructureService(prismaOver(w));
      await expect(structure.createAssignment(BIZ_A, CONTACT_ONLY as any, ADMIN)).rejects.toThrow(REFUSED);
      await expect(structure.createAssignment(BIZ_A, { ...CONTACT_ONLY, contactPhone: '+1 (868) 555-1904' } as any, OWNER_A)).rejects.toThrow(REFUSED);
      expect(w.assignments).toEqual([]);
    });

    it("and on update: moving a contact-only position onto a member's phone is refused", async () => {
      const w: World = { users: [ADMIN_USER, user(OWNER_A, null)], memberships: [ADMIN_FULL, OWNER_ROW], assignments: [contactOnly('+18685550000')] };
      const structure = new StructureService(prismaOver(w));
      await expect(structure.updateAssignment(BIZ_A, 'as_c', { contactPhone: '+1 868 555 1904' } as any, OWNER_A)).rejects.toThrow(REFUSED);
      expect(w.assignments[0].contactPhone).toBe('+18685550000');
    });

    it("controls: a contact-only position on a phone no member of the business has, and the member's own position on their phone, are still created", async () => {
      const w: World = {
        users: [ADMIN_USER, user(OWNER_A, null), user('u_elsewhere', '+18685550001')],
        memberships: [ADMIN_FULL, OWNER_ROW, member('m_elsewhere', 'u_elsewhere', BIZ_B, 'STAFF', null)],
        assignments: [],
      };
      const structure = new StructureService(prismaOver(w));
      await expect(structure.createAssignment(BIZ_A, { ...CONTACT_ONLY, contactPhone: '+18685550001' } as any, OWNER_A)).resolves.toMatchObject({
        isContactOnly: true,
        membershipId: null,
        contactPhone: '+18685550001',
      });
      await expect(
        structure.createAssignment(BIZ_A, { membershipId: ADMIN_FULL.id, userId: ADMIN, contactPhone: PHONE, orgUnitId: 'ou_A', jobRoleId: SALES_LEAD.id } as any, OWNER_A),
      ).resolves.toMatchObject({ isContactOnly: false, membershipId: ADMIN_FULL.id, contactPhone: PHONE });
    });

    it("the repro, at run time: a contact-only position already on the ADMIN's phone (filed before the door was shut) follows the ADMIN's narrowing", async () => {
      const before: World = { users: [ADMIN_USER], memberships: [ADMIN_FULL], assignments: [contactOnly(PHONE)] };
      expect(await httpAnswer(before, ADMIN, BIZ_A, { module: 'revenue', minLevel: 'write' })).toBe(true);
      expect(reachedBy((await routeThroughBridge(before, PHONE)).env)).toEqual(capped(ADMIN_FULL));

      const w: World = { users: [ADMIN_USER], memberships: [ADMIN_NARROWED], assignments: [contactOnly(PHONE)] };
      expect(await httpAnswer(w, ADMIN, BIZ_A, { module: 'revenue', minLevel: 'write' })).toBe('Insufficient permissions: revenue requires write access (you have none)');
      expect(await httpAnswer(w, ADMIN, BIZ_A, { module: 'crm', minLevel: 'write' })).toBe('Insufficient permissions: crm requires write access (you have read)');
      const { env } = await routeThroughBridge(w, PHONE);
      expect(reachedBy(env)).toEqual(capped(ADMIN_NARROWED));
      for (const tool of ['commerce_create_invoice', 'deals_mark_won', 'payments_create_link']) {
        const d = await oversight.evaluate(BIZ_A, tool, undefined, [], env, reader(2));
        expect(d.allowed, `${tool}: ${d.reason}`).toBe(false);
        expect(d.reason).toMatch(/Sales Lead position's (scope|tier)/);
      }
      expect(await oversight.evaluate(BIZ_A, 'deals_list', undefined, [], env, reader(2))).toMatchObject({ allowed: true });
      await expectWithinHttp(w, env, [ADMIN]);
    });

    it('a contact later invited with their phone (stored in another format) caps the position by their membership', async () => {
      const INVITED = 'u_invited';
      const STAFF_ROW = member('m_inv', INVITED, BIZ_A, 'STAFF', null);
      const w: World = { users: [user(INVITED, '+1 (868) 555-1905')], memberships: [STAFF_ROW], assignments: [contactOnly('+18685551905')] };
      expect(await httpAnswer(w, INVITED, BIZ_A, { module: 'revenue', minLevel: 'write' })).toBe('Insufficient permissions: revenue requires write access (you have read)');
      const { env } = await routeThroughBridge(w, '+18685551905');
      expect(reachedBy(env)).toEqual(capped(STAFF_ROW));
      expect((await oversight.evaluate(BIZ_A, 'commerce_create_invoice', undefined, [], env, reader(2))).allowed).toBe(false);
      await expectWithinHttp(w, env, [INVITED]);
    });

    it('two members on the phone bound it by both; a banned or deleted member on it leaves the baseline; a member of another business, or a user who is no member, does not cap it', async () => {
      const A1 = member('m_1', 'u_1', BIZ_A, 'STAFF', { crm: 'admin', revenue: 'read' });
      const A2 = member('m_2', 'u_2', BIZ_A, 'STAFF', { crm: 'read', revenue: 'admin' });
      const both: World = { users: [user('u_1', PHONE), user('u_2', '+1-868-555-1904')], memberships: [A1, A2], assignments: [contactOnly(PHONE)] };
      const env = (await routeThroughBridge(both, PHONE)).env;
      expect(reachedBy(env)).toEqual(capped(A1, A2));
      await expectWithinHttp(both, env, ['u_1', 'u_2']);

      for (const state of [BANNED, DELETED]) {
        const w: World = { users: [user('u_1', PHONE, state)], memberships: [A1], assignments: [contactOnly(PHONE)] };
        expect(reachedBy((await routeThroughBridge(w, PHONE)).env), JSON.stringify(state)).toEqual(BASELINE_REACH);
      }

      const elsewhere: World = {
        users: [user('u_b', PHONE), user('u_nomember', PHONE)],
        memberships: [member('m_b', 'u_b', BIZ_B, 'STAFF', {})],
        assignments: [contactOnly(PHONE)],
      };
      expect(reachedBy((await routeThroughBridge(elsewhere, PHONE)).env)).toEqual(capped());
    });

    it('K2 property: over positions on the phone x the members whose account phone it is, a governed tool KEY reaches is one HTTP gives every one of them', async () => {
      const scopeSets: Array<[string, unknown]> = [
        ['STAFF', {}],
        ['STAFF', { crm: 'read' }],
        ['STAFF', null],
        ['ADMIN', { crm: 'write', revenue: 'read' }],
        ['ADMIN', null],
        ['OWNER', null],
      ];
      const memberSets: MemberRow[][] = [[]];
      scopeSets.forEach(([role, s], i) => memberSets.push([member(`m_${i}`, `u_${i}`, BIZ_A, role, s)]));
      memberSets.push([member('m_p', 'u_p', BIZ_A, 'STAFF', { revenue: 'admin' }), member('m_q', 'u_q', BIZ_A, 'STAFF', { crm: 'admin' })]);
      const positions: Array<Partial<AssignmentRow>> = [
        { isContactOnly: true, contactName: 'Night desk' },
        { membershipId: 'm_holder', userId: 'u_holder' },
      ];
      const HOLDER_ROW = member('m_holder', 'u_holder', BIZ_A, 'ADMIN', null);
      let reached = 0;
      for (const ms of memberSets) {
        for (const p of positions) {
          const w: World = {
            users: [user('u_holder', null), ...ms.map((m) => user(m.userId, PHONE))],
            memberships: [HOLDER_ROW, ...ms],
            assignments: [position({ id: 'as_p', contactPhone: PHONE, ...p })],
          };
          const { env } = await routeThroughBridge(w, PHONE);
          const holders = [...ms.map((m) => m.userId), ...(p.userId ? [p.userId] : [])];
          const expected = p.userId ? capped(HOLDER_ROW, ...ms) : capped(...ms);
          expect(reachedBy(env), `${JSON.stringify(p)} / ${ms.map((m) => m.id).join(',')}`).toEqual(expected);
          reached += expected.length;
          await expectWithinHttp(w, env, holders);
        }
      }
      expect(reached, 'the property is not vacuous').toBeGreaterThan(200);
    });

    it('policy: phoneMembers bound a position; one not shown to be in the position business with an active account caps it to the baseline (fail closed)', () => {
      const row = { role: 'STAFF', permissionScopes: { crm: 'read' }, businessId: BIZ_A, userId: 'u_1', user: ACTIVE };
      const base = { jobRole: SALES_LEAD, businessId: BIZ_A, membershipId: null, userId: null };
      expect(reachedBy(policy.envelopeForPosition({ ...base, phoneMembers: [] } as any))).toEqual(capped());
      expect(reachedBy(policy.envelopeForPosition({ ...base, phoneMembers: [row] } as any))).toEqual(capped(member('m', 'u_1', BIZ_A, 'STAFF', { crm: 'read' })));
      for (const [label, m] of [
        ['in another business', { ...row, businessId: BIZ_B }],
        ['business not given', { ...row, businessId: undefined }],
        ['user not given', { ...row, userId: undefined }],
        ['account not given', { ...row, user: undefined }],
        ['banned', { ...row, user: BANNED }],
      ] as Array<[string, unknown]>) {
        expect(reachedBy(policy.envelopeForPosition({ ...base, phoneMembers: [m] } as any)), label).toEqual(BASELINE_REACH);
      }
      expect(reachedBy(policy.envelopeForPosition({ ...base, businessId: undefined, phoneMembers: [row] } as any)), 'position business not given').toEqual(BASELINE_REACH);
    });
  });

  describe('DRV-BRIEF / DRV5-1 — inbox_brief needs the level that forces a brief by hand', () => {
    const http = async (scopes: unknown, module: string, minLevel: Level) => {
      const w: World = { users: [user('u_1', null)], memberships: [member('m_1', 'u_1', BIZ_A, 'STAFF', scopes)], assignments: [] };
      return httpAnswer(w, 'u_1', BIZ_A, { module, minLevel });
    };

    it('{ operations: read } reaches the brief GET serves, not the one KEY generates; { operations: write } does, as POST brief/generate', async () => {
      const read = envelope({ operations: 'read' });
      expect(allows(read, 'inbox_brief')).toBe(false);
      expect(read.maxRiskTier).toBe(1);
      const refused = await oversight.evaluate(BIZ_A, 'inbox_brief', undefined, [], read, reader(1));
      expect(refused.allowed).toBe(false);
      expect(refused.reason).toMatch(/outside the Position position's scope/);
      // HTTP for the same map: GET brief (operations:read) yes, POST brief/generate (operations:write) no
      expect(await http({ operations: 'read' }, 'operations', 'read')).toBe(true);
      expect(await http({ operations: 'read' }, 'operations', 'write')).toBe('Insufficient permissions: operations requires write access (you have read)');

      const write = envelope({ operations: 'write' });
      expect(await http({ operations: 'write' }, 'operations', 'write')).toBe(true);
      expect(await oversight.evaluate(BIZ_A, 'inbox_brief', undefined, [], write, reader(1))).toMatchObject({ allowed: true, requiresQuickConfirm: false });
      // the other inbox reads stay at read
      expect(passes(read, 'inbox_list_threads')).toBe(true);
      expect(passes(read, 'inbox_read_thread')).toBe(true);
    });
  });

  describe('DRV5-2 — commerce_send_invoice is granted by no key', () => {
    it('{ revenue: admin } at autonomy 5 is refused it, and no canonical map, legacy key or the baseline reaches it', async () => {
      const admin = envelope({ revenue: 'admin' });
      expect(allows(admin, 'commerce_send_invoice')).toBe(false);
      const d = await oversight.evaluate(BIZ_A, 'commerce_send_invoice', undefined, [], admin, reader(5));
      expect(d.allowed).toBe(false);
      expect(d.reason).toMatch(/outside the Position position's scope/);
      const everything = Object.fromEntries([...CANONICAL_MODULES, ...Object.keys(policyExports.MODULE_TOOL_FAMILIES)].map((k) => [k, 'admin']));
      expect(allows(envelope(everything), 'commerce_send_invoice')).toBe(false);
      expect(allows(envelope({}), 'commerce_send_invoice')).toBe(false);
      expect(policyExports.GOVERNED_UNGRANTED.commerce_send_invoice).toBeDefined();
      // the tools beside it stay where the derivation puts them
      expect(passes(admin, 'commerce_create_invoice')).toBe(true);
      expect(passes(admin, 'commerce_delete_invoice')).toBe(true);
    });
  });
});

/**
 * V1-21b review 8 DD8-1. A dispatcher call that finds its row by an id the model chose, with no
 * business in the where, is bound over HTTP only by the ambient Prisma tenant TenantInterceptor
 * arms; the WhatsApp/SMS staff bridge runs with none, so on it the call reaches any business's
 * row. The governed ones the review found (call_log_outcome, call_schedule_followup,
 * call_generate_script, granted by crm:write) now bind the row to the business KEY acts in; the
 * ungoverned ones the same rule finds (job-role-tool-families.spec.ts rule 2b) are
 * TENANT_UNBOUND_TOOLS, which no key reaches: not a canonical key, not a legacy family (content_*,
 * bookings_*, projects_*, procurement_*), not the baseline.
 */
describe('V1-21b review 8 — no key reaches a tool that finds its row by a bare id on the bridge (DD8-1)', () => {
  const UNBOUND = ((policyExports as Record<string, unknown>).TENANT_UNBOUND_TOOLS ?? {}) as Record<string, string>;
  const oversight = new AiOversightService({ client: {} } as any, {} as any, {} as any, {} as any, {} as any, policy);
  const reader = (autonomyLevel: number): AutonomySettingsReader => ({
    autopilotSettings: { findUnique: async () => ({ autonomyLevel, blockedTools: [], approvedTools: [], approvalTimeoutHours: 24 }) },
    aiMemory: { findUnique: async () => null },
  });
  const CONTENT = ['content_assign_request', 'content_deliver_request', 'content_get_request', 'content_submit_for_review', 'content_transition_status', 'content_upload_deliverables'];

  it('lists exactly the tools the derivation finds (job-role-tool-families.spec.ts rule 2b)', () => {
    expect(Object.keys(UNBOUND).sort()).toEqual(
      [
        ...CONTENT,
        'approval_decide_step',
        'bookings_offer_waitlist_slot',
        'evidence_verify',
        'people_assign_task',
        // procurement_acknowledge_vendor / mark_fulfilled / mark_invoiced: governed by operations since
        // D-40, so GOVERNED_UNGRANTED instead (R0-13g), and operations write since FOLLOW3-D15 bound
        // ProcurementService's writes to the business; the legacy family still reaches none of them (below)
        // projects_update_task: ProjectsService.updateTask resolves the assignee within the business since
        // PR196-PROJECTS-SERVER (D-87), so it left the list and a projects key reaches it again (below)
      ].sort(),
    );
    for (const t of Object.keys(UNBOUND)) expect(REGISTRY, t).toContain(t);
  });

  it.each<[Record<string, string>, string[]]>([
    [{ content: 'admin' }, CONTENT],
    [{ marketing: 'admin' }, CONTENT],
    [{ bookings: 'admin' }, ['bookings_offer_waitlist_slot']],
    [{ procurement: 'admin' }, ['procurement_acknowledge_vendor', 'procurement_mark_fulfilled', 'procurement_mark_invoiced']],
  ])('%j matches them by family, and reaches none of them', (permissions, tools) => {
    const env = envelope(permissions);
    expect(env.maxRiskTier).toBe(3);
    for (const t of tools) {
      expect(env.blockedTools, t).toContain(t);
      expect(allows(env, t), t).toBe(false);
      expect(passes(env, t), t).toBe(false);
    }
  });

  it('every key at admin at once reaches none of them, and neither does the baseline', () => {
    const everything = Object.fromEntries([...CANONICAL_MODULES, ...Object.keys(policyExports.MODULE_TOOL_FAMILIES)].map((k) => [k, 'admin']));
    for (const t of Object.keys(UNBOUND)) {
      expect(allows(envelope(everything), t), t).toBe(false);
      expect(allows(envelope({}), t), t).toBe(false);
    }
  });

  it('through the real AiOversightService.evaluate at autonomy 5: refused as outside the position', async () => {
    for (const [permissions, tool] of [
      [{ content: 'admin' }, 'content_transition_status'],
      [{ content: 'admin' }, 'content_deliver_request'],
      [{ bookings: 'admin' }, 'bookings_offer_waitlist_slot'],
      [{ procurement: 'admin' }, 'procurement_mark_fulfilled'],
    ] as const) {
      const d = await oversight.evaluate('biz_1', tool, undefined, [], envelope(permissions), reader(5));
      expect(d.allowed, tool).toBe(false);
      expect(d.reason, tool).toMatch(/outside the Position position's scope/);
    }
  });

  it('negative control: the same keys still reach the sibling tools that bind their rows, and crm:write the call tools', () => {
    expect(passes(envelope({ content: 'write' }), 'content_create_request')).toBe(true);
    expect(passes(envelope({ content: 'read' }), 'content_list_requests')).toBe(true);
    expect(passes(envelope({ bookings: 'write' }), 'bookings_create_booking')).toBe(true);
    expect(passes(envelope({ projects: 'write' }), 'projects_create_task')).toBe(true);
    // PR196-PROJECTS-SERVER (D-87): updateTask binds the assignee to the business, so the key reaches it
    expect(passes(envelope({ projects: 'write' }), 'projects_update_task')).toBe(true);
    // D-40 (R0-13g): the procurement routes require operations, so the sibling procurement tools are
    // reached through operations and no longer through the legacy `procurement` family key
    expect(passes(envelope({ operations: 'write' }), 'procurement_create_request')).toBe(true);
    expect(passes(envelope({ operations: 'read' }), 'procurement_get_request')).toBe(true);
    expect(passes(envelope({ procurement: 'admin' }), 'procurement_create_request')).toBe(false);
    expect(passes(envelope({ procurement: 'admin' }), 'procurement_get_request')).toBe(false);
    const crm = envelope({ crm: 'write' });
    for (const t of ['call_log_outcome', 'call_schedule_followup', 'call_generate_script', 'call_create_task']) expect(passes(crm, t), t).toBe(true);
  });
});

/**
 * V1-21b review 9 WB-1 / FB-3 — a reply approval is capped as the envelope is.
 *
 * StaffChatBridgeService resolves a pending approval on a 'YES' (AiOversightService
 * .resolveApprovalByAssignment) before any envelope is built, and that checked the item's tier
 * against JobRole.defaultApprovalTier alone. A holder HTTP narrows (tier 0), bans, or knows only
 * as a member of another business approved a tier-3 refund by WhatsApp (confirmed on a real
 * database: test/staff-bridge-boundary.integration.test.ts). approvalTierForPosition is the tier
 * a position may approve by reply: its JobRole's, capped by the membership HTTP reads for its
 * holder in the position's business (membershipApprovalTier, the rule resolveApproval applies)
 * and by each member whose account phone is the position's; a holder HTTP would refuse every
 * route, or one not shown to be a member here, approves nothing (fail closed, as the envelope).
 */
describe('V1-21b review 9 — a reply approval needs the tier the holder has over HTTP (WB-1, FB-3)', () => {
  type TierResult = { tier: number; refusal?: string };
  const approvalTierForPosition = (policyExports as Record<string, unknown>).approvalTierForPosition as (p: unknown) => TierResult;
  const BIZ = 'biz_a';
  const ACTIVE = { deletedAt: null, bannedAt: null };
  const member = (over: Record<string, unknown> = {}) => ({
    businessId: BIZ,
    userId: 'u_holder',
    role: 'ADMIN',
    permissionScopes: null,
    maxApprovalTier: 3,
    user: ACTIVE,
    ...over,
  });
  const position = (over: Record<string, unknown> = {}) => ({
    businessId: BIZ,
    jobRole: { id: 'jr', name: 'Ownerish', permissions: {}, defaultApprovalTier: 3 },
    membershipId: 'm_holder',
    userId: 'u_holder',
    membership: member(),
    phoneMembers: [],
    ...over,
  });
  const contactOnly = { membershipId: null, userId: null, membership: null };

  it('is exported', () => {
    expect(typeof approvalTierForPosition).toBe('function');
  });

  it.each<[string, Record<string, unknown>, number, boolean]>([
    ['a holder at tier 3 holds the JobRole tier 3', {}, 3, false],
    [
      'a holder narrowed by PATCH .../permissions ({ crm: read }, tier 0) approves nothing above tier 0',
      { membership: member({ role: 'STAFF', permissionScopes: { crm: 'read' }, maxApprovalTier: 0 }) },
      0,
      false,
    ],
    ['the lower of the JobRole tier and the membership tier', { jobRole: { id: 'jr', name: 'Low', permissions: {}, defaultApprovalTier: 1 } }, 1, false],
    ['a STAFF holder on role defaults is tier 0 (DEFAULT_APPROVAL_TIERS)', { membership: member({ role: 'STAFF', maxApprovalTier: 0 }) }, 0, false],
    ['a banned holder is refused', { membership: member({ user: { deletedAt: null, bannedAt: new Date() } }) }, 0, true],
    ['a soft-deleted holder is refused', { membership: member({ user: { deletedAt: new Date(), bannedAt: null } }) }, 0, true],
    ['a holder whose account is not given is refused (fail closed)', { membership: member({ user: undefined }) }, 0, true],
    ['a membership-backed position with no membership here is refused', { membership: null }, 0, true],
    [
      "a membership in another business is refused (FB-3: HTTP reads the holder's row in this one)",
      { membership: member({ businessId: 'biz_b', role: 'OWNER', maxApprovalTier: 4 }) },
      0,
      true,
    ],
    ["another user's membership is refused", { membership: member({ userId: 'u_other' }) }, 0, true],
    ['a contact-only position with no member on its phone keeps its JobRole tier', contactOnly, 3, false],
    [
      "a contact-only position on a narrowed member's phone is capped by that member",
      { ...contactOnly, phoneMembers: [member({ userId: 'u_phone', role: 'STAFF', permissionScopes: { crm: 'read' }, maxApprovalTier: 0 })] },
      0,
      false,
    ],
    [
      "a contact-only position on a banned member's phone is refused",
      { ...contactOnly, phoneMembers: [member({ userId: 'u_phone', user: { deletedAt: null, bannedAt: new Date() } })] },
      0,
      true,
    ],
    ["a phone member of another business is refused (fail closed)", { ...contactOnly, phoneMembers: [member({ userId: 'u_phone', businessId: 'biz_b' })] }, 0, true],
    ['every phone member caps it (the lowest wins)', { phoneMembers: [member({ userId: 'u_p1', maxApprovalTier: 2 }), member({ userId: 'u_p2', maxApprovalTier: 1 })] }, 1, false],
    ['a position without a JobRole approves nothing', { jobRole: null }, 0, false],
  ])('%s', (_label, over, tier, refused) => {
    const out = approvalTierForPosition(position(over));
    expect(out.tier).toBe(tier);
    expect(!!out.refusal).toBe(refused);
  });
});
