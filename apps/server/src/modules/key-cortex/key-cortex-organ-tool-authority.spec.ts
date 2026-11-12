/**
 * W11-KEY-ORGAN-AUTHORITY-MAP (owner rulings D-119, D-131; SEC-W10CCS-R1): the member authority map
 * for the KEY chat's dotted organ and legacy cortex tools.
 *
 * Since SEC-W10CCS-R1 the KEY cortex chat holds each model tool call to memberToolRunAuthority with
 * no principal (key-cortex-query-pipeline.service.ts memberToolCallRefusals), which asks
 * graphActionRequirement. That map covered every FLOW tool but none of the dotted tools the chat
 * also offers, so assertMayRunGraphAction refused all of them to every ADMIN and SUPER_ADMIN, and
 * only the business owner ran them (D-119: kept until each tool's entry lands).
 *
 * key-cortex-organ-tool-authority.ts now holds one entry per dotted name: a TWIN (the FLOW tool
 * whose routes govern the same action; its requirement is taken unchanged), SCOPES (the module
 * scopes a member must hold, D-131 for the connector reads and the timeline's money signals), or
 * UNMAPPED with a reason (still null: only the owner runs it, D-119).
 *
 * The census below is the fail-closed guard: the dotted names registered at boot must equal the
 * map's keys plus the unmapped keys, so a new organ or legacy tool fails here until it is
 * classified, and an entry for a tool that no longer exists fails too.
 *
 * Pure: the adapters, the safe database and the legacy actions service are built over stubs and
 * only asked for their tool definitions (no handler runs). The map module is loaded inside each
 * case, so each case reports its own failure rather than a module-load error for the whole file.
 */
import { describe, it, expect, vi } from 'vitest';
import { KeyCortexOrganRegistrarService } from './key-cortex-organ-registrar.service';
import { KeyCortexSafeDatabaseService } from './key-cortex-safe-database.service';
import { KeyCortexActionsService } from './key-cortex-actions.service';
import { TemporalFlowAdapterService } from './organs/temporal-flow-adapter.service';
import { KeyInboxAdapterService } from './organs/key-inbox-adapter.service';
import { KeyGenomeAdapterService } from './organs/key-genome-adapter.service';
import { StorelinkAdapterService } from './organs/storelink-adapter.service';
import { KeyConnectorAdapterService } from './organs/key-connector-adapter.service';
import { KeyCortexActionExecutorPlugin } from './key-cortex-action-executor.plugin';
import { PrismaService } from '../../core/prisma/prisma.service';
import { FLOW_TOOLS } from '../ai/flow-tool-registry';
import { assertMayRunGraphAction, graphActionReadsContacts, graphActionRequirement } from '../ai/graph-actions.controller';
import { memberToolRunAuthority, noMemberToolRefusal, planStepRunAuthority } from '../ai/plan-step-authority';

interface OrganMap {
  KEY_ORGAN_TOOL_AUTHORITY: Record<string, { twin: string } | { scopes: Array<{ module: string; minLevel: string }> }>;
  KEY_ORGAN_TOOLS_UNMAPPED: Record<string, string>;
}

async function organMap(): Promise<OrganMap> {
  return (await import('./key-cortex-organ-tool-authority')) as unknown as OrganMap;
}

/**
 * Every tool name the KEY cortex registry holds at boot from the organ side: what
 * KeyCortexOrganRegistrarService.onModuleInit registers (listTools() of its five organ adapters and the
 * two KeyCortexSafeDatabaseService definitions) and what KeyCortexActionsService.registerLegacyTools
 * registers, each captured as it is handed to the registry. Raw (a name registered twice appears twice).
 */
