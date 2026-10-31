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
 */
import { describe, it, expect } from 'vitest';
import { FLOW_TOOLS } from '../ai/flow-tool-registry';
import { AiOversightService, type AutonomySettingsReader } from '../ai/ai-oversight.service';
import { CANONICAL_MODULES, type CanonicalModule } from '../../core/authority/module-vocabulary';
import { jobRolePermissionsProblem } from './dto/create-job-role.dto';
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
    // crm_list_contacts / crm_search_contacts ride on the legacy `crm` key (crm_*).
    read: ['deals_list', 'deals_get', 'deals_forecast', 'call_list_tasks', 'crm_find_duplicates', 'crm_merge_preview', 'crm_list_contacts', 'crm_search_contacts'],
    // tier 1, but the routes require crm:write (SEC-V21b-03)
    write: ['crm_create_contact', 'crm_update_contact', 'call_generate_script', 'deals_create', 'deals_mark_won', 'crm_update_deal', 'call_log_outcome', 'tag_contact'],
    admin: ['crm_delete_contact', 'crm_merge_execute', 'deals_delete'],
    deny: ['commerce_create_invoice', 'structure_list_job_roles', 'payments_refund_charge', 'sequence_enroll'],
  },
  revenue: {
    read: ['payments_list_links', 'payments_list_transactions', 'payments_list_gateways', 'payments_search_transactions'],
    write: ['commerce_create_invoice', 'commerce_create_quote', 'commerce_convert_quote', 'commerce_update_invoice', 'payments_create_link', 'payments_revoke_link'],
    admin: ['commerce_send_invoice', 'commerce_delete_invoice', 'payments_refund_charge'],
    deny: [
      // reached unscoped (Stripe webhook / catalog.controller) or by a direct Prisma read
      'commerce_mark_invoice_paid',
      'commerce_create_product',
      'commerce_list_invoices',
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
    read: ['assets_list', 'assets_list_folders', 'content_list_requests'],
    // assets_tag / assets_untag are tier 1, but POST .../tag and .../untag need content:write
    write: ['assets_tag', 'assets_untag', 'assets_update', 'content_create_request'],
    admin: ['assets_delete', 'content_deliver_request'],
    deny: ['assets_get', 'social_publish_post', 'marketing_send_campaign', 'commerce_create_invoice'],
  },
  expenses: {
    read: ['finance_list_bills', 'finance_view_payables'],
    write: ['expenses_create', 'finance_create_bill'],
    admin: ['finance_pay_bill'],
    deny: [
      'expenses_list',
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

  it('crm_add_note is reached only through the legacy crm_* family, as before V1-21b', () => {
    // CrmService.addNote backs no route, so the canonical table does not grant it; the
    // `crm` key is also a legacy key whose pre-V1-21 family crm_* is kept (rows written
    // before V1-21 keep their envelope).
    for (const m of CANONICAL_MODULES.filter((k) => k !== 'crm')) expect(allows(envelope({ [m]: 'admin' }), 'crm_add_note'), m).toBe(false);
    expect(passes(envelope({ crm: 'read' }), 'crm_add_note')).toBe(true);
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
  /** The tools whose routes require write: a read grant no longer reaches them (SEC-V21b-03). */
  const ROUTE_WRITE = new Set(
    Object.values(CANONICAL_MODULE_TOOLS).flatMap((tools) => Object.entries(tools).filter(([, l]) => l !== 'read').map(([t]) => t)),
  );

  for (const [key, families] of Object.entries(LEGACY).filter(([k]) => !(CANONICAL_MODULES as readonly string[]).includes(k))) {
    it(`{ ${key}: 'write' | 'admin' } reaches exactly what it reached before the repair`, () => {
      for (const level of ['write', 'admin'] as const) expect(reachedNow({ [key]: level }), level).toEqual(reachedBefore(families, level));
    });

    it(`{ ${key}: 'read' } reaches what it did before, less tools whose routes require write`, () => {
      expect(reachedNow({ [key]: 'read' })).toEqual(reachedBefore(families, 'read').filter((t) => !ROUTE_WRITE.has(t)));
    });
  }

  it('a read-level legacy grant no longer reaches a tier-1 tool whose route needs write (SEC-V21b-03)', () => {
    expect(allows(envelope({ crm: 'read' }), 'crm_create_contact')).toBe(false);
    expect(allows(envelope({ crm: 'read' }), 'crm_update_contact')).toBe(false);
    expect(allows(envelope({ sales: 'read' }), 'crm_create_contact')).toBe(false);
    expect(allows(envelope({ inbox: 'read' }), 'inbox_mark_resolved')).toBe(false);
    expect(passes(envelope({ inbox: 'write' }), 'inbox_mark_resolved')).toBe(true);
    expect(passes(envelope({ crm: 'write' }), 'crm_create_contact')).toBe(true);
    expect(passes(envelope({ sales: 'write' }), 'crm_create_contact')).toBe(true);
  });

  it('matches keys case-insensitively, as before', () => {
    expect(allows(envelope({ Revenue: 'WRITE' }), 'commerce_create_invoice')).toBe(true);
    expect(allows(envelope({ FINANCE: 'Write' }), 'finance_cashflow')).toBe(true);
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
