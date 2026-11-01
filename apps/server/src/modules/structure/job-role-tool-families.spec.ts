/**
 * Which KEY tools each canonical module grants, and at which level — derived from the HTTP
 * route decorators, not chosen (V1-21b-JOBROLE-TOOL-FAMILIES, V1-21 review CR-V21-01, the
 * V1-21b review repairs SEC-V21b-01..04 / CR-1, and the second review's ESC-1 / C1 / C2).
 *
 * WHY
 *
 * JobRole.permissions is held to the canonical module vocabulary on write (V1-21), and the
 * same map is copied onto the holder's Membership, where ModuleScopeGuard enforces it on
 * the HTTP routes. JobRolePolicyService reads the same column to decide which KEY tools a
 * position may use. The honest translation of "this position holds module M at level L"
 * into KEY tools is therefore: the tools whose work, done by hand, sits behind routes that
 * require M at a level L reaches — and nothing else.
 *
 * THE RULE (implemented by derive() below and asserted against CANONICAL_MODULE_TOOLS, so
 * the mapping cannot drift from the decorators)
 *
 *  1. A tool's calls are the `Service.method(` calls in its case of
 *     FlowOrchestratorService.executeToolAction (lazy `this.getX()` getters and injected
 *     fields), and those of the orchestrator's own private helpers the case calls
 *     (assets_get -> assetWithinBusiness -> AssetService.getAsset; review 2 C2); a tool
 *     bridged to a cortex organ (CORTEX_TOOL_BRIDGE) calls what the organ's handler calls.
 *     Direct Prisma reads are not service calls and carry no evidence, except a reviewed
 *     READ_EQUIVALENT: a case that only reads the model a scoped list route's method lists
 *     stands in for that method (commerce_list_invoices, expenses_list; review 2 C2; and
 *     crm_list_contacts / crm_search_contacts / crm_list_deals / calendar_list_events,
 *     which as ungoverned reads every legacy alias of crm_* / calendar_* reached: ESC-5).
 *     The equivalence is of module scope only: those KEY reads apply no CRM visibility
 *     clause (an owner decision recorded in the policy spec). A helper that re-enters the
 *     dispatcher (execute_custom_logic -> executeToolByName) carries every tool's calls.
 *  2. Only routes a member can call count. A provider webhook that runs no AuthGuard and
 *     verifies the provider's signature before acting (SIGNED_PROVIDER_ROUTES) is not one
 *     (POST /webhooks/stripe; review 2 C1). A service method is governed by module M at
 *     level L when every member route that calls it carries a RequireModuleScope decorator
 *     AND runs ModuleScopeGuard (method- or class-level @UseGuards); L is the lowest level
 *     among M's handlers (the least a member needs to do it by hand). One member route that
 *     calls it without an enforced scope means a member reaches it holding no module at all:
 *     it is FREE. A method no member route calls is UNKNOWN, unless it is a reviewed
 *     WRAPPER (it only forwards to a method a route calls, which then decides; CrmService
 *     .addNote / addTask -> CrmTimelineService, review 2 ESC-1) or a reviewed INCIDENTAL
 *     side effect (an activity-feed row), which is FREE.
 *  3. A tool is governed by the union of its calls' modules, at the highest level any of its
 *     governed calls needs. A tool governed by nothing is UNGOVERNED.
 *  4. Module M grants tool T, BY EXACT NAME, at level L exactly when M is the only module
 *     governing T and none of T's calls is UNKNOWN (an unknown call has no by-hand level, so
 *     the governed ones are only a floor). A governed tool no module grants (two modules, or
 *     an unknown call beside a governed one) is GOVERNED_UNGRANTED: no key reaches it. There
 *     are no wildcards: a tool added to a family later is granted only once this table, and
 *     so this spec, says so.
 *  5. Everything else stays ungranted (UNMAPPED families and UNGRANTED tools below, with the
 *     reason).
 *
 * The envelope (JobRolePolicyService) then grants a tool only through a key whose level
 * reaches the tool's route level AND whose tier (read 1, write 2, admin 3) covers the
 * tool's risk tier: a role's level on one module never unlocks another module's tools. The
 * legacy tool-family keys and the baseline reach only UNGOVERNED tools, so this
 * classification is also what keeps them off governed work (review 2 ESC-3); the drift
 * guard below fails if a tool they reach hides governed work one call deeper (ESC-1).
 *
 * EVIDENCE TABLE (one representative route per granting family; asserted in source below)
 *
 *  tool                         service                  HTTP route                                                   scope
 *  ---------------------------  -----------------------  -----------------------------------------------------------  ----------------
 *  crm_create_contact           CrmService               POST /crm/businesses/:businessId/contacts                    crm:write
 *  deals_create                 CrmDealsService          POST /crm/businesses/:businessId/deals                       crm:write
 *  deals_list                   CrmDealsService          GET /crm/businesses/:businessId/deals                        crm:read
 *  call_log_outcome             CallLogService           POST /businesses/:businessId/calls/:callId/complete          crm:write
 *  tag_contact                  CrmService               PATCH /crm/businesses/:businessId/contacts/:contactId        crm:write
 *  crm_add_note (wrapper)       CrmTimelineService       POST /crm/businesses/:businessId/contacts/:contactId/notes   crm:write
 *  crm_add_task (wrapper)       CrmTimelineService       POST /crm/businesses/:businessId/contacts/:contactId/tasks   crm:write
 *  commerce_create_quote        CommerceService          POST /commerce/businesses/:businessId/quotes                 revenue:write
 *  commerce_mark_invoice_paid   CommerceService          PATCH /commerce/invoices/:invoiceId/paid                     revenue:write
 *  commerce_list_invoices (eq.) CommerceService          GET /commerce/businesses/:businessId/invoices                revenue:read
 *  crm_list_contacts (eq.)      CrmService               GET /crm/businesses/:businessId/contacts                     crm:read
 *  calendar_list_events (eq.)   CalendarQueryService     GET /calendar/businesses/:businessId/events                  bookings:read
 *  payments_create_link         PaymentsOpsService       POST /payments/businesses/:businessId/links                  revenue:write
 *  calendar_create_event        CalendarQueryService     POST /calendar/businesses/:businessId/events                 bookings:write
 *  assets_get (helper)          AssetService             GET /businesses/:businessId/assets/:assetId                  content:read
 *  assets_tag                   AssetService             POST /businesses/:businessId/assets/:assetId/tag             content:write
 *  assets_untag                 AssetService             POST /businesses/:businessId/assets/:assetId/untag           content:write
 *  expenses_create              ExpensesService          POST /expenses/businesses/:businessId/expenses               expenses:write
 *  expenses_list (eq.)          ExpensesService          GET /expenses/businesses/:businessId/expenses                expenses:read
 *  finance_create_bill          ExpensesService          POST /finance/businesses/:businessId/bills                   expenses:write
 *  finance_list_bills           ExpensesService          GET /finance/businesses/:businessId/bills                    expenses:read
 *  finance_pay_bill             ExpensesService          POST /finance/businesses/:businessId/bills/:billId/pay       expenses:write
 *  finance_view_payables        ExpensesService          GET /finance/businesses/:businessId/payables/aging           expenses:read
 *  structure_create_delegation_rule StructureService     POST /structure/businesses/:businessId/delegation-rules      team:write
 *  contracts_create             ContractsService         POST /contracts/businesses/:businessId                       operations:write
 *  contracts_acknowledge_alert  ContractsService         POST /contracts/businesses/:businessId/:contractId/acknowledge-alert/:alertId  operations:write
 *  contract_create_tag          ContractsService         POST /contracts/businesses/:businessId/tags                  operations:write
 *  inbox_reply_thread           KeyInboxService          POST /key-inbox/businesses/:businessId/threads/:threadId/reply  operations:write
 *  inbox_mark_resolved (bridge) KeyInboxService          PATCH /key-inbox/businesses/:businessId/threads/:threadId    operations:write
 *  payroll_approve_run          PayrollService           POST /payroll/businesses/:businessId/runs/:runId/approve     operations:write
 *  payroll_list_rates           PayrollService           GET /payroll/businesses/:businessId/rates                    operations:read
 *  performance_take_snapshot    StaffPerformanceService  POST /staff-performance/businesses/:businessId/snapshot      operations:write
 *
 * NOT GRANTED although their family is (rule 4; UNGRANTED below): among them
 * payroll_set_rate and payroll_generate_run (PayrollService.setRate / generateRun back no
 * route at all), contract_extract_clauses and structure_find_person (their service methods
 * back no route), and every other tool that reads Prisma directly.
 *
 * CANONICAL MODULES THAT GRANT NO KEY TOOL
 *
 *  projects, storefront, ai — no route in the app declares these scopes.
 *  connect      — integration-hub.controller only; no KEY tool calls IntegrationHubService.
 *  analytics    — analytics.controller only, and it does not run ModuleScopeGuard; no KEY
 *                 tool calls its service.
 *  settings     — intelligence / push-notification / product-analytics / trash; no KEY
 *                 tool is governed by them (trash's restore reuses
 *                 CatalogService.updateProduct, which catalog.controller exposes unscoped).
 *  automations  — flow.controller (/api/flows); automations_* calls FlowService
 *                 createAutomation/updateAutomation, which no route calls, and the
 *                 playbook routes (automation.controller) are unscoped.
 *
 *  The legacy keys `crm`, `bookings`, `projects`, `content` are also canonical; their
 *  pre-V1-21 families (crm_*; bookings_*, calendar_*; projects_*, time_*; content_*) are
 *  kept alongside the table for the tools no route governs (see
 *  job-role-policy.service.spec.ts).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { FLOW_TOOLS, CORTEX_TOOL_BRIDGE } from '../ai/flow-tool-registry';
import { CANONICAL_MODULES, LEVEL_RANK, type CanonicalModule } from '../../core/authority/module-vocabulary';
import * as policyModule from './job-role-policy.service';

const SRC = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// Source evidence
// ─────────────────────────────────────────────────────────────────────────────

/** The body of a class member at two-space indent (signature through its closing `  }`). */
function memberBody(src: string, name: string): string | null {
  const lines = src.split('\n');
  const sig = new RegExp(`^ {2}(?:public |private |protected )?(?:async )?${name}\\s*[(<]`);
  const s = lines.findIndex((l) => sig.test(l));
  if (s < 0) return null;
  let e = s + 1;
  while (e < lines.length && !/^ {2}\}\s*$/.test(lines[e])) e++;
  return lines.slice(s, e + 1).join('\n');
}

