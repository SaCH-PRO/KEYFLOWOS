import type { CanonicalModule } from '../../core/authority/module-vocabulary';

/**
 * W11-KEY-ORGAN-AUTHORITY-MAP (owner rulings D-119, D-131): what a member must hold to have one of the
 * KEY chat's dotted organ or legacy cortex tools run for them.
 *
 * Since SEC-W10CCS-R1 the KEY cortex chat holds each model tool call to memberToolRunAuthority with no
 * principal (key-cortex-query-pipeline.service.ts memberToolCallRefusals), which asks
 * graphActionRequirement (ai/graph-actions.controller.ts). That map covered every FLOW tool and none of the
 * 46 dotted tools the chat also offers, so assertMayRunGraphAction refused all of them to every member but
 * the business owner, ADMINs and SUPER_ADMINs included (D-119: kept until each tool's entry lands). The
 * dotted tools are registered at boot by the organ adapters KeyCortexOrganRegistrarService collects, by
 * KeyCortexSafeDatabaseService's two definitions and by KeyCortexActionsService.registerLegacyTools;
 * key-cortex-organ-tool-authority.spec.ts holds their census to the two tables below, so a new tool is
 * refused to every member until it is classified here.
 *
 * Pure data, with no service import: graph-actions.controller.ts imports it, and reads an entry as
 *   - `{ twin }`: the FLOW tool whose routes govern the same action (V1-31b review CR-3: a tool some route
 *     governs takes that route's module and level); its requirement is taken unchanged;
 *   - `{ scopes }`: the module scopes, as ModuleScopeGuard reads them, the first being the tool's module
 *     and the rest required beside it (as GRAPH_ACTION_EXTRA_SCOPES are). A crm read is a contact read
 *     (graphActionReadsContacts). No dotted handler binds a principal (the KEY cortex registry applies no
 *     visibility clause), so graphActionRequirement makes such a tool, twin or scoped, the OWNER's only on
 *     every surface, a principal-run one included (review SEC-W11KOAM-1 / CR-W11KOA-2, D-37).
 * A name in KEY_ORGAN_TOOLS_UNMAPPED keeps no entry: graphActionRequirement answers null, so only the
 * business owner runs it (D-119), with the reason recorded beside it.
 *
 * Consequences of the existing rule, with no code here: an ADMIN whose explicit scope map sets revenue to
 * none is refused the revenue:read entries (D-114: assertMayRunGraphAction checks an explicit map); no
 * entry writes revenue, so D-46's SUPER_ADMIN refusal never applies to one; the owner (an OWNER membership,
 * D-116/D-125) with no explicit scope map keeps every tool, mapped or not, the connect:read entries included
 * although no role default holds connect (memberToolRunAuthority's owner arm, W11A-SEAM-REPAIR); an explicit
 * map on an OWNER membership binds it on the mapped entries as on any member's (review SEC-W11D116K-1).
 * A stored plan step naming a mapped dotted tool becomes readable to a member holding its scopes
 * (graphPlanReadScope), and its approved proposal runs it in the KEY cortex registry as the plan's member
 * (KeyCortexActionExecutorPlugin). The FLOW dispatcher runs no dotted tool (it answers 'Unknown tool'), so
 * POST actions/.../execute still refuses one before claiming the step (assertMayRunGraphAction's
 * flowDispatch, review CR-W11KOA-1).
 */

/** A module scope a dotted tool needs, as ModuleScopeGuard reads it (the shape of graph-actions' GraphActionScope). */
export interface KeyOrganToolScope {
  module: CanonicalModule;
  minLevel: 'read' | 'write' | 'admin';
}

/** One dotted tool's entry: the FLOW tool it twins, or the module scopes it needs. */
export type KeyOrganToolAuthority = { twin: string } | { scopes: KeyOrganToolScope[] };

const read = (module: CanonicalModule): KeyOrganToolScope => ({ module, minLevel: 'read' });
const write = (module: CanonicalModule): KeyOrganToolScope => ({ module, minLevel: 'write' });