function registeredOrganToolNames(): { names: string[]; adapters: number } {
  const names: string[] = [];
  const capture = { registerMany: (defs: Array<{ name: string }>) => { for (const d of defs) names.push(d.name); } };
  const bus = { publish: vi.fn(), emit: vi.fn(), subscribe: vi.fn(), subscribeAll: vi.fn() } as never;
  const stub = {} as never;
  const registrar = new KeyCortexOrganRegistrarService(
    capture as never,
    new TemporalFlowAdapterService(stub, bus),
    new KeyInboxAdapterService(stub, stub, bus),
    new KeyGenomeAdapterService(stub, stub, stub, stub, stub, stub, bus),
    new StorelinkAdapterService(stub, stub, stub, stub, stub, bus),
    new KeyConnectorAdapterService(stub, stub, bus),
    new KeyCortexSafeDatabaseService(stub, bus),
  );
  (registrar as unknown as { logger: { log: () => void } }).logger = { log: () => undefined };
  registrar.onModuleInit();
  const legacy = Object.create(KeyCortexActionsService.prototype) as { registerLegacyTools: () => void };
  Object.assign(legacy, { keyCortexToolRegistry: capture, logger: { log: () => undefined } });
  legacy.registerLegacyTools();
  return { names, adapters: registrar.listAdapters().length };
}

/** The TWIN entries at fb00af1c (V1-31b review CR-3: the routes govern; key-inbox.controller.ts:127-412 require operations). */
const TWINS: Record<string, { twin: string; scope: { module: string; minLevel: string } }> = {
  'key_inbox.list_threads': { twin: 'inbox_list_threads', scope: { module: 'operations', minLevel: 'read' } },
  'key_inbox.get_thread': { twin: 'inbox_read_thread', scope: { module: 'operations', minLevel: 'read' } },
  'key_inbox.send_reply': { twin: 'inbox_reply_thread', scope: { module: 'operations', minLevel: 'write' } },
  'key_inbox.mark_resolved': { twin: 'inbox_mark_resolved', scope: { module: 'operations', minLevel: 'write' } },
  'key_inbox.generate_brief': { twin: 'inbox_brief', scope: { module: 'operations', minLevel: 'write' } },
  'storelink.create_portal_access': { twin: 'portal_grant_access', scope: { module: 'crm', minLevel: 'write' } },
};

const s = (module: string, minLevel: 'read' | 'write') => ({ module, minLevel });

/** The SCOPED entries at fb00af1c (D-63, D-100, D-131). */
const SCOPED: Record<string, Array<{ module: string; minLevel: string }>> = {
  'temporal_flow.list_events': [s('ai', 'read'), s('revenue', 'read')],
  'temporal_flow.create_event': [s('ai', 'write')],
  'temporal_flow.set_reminder': [s('ai', 'write')],
  'temporal_flow.mark_resolved': [s('ai', 'write')],
  'temporal_flow.analyze_timeline': [s('ai', 'read'), s('revenue', 'read')],
  'key_genome.get_blueprint': [s('settings', 'read')],
  'key_genome.calculate_integrity': [s('settings', 'read')],
  'key_genome.list_signals': [s('settings', 'read')],
  'key_genome.list_recommendations': [s('settings', 'read')],
  'key_genome.list_facts': [s('settings', 'read')],
  'key_genome.get_readiness': [s('settings', 'read')],
  'storelink.get_analytics': [s('storefront', 'read'), s('revenue', 'read')],
  'storelink.get_conversion_funnel': [s('storefront', 'read')],
  'storelink.get_product_health': [s('storefront', 'read')],
  'storelink.create_promo_code': [s('storefront', 'write')],
  'storelink.list_intakes': [s('crm', 'read')],
  'storelink.get_portal_dashboard': [s('crm', 'read'), s('revenue', 'read')],
  'key_connector.list_providers': [s('connect', 'read')],
  'key_connector.list_connections': [s('connect', 'read')],
  'key_connector.check_health': [s('connect', 'read')],
  'cortex.create_task': [s('ai', 'write')],
  'cortex.schedule_reminder': [s('ai', 'write')],
  'cortex.create_document': [s('ai', 'write')],
  'cortex.search_knowledge': [s('ai', 'read')],
  'cortex.create_lead': [s('crm', 'write')],
};

/** The scoped entries that read contacts (crm read): the OWNER's only with no principal. */
const CONTACT_READS = ['storelink.list_intakes', 'storelink.get_portal_dashboard'];

/** The names that stay owner-only under D-119 at fb00af1c. */
const UNMAPPED = [
  'key_genome.update_dna_section',
  'key_connector.execute_internal',
  'key_connector.trigger_sync',
  'cortex.query_business_data',
  'cortex.query_database',
  'cortex.update_record',
  'cortex.update_crm',
  'cortex.analyze_data',
  'cortex.execute_tool',
  'cortex.create_event',
  'cortex.execute_flow',
  'cortex.create_invoice',
  'cortex.send_email',
  'cortex.send_message',
  'cortex.generate_report',
];

