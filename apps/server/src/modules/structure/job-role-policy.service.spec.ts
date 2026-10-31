/**
 * JobRolePolicyService.envelopeForJobRole — the position-scoped KEY envelope
 * (V1-21b-JOBROLE-TOOL-FAMILIES, V1-21 review CR-V21-01).
 *
 * V1-21 holds JobRole.permissions to the canonical module vocabulary on every write
 * (create-job-role.dto.ts jobRolePermissionsProblem), but the envelope used to read that
 * column only in the KEY tool-family vocabulary (finance, sales, hr, ...), which overlaps
 * the canonical list on crm, bookings, projects and content alone. A role authored after
 * V1-21 as {revenue: 'write'} therefore granted KEY no commerce_* tool, {team: 'write'} no
 * structure_*, {expenses: 'write'} no expenses_*.
 *
 * These cases pin the behaviour per canonical module (positive AND negative), the legacy
 * tool-family keys that rows written before V1-21 still carry, the unchanged level-to-tier
 * ladder, and deny-by-default. Which tool families each module governs is derived from the
 * HTTP route decorators in job-role-tool-families.spec.ts; the tools named here are the
 * concrete consequences of that table.
 */
import { describe, it, expect } from 'vitest';
import { FLOW_TOOLS } from '../ai/flow-tool-registry';
import { CANONICAL_MODULES, type CanonicalModule } from '../../core/authority/module-vocabulary';
import { jobRolePermissionsProblem } from './dto/create-job-role.dto';
import { JobRolePolicyService, type JobRoleEnvelope } from './job-role-policy.service';

const policy = new JobRolePolicyService();

function envelope(permissions: unknown): JobRoleEnvelope {
  return policy.envelopeForJobRole({ id: 'jr_1', name: 'Position', permissions: permissions as any });
}

const allows = (env: JobRoleEnvelope, tool: string) => policy.isToolAllowed(env, tool);

/** Baseline reads every position keeps regardless of grants (unchanged). */
const BASELINE = ['fetch_*', 'calendar_check_conflicts', 'documents_list'];

const REGISTRY = FLOW_TOOLS.map((t) => t.name);

/**
 * Per canonical module at write level: tools the envelope must approve, and tools it must
 * not. Every name is a real registry tool (asserted below), so a rename cannot turn a
 * negative case into a vacuous pass.
 */
const CASES: Record<CanonicalModule, { allow: string[]; deny: string[] }> = {
  crm: {
    allow: ['crm_create_contact', 'crm_merge_execute', 'deals_create', 'deals_mark_won', 'call_log_outcome', 'tag_contact'],
    deny: ['commerce_create_invoice', 'structure_list_job_roles', 'payments_refund_charge', 'sequence_enroll'],
  },
  revenue: {
    allow: [
      'commerce_create_invoice',
      'commerce_send_invoice',
      'commerce_convert_quote',
      'commerce_mark_invoice_paid',
      'payments_create_link',
      'payments_refund_charge',
    ],
    deny: ['finance_post_journal_entry', 'finance_profit_and_loss', 'crm_create_contact', 'expenses_create', 'structure_get_org_tree'],
  },
  bookings: {
    // calendar_* is what the `bookings` scope governs over HTTP; bookings_* is the legacy
    // `bookings` key's own grant (the key is in both vocabularies) and is kept.
    allow: ['calendar_create_event', 'calendar_list_events', 'bookings_create_booking'],
    deny: ['commerce_create_invoice', 'crm_create_contact', 'projects_create_task'],
  },
  projects: {
    // No `projects` scope is declared on any route; the legacy key's grant is kept.
    allow: ['projects_create_task', 'time_log_entry'],
    deny: ['commerce_create_invoice', 'calendar_create_event', 'structure_get_org_tree'],
  },
  content: {
    allow: ['assets_tag', 'assets_delete', 'assets_list', 'content_create_request'],
    deny: ['social_publish_post', 'marketing_send_campaign', 'commerce_create_invoice'],
  },
  expenses: {
    allow: ['expenses_create', 'expenses_list', 'finance_create_bill', 'finance_pay_bill', 'finance_list_bills', 'finance_view_payables'],
    deny: [
      'finance_post_journal_entry',
      'finance_profit_and_loss',
      'finance_create_coa_account',
      'finance_auto_match_bank',
      'commerce_create_invoice',
    ],
  },
  automations: {
    allow: [],
    deny: ['automations_create_playbook', 'automations_toggle_playbook', 'enable_flow_with_approval', 'commerce_create_invoice'],
  },
  storefront: {
    allow: [],
    deny: ['commerce_create_product', 'apply_storefront_recommendation', 'store_list_products', 'crm_create_contact'],
  },
  settings: {
    allow: [],
    deny: ['update_business_blueprint', 'commerce_create_invoice', 'structure_get_org_tree'],
  },
  ai: {
    allow: [],
    deny: ['goals_create', 'execute_custom_logic', 'commerce_create_invoice'],
  },
  team: {
    allow: ['structure_get_org_tree', 'structure_list_job_roles', 'structure_create_delegation_rule'],
    deny: ['people_assign_task', 'payroll_approve_run', 'commerce_create_invoice', 'crm_create_contact'],
  },
  analytics: {
    allow: [],
    deny: ['reports_generate', 'finance_profit_and_loss', 'commerce_create_invoice'],
  },
  operations: {
    allow: [
      'contracts_create',
      'contract_create_tag',
      'inbox_reply_thread',
      'inbox_list_threads',
      'payroll_approve_run',
      'performance_scorecard',
    ],
    deny: ['procurement_create_request', 'helpdesk_create_ticket', 'commerce_create_invoice', 'structure_get_org_tree'],
  },
  connect: {
    allow: [],
    deny: ['drive_create_document', 'commerce_create_invoice', 'crm_create_contact'],
  },
};