/** The 31 mapped dotted tools (W11-KEY-ORGAN-AUTHORITY-MAP, D-119, D-131), one entry per name at fb00af1c. */
export const KEY_ORGAN_TOOL_AUTHORITY: Readonly<Record<string, KeyOrganToolAuthority>> = {
  // TWIN (V1-31b review CR-3). The key-inbox routes all require operations (key-inbox.controller.ts).
  'key_inbox.list_threads': { twin: 'inbox_list_threads' },
  'key_inbox.get_thread': { twin: 'inbox_read_thread' },
  'key_inbox.send_reply': { twin: 'inbox_reply_thread' },
  'key_inbox.mark_resolved': { twin: 'inbox_mark_resolved' },
  'key_inbox.generate_brief': { twin: 'inbox_brief' },
  // The grant's token is withheld from the answer first (W11-KEY-ORGAN-OUTPUT-REDACT, portalAccessView).
  'storelink.create_portal_access': { twin: 'portal_grant_access' },

  // Timeline: temporal -> ai (KEY_PLAN_MODULE_SCOPES, CORTEX_MODULE_RULES, D-63's KEY rows). A read that
  // derives money signals also needs revenue read (D-131, D-100).
  'temporal_flow.list_events': { scopes: [read('ai'), read('revenue')] },
  'temporal_flow.create_event': { scopes: [write('ai')] },
  'temporal_flow.set_reminder': { scopes: [write('ai')] },
  'temporal_flow.mark_resolved': { scopes: [write('ai')] },
  'temporal_flow.analyze_timeline': { scopes: [read('ai'), read('revenue')] },

  // Business genome: genome -> settings (D-63). W11A-SEAM-REPAIR (D-128, D-100): list_signals and
  // list_recommendations withhold the finance signals and FINANCIAL recommendations from a member without
  // revenue read (KeyGenomeAdapterService, by the projection GET .../key-genome/signals and recommendations
  // apply: genome-finance-scope.ts), so KEY serves a member the rows REST serves them.
  'key_genome.get_blueprint': { scopes: [read('settings')] },
  'key_genome.calculate_integrity': { scopes: [read('settings')] },
  'key_genome.list_signals': { scopes: [read('settings')] },
  'key_genome.list_recommendations': { scopes: [read('settings')] },
  'key_genome.list_facts': { scopes: [read('settings')] },
  'key_genome.get_readiness': { scopes: [read('settings')] },

  // Storefront. get_analytics answers revenue.inPeriod and invoice counts (site.service.ts getAnalytics): D-100.
  'storelink.get_analytics': { scopes: [read('storefront'), read('revenue')] },
  'storelink.get_conversion_funnel': { scopes: [read('storefront')] },
  'storelink.get_product_health': { scopes: [read('storefront')] },
  'storelink.create_promo_code': { scopes: [write('storefront')] },
  // A lead's name, email and phone: a contact read, so only the OWNER runs it (no dotted handler binds a principal).
  'storelink.list_intakes': { scopes: [read('crm')] },
  // One contact's orders, bookings and open invoice total: a contact read, with money (D-100).
  'storelink.get_portal_dashboard': { scopes: [read('crm'), read('revenue')] },

  // KEY connector reads need connect read (D-131); their answers withhold stored credentials first
  // (W11-KEY-ORGAN-OUTPUT-REDACT, connectionView).
  'key_connector.list_providers': { scopes: [read('connect')] },
  'key_connector.list_connections': { scopes: [read('connect')] },
  'key_connector.check_health': { scopes: [read('connect')] },

  // Legacy cortex tools. Task and Reminder are KEY's own stores, with no member route; create_document
  // writes the KEY-internal Document model (the documents_* routes read DocumentInstance).
  'cortex.create_task': { scopes: [write('ai')] },
  'cortex.schedule_reminder': { scopes: [write('ai')] },
  'cortex.create_document': { scopes: [write('ai')] },
  'cortex.search_knowledge': { scopes: [read('ai')] },
  'cortex.create_lead': { scopes: [write('crm')] },
};

/**
 * The 15 dotted tools that stay owner-only under D-119 (graphActionRequirement answers null), each with
 * why no module scope bounds it.
 */
export const KEY_ORGAN_TOOLS_UNMAPPED: Readonly<Record<string, string>> = {
  'key_genome.update_dna_section': 'the business DNA is the business profile, which only the owner edits (D-11)',
  'key_connector.execute_internal':
    "it runs any connector module.action named by argument, which only the direct-command door's cortexCommandRefusal can judge",
  'key_connector.trigger_sync':
    'the connection is chosen by argument and may be Google: D-99 makes Google syncs owner-only, and D-111 needs OWNER or ADMIN otherwise',
  'cortex.query_business_data':
    'it reads across modules a model chosen by argument (Contact, Invoice, Expense, StaffMember, CortexSession, KeyCommand among them)',
  'cortex.query_database':
    'it reads across modules a model chosen by argument (Contact, Invoice, Expense, StaffMember, CortexSession, KeyCommand among them)',
  'cortex.update_record':
    "it updates a model chosen by argument (the executor's BLOCKED_ACTIONS UPDATE_RECORD precedent), and two registrations share the name",
  'cortex.update_crm':
    'it mass-assigns caller fields onto a contact, deal or lead with no actor or visibility clause (the CRM_ROW_VISIBILITY_TOOLS precedent)',
  'cortex.analyze_data': 'its data source is chosen by argument, and it reads contact rows with no visibility clause',
  'cortex.execute_tool':
    'it re-enters the registry for any tool, which the per-call rule never sees (the execute_custom_logic precedent)',
  'cortex.create_event':
    'broken: it writes startTime, endTime and attendees, but CalendarEvent has startAt and endAt and no attendees (the twin calendar_create_event exists)',
  'cortex.execute_flow': 'broken: FlowExecution has no inputs column, and KeyCommandService.enqueue is a no-op stub',
  'cortex.create_invoice':
    'broken: Invoice has no customerId, items or totalAmount; it would also bypass CommerceService, D-64, D-98 and the ledger door',
  'cortex.send_email': 'stub: enqueue is a no-op, so it claims a send that never happens (D-82: fail visibly)',
  'cortex.send_message': "it writes a Message row with status 'sent' that was never delivered",
  'cortex.generate_report':
    "stub: its Report row stays 'generating' forever; a money report type would need revenue:read (D-57)",
};

/** The map entry for `toolName`, or null for an unmapped or unknown name (W11-KEY-ORGAN-AUTHORITY-MAP, D-119). */
export function keyOrganToolAuthority(toolName: string): KeyOrganToolAuthority | null {
  return Object.prototype.hasOwnProperty.call(KEY_ORGAN_TOOL_AUTHORITY, toolName) ? KEY_ORGAN_TOOL_AUTHORITY[toolName] : null;
}