describe('W11-KEY-ORGAN-AUTHORITY-MAP (D-119, D-131): every dotted organ and legacy cortex tool is classified, and everything unmapped stays fail-closed', () => {
  it('W11-KEY-ORGAN-AUTHORITY-MAP census (D-119): the dotted names registered at boot equal exactly the keys of KEY_ORGAN_TOOL_AUTHORITY plus the keys of KEY_ORGAN_TOOLS_UNMAPPED, the two key sets do not overlap, and there are 46 names at fb00af1c', async () => {
    const { names, adapters } = registeredOrganToolNames();
    expect(adapters).toBe(5);
    const registered = [...new Set(names)].sort();
    // 47 registrations, 46 names: cortex.update_record is registered by the safe database and by the legacy service.
    expect(names).toHaveLength(47);
    expect(registered).toHaveLength(46);
    expect(registered.filter((n) => !n.includes('.'))).toEqual([]);
    expect(registered.filter((n) => FLOW_TOOLS.some((t) => t.name === n))).toEqual([]);

    const { KEY_ORGAN_TOOL_AUTHORITY, KEY_ORGAN_TOOLS_UNMAPPED } = await organMap();
    const mapped = Object.keys(KEY_ORGAN_TOOL_AUTHORITY);
    const unmapped = Object.keys(KEY_ORGAN_TOOLS_UNMAPPED);
    expect(mapped.filter((n) => unmapped.includes(n))).toEqual([]);
    expect([...mapped, ...unmapped].sort()).toEqual(registered);
    expect(mapped).toHaveLength(31);
    expect(unmapped).toHaveLength(15);
  });

  it('W11-KEY-ORGAN-AUTHORITY-MAP twins (V1-31b CR-3): every twin target is a FLOW tool whose requirement is neither null nor refused, and graphActionRequirement(dotted) equals graphActionRequirement(target)', async () => {
    const { KEY_ORGAN_TOOL_AUTHORITY } = await organMap();
    const twins = Object.fromEntries(
      Object.entries(KEY_ORGAN_TOOL_AUTHORITY).filter(([, entry]) => 'twin' in entry).map(([name, entry]) => [name, (entry as { twin: string }).twin]),
    );
    expect(twins).toEqual(Object.fromEntries(Object.entries(TWINS).map(([name, t]) => [name, t.twin])));
    for (const [dotted, { twin, scope }] of Object.entries(TWINS)) {
      expect(FLOW_TOOLS.some((t) => t.name === twin), twin).toBe(true);
      const target = graphActionRequirement(twin);
      expect(target, twin).not.toBeNull();
      expect('refused' in (target ?? {}), twin).toBe(false);
      expect((target as { scopes: unknown[] }).scopes[0], twin).toEqual(scope);
      expect(graphActionRequirement(dotted), dotted).toEqual(target);
    }
  });

  it('W11-KEY-ORGAN-AUTHORITY-MAP scoped entries (D-131, D-100, D-63): graphActionRequirement(dotted).scopes equals the entry; storelink.list_intakes and storelink.get_portal_dashboard read contacts, so they are the OWNER\'s only on every surface (review SEC-W11KOAM-1: no dotted handler binds a principal) and refused with no member; none writes revenue (D-46)', async () => {
    const { KEY_ORGAN_TOOL_AUTHORITY } = await organMap();
    const scoped = Object.fromEntries(
      Object.entries(KEY_ORGAN_TOOL_AUTHORITY).filter(([, entry]) => 'scopes' in entry).map(([name, entry]) => [name, (entry as { scopes: unknown[] }).scopes]),
    );
    expect(scoped).toEqual(SCOPED);
    for (const [dotted, scopes] of Object.entries(SCOPED)) {
      const requirement = graphActionRequirement(dotted) as { scopes: unknown[]; ownerOnly?: string; ownerOnlyWithoutPrincipal?: string };
      expect(requirement, dotted).not.toBeNull();
      expect('refused' in requirement, dotted).toBe(false);
      expect(requirement.scopes, dotted).toEqual(scopes);
      if (CONTACT_READS.includes(dotted)) {
        // Review SEC-W11KOAM-1 / CR-W11KOA-2: owner-only with or without a principal.
        expect(requirement.ownerOnly, dotted).toMatch(/KEY cortex registry, whose handlers bind no principal on any surface/);
        expect(requirement.ownerOnlyWithoutPrincipal, dotted).toEqual(expect.any(String));
        expect(graphActionReadsContacts(dotted), dotted).toBe(true);
        expect(noMemberToolRefusal(dotted), dotted).toMatch(/reads the business's contacts/);
      } else {
        expect(requirement.ownerOnly, dotted).toBeUndefined();
        expect(requirement.ownerOnlyWithoutPrincipal, dotted).toBeUndefined();
        expect(graphActionReadsContacts(dotted), dotted).toBe(false);
      }
    }
    // D-46: no mapped tool writes revenue, so a SUPER_ADMIN who is no member is never refused one for that.
    for (const name of Object.keys(KEY_ORGAN_TOOL_AUTHORITY)) {
      const requirement = graphActionRequirement(name) as { scopes: Array<{ module: string; minLevel: string }> };
      expect(requirement.scopes.filter((x) => x.module === 'revenue' && x.minLevel !== 'read'), name).toEqual([]);
    }
  });

  it('W11-KEY-ORGAN-AUTHORITY-MAP unmapped (D-119): every unmapped name has a reason, graphActionRequirement is null, and noMemberToolRefusal says it is mapped to no module scope', async () => {
    const { KEY_ORGAN_TOOLS_UNMAPPED } = await organMap();
    expect(Object.keys(KEY_ORGAN_TOOLS_UNMAPPED).sort()).toEqual([...UNMAPPED].sort());
    for (const name of UNMAPPED) {
      expect(KEY_ORGAN_TOOLS_UNMAPPED[name], name).toMatch(/\S{3}/);
      expect(graphActionRequirement(name), name).toBeNull();
      expect(noMemberToolRefusal(name), name).toMatch(/is mapped to no module scope/);
    }
  });
});

/**
 * The rows memberToolRunAuthority, planStepRunAuthority and assertMayRunGraphAction read, for member
 * 'u1' of business 'b1': the business owner (with a membership row, D-104) or a member of `role` with
 * `permissionScopes` (null: the role's defaults). Plan 'plan1' is u1's.
 */
function authorityPrisma(member: { owner?: boolean; role?: string; permissionScopes?: Record<string, string> | null; userRole?: string }) {
  return {
    client: {
      business: {
        findFirst: vi.fn(async () => (member.owner ? { id: 'b1' } : null)),
        findUnique: vi.fn(async () => ({ ownerId: member.owner ? 'u1' : 'owner_other' })),
      },
      membership: {
        findUnique: vi.fn(async () =>
          member.role === undefined && !member.owner ? null : { id: 'm1', role: member.owner ? 'OWNER' : member.role, permissionScopes: member.permissionScopes ?? null },
        ),
      },
      user: { findUnique: vi.fn(async () => ({ role: member.userRole ?? 'USER' })) },
      aiPlan: { findFirst: vi.fn(async () => ({ userId: 'u1', objective: 'v97q plan', rawInput: 'v97q', scope: [] })) },
    },
  };
}

/** An approved plan step's proposal as PlanExecutorService.createStepProposal files it, for a dotted tool. */
function planStepProposal(toolName: string) {
  return {
    id: 'proposal1',
    userId: 'u1',
    sourceType: 'AI_PLAN',
    planId: 'plan1',
    planStepId: 'step1',
    payload: { toolName, inputPayload: { contactId: 'contact_of_another_member' } },
  };
}

function pluginOver(prisma: unknown) {
  const cortex = { execute: vi.fn(async () => ({ success: true, data: { ran: true } })) };
  const plugin = new KeyCortexActionExecutorPlugin(
    { register: vi.fn() } as never,
    cortex as never,
    { get: vi.fn((token: unknown) => (token === PrismaService ? prisma : {})) } as never,
  );
  return { plugin, cortex };
}

const KEY_CORTEX_CONTACT_READ = /is executed from here only for the business owner: it reads contacts in the KEY cortex registry, whose handlers bind no principal on any surface/;

describe('W11-KEY-ORGAN-AUTHORITY-MAP review repairs (D-37, D-119): a dotted contact read is the OWNER\'s only on every surface, and the FLOW dispatch route runs no dotted tool', () => {
  it('SEC-W11KOAM-1 every mapped dotted tool whose requirement is bound by contact visibility is owner-only outright: no entry, twin or scoped, leaves ownerOnlyWithoutPrincipal for a principal-run surface to skip', async () => {
    const { KEY_ORGAN_TOOL_AUTHORITY } = await organMap();
    const principalSkippable = Object.keys(KEY_ORGAN_TOOL_AUTHORITY).filter((name) => {
      const requirement = graphActionRequirement(name) as { ownerOnly?: string; ownerOnlyWithoutPrincipal?: string } | null;
      return !!requirement && !!requirement.ownerOnlyWithoutPrincipal && !requirement.ownerOnly;
    });
    expect(principalSkippable).toEqual([]);
  });

  it('SEC-W11KOAM-1 / CR-W11KOA-2 RED-BEFORE (D-37): run as the principal (asPrincipal), a STAFF member with crm and revenue read and an ADMIN on role defaults are refused storelink.get_portal_dashboard and storelink.list_intakes, as they are with no principal; the owner runs both', async () => {
    const members = [
      authorityPrisma({ role: 'STAFF', permissionScopes: { crm: 'read', revenue: 'read', storefront: 'read' } }),
      authorityPrisma({ role: 'STAFF', permissionScopes: null }),
      authorityPrisma({ role: 'ADMIN', permissionScopes: null }),
    ];
    for (const prisma of members) {
      for (const tool of CONTACT_READS) {
        for (const asPrincipal of [true, false]) {
          const run = await memberToolRunAuthority(prisma as never, 'b1', 'u1', tool, { asPrincipal });
          expect(run.refusal, `${tool} asPrincipal=${asPrincipal}`).toMatch(KEY_CORTEX_CONTACT_READ);
          expect(run.principal, tool).toBe(false);
        }
      }
    }
    for (const tool of CONTACT_READS) {
      expect((await memberToolRunAuthority(authorityPrisma({ owner: true }) as never, 'b1', 'u1', tool, { asPrincipal: true })).refusal, tool).toBeNull();
    }
  });

  it('regression control (D-119, D-63): run as the principal, an ADMIN still runs a dotted tool that reads no contact (key_genome.get_blueprint) and a twin (key_inbox.get_thread)', async () => {
    for (const tool of ['key_genome.get_blueprint', 'key_inbox.get_thread']) {
      const run = await memberToolRunAuthority(authorityPrisma({ role: 'ADMIN', permissionScopes: null }) as never, 'b1', 'u1', tool, { asPrincipal: true });
      expect(run, tool).toEqual({ refusal: null, principal: true });
    }
  });

  it('SEC-W11KOAM-1 RED-BEFORE (D-37, W4-PROPOSAL-PRINCIPAL): a plan step\'s proposal (planStepRunAuthority with memberIsPrincipal) of a STAFF member\'s plan is refused storelink.get_portal_dashboard, and the approved proposal runs nothing in the cortex registry', async () => {
    const prisma = authorityPrisma({ role: 'STAFF', permissionScopes: null });
    const run = await planStepRunAuthority(prisma as never, 'b1', 'plan1', 'storelink.get_portal_dashboard', { memberIsPrincipal: true });
    expect(run.memberId).toBe('u1');
    expect(run.principalId).toBeNull();
    expect(run.refusal).toMatch(KEY_CORTEX_CONTACT_READ);

    const { plugin, cortex } = pluginOver(prisma);
    for (const tool of CONTACT_READS) {
      const outcome = await plugin.execute('b1', planStepProposal(tool) as never, 'u1');
      expect(outcome.success, tool).toBe(false);
      expect(outcome.error, tool).toMatch(/^Refused: Tool ".+" is executed from here only for the business owner: it reads contacts in the KEY cortex registry/);
    }
    expect(cortex.execute).not.toHaveBeenCalled();
  });

  it('regression control (W4-PROPOSAL-PRINCIPAL): the owner\'s plan step proposal of storelink.get_portal_dashboard runs in the cortex registry, as the owner', async () => {
    const { plugin, cortex } = pluginOver(authorityPrisma({ owner: true }));
    const outcome = await plugin.execute('b1', planStepProposal('storelink.get_portal_dashboard') as never, 'u1');
    expect(outcome).toEqual({ success: true, result: { ran: true }, error: undefined });
    expect(cortex.execute).toHaveBeenCalledTimes(1);
    expect(cortex.execute).toHaveBeenCalledWith(
      'storelink.get_portal_dashboard',
      expect.objectContaining({ businessId: 'b1', userId: 'u1', preApproved: true }),
      { contactId: 'contact_of_another_member' },
    );
  });

  it('CR-W11KOA-1 RED-BEFORE (GA-06, D-119): with flowDispatch (POST actions/.../execute, whose dispatcher runs no dotted tool) a mapped dotted tool is refused to the owner, an ADMIN and a SUPER_ADMIN; without it the owner passes (the KEY cortex surfaces), and a FLOW tool still passes with it', async () => {
    const cases: Array<[ReturnType<typeof authorityPrisma>, { id: string; role?: string }]> = [
      [authorityPrisma({ owner: true }), { id: 'u1' }],
      [authorityPrisma({ role: 'ADMIN', permissionScopes: null }), { id: 'u1' }],
      [authorityPrisma({ userRole: 'SUPER_ADMIN' }), { id: 'u1', role: 'SUPER_ADMIN' }],
    ];
    for (const [prisma, user] of cases) {
      for (const tool of ['key_genome.get_blueprint', 'key_inbox.list_threads', 'cortex.create_task']) {
        await expect(assertMayRunGraphAction(prisma as never, 'b1', user, tool, 'u1', { flowDispatch: true }), tool).rejects.toThrow(
          `Tool "${tool}" is a KEY cortex tool, which this route's dispatcher does not run, so it is not executed from this route`,
        );
      }
    }
    const owner = authorityPrisma({ owner: true });
    await expect(assertMayRunGraphAction(owner as never, 'b1', { id: 'u1' }, 'key_genome.get_blueprint', 'u1')).resolves.toBeUndefined();
    await expect(assertMayRunGraphAction(owner as never, 'b1', { id: 'u1' }, 'inbox_list_threads', 'u1', { flowDispatch: true })).resolves.toBeUndefined();
    // An unmapped dotted tool keeps its own answer (D-119).
    await expect(assertMayRunGraphAction(owner as never, 'b1', { id: 'u1' }, 'cortex.query_database', 'u1', { flowDispatch: true })).rejects.toThrow(
      'Tool "cortex.query_database" is mapped to no module scope, so it is not executed from this route',
    );
  });

  // Review SEC-W11KOAM-2 (pre-existing, outside this packet's write set): KeyCortexActionExecutorPlugin.runAuthority
  // answers refusal null for every dotted tool on a proposal with no stored plan (MANUAL, KEY_CORTEX, ...), so a
  // member who files POST key-autonomy/.../actions/proposals with EXECUTE_TOOL and a dotted toolName (a contact read,
  // or an unmapped owner-only tool such as cortex.query_database) runs it preApproved once approved. Holding that
  // branch to memberToolRunAuthority with no principal (the organ map now judges every dotted name) is a follow-up
  // packet's change to key-cortex-action-executor.plugin.ts.
  it.todo('SEC-W11KOAM-2 (D-119, D-37): an approved proposal with no stored plan runs a dotted tool only if its executing member may run it with no principal (memberToolRunAuthority); follow-up packet, outside the W11-KEY-ORGAN-AUTHORITY-MAP write set');

  // Review CR-W11KOA-1, the other FLOW-dispatch surfaces: the plan queue (QueueService.processPlanStep ->
  // planStepRunRefusal) and the Pro Auto monitor (noMemberToolRefusal) share memberToolRunAuthority with the KEY
  // chat, so telling them apart needs plan-step-authority.ts (outside this write set). A mapped dotted step there
  // now reaches the FLOW dispatcher, which answers 'Unknown tool': the step or monitor action still fails with
  // nothing run (the owner's already did at base), but it fails at dispatch rather than with a refusal.
  it.todo('CR-W11KOA-1 (GA-06, D-119): the plan queue and the Pro Auto monitor refuse a mapped dotted tool before FLOW dispatch (flowDispatch); follow-up packet, outside the W11-KEY-ORGAN-AUTHORITY-MAP write set');
});
