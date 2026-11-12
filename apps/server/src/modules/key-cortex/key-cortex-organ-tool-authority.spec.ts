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
import { FLOW_TOOLS } from '../ai/flow-tool-registry';
import { graphActionReadsContacts, graphActionRequirement } from '../ai/graph-actions.controller';
import { noMemberToolRefusal } from '../ai/plan-step-authority';

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

  it('W11-KEY-ORGAN-AUTHORITY-MAP scoped entries (D-131, D-100, D-63): graphActionRequirement(dotted).scopes equals the entry; storelink.list_intakes and storelink.get_portal_dashboard read contacts, so they are the OWNER\'s only with no principal and refused with no member; none writes revenue (D-46)', async () => {
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
      expect(requirement.ownerOnly, dotted).toBeUndefined();
      if (CONTACT_READS.includes(dotted)) {
        expect(requirement.ownerOnlyWithoutPrincipal, dotted).toEqual(expect.any(String));
        expect(graphActionReadsContacts(dotted), dotted).toBe(true);
        expect(noMemberToolRefusal(dotted), dotted).toMatch(/reads the business's contacts/);
      } else {
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