describe('JobRolePolicyService — canonical module vocabulary (V1-21b)', () => {
  it('covers every canonical module and names only real registry tools', () => {
    expect(Object.keys(CASES).sort()).toEqual([...CANONICAL_MODULES].sort());
    for (const { allow, deny } of Object.values(CASES)) {
      for (const tool of [...allow, ...deny]) expect(REGISTRY, tool).toContain(tool);
    }
  });

  for (const module of CANONICAL_MODULES) {
    describe(`{ ${module}: 'write' }`, () => {
      it('is a permissions map V1-21 accepts on create/update', () => {
        expect(jobRolePermissionsProblem({ [module]: 'write' })).toBeNull();
      });

      if (CASES[module].allow.length) {
        it('approves the tool families the module governs', () => {
          const env = envelope({ [module]: 'write' });
          for (const tool of CASES[module].allow) expect(allows(env, tool), `${module} -> ${tool}`).toBe(true);
          expect(env.maxRiskTier).toBe(2);
        });
      } else {
        it('governs no KEY tool family, so it keeps only the baseline reads and tier 1', () => {
          const env = envelope({ [module]: 'write' });
          expect([...env.approvedTools].sort()).toEqual([...BASELINE].sort());
          expect(env.maxRiskTier).toBe(1);
          expect(allows(env, 'fetch_business_summary')).toBe(true);
        });
      }

      it('approves nothing another module governs', () => {
        const env = envelope({ [module]: 'write' });
        for (const tool of CASES[module].deny) expect(allows(env, tool), `${module} -/-> ${tool}`).toBe(false);
      });

      it("grants nothing at level 'none'", () => {
        const env = envelope({ [module]: 'none' });
        expect([...env.approvedTools].sort()).toEqual([...BASELINE].sort());
        expect(env.maxRiskTier).toBe(1);
        for (const tool of CASES[module].allow) expect(allows(env, tool), `${module}:none -/-> ${tool}`).toBe(false);
      });
    });
  }

  it('a role authored today in the canonical vocabulary grants KEY its tools (CR-V21-01)', () => {
    const permissions = { revenue: 'write', team: 'read', expenses: 'write', crm: 'read', crm_view: 'owned' };
    expect(jobRolePermissionsProblem(permissions)).toBeNull();
    const env = envelope(permissions);
    expect(allows(env, 'commerce_create_invoice')).toBe(true);
    expect(allows(env, 'payments_list_links')).toBe(true);
    expect(allows(env, 'structure_get_org_tree')).toBe(true);
    expect(allows(env, 'expenses_create')).toBe(true);
    expect(allows(env, 'deals_list')).toBe(true);
    expect(allows(env, 'payroll_approve_run')).toBe(false);
    expect(env.maxRiskTier).toBe(2);
  });

  it('keeps the level-to-tier ladder: read 1, write 2, admin 3, strongest grant wins', () => {
    expect(envelope({ revenue: 'read' }).maxRiskTier).toBe(1);
    expect(envelope({ revenue: 'write' }).maxRiskTier).toBe(2);
    expect(envelope({ revenue: 'admin' }).maxRiskTier).toBe(3);
    expect(envelope({ revenue: 'read', team: 'admin' }).maxRiskTier).toBe(3);
    // A read grant still lists the family; the tier is what keeps writes out.
    expect(allows(envelope({ revenue: 'read' }), 'commerce_create_invoice')).toBe(true);
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
    expect(allows(envelope({ finance: 'write' }), 'finance_post_journal_entry')).toBe(true);
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
