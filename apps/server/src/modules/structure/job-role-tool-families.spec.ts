/**
 * Which KEY tool families each canonical module governs — derived from the HTTP route
 * decorators, not chosen (V1-21b-JOBROLE-TOOL-FAMILIES, V1-21 review CR-V21-01).
 *
 * WHY
 *
 * JobRole.permissions is held to the canonical module vocabulary on write (V1-21), and the
 * same map is copied onto the holder's Membership, where ModuleScopeGuard enforces it on
 * the HTTP routes. JobRolePolicyService reads the same column to decide which KEY tools a
 * position may use. The honest translation of "this position holds module M" into KEY tools
 * is therefore: the tools whose work, done by hand, sits behind routes that require M.
 *
 * THE RULE (implemented by derive() below and asserted against
 * CANONICAL_MODULE_TOOL_FAMILIES, so the mapping cannot drift from the decorators)
 *
 *  1. A tool's calls are the `Service.method(` calls in its case of
 *     FlowOrchestratorService.executeToolAction (lazy `this.getX()` getters and injected
 *     fields). Direct Prisma reads are not service calls and carry no evidence.
 *  2. A service method is governed by module M when every controller handler that calls
 *     it carries a RequireModuleScope decorator naming M AND runs ModuleScopeGuard (method- or
 *     class-level @UseGuards). One handler that calls it without an enforced scope means
 *     a member reaches it holding no module at all, so it is governed by nothing.
 *  3. A tool is governed by the union of its calls' modules.
 *  4. A family is the tool-name prefix before the first `_`. Family F maps to M as
 *     `F_*` when M is the only module governing any tool in F and M governs most of F's
 *     service-calling tools. When M governs only a minority of F, M grants just those
 *     tools, by exact name. A tool governed by two modules is granted by neither.
 *  5. Everything else stays unmapped (UNMAPPED below, with the reason).
 *
 * EVIDENCE TABLE (one representative route per mapped family; asserted in source below)
 *
 *  family / tools        service                      HTTP route                                              module scope
 *  --------------------  ---------------------------  ------------------------------------------------------  ---------------
 *  crm_*                 CrmService                   POST /crm/businesses/:businessId/contacts               crm:write
 *  deals_*               CrmDealsService              POST /crm/businesses/:businessId/deals                  crm:write
 *  call_*                CallLogService               POST /businesses/:businessId/calls/:callId/complete     crm:write
 *  tag_* (tag_contact)   CrmService                   PATCH /crm/businesses/:businessId/contacts/:contactId   crm:write
 *  commerce_*            CommerceService              POST /commerce/businesses/:businessId/quotes            revenue:write
 *  payments_*            PaymentsOpsService           POST /payments/businesses/:businessId/links             revenue:write
 *  calendar_*            CalendarQueryService         POST /calendar/businesses/:businessId/events            bookings:write
 *  assets_*              AssetService                 POST /businesses/:businessId/assets/:assetId/tag        content:write
 *  expenses_*            ExpensesService              POST /expenses/businesses/:businessId/expenses          expenses:write
 *  finance_create_bill   ExpensesService              POST /finance/businesses/:businessId/bills              expenses:write
 *  finance_list_bills    ExpensesService              GET /finance/businesses/:businessId/bills               expenses:read
 *  finance_pay_bill      ExpensesService              POST /finance/businesses/:businessId/bills/:billId/pay  expenses:write
 *  finance_view_payables ExpensesService              GET /finance/businesses/:businessId/payables/aging      expenses:read
 *  structure_*           StructureService             POST /structure/businesses/:businessId/delegation-rules team:write
 *  contracts_*           ContractsService             POST /contracts/businesses/:businessId                  operations:write
 *  contract_*            ContractsService             POST /contracts/businesses/:businessId/tags             operations:write
 *  inbox_*               KeyInboxService              POST /key-inbox/businesses/:businessId/threads/:threadId/reply  operations:write
 *  payroll_*             PayrollService               POST /payroll/businesses/:businessId/runs/:runId/approve operations:write
 *  performance_*         StaffPerformanceService      POST /staff-performance/businesses/:businessId/snapshot operations:write
 *
 *  inbox_list_threads / inbox_read_thread / inbox_brief / inbox_mark_resolved are bridged
 *  to the key_inbox organ (CORTEX_TOOL_BRIDGE), whose handlers call the same
 *  KeyInboxService behind key-inbox.controller (operations); they ride with inbox_*.
 *
 * CANONICAL MODULES THAT GOVERN NO KEY TOOL FAMILY
 *
 *  projects, storefront, ai — no route in the app declares these scopes.
 *  connect      — integration-hub.controller only; no KEY tool calls IntegrationHubService.
 *  analytics    — analytics.controller only, and it does not run ModuleScopeGuard; no KEY
 *                 tool calls its service.
 *  settings     — intelligence / push-notification / product-analytics / trash; no KEY
 *                 tool family is governed by them (trash's restore reuses
 *                 CatalogService.updateProduct, which catalog.controller exposes unscoped).
 *  automations  — flow.controller (/api/flows); automations_* calls FlowService
 *                 createAutomation/updateAutomation, which no route calls, and the
 *                 playbook routes (automation.controller) are unscoped.
 *
 *  The legacy keys `crm`, `bookings`, `projects`, `content` are also canonical; their
 *  pre-V1-21 families (crm_*; bookings_*, calendar_*; projects_*, time_*; content_*) are
 *  kept alongside the evidence above so existing rows keep their envelope.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { FLOW_TOOLS, CORTEX_TOOL_BRIDGE } from '../ai/flow-tool-registry';
import { CANONICAL_MODULES, type CanonicalModule } from '../../core/authority/module-vocabulary';
import * as policyModule from './job-role-policy.service';

const SRC = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// Source evidence
// ─────────────────────────────────────────────────────────────────────────────

/** tool name -> `Service.method` calls in its dispatcher case. */
function dispatcherCalls(): Map<string, string[]> {
  const src = read('modules/ai/flow-orchestrator.service.ts');
  const getters = new Map<string, string>();
  for (const m of src.matchAll(/private (get[A-Za-z0-9]+)\(\)[^{]*\{\s*(?:try\s*\{\s*)?return this\.moduleRef\.get\(([A-Za-z0-9]+)/g)) {
    getters.set(m[1], m[2]);
  }
  const fields = new Map<string, string>();
  for (const m of src.matchAll(/private readonly ([a-zA-Z0-9]+): ([A-Z][A-Za-z0-9]+)/g)) fields.set(m[1], m[2]);

  const start = src.indexOf('private async executeToolAction(');
  const end = src.indexOf('\n  private ', start + 1);
  if (start < 0 || end < 0) throw new Error('executeToolAction dispatcher not found');
  const lines = src.slice(start, end).split('\n');

  const bodies = new Map<string, string>();
  let labels: string[] = [];
  let body: string[] = [];
  const flush = () => {
    for (const l of labels) bodies.set(l, (bodies.get(l) ?? '') + body.join('\n'));
    labels = [];
    body = [];
  };
  for (const line of lines) {
    const c = line.match(/^ {6}case '([a-z0-9_]+)':/);
    if (c) {
      // consecutive labels (fall-through) share one body
      if (body.length && !/^ {6}case '/.test(body[body.length - 1])) flush();
      labels.push(c[1]);
      body.push(line);
      continue;
    }
    if (/^ {6}default:/.test(line) || /^ {4}\}/.test(line)) {
      if (labels.length) flush();
      continue;
    }
    if (labels.length) body.push(line);
  }

  const out = new Map<string, string[]>();
  for (const [tool, b] of bodies) {
    const calls = new Set<string>();
    for (const m of b.matchAll(/this\.(get[A-Za-z0-9]+)\(\)\s*\.\s*([a-zA-Z0-9]+)\(/g)) {
      const svc = getters.get(m[1]);
      if (svc) calls.add(`${svc}.${m[2]}`);
    }
    for (const m of b.matchAll(/this\.([a-zA-Z0-9]+)\s*\.\s*([a-zA-Z0-9]+)\(/g)) {
      const svc = fields.get(m[1]);
      if (svc && svc !== 'PrismaService') calls.add(`${svc}.${m[2]}`);
    }
    out.set(tool, [...calls]);
  }
  return out;
}

interface Route {
  file: string;
  verb: string;
  path: string;
  /** `module:level` when the handler declares a scope AND runs ModuleScopeGuard. */
  scope: string | null;
  calls: Set<string>;
}

function controllerFiles(dir: string): string[] {
  let out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out = out.concat(controllerFiles(p));
    else if (e.name.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

function controllerRoutes(): Route[] {
  const routes: Route[] = [];
  for (const file of controllerFiles(join(SRC, 'modules'))) {
    const src = readFileSync(file, 'utf8');
    const classAt = src.search(/^export class /m);
    if (classAt < 0) continue;
    const head = src.slice(0, classAt);
    const prefix = (head.match(/@Controller\(\s*'([^']*)'/) ?? [])[1] ?? '';
    const classGuard = /@UseGuards\([^)]*\bModuleScopeGuard\b/.test(head);
    const fields = new Map<string, string>();
    for (const m of src.matchAll(/(?:private|public|protected)\s+(?:readonly\s+)?([a-zA-Z0-9_$]+)\s*:\s*([A-Z][A-Za-z0-9_]*)/g)) {
      fields.set(m[1], m[2]);
    }

    // Members of the class: a signature at two-space indent. Decorators of a member are
    // the lines between the previous member's closing `  }` and its signature.
    const lines = src.slice(classAt).split('\n');
    const sigs: number[] = [];
    lines.forEach((l, i) => {
      if (/^ {2}(?:public |private |protected )?(?:async )?[A-Za-z_$][\w$]*\s*\(/.test(l)) sigs.push(i);
    });
    for (let k = 0; k < sigs.length; k++) {
      const s = sigs[k];
      let decoStart = k === 0 ? 1 : sigs[k - 1] + 1;
      for (let j = s - 1; j >= decoStart; j--) {
        if (/^ {2}\}/.test(lines[j])) {
          decoStart = j + 1;
          break;
        }
      }
      const deco = lines.slice(decoStart, s).join('\n');
      const verb = deco.match(/@(Get|Post|Put|Patch|Delete|All)\(\s*(?:'([^']*)')?/);
      if (!verb) continue;
      let bodyEnd = k + 1 < sigs.length ? sigs[k + 1] : lines.length;
      for (let j = bodyEnd - 1; j > s; j--) {
        if (/^ {2}\}/.test(lines[j])) {
          bodyEnd = j + 1;
          break;
        }
      }
      const body = lines.slice(s, bodyEnd).join('\n');
      const scopeM = deco.match(/@RequireModuleScope\(\s*'([a-z]+)'(?:\s*,\s*'([a-z]+)')?\s*\)/);
      const enforced = classGuard || /@UseGuards\([^)]*\bModuleScopeGuard\b/.test(deco);
      const calls = new Set<string>();
      for (const m of body.matchAll(/this\.([a-zA-Z0-9_$]+)\s*\.\s*([a-zA-Z0-9_$]+)\s*\(/g)) {
        const svc = fields.get(m[1]);
        if (svc && svc !== 'PrismaService') calls.add(`${svc}.${m[2]}`);
      }
      routes.push({
        file: relative(SRC, file),
        verb: verb[1].toUpperCase(),
        path: ('/' + [prefix, verb[2] ?? ''].filter(Boolean).join('/')).replace(/\/+/g, '/'),
        scope: scopeM && enforced ? `${scopeM[1]}:${scopeM[2] ?? 'read'}` : null,
        calls,
      });
    }
  }
  return routes;
}

const family = (tool: string) => tool.split('_')[0];

interface Derivation {
  mapping: Record<string, string[]>;
  /** family -> governing modules (empty = governed by none) */
  familyModules: Map<string, Set<string>>;
  toolModules: Map<string, Set<string>>;
}

function derive(calls: Map<string, string[]>, routes: Route[]): Derivation {
  const byMethod = new Map<string, Route[]>();
  for (const r of routes) for (const c of r.calls) byMethod.set(c, [...(byMethod.get(c) ?? []), r]);

  const methodModules = (call: string): Set<string> => {
    const rs = byMethod.get(call) ?? [];
    if (!rs.length || rs.some((r) => r.scope === null)) return new Set();
    return new Set(rs.map((r) => r.scope!.split(':')[0]));
  };

  const toolModules = new Map<string, Set<string>>();
  for (const [tool, cs] of calls) {
    const mods = new Set<string>();
    for (const c of cs) for (const m of methodModules(c)) mods.add(m);
    toolModules.set(tool, mods);
  }

  const families = new Map<string, string[]>();
  for (const tool of calls.keys()) families.set(family(tool), [...(families.get(family(tool)) ?? []), tool]);

  const mapping: Record<string, string[]> = Object.fromEntries(CANONICAL_MODULES.map((m) => [m, [] as string[]]));
  const familyModules = new Map<string, Set<string>>();
  for (const [f, tools] of [...families].sort(([a], [b]) => a.localeCompare(b))) {
    const mods = new Set<string>();
    for (const t of tools) for (const m of toolModules.get(t)!) mods.add(m);
    familyModules.set(f, mods);
    const serviceCalling = tools.filter((t) => (calls.get(t) ?? []).length > 0);
    const governedBy = (m: string) => tools.filter((t) => {
      const tm = toolModules.get(t)!;
      return tm.size === 1 && tm.has(m);
    });
    if (mods.size === 1) {
      const [m] = [...mods];
      const governed = governedBy(m);
      if (governed.length * 2 > serviceCalling.length) {
        mapping[m].push(`${f}_*`);
        continue;
      }
    }
    for (const m of mods) mapping[m].push(...governedBy(m).sort());
  }
  for (const m of Object.keys(mapping)) mapping[m].sort();
  return { mapping, familyModules, toolModules };
}

// ─────────────────────────────────────────────────────────────────────────────
// Assertions
// ─────────────────────────────────────────────────────────────────────────────

/** The table in the header, row by row. */
const EVIDENCE: Array<{ tool: string; service: string; route: string; scope: string; file: string }> = [
  { tool: 'crm_create_contact', service: 'CrmService', route: 'POST /crm/businesses/:businessId/contacts', scope: 'crm:write', file: 'modules/crm/crm.controller.ts' },
  { tool: 'deals_create', service: 'CrmDealsService', route: 'POST /crm/businesses/:businessId/deals', scope: 'crm:write', file: 'modules/crm/crm-deals.controller.ts' },
  { tool: 'call_log_outcome', service: 'CallLogService', route: 'POST /businesses/:businessId/calls/:callId/complete', scope: 'crm:write', file: 'modules/call-tasks/call-task.controller.ts' },
  { tool: 'tag_contact', service: 'CrmService', route: 'PATCH /crm/businesses/:businessId/contacts/:contactId', scope: 'crm:write', file: 'modules/crm/crm.controller.ts' },
  { tool: 'commerce_create_quote', service: 'CommerceService', route: 'POST /commerce/businesses/:businessId/quotes', scope: 'revenue:write', file: 'modules/commerce/commerce.controller.ts' },
  { tool: 'payments_create_link', service: 'PaymentsOpsService', route: 'POST /payments/businesses/:businessId/links', scope: 'revenue:write', file: 'modules/payments/payments-ops.controller.ts' },
  { tool: 'calendar_create_event', service: 'CalendarQueryService', route: 'POST /calendar/businesses/:businessId/events', scope: 'bookings:write', file: 'modules/calendar/calendar.controller.ts' },
  { tool: 'assets_tag', service: 'AssetService', route: 'POST /businesses/:businessId/assets/:assetId/tag', scope: 'content:write', file: 'modules/assets/asset.controller.ts' },
  { tool: 'expenses_create', service: 'ExpensesService', route: 'POST /expenses/businesses/:businessId/expenses', scope: 'expenses:write', file: 'modules/expenses/expenses.controller.ts' },
  { tool: 'finance_create_bill', service: 'ExpensesService', route: 'POST /finance/businesses/:businessId/bills', scope: 'expenses:write', file: 'modules/expenses/bills.controller.ts' },
  { tool: 'finance_list_bills', service: 'ExpensesService', route: 'GET /finance/businesses/:businessId/bills', scope: 'expenses:read', file: 'modules/expenses/bills.controller.ts' },
  { tool: 'finance_pay_bill', service: 'ExpensesService', route: 'POST /finance/businesses/:businessId/bills/:billId/pay', scope: 'expenses:write', file: 'modules/expenses/bills.controller.ts' },
  { tool: 'finance_view_payables', service: 'ExpensesService', route: 'GET /finance/businesses/:businessId/payables/aging', scope: 'expenses:read', file: 'modules/expenses/bills.controller.ts' },
  { tool: 'structure_create_delegation_rule', service: 'StructureService', route: 'POST /structure/businesses/:businessId/delegation-rules', scope: 'team:write', file: 'modules/structure/structure.controller.ts' },
  { tool: 'contracts_create', service: 'ContractsService', route: 'POST /contracts/businesses/:businessId', scope: 'operations:write', file: 'modules/contracts/contracts.controller.ts' },
  { tool: 'contract_create_tag', service: 'ContractsService', route: 'POST /contracts/businesses/:businessId/tags', scope: 'operations:write', file: 'modules/contracts/contracts.controller.ts' },
  { tool: 'inbox_reply_thread', service: 'KeyInboxService', route: 'POST /key-inbox/businesses/:businessId/threads/:threadId/reply', scope: 'operations:write', file: 'modules/key-inbox/key-inbox.controller.ts' },
  { tool: 'payroll_approve_run', service: 'PayrollService', route: 'POST /payroll/businesses/:businessId/runs/:runId/approve', scope: 'operations:write', file: 'modules/payroll/payroll.controller.ts' },
  { tool: 'performance_take_snapshot', service: 'StaffPerformanceService', route: 'POST /staff-performance/businesses/:businessId/snapshot', scope: 'operations:write', file: 'modules/staff-performance/staff-performance.controller.ts' },
];

/**
 * Registry families no canonical module governs, and why. Every registry family is either
 * mapped by the derivation or listed here, so a new family has to be placed on purpose.
 */
const UNMAPPED: Record<string, string> = {
  apply: 'CatalogService.updateProduct is also exposed unscoped by catalog.controller',
  approval: 'approval.controller declares no module scope',
  automations: 'FlowService.createAutomation/updateAutomation back no route; playbook routes (automation.controller) are unscoped',
  bookings: 'bookings.controller declares no module scope (the legacy `bookings` key still grants bookings_*)',
  command: 'command.controller declares no module scope',
  comms: 'CommunicationsService.sendBroadcast backs no route',
  community: 'reads Prisma directly; no service call',
  content: 'content-ops.controller declares no module scope (the legacy `content` key still grants content_*)',
  create: 'CrmService.addTask backs no route; TaskAssignmentService routes are unscoped',
  delegation: 'DelegationLoopService is reached only through autopilot.controller, which declares no module scope',
  documents: 'reads Prisma directly; no service call',
  draft: 'AiUsageService.callAi is reached by unscoped AI routes',
  drive: 'google-drive.controller declares no module scope',
  enable: 'FlowService.updateAutomation backs no route',
  evidence: 'evidence.controller declares no module scope',
  execute: 'CodeExecutorService.execute backs no scoped route',
  fetch: 'cross-module reads; already baseline (fetch_*) for every position',
  generate: 'seo.controller declares no module scope',
  goals: 'key-cortex-goals.controller declares no module scope',
  governance: 'governance.controller declares no module scope',
  helpdesk: 'helpdesk.controller declares no module scope',
  inventory: 'marketplace.controller declares no module scope',
  keyflow: 'keyflow-command.controller declares no module scope',
  marketing: 'email-marketing.controller declares no module scope',
  marketplace: 'reads Prisma directly; no service call',
  people: 'StructureService.listPeople backs no route; TaskAssignmentService routes are unscoped',
  portal: 'portal.controller declares no module scope',
  present: 'renders an onboarding card; no service call',
  procurement: 'procurement.controller declares no module scope',
  projects: 'projects.controller declares no module scope (the legacy `projects` key still grants projects_*, time_*)',
  queue: 'EmailMarketingService.queueCampaign backs no route',
  reconcile: 'finance.controller declares no module scope',
  reports: 'reports.controller declares no module scope',
  retainers: 'retainer.controller declares no module scope',
  save: 'onboarding-concierge.controller declares no module scope',
  segment: 'reads Prisma directly; no service call',
  send: 'CrmService.addNote / AiMessageSenderService.sendMessage back no route',
  seo: 'reads Prisma and AiUsageService.callAi (unscoped AI routes)',
  sequence: 'crm-sequence.controller declares no module scope',
  social: 'social.controller declares no module scope',
  store: 'reads Prisma directly; no service call',
  suppliers: 'supplier.controller declares no module scope',
  sync: 'seo.controller declares no module scope',
  time: 'time-entry.controller declares no module scope (the legacy `projects`/`time` keys still grant time_*)',
  update: 'update_status_with_confirmation needs crm AND revenue, so neither alone grants it; update_business_blueprint is unscoped',
  // finance_*: only the four ExpensesService tools are governed (by expenses, by exact name);
  // the ledger, receivables, bank, chart-of-accounts and posting tools are behind
  // finance.controller and reports.controller, which declare no module scope.
  finance: 'finance.controller and reports.controller declare no module scope; expenses grants the four bill tools by name',
};

describe('job role tool families — derived from the route decorators (V1-21b)', () => {
  const calls = dispatcherCalls();
  const routes = controllerRoutes();
  const derived = derive(calls, routes);
  const CANONICAL_MODULE_TOOL_FAMILIES = (policyModule as Record<string, unknown>).CANONICAL_MODULE_TOOL_FAMILIES as
    | Record<CanonicalModule, readonly string[]>
    | undefined;

  it('the parser sees the dispatcher and the scoped controllers (guards the guard)', () => {
    expect(calls.size).toBeGreaterThan(250);
    expect(routes.filter((r) => r.scope).length).toBeGreaterThan(300);
    // every registry tool except the cortex-bridged ones has a dispatcher case
    const missing = FLOW_TOOLS.map((t) => t.name).filter((n) => !calls.has(n) && !(n in CORTEX_TOOL_BRIDGE));
    expect(missing).toEqual([]);
  });

  it.each(EVIDENCE)('$tool -> $service -> $route [$scope]', ({ tool, service, route, scope, file }) => {
    expect(calls.get(tool) ?? [], `${tool} calls ${service}`).toEqual(expect.arrayContaining([expect.stringMatching(new RegExp(`^${service}\\.`))]));
    const [verb, path] = route.split(' ');
    const hit = routes.find((r) => r.file === file && r.verb === verb && r.path === path);
    expect(hit, `${route} in ${file}`).toBeDefined();
    expect(hit!.scope).toBe(scope);
    expect([...hit!.calls].some((c) => c.startsWith(`${service}.`)), `${route} calls ${service}`).toBe(true);
    // the tool's own call reaches this module and no other
    expect([...(derived.toolModules.get(tool) ?? [])]).toEqual([scope.split(':')[0]]);
  });

  it('the bridged inbox tools reach KeyInboxService through the key_inbox organ', () => {
    expect(Object.keys(CORTEX_TOOL_BRIDGE).every((t) => t.startsWith('inbox_'))).toBe(true);
    const organ = read('modules/key-cortex/organs/key-inbox-adapter.service.ts');
    expect(organ).toMatch(/private readonly inbox: KeyInboxService/);
    for (const target of Object.values(CORTEX_TOOL_BRIDGE)) expect(organ).toContain(`'${target}'`);
  });

  it('JobRolePolicyService exports the canonical mapping, one entry per canonical module', () => {
    expect(CANONICAL_MODULE_TOOL_FAMILIES).toBeDefined();
    expect(Object.keys(CANONICAL_MODULE_TOOL_FAMILIES ?? {}).sort()).toEqual([...CANONICAL_MODULES].sort());
  });

  it('CANONICAL_MODULE_TOOL_FAMILIES is exactly what the decorators derive', () => {
    const actual = Object.fromEntries(
      CANONICAL_MODULES.map((m) => [m, [...(CANONICAL_MODULE_TOOL_FAMILIES?.[m] ?? [])].sort()]),
    );
    expect(actual).toEqual(derived.mapping);
  });

  it('the derivation yields the reviewed table (a change here is a reviewed change)', () => {
    expect(derived.mapping).toEqual({
      crm: ['call_*', 'crm_*', 'deals_*', 'tag_*'],
      revenue: ['commerce_*', 'payments_*'],
      bookings: ['calendar_*'],
      projects: [],
      content: ['assets_*'],
      expenses: ['expenses_*', 'finance_create_bill', 'finance_list_bills', 'finance_pay_bill', 'finance_view_payables'],
      automations: [],
      storefront: [],
      settings: [],
      ai: [],
      team: ['structure_*'],
      analytics: [],
      operations: ['contract_*', 'contracts_*', 'inbox_*', 'payroll_*', 'performance_*'],
      connect: [],
    });
  });

  it('every registry family is either mapped or listed as unmapped with a reason', () => {
    const mappedFamilies = new Set(
      Object.values(derived.mapping)
        .flat()
        .filter((p) => p.endsWith('_*'))
        .map((p) => p.slice(0, -2)),
    );
    const registryFamilies = [...new Set(FLOW_TOOLS.map((t) => family(t.name)))].sort();
    for (const f of registryFamilies) {
      expect(mappedFamilies.has(f) || f in UNMAPPED, `family ${f} is neither mapped nor listed`).toBe(true);
      expect(mappedFamilies.has(f) && f in UNMAPPED, `family ${f} is both mapped and listed`).toBe(false);
    }
    for (const f of Object.keys(UNMAPPED)) expect(registryFamilies, `UNMAPPED lists ${f}`).toContain(f);
  });

  it('the unmapped families really are ungoverned or split', () => {
    for (const f of Object.keys(UNMAPPED)) {
      const mods = derived.familyModules.get(f) ?? new Set<string>();
      if (f === 'finance') expect([...mods]).toEqual(['expenses']);
      else if (f === 'update') expect([...mods].sort()).toEqual(['crm', 'revenue']);
      else expect([...mods], `family ${f} is governed by ${[...mods].join(',')}`).toEqual([]);
    }
  });

  it('every pattern the mapping grants matches at least one registry tool', () => {
    const names = FLOW_TOOLS.map((t) => t.name);
    for (const [m, patterns] of Object.entries(CANONICAL_MODULE_TOOL_FAMILIES ?? {})) {
      for (const p of patterns) {
        const hit = p.endsWith('*') ? names.some((n) => n.startsWith(p.slice(0, -1))) : names.includes(p);
        expect(hit, `${m}: ${p}`).toBe(true);
      }
    }
  });
});
