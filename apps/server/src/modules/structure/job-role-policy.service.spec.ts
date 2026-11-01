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
 * StaffChatBridgeService and the real RoleEngineService crews.
 */
import { describe, it, expect } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FLOW_TOOLS } from '../ai/flow-tool-registry';
import { AiOversightService, type AutonomySettingsReader } from '../ai/ai-oversight.service';
import { RoleEngineService, type BusinessRole } from '../ai/role-engine.service';
import { FlowOrchestratorService } from '../ai/flow-orchestrator.service';
import { CANONICAL_MODULES, type CanonicalModule } from '../../core/authority/module-vocabulary';
import { ModuleScopeGuard, MODULE_SCOPE_KEY } from '../../core/auth/module-scope.guard';
import { resolveCrmAccess } from '../crm/crm-permissions.helper';
import { CrmService } from '../crm/crm.service';
import { StaffChatBridgeService } from './staff-chat-bridge.service';
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
    write: ['crm_create_contact', 'crm_update_contact', 'call_generate_script', 'deals_create', 'deals_mark_won', 'crm_update_deal', 'call_log_outcome', 'tag_contact', 'crm_add_note', 'crm_add_task'],
    admin: ['crm_delete_contact', 'crm_merge_execute', 'deals_delete'],
    deny: ['commerce_create_invoice', 'structure_list_job_roles', 'payments_refund_charge', 'sequence_enroll'],
  },
  revenue: {
    // commerce_list_invoices reads what GET .../invoices (revenue:read) lists (review 2 C2)
    read: ['payments_list_links', 'payments_list_transactions', 'payments_list_gateways', 'payments_search_transactions', 'commerce_list_invoices'],
    // commerce_mark_invoice_paid: PATCH invoices/:id/paid needs revenue:write; the Stripe
    // webhook that also calls it is not a member route (review 2 C1)
    write: ['commerce_create_invoice', 'commerce_create_quote', 'commerce_convert_quote', 'commerce_update_invoice', 'payments_create_link', 'payments_revoke_link', 'commerce_mark_invoice_paid'],
    admin: ['commerce_send_invoice', 'commerce_delete_invoice', 'payments_refund_charge'],
    deny: [
      // reached unscoped (catalog.controller)
      'commerce_create_product',
      'finance_post_journal_entry',
      'finance_profit_and_loss',
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
    admin: ['assets_delete', 'content_deliver_request'],
    deny: ['social_publish_post', 'marketing_send_campaign', 'commerce_create_invoice'],
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
    read: ['contracts_list', 'contracts_get', 'contract_list_tags', 'inbox_list_threads', 'inbox_read_thread', 'inbox_brief', 'payroll_list_rates', 'payroll_get_run', 'performance_scorecard'],
    // contracts_acknowledge_alert / inbox_mark_resolved are tier 1, but their routes need operations:write
    write: ['contracts_acknowledge_alert', 'inbox_mark_resolved', 'contracts_create', 'contract_create_tag', 'inbox_update_thread_status', 'performance_take_snapshot'],
    admin: ['contracts_delete', 'inbox_reply_thread', 'payroll_approve_run', 'payroll_mark_paid'],
    // PayrollService.setRate / generateRun and ContractClauseService.extractClauses back no route
    deny: ['payroll_set_rate', 'payroll_generate_run', 'contract_extract_clauses', 'procurement_create_request', 'helpdesk_create_ticket', 'commerce_create_invoice', 'structure_get_org_tree'],
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
    expect(passes(envelope({ crm: 'admin' }), 'crm_delete_contact')).toBe(true);
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
    [{ crm: 'admin' }, 'crm_delete_contact', { requiresFormalApproval: true }],
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
    expect(passes(envelope({ finance: 'write' }), 'finance_cashflow')).toBe(true);
    expect(passes(envelope({ finance: 'write' }), 'finance_create_coa_account')).toBe(true);
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

  for (const [key, families] of Object.entries(LEGACY).filter(([k]) => !(CANONICAL_MODULES as readonly string[]).includes(k))) {
    it(`{ ${key}: <level> } reaches what it reached before the repair, less the tools a route governs`, () => {
      for (const level of LEVELS) {
        expect(reachedNow({ [key]: level }), level).toEqual(reachedBefore(families, level).filter((t) => !ROUTE_GOVERNED.has(t)));
      }
    });
  }

  it('the governed tools a legacy key loses, pinned (an owner decision whether to migrate such rows)', () => {
    const lost = (key: string) => reachedBefore(LEGACY[key], 'admin').filter((t) => ROUTE_GOVERNED.has(t));
    expect(lost('finance')).toEqual(['expenses_create', 'expenses_list', 'finance_create_bill', 'finance_list_bills', 'finance_pay_bill', 'finance_view_payables']);
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
    expect(allows(envelope({ FINANCE: 'Write' }), 'finance_cashflow')).toBe(true);
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
      expect(await evaluate({ crm: 'write' }, 'crm_update_contact')).toMatchObject({ allowed: true });
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

    it('a legacy key keeps the tools a member reaches over HTTP with no module (finance_cashflow, commerce_create_product, helpdesk_*)', async () => {
      expect(await evaluate({ finance: 'write' }, 'finance_cashflow')).toMatchObject({ allowed: true });
      expect(await evaluate({ sales: 'read' }, 'commerce_create_product')).toMatchObject({ allowed: true });
      expect(await evaluate({ helpdesk: 'read' }, 'helpdesk_list_tickets')).toMatchObject({ allowed: true });
      expect(await evaluate({ helpdesk: 'write' }, 'helpdesk_create_ticket')).toMatchObject({ allowed: true });
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
      expect(await evaluate({ crm: 'write' }, 'crm_update_contact')).toMatchObject({ allowed: true });
      expect(await evaluate({ crm: 'write', crm_edit: 'any' }, 'tag_contact')).toMatchObject({ allowed: true });
      expect((await access({ crm: 'admin' })).deleteScope).toBe('any');
      expect(await evaluate({ crm: 'admin' }, 'crm_delete_contact', 3)).toMatchObject({ allowed: true });
      expect(await evaluate({ crm: 'admin', crm_delete: 'any' }, 'crm_delete_contact', 3)).toMatchObject({ allowed: true });
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
          'revenue:commerce_delete_invoice',
          'revenue:commerce_send_invoice',
          'revenue:payments_refund_charge',
          'team:structure_create_delegation_rule',
          'team:structure_update_delegation_rule',
        ].sort(),
      );
      for (const entry of tierCapped) {
        const [m, t] = entry.split(':');
        expect(allows(envelope({ [m]: 'write' }), t), `${entry} @ write`).toBe(false);
        expect(passes(envelope({ [m]: 'admin' }), t), `${entry} @ admin`).toBe(true);
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
      for (const permissions of [{ crm: 'admin' }, { crm: 'admin', crm_view: 'all' }]) {
        expect((await resolveCrmAccess(membershipPrisma(permissions), 'biz_1', 'u_1')).viewAll).toBe(true);
        for (const tool of SUB_TOOLS) expect(passes(envelope(permissions), tool), `${JSON.stringify(permissions)} ${tool}`).toBe(true);
      }
      expect(
        await oversight.evaluate('biz_1', 'crm_update_contact', undefined, [], envelope({ crm: 'write', crm_view: 'all' }), reader()),
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
      const orchestrator = {
        getConversationHistory: async () => [],
        chat: async (_b: string, _m: string, _h: unknown, _a: unknown, ctx: typeof pageContext) => {
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
      return pageContext;
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