const ORCHESTRATOR = 'modules/ai/flow-orchestrator.service.ts';

/** tool name -> the text of its dispatcher case (fall-through labels share one body). */
function dispatcherCases(): Map<string, string> {
  const src = read(ORCHESTRATOR);
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
  return bodies;
}

/**
 * tool name -> `Service.method` calls in its dispatcher case, and in the orchestrator's own
 * helpers the case calls (`this.assetWithinBusiness(`), followed through helper to helper.
 */
function dispatcherCalls(): Map<string, string[]> {
  const src = read(ORCHESTRATOR);
  const getters = new Map<string, string>();
  for (const m of src.matchAll(/private (get[A-Za-z0-9]+)\(\)[^{]*\{\s*(?:try\s*\{\s*)?return this\.moduleRef\.get\(([A-Za-z0-9]+)/g)) {
    getters.set(m[1], m[2]);
  }
  const fields = new Map<string, string>();
  for (const m of src.matchAll(/private readonly ([a-zA-Z0-9]+): ([A-Z][A-Za-z0-9]+)/g)) fields.set(m[1], m[2]);

  const serviceCalls = (text: string, out: Set<string>) => {
    for (const m of text.matchAll(/this\.(get[A-Za-z0-9]+)\(\)\s*\.\s*([a-zA-Z0-9]+)\(/g)) {
      const svc = getters.get(m[1]);
      if (svc) out.add(`${svc}.${m[2]}`);
    }
    for (const m of text.matchAll(/this\.([a-zA-Z0-9]+)\s*\.\s*([a-zA-Z0-9]+)\(/g)) {
      const svc = fields.get(m[1]);
      if (svc && svc !== 'PrismaService') out.add(`${svc}.${m[2]}`);
    }
  };
  // A bridged tool's call goes through executeBridgedCortexTool to the organ; bridgedCalls()
  // reads the organ's handler instead of the registry plumbing.
  const notHelpers = new Set([...getters.keys(), 'executeBridgedCortexTool']);
  const helperCalls = (text: string, out: Set<string>, seen: Set<string>) => {
    for (const m of text.matchAll(/this\.([a-zA-Z0-9]+)\(/g)) {
      const name = m[1];
      if (notHelpers.has(name) || seen.has(name)) continue;
      seen.add(name);
      const body = memberBody(src, name);
      if (!body) continue;
      serviceCalls(body, out);
      helperCalls(body, out, seen);
    }
  };

  const out = new Map<string, string[]>();
  for (const [tool, b] of dispatcherCases()) {
    const calls = new Set<string>();
    serviceCalls(b, calls);
    helperCalls(b, calls, new Set());
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
  /** The handler (or its class) runs AuthGuard. */
  authGuard: boolean;
  calls: Set<string>;
  body: string;
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
    const classAuth = /@UseGuards\([^)]*\bAuthGuard\b/.test(head);
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
        authGuard: classAuth || /@UseGuards\([^)]*\bAuthGuard\b/.test(deco),
        calls,
        body,
      });
    }
  }
  return routes;
}

/**
 * tool -> `Service.method` calls of the cortex organ handler a bridged tool dispatches to
 * (FlowOrchestratorService.executeBridgedCortexTool runs the organ's own handler).
 */
function bridgedCalls(): Map<string, string[]> {
  const src = read('modules/key-cortex/organs/key-inbox-adapter.service.ts');
  const fields = new Map<string, string>();
  for (const m of src.matchAll(/private readonly ([a-zA-Z0-9]+): ([A-Z][A-Za-z0-9]+)/g)) fields.set(m[1], m[2]);
  const out = new Map<string, string[]>();
  for (const [tool, target] of Object.entries(CORTEX_TOOL_BRIDGE)) {
    const at = src.indexOf(`this.makeTool(\n        '${target}'`);
    if (at < 0) throw new Error(`organ handler ${target} not found`);
    const next = src.indexOf('this.makeTool(', at + 1);
    const body = src.slice(at, next < 0 ? src.indexOf('\n  }\n', at) : next);
    const calls = new Set<string>();
    for (const m of body.matchAll(/this\.([a-zA-Z0-9]+)\s*\.\s*([a-zA-Z0-9]+)\(/g)) {
      const svc = fields.get(m[1]);
      if (svc) calls.add(`${svc}.${m[2]}`);
    }
    out.set(tool, [...calls]);
  }
  return out;
}

/** class name -> the source file that exports it (services, for the wrapper and drift checks). */
const CLASS_FILES: ReadonlyMap<string, string> = (() => {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) {
        for (const m of readFileSync(p, 'utf8').matchAll(/^export class ([A-Za-z0-9_]+)/gm)) out.set(m[1], p);
      }
    }
  };
  walk(SRC);
  return out;
})();

/** `Class.method` -> its body and the class's injected service fields. */
function serviceMethod(call: string): { body: string; fields: Map<string, string>; cls: string; src: string } | null {
  const [cls, method] = call.split('.');
  const file = CLASS_FILES.get(cls);
  if (!file) return null;
  const src = readFileSync(file, 'utf8');
  const body = memberBody(src, method);
  if (!body) return null;
  const fields = new Map<string, string>();
  for (const m of src.matchAll(/(?:private|public|protected)\s+(?:readonly\s+)?([a-zA-Z0-9_$]+)\s*[?]?:\s*([A-Z][A-Za-z0-9_]*)/g)) fields.set(m[1], m[2]);
  return { body, fields, cls, src };
}

/** The service methods a service method calls: injected services, and its own class's methods. */
function serviceDelegates(call: string): string[] {
  const sm = serviceMethod(call);
  if (!sm) return [];
  const out = new Set<string>();
  for (const m of sm.body.matchAll(/this\.([a-zA-Z0-9_$]+)\s*\.\s*([a-zA-Z0-9_$]+)\s*\(/g)) {
    const svc = sm.fields.get(m[1]);
    if (svc && svc !== 'PrismaService' && CLASS_FILES.has(svc)) out.add(`${svc}.${m[2]}`);
  }
  const own = call.split('.')[1];
  for (const m of sm.body.matchAll(/this\.([a-zA-Z0-9_$]+)\s*\(/g)) {
    if (m[1] !== own && memberBody(sm.src, m[1])) out.add(`${sm.cls}.${m[1]}`);
  }
  return [...out];
}

const family = (tool: string) => tool.split('_')[0];

type Level = 'read' | 'write' | 'admin';
const rank = (l: Level) => LEVEL_RANK[l];

// ─────────────────────────────────────────────────────────────────────────────
// Reviewed inputs to the derivation (each asserted against the source below)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Routes no member can call (rule 2): no AuthGuard, and the handler verifies a provider
 * signature before it acts. `proof` must appear in the handler before the service call.
 */
const SIGNED_PROVIDER_ROUTES: Array<{ file: string; verb: string; path: string; proof: RegExp; call: string }> = [
  {
    file: 'modules/webhooks/webhooks.controller.ts',
    verb: 'POST',
    path: '/webhooks/stripe',
    proof: /this\.stripe!?\.webhooks\.constructEvent\(rawBody, signature, webhookSecret\)/,
    call: 'CommerceService.markInvoicePaid',
  },
];
const routeKey = (r: { file: string; verb: string; path: string }) => `${r.file} ${r.verb} ${r.path}`;
const SIGNED = new Set(SIGNED_PROVIDER_ROUTES.map(routeKey));

/**
 * Service methods no route calls that only forward to one that a route does (rule 2): the
 * forwarded-to method's routes decide. `via` is the field the wrapper forwards through.
 */
const WRAPPERS: Record<string, { to: string; via: string }> = {
  'CrmService.addNote': { to: 'CrmTimelineService.addNote', via: 'timeline' },
  'CrmService.addTask': { to: 'CrmTimelineService.addTask', via: 'timeline' },
};

/** Side effects no module scope applies to (rule 2: FREE). */
const INCIDENTAL: Record<string, string> = {
  'ActivityLogService.createActivity': 'appends an activity-feed row (commerce_send_invoice)',
};

/**
 * Dispatcher cases that read one model through Prisma and stand in for the scoped service
 * method that lists it (rule 1). The case must make no service call and no Prisma write.
 */
const READ_EQUIVALENTS: Record<string, { method: string; model: string }> = {
  commerce_list_invoices: { method: 'CommerceService.listInvoices', model: 'invoice' },
  expenses_list: { method: 'ExpensesService.listExpenses', model: 'expense' },
  // review 2 ESC-5: as ungoverned reads, every legacy alias of crm_* / calendar_* reached these
  crm_list_contacts: { method: 'CrmService.listContacts', model: 'contact' },
  crm_search_contacts: { method: 'CrmService.listContacts', model: 'contact' },
  crm_list_deals: { method: 'CrmDealsService.listDeals', model: 'deal' },
  calendar_list_events: { method: 'CalendarQueryService.listEvents', model: 'calendarEvent' },
};

/** Every tool's calls: dispatcher (with helpers), bridged organ, and the read equivalents. */
function toolCalls(): Map<string, string[]> {
  const calls = new Map([...dispatcherCalls(), ...bridgedCalls()]);
  for (const [tool, eq] of Object.entries(READ_EQUIVALENTS)) calls.set(tool, [...(calls.get(tool) ?? []), eq.method]);
  return calls;
}

interface Derivation {
  /** canonical module -> exact tool name -> the level its by-hand routes require */
  mapping: Record<string, Record<string, Level>>;
  /** family -> governing modules (empty = governed by none) */
  familyModules: Map<string, Set<string>>;
  /** tool -> governing module -> level (empty = ungoverned) */
  toolLevels: Map<string, Map<string, Level>>;
  /** tool -> its UNKNOWN calls (no member route, not a wrapper, not incidental) */
  unknownCalls: Map<string, string[]>;
  /** governed tools no module grants (rule 4) */
  governedUngranted: string[];
  /** method -> the member routes whose handlers call it */
  byMethod: Map<string, Route[]>;
}

function derive(calls: Map<string, string[]>, routes: Route[]): Derivation {
  const byMethod = new Map<string, Route[]>();
  for (const r of routes) {
    if (SIGNED.has(routeKey(r))) continue;
    for (const c of r.calls) byMethod.set(c, [...(byMethod.get(c) ?? []), r]);
  }

  /** Rule 2: 'unknown', or module -> lowest level among its handlers (empty = FREE). */
  const classify = (call: string): Map<string, Level> | 'unknown' => {
    let rs = byMethod.get(call) ?? [];
    if (!rs.length && WRAPPERS[call]) rs = byMethod.get(WRAPPERS[call].to) ?? [];
    const out = new Map<string, Level>();
    if (!rs.length) return INCIDENTAL[call] ? out : 'unknown';
    if (rs.some((r) => r.scope === null)) return out;
    for (const r of rs) {
      const [m, l] = r.scope!.split(':') as [string, Level];
      const cur = out.get(m);
      if (!cur || rank(l) < rank(cur)) out.set(m, l);
    }
    return out;
  };

  /** Rule 3: union of modules, highest level any governed call needs. */
  const toolLevels = new Map<string, Map<string, Level>>();
  const unknownCalls = new Map<string, string[]>();
  for (const [tool, cs] of calls) {
    const lv = new Map<string, Level>();
    const unknown: string[] = [];
    for (const c of cs) {
      const k = classify(c);
      if (k === 'unknown') {
        unknown.push(c);
        continue;
      }
      for (const [m, l] of k) {
        const cur = lv.get(m);
        if (!cur || rank(l) > rank(cur)) lv.set(m, l);
      }
    }
    toolLevels.set(tool, lv);
    unknownCalls.set(tool, unknown);
  }

  /** Rule 4: exact names, sole governing module, no unknown call. */
  const mapping: Record<string, Record<string, Level>> = Object.fromEntries(
    CANONICAL_MODULES.map((m) => [m, {} as Record<string, Level>]),
  );
  const governedUngranted: string[] = [];
  for (const [tool, lv] of [...toolLevels].sort(([a], [b]) => a.localeCompare(b))) {
    if (!lv.size) continue;
    if (lv.size !== 1 || unknownCalls.get(tool)!.length) {
      governedUngranted.push(tool);
      continue;
    }
    const [[m, l]] = [...lv];
    if (!mapping[m]) throw new Error(`${tool} is governed by non-canonical module ${m}`);
    mapping[m][tool] = l;
  }

  const familyModules = new Map<string, Set<string>>();
  for (const [tool, lv] of toolLevels) {
    const mods = familyModules.get(family(tool)) ?? new Set<string>();
    for (const m of lv.keys()) mods.add(m);
    familyModules.set(family(tool), mods);
  }
  return { mapping, familyModules, toolLevels, unknownCalls, governedUngranted, byMethod };
}

// ─────────────────────────────────────────────────────────────────────────────
// Assertions
// ─────────────────────────────────────────────────────────────────────────────

/** The table in the header, row by row (wrapper rows are asserted with WRAPPERS below). */
const EVIDENCE: Array<{ tool: string; service: string; route: string; scope: string; file: string }> = [
  { tool: 'crm_create_contact', service: 'CrmService', route: 'POST /crm/businesses/:businessId/contacts', scope: 'crm:write', file: 'modules/crm/crm.controller.ts' },
  { tool: 'deals_create', service: 'CrmDealsService', route: 'POST /crm/businesses/:businessId/deals', scope: 'crm:write', file: 'modules/crm/crm-deals.controller.ts' },
  { tool: 'deals_list', service: 'CrmDealsService', route: 'GET /crm/businesses/:businessId/deals', scope: 'crm:read', file: 'modules/crm/crm-deals.controller.ts' },
  { tool: 'call_log_outcome', service: 'CallLogService', route: 'POST /businesses/:businessId/calls/:callId/complete', scope: 'crm:write', file: 'modules/call-tasks/call-task.controller.ts' },
  { tool: 'tag_contact', service: 'CrmService', route: 'PATCH /crm/businesses/:businessId/contacts/:contactId', scope: 'crm:write', file: 'modules/crm/crm.controller.ts' },
  { tool: 'commerce_create_quote', service: 'CommerceService', route: 'POST /commerce/businesses/:businessId/quotes', scope: 'revenue:write', file: 'modules/commerce/commerce.controller.ts' },
  { tool: 'commerce_mark_invoice_paid', service: 'CommerceService', route: 'PATCH /commerce/invoices/:invoiceId/paid', scope: 'revenue:write', file: 'modules/commerce/commerce.controller.ts' },
  { tool: 'commerce_list_invoices', service: 'CommerceService', route: 'GET /commerce/businesses/:businessId/invoices', scope: 'revenue:read', file: 'modules/commerce/commerce.controller.ts' },
  { tool: 'payments_create_link', service: 'PaymentsOpsService', route: 'POST /payments/businesses/:businessId/links', scope: 'revenue:write', file: 'modules/payments/payments-ops.controller.ts' },
  { tool: 'calendar_create_event', service: 'CalendarQueryService', route: 'POST /calendar/businesses/:businessId/events', scope: 'bookings:write', file: 'modules/calendar/calendar.controller.ts' },
  { tool: 'calendar_list_events', service: 'CalendarQueryService', route: 'GET /calendar/businesses/:businessId/events', scope: 'bookings:read', file: 'modules/calendar/calendar.controller.ts' },
  { tool: 'crm_list_contacts', service: 'CrmService', route: 'GET /crm/businesses/:businessId/contacts', scope: 'crm:read', file: 'modules/crm/crm.controller.ts' },
  { tool: 'assets_get', service: 'AssetService', route: 'GET /businesses/:businessId/assets/:assetId', scope: 'content:read', file: 'modules/assets/asset.controller.ts' },
  { tool: 'assets_tag', service: 'AssetService', route: 'POST /businesses/:businessId/assets/:assetId/tag', scope: 'content:write', file: 'modules/assets/asset.controller.ts' },
  { tool: 'assets_untag', service: 'AssetService', route: 'POST /businesses/:businessId/assets/:assetId/untag', scope: 'content:write', file: 'modules/assets/asset.controller.ts' },
  { tool: 'expenses_create', service: 'ExpensesService', route: 'POST /expenses/businesses/:businessId/expenses', scope: 'expenses:write', file: 'modules/expenses/expenses.controller.ts' },
  { tool: 'expenses_list', service: 'ExpensesService', route: 'GET /expenses/businesses/:businessId/expenses', scope: 'expenses:read', file: 'modules/expenses/expenses.controller.ts' },
  { tool: 'finance_create_bill', service: 'ExpensesService', route: 'POST /finance/businesses/:businessId/bills', scope: 'expenses:write', file: 'modules/expenses/bills.controller.ts' },
  { tool: 'finance_list_bills', service: 'ExpensesService', route: 'GET /finance/businesses/:businessId/bills', scope: 'expenses:read', file: 'modules/expenses/bills.controller.ts' },
  { tool: 'finance_pay_bill', service: 'ExpensesService', route: 'POST /finance/businesses/:businessId/bills/:billId/pay', scope: 'expenses:write', file: 'modules/expenses/bills.controller.ts' },
  { tool: 'finance_view_payables', service: 'ExpensesService', route: 'GET /finance/businesses/:businessId/payables/aging', scope: 'expenses:read', file: 'modules/expenses/bills.controller.ts' },
  { tool: 'structure_create_delegation_rule', service: 'StructureService', route: 'POST /structure/businesses/:businessId/delegation-rules', scope: 'team:write', file: 'modules/structure/structure.controller.ts' },
  { tool: 'contracts_create', service: 'ContractsService', route: 'POST /contracts/businesses/:businessId', scope: 'operations:write', file: 'modules/contracts/contracts.controller.ts' },
  { tool: 'contracts_acknowledge_alert', service: 'ContractsService', route: 'POST /contracts/businesses/:businessId/:contractId/acknowledge-alert/:alertId', scope: 'operations:write', file: 'modules/contracts/contracts.controller.ts' },
  { tool: 'contract_create_tag', service: 'ContractsService', route: 'POST /contracts/businesses/:businessId/tags', scope: 'operations:write', file: 'modules/contracts/contracts.controller.ts' },
  { tool: 'inbox_reply_thread', service: 'KeyInboxService', route: 'POST /key-inbox/businesses/:businessId/threads/:threadId/reply', scope: 'operations:write', file: 'modules/key-inbox/key-inbox.controller.ts' },
  { tool: 'inbox_mark_resolved', service: 'KeyInboxService', route: 'PATCH /key-inbox/businesses/:businessId/threads/:threadId', scope: 'operations:write', file: 'modules/key-inbox/key-inbox.controller.ts' },
  { tool: 'payroll_approve_run', service: 'PayrollService', route: 'POST /payroll/businesses/:businessId/runs/:runId/approve', scope: 'operations:write', file: 'modules/payroll/payroll.controller.ts' },
  { tool: 'payroll_list_rates', service: 'PayrollService', route: 'GET /payroll/businesses/:businessId/rates', scope: 'operations:read', file: 'modules/payroll/payroll.controller.ts' },
  { tool: 'performance_take_snapshot', service: 'StaffPerformanceService', route: 'POST /staff-performance/businesses/:businessId/snapshot', scope: 'operations:write', file: 'modules/staff-performance/staff-performance.controller.ts' },
];

/**
 * Registry families no canonical module grants any tool of, and why. Every registry family
 * either has a granted tool or is listed here, so a new family has to be placed on purpose.
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
  delegation: 'DelegationLoopService is reached only through autopilot.controller, which declares no module scope',
  documents: 'reads Prisma directly; no service call',
  draft: 'AiUsageService.callAi is reached by unscoped AI routes',
  drive: 'google-drive.controller declares no module scope',
  enable: 'FlowService.updateAutomation backs no route',
  evidence: 'evidence.controller declares no module scope',
  execute: 'execute_custom_logic re-enters the dispatcher for any tool (innerToolExecutor -> executeToolByName), so it is governed by every module the dispatcher reaches and granted by none',
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
  send: 'send_message_with_approval: crm:write (CrmService.addNote) beside AiMessageSenderService.sendMessage, which backs no route',
  seo: 'reads Prisma and AiUsageService.callAi (unscoped AI routes)',
  sequence: 'crm-sequence.controller declares no module scope',
  social: 'social.controller declares no module scope',
  store: 'reads Prisma directly; no service call',
  suppliers: 'supplier.controller declares no module scope',
  sync: 'seo.controller declares no module scope',
  time: 'time-entry.controller declares no module scope (the legacy `projects`/`time` keys still grant time_*)',
  update: 'update_status_with_confirmation needs crm AND revenue, so neither alone grants it; update_business_blueprint is unscoped',
};

/** The governed tools in UNMAPPED families (rule 4: GOVERNED_UNGRANTED). */
const UNMAPPED_GOVERNED: Record<string, string[]> = {
  execute: ['bookings', 'content', 'crm', 'expenses', 'operations', 'revenue', 'team'],
  send: ['crm'],
  update: ['crm', 'revenue'],
};

/**
 * Tools of a granting family that no canonical module grants (rule 4), and why. Before the
 * V1-21b repair a family went in whole as `F_*` when one module governed most of it, which
 * granted exactly these (SEC-V21b-02: payroll_set_rate, payroll_generate_run, ...).
 */
const UNGRANTED: Record<string, string> = {
  calendar_check_conflicts: 'reads Prisma directly; no service call (baseline read for every position)',
  commerce_create_product: 'CatalogService.createProduct is reached by catalog.controller, which is unscoped',
  commerce_update_product: 'CatalogService.updateProduct is reached by catalog.controller and trash restore, both unscoped',
  contract_extract_clauses: 'ContractClauseService.extractClauses backs no route',
  finance_auto_match_bank: 'BankMatchingService.autoMatch is reached by finance.controller, which is unscoped',
  finance_balance_sheet: 'LedgerReportingService is reached by reports.controller, which is unscoped',
  finance_cashflow: 'LedgerReportingService is reached by reports.controller, which is unscoped',
  finance_create_coa_account: 'FinanceCoaService is reached by finance.controller, which is unscoped',
  finance_customer_balance: 'reads Prisma directly; no service call',
  finance_expense_breakdown: 'LedgerReportingService is reached by reports.controller, which is unscoped',
  finance_list_action_items: 'reads Prisma directly; no service call',
  finance_list_bank_accounts: 'FinanceAccountsService is reached by finance.controller, which is unscoped',
  finance_list_coa: 'FinanceCoaService is reached by finance.controller, which is unscoped',
  finance_post_journal_entry: 'PostingService.post is reached by finance.controller, which is unscoped',
  finance_profit_and_loss: 'LedgerReportingService is reached by reports.controller, which is unscoped',
  finance_revenue_breakdown: 'LedgerReportingService is reached by reports.controller, which is unscoped',
  finance_tax_summary: 'LedgerReportingService is reached by reports.controller, which is unscoped',
  finance_view_receivables: 'ReceivablesService is reached by finance.controller, which is unscoped',
  payroll_generate_run: 'PayrollService.generateRun backs no route (payroll.controller has list/get/approve/mark-paid only)',
  payroll_set_rate: 'PayrollService.setRate backs no route (payroll.controller has list/get/approve/mark-paid only)',
  structure_find_person: 'StructureService.findPeople backs no route',
};

/** Why the derivation leaves a tool ungranted, in the words UNGRANTED uses. */
function ungrantedKind(d: Derivation, calls: Map<string, string[]>, tool: string): 'no service call' | 'no route' | 'unscoped' | 'split' {
  const cs = calls.get(tool) ?? [];
  if (!cs.length) return 'no service call';
  if ((d.toolLevels.get(tool)?.size ?? 0) > 1) return 'split';
  return cs.some((c) => (d.byMethod.get(c) ?? []).length > 0) ? 'unscoped' : 'no route';
}

describe('job role tools — derived from the route decorators (V1-21b)', () => {
  const calls = toolCalls();
  const routes = controllerRoutes();
  const derived = derive(calls, routes);
  const CANONICAL_MODULE_TOOLS = (policyModule as Record<string, unknown>).CANONICAL_MODULE_TOOLS as
    | Record<CanonicalModule, Readonly<Record<string, Level>>>
    | undefined;
  const GOVERNED_UNGRANTED = ((policyModule as Record<string, unknown>).GOVERNED_UNGRANTED ?? {}) as Record<string, string>;
  const granted = new Map<string, string>();
  for (const [m, tools] of Object.entries(derived.mapping)) for (const t of Object.keys(tools)) granted.set(t, m);

  it('the parser sees the dispatcher, the bridged organ and the scoped controllers (guards the guard)', () => {
    expect(calls.size).toBeGreaterThan(250);
    expect(routes.filter((r) => r.scope).length).toBeGreaterThan(300);
    // every registry tool has a dispatcher case or a bridged organ handler
    const missing = FLOW_TOOLS.map((t) => t.name).filter((n) => !calls.has(n));
    expect(missing).toEqual([]);
    for (const t of Object.keys(CORTEX_TOOL_BRIDGE)) expect(calls.get(t)?.length, t).toBeGreaterThan(0);
    // ...and the converse: the envelope computes blockedTools over the registry, so a case
    // label outside it would be approved by a family pattern with no per-grant check
    const registry = new Set(FLOW_TOOLS.map((t) => t.name));
    expect([...dispatcherCases().keys()].filter((l) => !registry.has(l))).toEqual([]);
  });

  it.each(EVIDENCE)('$tool -> $service -> $route [$scope]', ({ tool, service, route, scope, file }) => {
    expect(calls.get(tool) ?? [], `${tool} calls ${service}`).toEqual(expect.arrayContaining([expect.stringMatching(new RegExp(`^${service}\\.`))]));
    const [verb, path] = route.split(' ');
    const hit = routes.find((r) => r.file === file && r.verb === verb && r.path === path);
    expect(hit, `${route} in ${file}`).toBeDefined();
    expect(hit!.scope).toBe(scope);
    expect([...hit!.calls].some((c) => c.startsWith(`${service}.`)), `${route} calls ${service}`).toBe(true);
    // the tool's own calls reach this module, at this level, and no other module
    const [module, level] = scope.split(':');
    expect([...(derived.toolLevels.get(tool) ?? new Map())]).toEqual([[module, level]]);
    expect(derived.mapping[module][tool]).toBe(level);
  });

  it('the bridged inbox tools reach KeyInboxService through the key_inbox organ', () => {
    expect(Object.keys(CORTEX_TOOL_BRIDGE).every((t) => t.startsWith('inbox_'))).toBe(true);
    const organ = read('modules/key-cortex/organs/key-inbox-adapter.service.ts');
    expect(organ).toMatch(/private readonly inbox: KeyInboxService/);
    for (const target of Object.values(CORTEX_TOOL_BRIDGE)) expect(organ).toContain(`'${target}'`);
    for (const t of Object.keys(CORTEX_TOOL_BRIDGE)) {
      for (const c of calls.get(t)!) expect(c, t).toMatch(/^KeyInboxService\./);
    }
  });

  it('JobRolePolicyService exports the canonical table, one entry per canonical module', () => {
    expect(CANONICAL_MODULE_TOOLS).toBeDefined();
    expect(Object.keys(CANONICAL_MODULE_TOOLS ?? {}).sort()).toEqual([...CANONICAL_MODULES].sort());
  });

  it('CANONICAL_MODULE_TOOLS is exactly what the decorators derive', () => {
    const actual = Object.fromEntries(CANONICAL_MODULES.map((m) => [m, { ...(CANONICAL_MODULE_TOOLS?.[m] ?? {}) }]));
    expect(actual).toEqual(derived.mapping);
  });

  it('GOVERNED_UNGRANTED is exactly the governed tools no module grants (rule 4)', () => {
    expect(derived.governedUngranted).toEqual(['execute_custom_logic', 'send_message_with_approval', 'update_status_with_confirmation']);
    expect(Object.keys(GOVERNED_UNGRANTED).sort()).toEqual(derived.governedUngranted);
  });

  it('the derivation yields the reviewed table (a change here is a reviewed change)', () => {
    expect(derived.mapping).toEqual({
      crm: {
        call_create_task: 'write',
        call_generate_script: 'write',
        call_list_tasks: 'read',
        call_log_outcome: 'write',
        call_schedule_followup: 'write',
        create_followup_queue: 'write',
        create_task: 'write',
        crm_add_note: 'write',
        crm_add_task: 'write',
        crm_create_contact: 'write',
        crm_delete_contact: 'write',
        crm_find_duplicates: 'read',
        crm_list_contacts: 'read',
        crm_list_deals: 'read',
        crm_merge_execute: 'write',
        crm_merge_preview: 'read',
        crm_move_deal_stage: 'write',
        crm_search_contacts: 'read',
        crm_update_contact: 'write',
        crm_update_deal: 'write',
        deals_create: 'write',
        deals_delete: 'write',
        deals_forecast: 'read',
        deals_get: 'read',
        deals_list: 'read',
        deals_list_stages: 'read',
        deals_mark_lost: 'write',
        deals_mark_won: 'write',
        deals_move_stage: 'write',
        deals_pipeline_velocity: 'read',
        deals_update: 'write',
        tag_contact: 'write',
      },
      revenue: {
        commerce_convert_quote: 'write',
        commerce_create_invoice: 'write',
        commerce_create_quote: 'write',
        commerce_delete_invoice: 'write',
        commerce_list_invoices: 'read',
        commerce_mark_invoice_paid: 'write',
        commerce_send_invoice: 'write',
        commerce_update_invoice: 'write',
        payments_create_link: 'write',
        payments_list_gateways: 'read',
        payments_list_links: 'read',
        payments_list_transactions: 'read',
        payments_refund_charge: 'write',
        payments_revoke_link: 'write',
        payments_search_transactions: 'read',
      },
      bookings: {
        calendar_create_event: 'write',
        calendar_list_events: 'read',
      },
      projects: {},
      content: {
        assets_delete: 'write',
        assets_get: 'read',
        assets_list: 'read',
        assets_list_folders: 'read',
        assets_tag: 'write',
        assets_untag: 'write',
        assets_update: 'write',
      },
      expenses: {
        expenses_create: 'write',
        expenses_list: 'read',
        finance_create_bill: 'write',
        finance_list_bills: 'read',
        finance_pay_bill: 'write',
        finance_view_payables: 'read',
      },
      automations: {},
      storefront: {},
      settings: {},
      ai: {},
      team: {
        structure_create_delegation_rule: 'write',
        structure_get_org_tree: 'read',
        structure_get_stats: 'read',
        structure_list_assignments: 'read',
        structure_list_delegation_rules: 'read',
        structure_list_job_roles: 'read',
        structure_list_org_units: 'read',
        structure_update_delegation_rule: 'write',
      },
      analytics: {},
      operations: {
        contract_create_tag: 'write',
        contract_extract_terms: 'write',
        contract_list_tags: 'read',
        contracts_acknowledge_alert: 'write',
        contracts_create: 'write',
        contracts_delete: 'write',
        contracts_get: 'read',
        contracts_list: 'read',
        contracts_stats: 'read',
        contracts_update: 'write',
        inbox_brief: 'read',
        inbox_list_threads: 'read',
        inbox_mark_resolved: 'write',
        inbox_read_thread: 'read',
        inbox_reply_thread: 'write',
        inbox_update_thread_status: 'write',
        payroll_approve_run: 'write',
        payroll_get_run: 'read',
        payroll_list_rates: 'read',
        payroll_list_runs: 'read',
        payroll_mark_paid: 'write',
        performance_scorecard: 'read',
        performance_take_snapshot: 'write',
        performance_team_summary: 'read',
        performance_trend: 'read',
      },
      connect: {},
    });
  });

  describe('SEC-V21b-02 — an ungoverned tool is never granted', () => {
    it('the table names exact registry tools only, each governed by that module alone', () => {
      const names = new Set(FLOW_TOOLS.map((t) => t.name));
      for (const [m, tools] of Object.entries(CANONICAL_MODULE_TOOLS ?? {})) {
        for (const t of Object.keys(tools)) {
          expect(t, `${m}: ${t} is a wildcard`).not.toContain('*');
          expect(names.has(t), `${m}: ${t} is not a registry tool`).toBe(true);
          expect([...(derived.toolLevels.get(t)?.keys() ?? [])], `${m}: ${t}`).toEqual([m]);
          expect(derived.unknownCalls.get(t), `${m}: ${t}`).toEqual([]);
        }
      }
    });

    it('no canonical module grants a tool the derivation calls ungoverned', () => {
      const ungoverned = FLOW_TOOLS.map((t) => t.name).filter((t) => (derived.toolLevels.get(t)?.size ?? 0) === 0);
      expect(ungoverned.length).toBeGreaterThan(0);
      for (const t of ungoverned) expect(granted.get(t), t).toBeUndefined();
    });

    it.each([
      ['payroll_set_rate', 'PayrollService.setRate'],
      ['payroll_generate_run', 'PayrollService.generateRun'],
      ['contract_extract_clauses', 'ContractClauseService.extractClauses'],
      ['structure_find_person', 'StructureService.findPeople'],
    ])('%s (%s backs no route) is granted by no canonical module', (tool, method) => {
      expect(calls.get(tool)).toEqual([method]);
      expect(derived.byMethod.get(method) ?? []).toEqual([]);
      expect(WRAPPERS[method]).toBeUndefined();
      expect(granted.get(tool)).toBeUndefined();
      expect(UNGRANTED[tool]).toMatch(/backs no route/);
    });

    it('a governed call beside an unknown one is only a floor: such a tool is granted by no module', () => {
      // send_message_with_approval logs a CRM note (crm:write by hand) and sends a real
      // message through AiMessageSenderService.sendMessage, which no route exposes.
      expect([...derived.toolLevels.get('send_message_with_approval')!]).toEqual([['crm', 'write']]);
      expect(derived.unknownCalls.get('send_message_with_approval')).toEqual(['AiMessageSenderService.sendMessage']);
      expect(granted.get('send_message_with_approval')).toBeUndefined();
      // PayrollService.generateRun calls this.listRates (operations:read) but writes a run of
      // its own: it is not a reviewed wrapper, so payroll_generate_run stays ungoverned.
      expect(serviceDelegates('PayrollService.generateRun')).toContain('PayrollService.listRates');
      expect(granted.get('payroll_generate_run')).toBeUndefined();
    });

    it('execute_custom_logic re-enters the dispatcher, so it carries every module and no key grants it', () => {
      expect(dispatcherCases().get('execute_custom_logic')).toMatch(/innerToolExecutor: [^\n]*this\.executeToolByName\(/);
      expect(memberBody(read(ORCHESTRATOR), 'executeToolByName')).toContain('return this.executeToolAction(');
      expect(derived.toolLevels.get('execute_custom_logic')!.size).toBeGreaterThan(1);
      expect(granted.get('execute_custom_logic')).toBeUndefined();
    });

    it('drift guard: a new ungoverned tool in a granting family is not granted; a new governed one changes the table', () => {
      const plusUngoverned = new Map(calls).set('payroll_probe_ungoverned', ['PayrollService.setRate']);
      expect(derive(plusUngoverned, routes).mapping).toEqual(derived.mapping);
      const plusGoverned = new Map(calls).set('payroll_probe_governed', ['PayrollService.approveRun']);
      expect(derive(plusGoverned, routes).mapping.operations).toEqual({ ...derived.mapping.operations, payroll_probe_governed: 'write' });
      expect(derive(plusGoverned, routes).mapping).not.toEqual(CANONICAL_MODULE_TOOLS);
      const plusFloor = new Map(calls).set('payroll_probe_floor', ['PayrollService.approveRun', 'PayrollService.setRate']);
      expect(derive(plusFloor, routes).mapping).toEqual(derived.mapping);
      expect(derive(plusFloor, routes).governedUngranted).toContain('payroll_probe_floor');
    });
  });

  describe('SEC-V21b-03 — a tool keeps the level its route requires', () => {
    it.each([
      ['assets_tag', 'content', 'write'],
      ['assets_untag', 'content', 'write'],
      ['assets_list', 'content', 'read'],
      ['contracts_acknowledge_alert', 'operations', 'write'],
      ['contracts_list', 'operations', 'read'],
      ['inbox_mark_resolved', 'operations', 'write'],
      ['inbox_list_threads', 'operations', 'read'],
      ['crm_create_contact', 'crm', 'write'],
      ['crm_update_contact', 'crm', 'write'],
      ['call_generate_script', 'crm', 'write'],
      ['deals_list', 'crm', 'read'],
      ['crm_add_note', 'crm', 'write'],
      ['crm_add_task', 'crm', 'write'],
      ['commerce_mark_invoice_paid', 'revenue', 'write'],
    ])('%s is granted by %s at %s', (tool, module, level) => {
      expect(CANONICAL_MODULE_TOOLS?.[module as CanonicalModule]?.[tool]).toBe(level);
    });

    it('a read-level entry is reachable by hand through read routes for every governed call', () => {
      for (const [m, tools] of Object.entries(derived.mapping)) {
        for (const [t, level] of Object.entries(tools)) {
          if (level !== 'read') continue;
          for (const c of calls.get(t)!) {
            const rs = derived.byMethod.get(c) ?? [];
            if (!rs.length || rs.some((r) => r.scope === null)) continue;
            expect(rs.some((r) => r.scope === `${m}:read`), `${t} -> ${c} has a ${m}:read route`).toBe(true);
          }
        }
      }
    });
  });

  describe('review 2 ESC-1 — a reviewed wrapper is governed by what it forwards to', () => {
    it.each(Object.entries(WRAPPERS))('%s only forwards to %j', (wrapper, { to, via }) => {
      const sm = serviceMethod(wrapper);
      expect(sm, wrapper).not.toBeNull();
      expect(sm!.fields.get(via)).toBe(to.split('.')[0]);
      expect(sm!.body).toContain(`this.${via}.${to.split('.')[1]}(input)`);
      // its only other calls are its own audit helper, and it writes nothing itself
      expect(serviceDelegates(wrapper).sort()).toEqual([to, `${wrapper.split('.')[0]}.auditContact`].sort());
      expect(sm!.body).not.toMatch(/this\.prisma\.client\.[a-zA-Z]+\.(create|update|upsert|delete)/);
      // no member route calls the wrapper itself; the forwarded-to method is scoped crm:write
      expect(derived.byMethod.get(wrapper) ?? []).toEqual([]);
      expect((derived.byMethod.get(to) ?? []).map((r) => r.scope)).toEqual(['crm:write']);
    });

    it.each([
      ['crm_add_note', 'POST /crm/businesses/:businessId/contacts/:contactId/notes'],
      ['crm_add_task', 'POST /crm/businesses/:businessId/contacts/:contactId/tasks'],
    ])('%s -> CrmService -> CrmTimelineService -> %s [crm:write]', (tool, route) => {
      const [verb, path] = route.split(' ');
      const hit = routes.find((r) => r.file === 'modules/crm/crm.controller.ts' && r.verb === verb && r.path === path);
      expect(hit?.scope).toBe('crm:write');
      expect([...hit!.calls].some((c) => c.startsWith('CrmTimelineService.'))).toBe(true);
      expect([...derived.toolLevels.get(tool)!]).toEqual([['crm', 'write']]);
      expect(derived.mapping.crm[tool]).toBe('write');
    });

    it('drift guard: no tool a legacy family or the baseline reaches hides governed work one call deeper', () => {
      const families = (policyModule as Record<string, unknown>).MODULE_TOOL_FAMILIES as Record<string, readonly string[]>;
      const baseline = (policyModule as Record<string, unknown>).BASELINE_READS as readonly string[];
      expect(families).toBeDefined();
      expect(baseline).toBeDefined();
      const patterns = [...Object.values(families).flat(), ...baseline];
      const reachable = FLOW_TOOLS.map((t) => t.name).filter((t) =>
        patterns.some((p) => (p.endsWith('*') ? t.startsWith(p.slice(0, -1)) : p === t)),
      );
      const governedDeep = (call: string, depth: number, seen: Set<string>): string | null => {
        if (depth > 4 || seen.has(call)) return null;
        seen.add(call);
        for (const d of serviceDelegates(call)) {
          const rs = derived.byMethod.get(d) ?? [];
          if (rs.length && rs.every((r) => r.scope !== null)) return `${d} [${rs.map((r) => r.scope).join(',')}]`;
          if (!rs.length) {
            const deeper = governedDeep(d, depth + 1, seen);
            if (deeper) return `${d} -> ${deeper}`;
          }
        }
        return null;
      };
      const hidden: string[] = [];
      for (const t of reachable) {
        if (derived.toolLevels.get(t)?.size) continue; // governed: the legacy keys do not reach it
        for (const u of derived.unknownCalls.get(t) ?? []) {
          const deep = governedDeep(u, 0, new Set());
          if (deep) hidden.push(`${t}: ${u} -> ${deep}`);
        }
      }
      expect(hidden).toEqual([]);
    });
  });

  describe('review 2 C1 — a provider-signed webhook is not a member route', () => {
    it.each(SIGNED_PROVIDER_ROUTES)('$verb $path verifies the provider signature and runs no AuthGuard', ({ file, verb, path, proof, call }) => {
      const hit = routes.find((r) => r.file === file && r.verb === verb && r.path === path);
      expect(hit, `${verb} ${path}`).toBeDefined();
      expect(hit!.authGuard).toBe(false);
      expect(hit!.scope).toBeNull();
      expect(hit!.calls.has(call)).toBe(true);
      const at = hit!.body.search(proof);
      expect(at, 'signature check').toBeGreaterThan(0);
      expect(at).toBeLessThan(hit!.body.indexOf(`.${call.split('.')[1]}(`));
    });

    it('CommerceService.markInvoicePaid is then governed by its member route alone, revenue:write', () => {
      expect((derived.byMethod.get('CommerceService.markInvoicePaid') ?? []).map((r) => `${r.verb} ${r.path} ${r.scope}`)).toEqual([
        'PATCH /commerce/invoices/:invoiceId/paid revenue:write',
      ]);
      expect(derived.mapping.revenue.commerce_mark_invoice_paid).toBe('write');
      // update_status_with_confirmation also marks paid, and still needs crm AND revenue
      expect([...derived.toolLevels.get('update_status_with_confirmation')!.keys()].sort()).toEqual(['crm', 'revenue']);
    });
  });

  describe('review 2 C2 — reads that stand in for a scoped list route', () => {
    const cases = dispatcherCases();

    it.each(Object.entries(READ_EQUIVALENTS))('%s reads %j through Prisma only', (tool, { method, model }) => {
      const body = cases.get(tool)!;
      expect(dispatcherCalls().get(tool), `${tool} makes no service call of its own`).toEqual([]);
      const prisma = [...body.matchAll(/this\.prisma\.client\.([a-zA-Z]+)\.([a-zA-Z]+)\(/g)].map((m) => `${m[1]}.${m[2]}`);
      expect(prisma.length).toBeGreaterThan(0);
      for (const p of prisma) expect(p, tool).toMatch(new RegExp(`^${model}\\.(findMany|findFirst|findUnique|count)$`));
      const rs = derived.byMethod.get(method) ?? [];
      expect(rs.length, `${method} backs a member route`).toBeGreaterThan(0);
      expect(rs.every((r) => r.scope?.endsWith(':read')), `${method} is a read route`).toBe(true);
    });

    it('assets_get reaches AssetService.getAsset through the assetWithinBusiness helper', () => {
      expect(cases.get('assets_get')).toContain('this.assetWithinBusiness(');
      expect(calls.get('assets_get')).toEqual(['AssetService.getAsset']);
      expect(derived.mapping.content.assets_get).toBe('read');
    });
  });

  describe('review 2 ESC-4 — the CRM tools whose service checks crm_edit / crm_delete', () => {
    const crm = read('modules/crm/crm.service.ts');
    const methods = [...crm.matchAll(/^ {2}(?:async )?([a-zA-Z]+)\(/gm)].map((m) => m[1]);
    const gated = (re: RegExp) =>
      new Set(methods.filter((m) => re.test(memberBody(crm, m) ?? '')).map((m) => `CrmService.${m}`));
    const editGated = gated(/access\.editScope|this\.assertCanCreateContacts\(/);
    const deleteGated = gated(/access\.deleteScope/);
    const SUB = ((policyModule as Record<string, unknown>).CRM_SUBPERMISSION_TOOLS ?? {}) as Record<string, readonly string[]>;
    const grantedCalling = (set: Set<string>) =>
      Object.keys(derived.mapping.crm)
        .filter((t) => (calls.get(t) ?? []).some((c) => set.has(c)))
        .sort();

    it('the gated service methods are the ones resolveCrmAccess bounds over HTTP', () => {
      expect([...editGated].sort()).toEqual(
        ['CrmService.assertCanCreateContacts', 'CrmService.bulkUpdateContacts', 'CrmService.createContact', 'CrmService.findOrCreateContact', 'CrmService.updateContact'].sort(),
      );
      expect([...deleteGated].sort()).toEqual(['CrmService.bulkDeleteContacts', 'CrmService.softDeleteContact']);
    });

    it('CRM_SUBPERMISSION_TOOLS lists exactly the granted tools that call them', () => {
      expect([...(SUB.crm_edit ?? [])].sort()).toEqual(grantedCalling(editGated));
      expect([...(SUB.crm_delete ?? [])].sort()).toEqual(grantedCalling(deleteGated));
      expect(grantedCalling(editGated)).toEqual(['crm_create_contact', 'crm_update_contact', 'tag_contact']);
      expect(grantedCalling(deleteGated)).toEqual(['crm_delete_contact']);
    });
  });

  it('every registry family either has a granted tool or is listed as unmapped with a reason', () => {
    const grantingFamilies = new Set([...granted.keys()].map(family));
    const registryFamilies = [...new Set(FLOW_TOOLS.map((t) => family(t.name)))].sort();
    for (const f of registryFamilies) {
      expect(grantingFamilies.has(f) || f in UNMAPPED, `family ${f} is neither granted nor listed`).toBe(true);
      expect(grantingFamilies.has(f) && f in UNMAPPED, `family ${f} is both granted and listed`).toBe(false);
    }
    for (const f of Object.keys(UNMAPPED)) expect(registryFamilies, `UNMAPPED lists ${f}`).toContain(f);
  });

  it('the unmapped families really are ungoverned, or governed only by tools no module grants', () => {
    for (const f of Object.keys(UNMAPPED)) {
      const mods = derived.familyModules.get(f) ?? new Set<string>();
      expect([...mods].sort(), `family ${f} is governed by ${[...mods].join(',')}`).toEqual(UNMAPPED_GOVERNED[f] ?? []);
    }
  });

  it('every ungranted tool of a granting family is listed in UNGRANTED, with the derivation\'s reason', () => {
    const grantingFamilies = new Set([...granted.keys()].map(family));
    const ungranted = FLOW_TOOLS.map((t) => t.name).filter((t) => grantingFamilies.has(family(t)) && !granted.has(t)).sort();
    expect(Object.keys(UNGRANTED).sort()).toEqual(ungranted);
    for (const t of ungranted) {
      const kind = ungrantedKind(derived, calls, t);
      const reason = UNGRANTED[t];
      if (kind === 'no service call') expect(reason, t).toMatch(/no service call/);
      else if (kind === 'no route') expect(reason, t).toMatch(/backs no route/);
      else if (kind === 'split') expect(reason, t).toMatch(/needs .* AND /);
      else expect(reason, t).toMatch(/unscoped/);
    }
  });
});
