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
 *     A route counts for a method only where the member can make it run (review 7 DRV-BRIEF
 *     / DRV5-1). A call the handler makes only under a guard on server state (a value it read
 *     through a service or Prisma: `if (insights.length > 0) return insights[0]` before
 *     generateBrief, a catch block, a branch on a row's status) is STATE-GUARDED: the member
 *     cannot force it, so that route neither lowers the method's level nor makes it FREE. A
 *     branch on the caller's own input (a query parameter, the body) is not a guard: the
 *     member picks it. A method only state-guarded routes call is governed by their modules
 *     but has no by-hand level, so it counts as UNKNOWN beside them (its tools are
 *     GOVERNED_UNGRANTED). A reviewed ARGUMENT_BOUND route call is one whose arguments the
 *     route fixes so that it does not stand in for the method in general (POST
 *     /drive/.../email-content mails only the caller a fixed notice, so it is not a route to
 *     TransactionalEmailService.send to a customer; review 7 DRV5-2).
 *  2b. A route call bound only by the ambient tenant does not stand in for a dispatcher call
 *     made with none (review 8 DD8-1). On HTTP, TenantInterceptor arms the Prisma tenant
 *     extension for the request's business, which binds every where on a tenant model
 *     (packages/db BUSINESS_ID_MODELS) to it, so a handler that passes a bare id
 *     (completeCall(callId)) still stays in its business. The KEY dispatcher also runs on the
 *     WhatsApp/SMS staff bridge, inside a provider webhook, with no tenant context. A dispatcher
 *     call that reaches a tenant row by an id the model chose (an `args` value, followed through
 *     the services and own-class helpers it is handed to) is AMBIENT-BOUND unless the first such
 *     where on that model also names the business (one the model did not choose), or the code
 *     compares the row's businessId with its own and refuses, or a dispatcher helper proved the
 *     id first (assetWithinBusiness). An AMBIENT-BOUND call is UNKNOWN: its routes are only a
 *     floor, so a governed tool that makes one is GOVERNED_UNGRANTED, and an ungoverned one is
 *     TENANT_UNBOUND_TOOLS, which no key reaches (not a legacy family, not the baseline).
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
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as ts from 'typescript';
import { NotFoundException } from '@nestjs/common';
import { FLOW_TOOLS, CORTEX_TOOL_BRIDGE } from '../ai/flow-tool-registry';
import { BookingsService } from '../bookings/bookings.service';
import { KeyInboxController } from '../key-inbox/key-inbox.controller';
import { KeyInboxAdapterService } from '../key-cortex/organs/key-inbox-adapter.service';
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
/** The orchestrator's lazy `this.getX()` getters (getter -> service class) and injected fields. */
function orchestratorServices(): { getters: Map<string, string>; fields: Map<string, string> } {
  const src = read(ORCHESTRATOR);
  const getters = new Map<string, string>();
  for (const m of src.matchAll(/private (get[A-Za-z0-9]+)\(\)[^{]*\{\s*(?:try\s*\{\s*)?return this\.moduleRef\.get\(([A-Za-z0-9]+)/g)) {
    getters.set(m[1], m[2]);
  }
  const fields = new Map<string, string>();
  for (const m of src.matchAll(/private readonly ([a-zA-Z0-9]+): ([A-Z][A-Za-z0-9]+)/g)) fields.set(m[1], m[2]);
  return { getters, fields };
}

function dispatcherCalls(): Map<string, string[]> {
  const src = read(ORCHESTRATOR);
  const { getters, fields } = orchestratorServices();

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
  /** Of `calls`, those the handler makes only under a guard on server state (rule 2). */
  guarded: Map<string, string>;
  body: string;
}

/**
 * The service calls a handler makes only under a guard on server state, each with the guard
 * (review 7 DRV-BRIEF / DRV5-1). A state value is a local the handler read through `this.`
 * (a service or Prisma) or an `await`, or one derived from such a value; a guard on it is an
 * if / ternary / && || ?? / switch around the call, a catch block, or an earlier
 * `if (...) return` in an enclosing block (the cache-hit shape: a different result returned
 * instead of doing the work). An early `throw` is a refusal, not an alternative, and does not
 * make a later call guarded; a guard on the caller's own input (parameters) does not either,
 * since the member chooses it. A call made at least once unguarded is unguarded.
 */
function stateGuardedCalls(body: string, fields: ReadonlyMap<string, string>): Map<string, string> {
  const sf = ts.createSourceFile('handler.ts', `class Handler {\n${body}\n}`, ts.ScriptTarget.Latest, true);
  const guarded = new Map<string, string>();
  const unguarded = new Set<string>();
  const visitMethods = (node: ts.Node) => {
    if (ts.isMethodDeclaration(node) && node.body) analyse(node);
    else ts.forEachChild(node, visitMethods);
  };
  const analyse = (method: ts.MethodDeclaration) => {
    const state = new Set<string>();
    const readsState = (n: ts.Node): boolean => {
      let hit = false;
      const v = (x: ts.Node) => {
        if (hit) return;
        if (ts.isAwaitExpression(x)) hit = true;
        else if (ts.isIdentifier(x) && state.has(x.text)) hit = true;
        else if (ts.isCallExpression(x)) {
          let e: ts.Expression = x.expression;
          while (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e) || ts.isNonNullExpression(e) || ts.isCallExpression(e)) e = e.expression;
          if (e.kind === ts.SyntaxKind.ThisKeyword) hit = true;
        }
        if (!hit) ts.forEachChild(x, v);
      };
      v(n);
      return hit;
    };
    const names = (b: ts.BindingName, out: string[]) => {
      if (ts.isIdentifier(b)) out.push(b.text);
      else for (const el of b.elements) if (!ts.isOmittedExpression(el)) names(el.name, out);
    };
    for (let changed = true; changed; ) {
      changed = false;
      const v = (x: ts.Node) => {
        const add = (n: string) => {
          if (!state.has(n)) {
            state.add(n);
            changed = true;
          }
        };
        if (ts.isVariableDeclaration(x) && x.initializer && readsState(x.initializer)) {
          const ns: string[] = [];
          names(x.name, ns);
          ns.forEach(add);
        }
        if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(x.left) && readsState(x.right)) add(x.left.text);
        ts.forEachChild(x, v);
      };
      v(method.body!);
    }
    const returns = (s: ts.Node): boolean => {
      let r = false;
      const v = (n: ts.Node) => {
        if (ts.isReturnStatement(n)) r = true;
        else if (!ts.isFunctionLike(n)) ts.forEachChild(n, v);
      };
      v(s);
      return r;
    };
    const guardOf = (node: ts.Node): string | null => {
      let cur: ts.Node = node;
      while (cur.parent && cur !== method) {
        const p = cur.parent;
        if (ts.isIfStatement(p) && p.expression !== cur && readsState(p.expression)) return `if (${p.expression.getText()})`;
        if (ts.isConditionalExpression(p) && p.condition !== cur && readsState(p.condition)) return `${p.condition.getText()} ?`;
        if (
          ts.isBinaryExpression(p) &&
          p.right === cur &&
          [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(p.operatorToken.kind) &&
          readsState(p.left)
        ) {
          return `${p.left.getText()} ${p.operatorToken.getText()}`;
        }
        if (ts.isCatchClause(p)) return 'catch';
        if ((ts.isCaseClause(p) || ts.isDefaultClause(p)) && readsState(p.parent.parent.expression)) return `switch (${p.parent.parent.expression.getText()})`;
        if (ts.isBlock(p)) {
          for (const s of p.statements.slice(0, p.statements.indexOf(cur as ts.Statement))) {
            if (ts.isIfStatement(s) && readsState(s.expression) && (returns(s.thenStatement) || (!!s.elseStatement && returns(s.elseStatement)))) {
              return `after if (${s.expression.getText()}) return`;
            }
          }
        }
        cur = p;
      }
      return null;
    };
    const visitCalls = (n: ts.Node) => {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        ts.isPropertyAccessExpression(n.expression.expression) &&
        n.expression.expression.expression.kind === ts.SyntaxKind.ThisKeyword
      ) {
        const svc = fields.get(n.expression.expression.name.text);
        if (svc && svc !== 'PrismaService') {
          const call = `${svc}.${n.expression.name.text}`;
          const guard = guardOf(n);
          if (guard === null) unguarded.add(call);
          else if (!guarded.has(call)) guarded.set(call, guard);
        }
      }
      ts.forEachChild(n, visitCalls);
    };
    visitCalls(method.body!);
  };
  visitMethods(sf);
  for (const c of unguarded) guarded.delete(c);
  return guarded;
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

/**
 * The controller classes a file declares: every top-level class decorated with @Controller,
 * with its class decorators (`head`) and its own text, from its `class` line through its
 * closing brace. The controller is not simply the file's first `export class`: a file may
 * declare a body DTO first so that the controller's decorator metadata can name it when the
 * class is defined (crm.controller.ts BulkUpdateContactsDto, R0-13e; crm-deals.controller.ts
 * BulkMoveDealsStageDto, R0-13f; the key-cortex controllers), and then every route of that
 * controller was read without its '/crm' prefix or its class guards. A file may also declare
 * two controllers (feature-flags, flow-signal-role), each with its own prefix and guards.
 */
function controllerClasses(src: string): Array<{ head: string; text: string }> {
  const sf = ts.createSourceFile('controller.ts', src, ts.ScriptTarget.Latest, true);
  const out: Array<{ head: string; text: string }> = [];
  for (const st of sf.statements) {
    if (!ts.isClassDeclaration(st) || !st.name) continue;
    const decorators = ts.getDecorators(st) ?? [];
    const isController = decorators.some(
      (d) => ts.isCallExpression(d.expression) && ts.isIdentifier(d.expression.expression) && d.expression.expression.text === 'Controller',
    );
    if (!isController) continue;
    const classLine = src.lastIndexOf('\n', st.name.getStart(sf)) + 1;
    out.push({ head: decorators.map((d) => d.getText(sf)).join('\n'), text: src.slice(classLine, st.end) });
  }
  return out;
}

function controllerRoutes(): Route[] {
  const routes: Route[] = [];
  for (const file of controllerFiles(join(SRC, 'modules'))) {
    for (const { head, text } of controllerClasses(readFileSync(file, 'utf8'))) routes.push(...classRoutes(file, head, text));
  }
  return routes;
}

/** The routes of one controller class (`head`: its class decorators; `text`: the class). */
function classRoutes(file: string, head: string, text: string): Route[] {
  const routes: Route[] = [];
  const prefix = (head.match(/@Controller\(\s*'([^']*)'/) ?? [])[1] ?? '';
  const classGuard = /@UseGuards\([^)]*\bModuleScopeGuard\b/.test(head);
  const classAuth = /@UseGuards\([^)]*\bAuthGuard\b/.test(head);
  const fields = new Map<string, string>();
  for (const m of text.matchAll(/(?:private|public|protected)\s+(?:readonly\s+)?([a-zA-Z0-9_$]+)\s*:\s*([A-Z][A-Za-z0-9_]*)/g)) {
    fields.set(m[1], m[2]);
  }

  // Members of the class: a signature at two-space indent. Decorators of a member are
  // the lines between the previous member's closing `  }` and its signature.
  const lines = text.split('\n');
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
      guarded: stateGuardedCalls(body, fields),
      body,
    });
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
 * Route calls whose arguments the route fixes so that it does not stand in for the method in
 * general (rule 2, review 7 DRV5-2). `proof` must appear in the handler. POST
 * /drive/.../email-content mails the caller (or, without one, the business's first member) a
 * fixed 'document_generated' notice: it is not a route by which a member mails a customer, so
 * it does not make TransactionalEmailService.send FREE for commerce_send_invoice, which mails
 * the invoice's customer an 'invoice_sent' pay link.
 */
const ARGUMENT_BOUND: Array<{ file: string; verb: string; path: string; call: string; proof: RegExp[]; why: string }> = [
  {
    file: 'modules/google-drive/google-drive.controller.ts',
    verb: 'POST',
    path: '/drive/businesses/:businessId/email-content',
    call: 'TransactionalEmailService.send',
    proof: [
      /user = await this\.prisma\.client\.user\.findUnique\(\{\s*where: \{ id: req\.user\.id \}/,
      /user = business\.members\[0\]\.user;/,
      /type: 'document_generated',/,
      /recipientEmail: user\.email,/,
    ],
    why: "mails the caller (or the business's first member) a fixed document_generated notice, never a customer",
  },
];
const BOUND = new Set(ARGUMENT_BOUND.map((b) => `${routeKey(b)} ${b.call}`));

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

// ─────────────────────────────────────────────────────────────────────────────
// Rule 2b — tenant binding (review 8 DD8-1)
// ─────────────────────────────────────────────────────────────────────────────

/** packages/db/src/client.ts: the Prisma tenant extension and the models it scopes. */
const DB_CLIENT = join(SRC, '..', '..', '..', 'packages', 'db', 'src', 'client.ts');

/**
 * The models the Prisma tenant extension scopes (BUSINESS_ID_MODELS), as client delegate names
 * (`CallLog` -> `callLog`). The extension ANDs the ambient tenant onto every where of these
 * models, and forces it onto every create, only while a tenant context is live: TenantInterceptor
 * installs one for an authenticated HTTP request; the WhatsApp/SMS staff bridge runs inside a
 * provider webhook (no AuthGuard, no user) with none.
 */
const TENANT_MODELS: ReadonlySet<string> = (() => {
  const src = readFileSync(DB_CLIENT, 'utf8');
  const at = src.indexOf('const BUSINESS_ID_MODELS = new Set([');
  const end = src.indexOf(']);', at);
  if (at < 0 || end < 0) throw new Error('BUSINESS_ID_MODELS not found in packages/db/src/client.ts');
  const names = [...src.slice(at, end).replace(/\/\/[^\n]*/g, '').matchAll(/'([A-Z][A-Za-z0-9]*)'/g)].map((m) => m[1]);
  return new Set(names.map((n) => n[0].toLowerCase() + n.slice(1)));
})();

/** Prisma operations that reach existing rows through a where. */
const ROW_OPS = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert']);

/**
 * What a caller hands a parameter: a value the model chose (true: an `args.*` value of the tool
 * call, or one copied from it), an object of which the model chose exactly these keys, or
 * nothing the model chose (false: the dispatcher's own businessId, a literal, a row it read).
 */
type Seed = boolean | ReadonlySet<string>;

/**
 * What a caller's argument is, beyond whether the model chose it (review 9 TD9-5): 'absent' when
 * nothing is handed over (an argument not passed, or `undefined` / `null`), the keys of an object
 * literal it hands over, or null when that is not known (the value is present). Prisma drops a
 * `businessId: undefined`, so a where whose businessId is absent names no business.
 */
type Shape = 'absent' | ReadonlySet<string> | null;

/** The roots of a body whose value is absent, and the object parameters whose keys are known. */
interface Absence {
  absent: ReadonlySet<string>;
  supplied: ReadonlyMap<string, ReadonlySet<string>>;
}

const NO_ABSENCE: Absence = { absent: new Set(), supplied: new Map() };

/** A where on a tenant model that names a row by an id the model chose. */
interface Touch {
  model: string;
  op: string;
  /** The where also names the business (not one the model chose), or the code compares the row's businessId. */
  bound: boolean;
  /** The dispatcher call it is reached through (`Service.method`, or `prisma.<model>` for the case's own read). */
  via: string;
}

interface ClassCtx {
  cls: string;
  src: string;
  fields: ReadonlyMap<string, string>;
  getters: ReadonlyMap<string, string>;
}

function classCtx(cls: string, src: string): ClassCtx {
  const fields = new Map<string, string>();
  for (const m of src.matchAll(/(?:private|public|protected)\s+(?:readonly\s+)?([a-zA-Z0-9_$]+)\s*[?]?:\s*([A-Z][A-Za-z0-9_]*)/g)) fields.set(m[1], m[2]);
  const getters = new Map<string, string>();
  for (const m of src.matchAll(/private (get[A-Za-z0-9]+)\(\)[^{]*\{\s*(?:try\s*\{\s*)?return this\.moduleRef\.get\(([A-Za-z0-9]+)/g)) getters.set(m[1], m[2]);
  return { cls, src, fields, getters };
}

const unwrapExpr = (e: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isTypeAssertionExpression(e) ? unwrapExpr(e.expression) : e;

/**
 * A comparison of a row's businessId with the business the code was given, followed by a
 * refusal (`if (!asset || asset.businessId !== businessId) { throw ...`): it binds whatever the
 * code reached before it.
 */
const COMPARES_TENANT = /\.businessId !== (?:[\w.]+\.)?businessId\)?\s*\{?\s*(?:\/\/[^\n]*\n\s*)*throw /;

/**
 * The tenant-model rows a function body reaches by an id the model chose, in source order,
 * following the own-class helpers and injected services it hands such a value. `roots` seeds
 * the body's free identifiers (a method's parameters; a dispatcher case's `args`). A dispatcher
 * helper that proves ownership (`this.assetWithinBusiness(businessId, args.assetId)`) binds the
 * value it proved for the rest of the body; a body that compares the row's businessId with its
 * own binds what it reached.
 */
function chosenTouches(
  ctx: ClassCtx,
  fn: ts.Node,
  roots: ReadonlyMap<string, Seed>,
  seen: Set<string>,
  opts: { dispatcher?: boolean; ignoreProofs?: boolean } = {},
  absence: Absence = NO_ABSENCE,
): Touch[] {
  const decls = new Map<string, ts.Expression>();
  const picked = new Map<string, { from: ts.Expression; key: string }>();
  const collect = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && n.initializer) {
      if (ts.isIdentifier(n.name)) decls.set(n.name.text, n.initializer);
      else if (ts.isObjectBindingPattern(n.name)) {
        for (const el of n.name.elements) {
          if (ts.isIdentifier(el.name)) picked.set(el.name.text, { from: n.initializer, key: (el.propertyName ?? el.name).getText() });
        }
      }
    }
    ts.forEachChild(n, collect);
  };
  collect(fn);

  /** A value the code read itself (awaited, or a call on `this`): whatever bound that read binds it. */
  const readsRow = (e: ts.Expression): boolean => {
    const x = unwrapExpr(e);
    if (ts.isAwaitExpression(x)) return true;
    if (!ts.isCallExpression(x)) return false;
    let c: ts.Expression = x.expression;
    while (ts.isPropertyAccessExpression(c) || ts.isCallExpression(c) || ts.isElementAccessExpression(c) || ts.isNonNullExpression(c)) c = c.expression;
    return c.kind === ts.SyntaxKind.ThisKeyword;
  };
  const union = (a: Seed, b: Seed): Seed => {
    if (a === true || b === true) return true;
    if (a === false) return b;
    if (b === false) return a;
    return new Set([...a, ...b]);
  };
  const seedOf = (e: ts.Expression, depth = 0): Seed => {
    if (depth > 8) return false;
    const x = unwrapExpr(e);
    if (ts.isIdentifier(x)) {
      if (roots.has(x.text)) return roots.get(x.text)!;
      const p = picked.get(x.text);
      if (p) return readsRow(p.from) ? false : keyOf(seedOf(p.from, depth + 1), p.key);
      const d = decls.get(x.text);
      return d && !readsRow(d) ? seedOf(d, depth + 1) : false;
    }
    if (ts.isPropertyAccessExpression(x)) return keyOf(seedOf(x.expression, depth + 1), x.name.text);
    if (ts.isElementAccessExpression(x)) return seedOf(x.expression, depth + 1) === true;
    if (ts.isObjectLiteralExpression(x)) {
      const keys = new Set<string>();
      for (const p of x.properties) {
        if (ts.isSpreadAssignment(p)) {
          const s = seedOf(p.expression, depth + 1);
          if (s === true) return true;
          if (s) for (const k of s) keys.add(k);
          continue;
        }
        const v = ts.isPropertyAssignment(p) ? p.initializer : ts.isShorthandPropertyAssignment(p) ? p.name : null;
        if (v && p.name && seedOf(v, depth + 1) === true) keys.add(p.name.getText());
      }
      return keys.size ? keys : false;
    }
    if (ts.isArrayLiteralExpression(x)) return x.elements.some((el) => seedOf(el as ts.Expression, depth + 1) === true);
    if (ts.isConditionalExpression(x)) return union(seedOf(x.whenTrue, depth + 1), seedOf(x.whenFalse, depth + 1));
    if (ts.isBinaryExpression(x) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(x.operatorToken.kind)) {
      return union(seedOf(x.left, depth + 1), seedOf(x.right, depth + 1));
    }
    if (ts.isTemplateExpression(x)) return x.templateSpans.some((s) => seedOf(s.expression, depth + 1) === true);
    if (ts.isCallExpression(x) && !readsRow(x)) {
      // String(args.id), args.ids.map(...): a value computed from what the model chose
      return [x.expression, ...x.arguments].some((a) => seedOf(a, depth + 1) === true);
    }
    return false;
  };

  /**
   * Whether `e` is a value its caller never handed over (review 9 TD9-5): `undefined`, `null`, a
   * parameter not passed, a key left out of the object literal handed over, or a copy of one.
   */
  const isAbsent = (e: ts.Expression, depth = 0): boolean => {
    if (depth > 8) return false;
    const x = unwrapExpr(e);
    if (x.kind === ts.SyntaxKind.NullKeyword || ts.isVoidExpression(x)) return true;
    if (ts.isIdentifier(x)) {
      if (x.text === 'undefined' || absence.absent.has(x.text)) return true;
      if (roots.has(x.text)) return false;
      const p = picked.get(x.text);
      if (p) return !readsRow(p.from) && isAbsentKey(p.from, p.key, depth + 1);
      const d = decls.get(x.text);
      return d && !readsRow(d) ? isAbsent(d, depth + 1) : false;
    }
    if (ts.isPropertyAccessExpression(x)) return isAbsentKey(x.expression, x.name.text, depth + 1);
    return false;
  };
  const isAbsentKey = (obj: ts.Expression, key: string, depth: number): boolean => {
    const o = unwrapExpr(obj);
    if (isAbsent(o, depth)) return true;
    if (ts.isIdentifier(o) && !decls.has(o.text) && !picked.has(o.text)) {
      const keys = absence.supplied.get(o.text);
      if (keys) return !keys.has(key);
    }
    return false;
  };

  const classifyWhere = (w: ts.Expression, depth = 0): { chosenId: boolean; bound: boolean; idText?: string } => {
    const none = { chosenId: false, bound: false };
    if (depth > 6) return none;
    const x = unwrapExpr(w);
    if (ts.isIdentifier(x)) {
      const d = decls.get(x.text);
      return d ? classifyWhere(d, depth + 1) : none;
    }
    if (ts.isCallExpression(x)) {
      // contactWhereWithId(input.businessId, input.contactId)
      return {
        chosenId: x.arguments.some((a) => seedOf(a) === true),
        bound: x.arguments.some((a) => /\bbusinessId\b/.test(a.getText()) && seedOf(a) !== true && !isAbsent(a)),
      };
    }
    if (!ts.isObjectLiteralExpression(x)) return none;
    let chosenId = false;
    let bound = false;
    let idText: string | undefined;
    for (const p of x.properties) {
      if (ts.isSpreadAssignment(p)) {
        const inner = classifyWhere(p.expression, depth + 1);
        chosenId ||= inner.chosenId;
        bound ||= inner.bound;
        idText ??= inner.idText;
        continue;
      }
      const k = p.name?.getText();
      const v = ts.isPropertyAssignment(p) ? p.initializer : ts.isShorthandPropertyAssignment(p) ? p.name : undefined;
      if (!v) continue;
      if (k === 'id') {
        const u = unwrapExpr(v);
        const inList = ts.isObjectLiteralExpression(u) ? u.properties.find((q) => q.name?.getText() === 'in') : undefined;
        const idValue = inList && ts.isPropertyAssignment(inList) ? inList.initializer : u;
        if (!proven.has(idValue.getText()) && seedOf(idValue) === true) {
          chosenId = true;
          idText = idValue.getText();
        }
      } else if (k === 'businessId') {
        // a tenant the model chose binds nothing, nor one the caller never handed over (TD9-5)
        if (seedOf(v) !== true && !isAbsent(v)) bound = true;
      } else if (ts.isObjectLiteralExpression(unwrapExpr(v)) && /\bbusinessId\b/.test(v.getText())) {
        // a relation filter that names the tenant: { project: { businessId } }
        if (classifyWhere(v, depth + 1).bound) bound = true;
      }
    }
    return { chosenId, bound, idText };
  };

  /** What an argument hands over: nothing, an object literal's keys, or a value (TD9-5). */
  const shapeOf = (a: ts.Expression, depth = 0): Shape => {
    if (isAbsent(a)) return 'absent';
    const x = unwrapExpr(a);
    if (ts.isObjectLiteralExpression(x)) {
      const keys = new Set<string>();
      for (const p of x.properties) {
        if (ts.isSpreadAssignment(p)) return null;
        const v = ts.isPropertyAssignment(p) ? p.initializer : ts.isShorthandPropertyAssignment(p) ? p.name : undefined;
        if (p.name && !(v && isAbsent(v))) keys.add(p.name.getText());
      }
      return keys;
    }
    if (ts.isIdentifier(x) && depth < 8) {
      const d = decls.get(x.text);
      if (d && !readsRow(d) && ts.isObjectLiteralExpression(unwrapExpr(d))) return shapeOf(d, depth + 1);
    }
    return null;
  };

  const ownershipHelper = (name: string) => opts.dispatcher && COMPARES_TENANT.test(memberBody(ctx.src, name) ?? '');
  const proven = new Set<string>();
  const touches: Touch[] = [];
  const visit = (n: ts.Node, via: string | null) => {
    let nextVia = via;
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const method = n.expression.name.text;
      const target = unwrapExpr(n.expression.expression);
      if (ROW_OPS.has(method) && ts.isPropertyAccessExpression(target) && TENANT_MODELS.has(target.name.text)) {
        const arg = n.arguments[0] && unwrapExpr(n.arguments[0]);
        const whereProp = arg && ts.isObjectLiteralExpression(arg) ? arg.properties.find((p) => p.name?.getText() === 'where') : undefined;
        const w = whereProp && ts.isPropertyAssignment(whereProp) ? whereProp.initializer : whereProp && ts.isShorthandPropertyAssignment(whereProp) ? whereProp.name : undefined;
        const c = w ? classifyWhere(w) : null;
        if (c?.chosenId) touches.push({ model: target.name.text, op: method, bound: c.bound, via: via ?? `prisma.${target.name.text}` });
        // a where that names the business proves the id it names for the rest of the body
        if (c?.chosenId && c.bound && c.idText) proven.add(c.idText);
      } else {
        let callee: string | null = null;
        if (target.kind === ts.SyntaxKind.ThisKeyword && memberBody(ctx.src, method)) callee = `${ctx.cls}.${method}`;
        else if (ts.isCallExpression(target) && ts.isPropertyAccessExpression(target.expression) && target.expression.expression.kind === ts.SyntaxKind.ThisKeyword) {
          const svc = ctx.getters.get(target.expression.name.text);
          if (svc) callee = `${svc}.${method}`;
        } else if (ts.isPropertyAccessExpression(target) && target.expression.kind === ts.SyntaxKind.ThisKeyword) {
          const svc = ctx.fields.get(target.name.text);
          if (svc && svc !== 'PrismaService' && CLASS_FILES.has(svc)) callee = `${svc}.${method}`;
        }
        if (callee) {
          if (callee.startsWith(`${ctx.cls}.`) && ownershipHelper(method) && !opts.ignoreProofs) {
            // the helper proves the row is the business's: what it was handed is bound from here on
            for (const a of n.arguments) proven.add(a.getText());
          } else {
            const seeds = n.arguments.map((a) => (proven.has(a.getText()) ? false : seedOf(a)));
            const shapes = n.arguments.map((a) => shapeOf(a));
            const at = via ?? (callee.startsWith(`${ctx.cls}.`) && opts.dispatcher ? null : callee);
            if (seeds.some((s) => s !== false)) touches.push(...methodTouches(callee, seeds, seen, at, opts.dispatcher ? opts : {}, shapes));
            nextVia = at;
          }
        }
      }
    }
    ts.forEachChild(n, (c) => visit(c, nextVia));
  };
  ts.forEachChild(fn, (c) => visit(c, null));
  if (COMPARES_TENANT.test(fn.getText())) for (const t of touches) t.bound = true;
  return touches;
}

/** Classes the rule's own cases below are written in (class name -> source). */
const SYNTHETIC_CLASSES = new Map<string, string>();

/** The rows `Class.method` reaches by an id the model chose, given what its caller handed each parameter. */
function methodTouches(
  call: string,
  seeds: Seed[],
  seen: Set<string>,
  via: string | null,
  opts: { dispatcher?: boolean; ignoreProofs?: boolean } = {},
  shapes: readonly Shape[] = [],
): Touch[] {
  const shapeKey = (i: number) => {
    const sh = shapes[i] ?? null;
    return sh === 'absent' ? '~' : sh ? `{${[...sh].sort().join('|')}}` : '';
  };
  const key = `${call}(${seeds.map((s, i) => (s === true ? '*' : s === false ? '-' : [...s].sort().join('|')) + shapeKey(i)).join(',')})`;
  if (seen.has(key)) return [];
  seen.add(key);
  const [cls, method] = call.split('.');
  const file = CLASS_FILES.get(cls);
  const src = SYNTHETIC_CLASSES.get(cls) ?? (file ? readFileSync(file, 'utf8') : null);
  if (!src) return [];
  const body = memberBody(src, method);
  if (!body) return [];
  const sf = ts.createSourceFile('m.ts', `class M {\n${body}\n}`, ts.ScriptTarget.Latest, true);
  let decl: ts.MethodDeclaration | undefined;
  const find = (n: ts.Node) => {
    if (!decl && ts.isMethodDeclaration(n)) decl = n;
    else ts.forEachChild(n, find);
  };
  find(sf);
  if (!decl?.body) return [];
  const roots = new Map<string, Seed>();
  // review 9 TD9-5: a parameter its caller did not pass (or passed as undefined / null) is absent,
  // and so is a key left out of the object literal it handed over: Prisma drops such a businessId
  const absent = new Set<string>();
  const supplied = new Map<string, ReadonlySet<string>>();
  decl.parameters.forEach((p, i) => {
    const s = seeds[i] ?? false;
    const shape: Shape = i >= seeds.length ? 'absent' : (shapes[i] ?? null);
    if (ts.isIdentifier(p.name)) {
      roots.set(p.name.text, s);
      if (shape === 'absent') absent.add(p.name.text);
      else if (shape) supplied.set(p.name.text, shape);
    } else if (ts.isObjectBindingPattern(p.name)) {
      for (const el of p.name.elements) {
        if (!ts.isIdentifier(el.name)) continue;
        const k = (el.propertyName ?? el.name).getText();
        roots.set(el.name.text, keyOf(s, k));
        if (shape === 'absent' || (shape && !shape.has(k))) absent.add(el.name.text);
      }
    }
  });
  const ctx = classCtx(cls, src);
  return chosenTouches(
    ctx,
    decl.body,
    roots,
    seen,
    { dispatcher: cls === 'FlowOrchestratorService' && opts.dispatcher, ignoreProofs: opts.ignoreProofs },
    { absent, supplied },
  ).map((t) => ({
    ...t,
    via: via ?? t.via,
  }));
}

function keyOf(s: Seed, key: string): Seed {
  return s === true ? true : s === false ? false : s.has(key);
}

/** A dispatcher case's text as a parseable body: `args` is the model's, `businessId` the dispatcher's own. */
function caseBody(caseText: string): ts.Node {
  const sf = ts.createSourceFile('case.ts', `class D {\n  async c(businessId: string, args: any, toolName: string) {\n    switch (toolName) {\n${caseText}\n    }\n  }\n}`, ts.ScriptTarget.Latest, true);
  let body: ts.Node | undefined;
  const find = (n: ts.Node) => {
    if (!body && ts.isMethodDeclaration(n) && n.body) body = n.body;
    else ts.forEachChild(n, find);
  };
  find(sf);
  return body!;
}

/**
 * tool -> the tenant rows its dispatcher case reaches by an id the model chose. A bridged tool
 * runs the cortex organ's handler `(ctx, input) => ...`: `input` is the model's, `ctx.businessId`
 * the session's.
 */
function dispatcherTouches(opts: { ignoreProofs?: boolean } = {}): Map<string, Touch[]> {
  const ctx = classCtx('FlowOrchestratorService', read(ORCHESTRATOR));
  const out = new Map<string, Touch[]>();
  for (const [tool, text] of dispatcherCases()) {
    out.set(tool, chosenTouches(ctx, caseBody(text), new Map([['args', true]]), new Set(), { dispatcher: true, ignoreProofs: opts.ignoreProofs }));
  }
  const organSrc = read('modules/key-cortex/organs/key-inbox-adapter.service.ts');
  const organ = classCtx('KeyInboxAdapterService', organSrc);
  const handlers = new Map<string, ts.ArrowFunction | ts.FunctionExpression>();
  const sf = ts.createSourceFile('organ.ts', organSrc, ts.ScriptTarget.Latest, true);
  const find = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'makeTool' && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) {
      const h = n.arguments[n.arguments.length - 1];
      if (ts.isArrowFunction(h) || ts.isFunctionExpression(h)) handlers.set(n.arguments[0].text, h);
    }
    ts.forEachChild(n, find);
  };
  find(sf);
  for (const [tool, target] of Object.entries(CORTEX_TOOL_BRIDGE)) {
    const h = handlers.get(target);
    if (!h) throw new Error(`organ handler ${target} not found`);
    const roots = new Map<string, Seed>();
    h.parameters.forEach((p, i) => ts.isIdentifier(p.name) && roots.set(p.name.text, i === 1));
    out.set(tool, chosenTouches(organ, h.body, roots, new Set()));
  }
  return out;
}

/**
 * Rule 2b: tool -> its dispatcher calls that are AMBIENT-BOUND — calls that reach a tenant row
 * by an id the model chose, where the first such where on that model names no business (not the
 * model's) and nothing compares the row's businessId. Over HTTP that same where is bound by the
 * ambient tenant alone; on the staff bridge it reaches any business's row.
 */
function ambientCalls(touches: Map<string, Touch[]>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [tool, list0] of touches) {
    const byVia = new Map<string, Touch[]>();
    for (const t of list0) byVia.set(t.via, [...(byVia.get(t.via) ?? []), t]);
    const bad: string[] = [];
    for (const [via, list] of byVia) {
      const first = new Map<string, Touch>();
      for (const t of list) if (!first.has(t.model)) first.set(t.model, t);
      if ([...first.values()].some((t) => !t.bound)) bad.push(via);
    }
    if (bad.length) out.set(tool, bad.sort());
  }
  return out;
}

const DISPATCHER_TOUCHES = dispatcherTouches();
const AMBIENT: ReadonlyMap<string, readonly string[]> = ambientCalls(DISPATCHER_TOUCHES);

interface Derivation {
  /** canonical module -> exact tool name -> the level its by-hand routes require */
  mapping: Record<string, Record<string, Level>>;
  /** family -> governing modules (empty = governed by none) */
  familyModules: Map<string, Set<string>>;
  /** tool -> governing module -> level (empty = ungoverned) */
  toolLevels: Map<string, Map<string, Level>>;
  /** tool -> its UNKNOWN calls (no member route, not a wrapper, not incidental; or AMBIENT-BOUND, rule 2b) */
  unknownCalls: Map<string, string[]>;
  /** governed tools no module grants (rule 4) */
  governedUngranted: string[];
  /** method -> the member routes whose handlers make it run whenever the member asks */
  byMethod: Map<string, Route[]>;
  /** method -> the member routes whose handlers call it only under a guard on server state */
  guardedBy: Map<string, Route[]>;
}

function derive(calls: Map<string, string[]>, routes: Route[], ambient: ReadonlyMap<string, readonly string[]> = AMBIENT): Derivation {
  const byMethod = new Map<string, Route[]>();
  const guardedBy = new Map<string, Route[]>();
  for (const r of routes) {
    if (SIGNED.has(routeKey(r))) continue;
    for (const c of r.calls) {
      if (BOUND.has(`${routeKey(r)} ${c}`)) continue;
      const into = r.guarded.has(c) ? guardedBy : byMethod;
      into.set(c, [...(into.get(c) ?? []), r]);
    }
  }

  /**
   * Rule 2: module -> lowest level among the handlers that make it run (empty = FREE), and
   * whether the method has no by-hand level (UNKNOWN). A method only state-guarded handlers
   * call is UNKNOWN, governed by those handlers' modules at their highest level: they keep
   * the legacy keys and the baseline off it, and no module grants it.
   */
  const classify = (call: string): { levels: Map<string, Level>; unknown: boolean } => {
    let rs = byMethod.get(call) ?? [];
    if (!rs.length && WRAPPERS[call]) rs = byMethod.get(WRAPPERS[call].to) ?? [];
    const levels = new Map<string, Level>();
    if (!rs.length) {
      if (INCIDENTAL[call]) return { levels, unknown: false };
      for (const r of guardedBy.get(call) ?? []) {
        if (!r.scope) continue;
        const [m, l] = r.scope.split(':') as [string, Level];
        const cur = levels.get(m);
        if (!cur || rank(l) > rank(cur)) levels.set(m, l);
      }
      return { levels, unknown: true };
    }
    if (rs.some((r) => r.scope === null)) return { levels, unknown: false };
    for (const r of rs) {
      const [m, l] = r.scope!.split(':') as [string, Level];
      const cur = levels.get(m);
      if (!cur || rank(l) < rank(cur)) levels.set(m, l);
    }
    return { levels, unknown: false };
  };

  /** Rule 3: union of modules, highest level any governed call needs. */
  const toolLevels = new Map<string, Map<string, Level>>();
  const unknownCalls = new Map<string, string[]>();
  for (const [tool, cs] of calls) {
    const lv = new Map<string, Level>();
    const unknown: string[] = [];
    for (const c of cs) {
      const k = classify(c);
      if (k.unknown) unknown.push(c);
      for (const [m, l] of k.levels) {
        const cur = lv.get(m);
        if (!cur || rank(l) > rank(cur)) lv.set(m, l);
      }
    }
    // Rule 2b: a call that reaches a tenant row by an id the model chose, bound over HTTP only by
    // the ambient tenant, has no by-hand equivalent on the bridge: its routes are only a floor.
    for (const c of ambient.get(tool) ?? []) if (!unknown.includes(c)) unknown.push(c);
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
  return { mapping, familyModules, toolLevels, unknownCalls, governedUngranted, byMethod, guardedBy };
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
  commerce_send_invoice:
    "mails the invoice's customer through TransactionalEmailService.send, which no member route makes run for a customer (drive email-content mails only the caller: ARGUMENT_BOUND), with a pay link from CommerceService.automatedInvoiceUrl, which backs no route (V1-46b), so revenue:write (updateInvoiceStatus) is only a floor (review 7 DRV5-2)",
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
  procurement_acknowledge_vendor:
    'operations:write (D-40) is only a floor: ProcurementService.acknowledgeVendor updates the request by its bare id, AMBIENT-BOUND on the staff bridge (rule 2b, R0-13g)',
  procurement_mark_fulfilled:
    'operations:write (D-40) is only a floor: ProcurementService.markFulfilled updates the request by its bare id, AMBIENT-BOUND on the staff bridge (rule 2b, R0-13g)',
  procurement_mark_invoiced:
    'operations:write (D-40) is only a floor: ProcurementService.markInvoiced updates the request by its bare id, AMBIENT-BOUND on the staff bridge (rule 2b, R0-13g)',
  structure_find_person: 'StructureService.findPeople backs no route',
};

/** Why the derivation leaves a tool ungranted, in the words UNGRANTED uses. */
function ungrantedKind(d: Derivation, calls: Map<string, string[]>, tool: string): 'no service call' | 'no route' | 'unscoped' | 'split' | 'floor' {
  const cs = calls.get(tool) ?? [];
  if (!cs.length) return 'no service call';
  if ((d.toolLevels.get(tool)?.size ?? 0) > 1) return 'split';
  if ((d.toolLevels.get(tool)?.size ?? 0) === 1 && (d.unknownCalls.get(tool) ?? []).length) return 'floor';
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

  it('every @Controller class is read with its own prefix and guards, wherever it sits in its file (guards the guard)', () => {
    // a body DTO declared before the controller (R0-13e, R0-13f) is not the controller
    for (const file of ['modules/crm/crm.controller.ts', 'modules/crm/crm-deals.controller.ts']) {
      const src = read(file);
      expect(src.search(/^export class /m), file).toBeLessThan(src.search(/^@Controller\(/m));
      const rs = routes.filter((r) => r.file === file);
      expect(rs.length, file).toBeGreaterThan(10);
      expect(rs.filter((r) => !r.path.startsWith('/crm/')).map((r) => `${r.verb} ${r.path}`), file).toEqual([]);
      expect(rs.filter((r) => r.scope).length, file).toBeGreaterThan(10);
    }
    // two controllers in one file keep their own prefixes and class guards
    const flags = routes.filter((r) => r.file === 'modules/feature-flags/feature-flags.controller.ts');
    expect(flags.map((r) => `${r.verb} ${r.path} ${r.authGuard}`).sort()).toEqual(
      ['GET /api/admin/feature-flags true', 'GET /api/feature-flags true', 'PUT /api/admin/feature-flags/:key true'].sort(),
    );
    // every @Controller decorator in the app is a class the parser reads
    for (const file of controllerFiles(join(SRC, 'modules'))) {
      const src = readFileSync(file, 'utf8');
      expect(controllerClasses(src).length, relative(SRC, file)).toBe((src.match(/^@Controller\(/gm) ?? []).length);
    }
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
    // commerce_send_invoice: review 7 DRV5-2 (TransactionalEmailService.send backs no member route to a customer)
    // procurement_acknowledge_vendor / mark_fulfilled / mark_invoiced: governed by operations since D-40
    // (R0-13g), but each dispatcher call updates the request by its bare id (rule 2b), so the route is only a floor
    expect(derived.governedUngranted).toEqual([
      'commerce_send_invoice',
      'execute_custom_logic',
      'procurement_acknowledge_vendor',
      'procurement_mark_fulfilled',
      'procurement_mark_invoiced',
      'send_message_with_approval',
      'update_status_with_confirmation',
    ]);
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
        // commerce_send_invoice: GOVERNED_UNGRANTED (review 7 DRV5-2)
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
        // command_* and procurement_*: D-40 put the command-centre item and procurement routes
        // under operations (R0-13g-OPS-SCOPE-COMMAND-PROCUREMENT)
        command_discharge_obligation: 'write',
        command_list_due_obligations: 'read',
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
        // GET brief calls generateBrief only on a cache miss; POST brief/generate needs write (review 7 DRV-BRIEF)
        inbox_brief: 'write',
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
        // procurement_acknowledge_vendor, procurement_mark_fulfilled, procurement_mark_invoiced:
        // GOVERNED_UNGRANTED (rule 2b: each updates the request by its bare id, R0-13g)
        procurement_create_request: 'write',
        procurement_get_request: 'read',
        procurement_get_stats: 'read',
        procurement_issue_po: 'write',
        procurement_list_requests: 'read',
        procurement_list_suppliers: 'read',
        procurement_select_vendor: 'write',
        procurement_submit_for_review: 'write',
        procurement_update_request: 'write',
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
    /** Every CrmService member, private helpers included (what `this.x(` can call). */
    const ownMembers = new Set([...crm.matchAll(/^ {2}(?:private |public |protected )?(?:async )?([a-zA-Z]+)\s*[(<]/gm)].map((m) => m[1]));
    /**
     * A method is gated when its body reads the scope, or when it calls an own-class method that
     * is (followed through private helpers). createContact and findOrCreateContact reach crm_edit
     * through assertCanCreateContacts, and since R0-13c (review CR-1) updateContact reaches it
     * through assertCanEditContact, the one contact-level edit check it shares with the
     * enrichment route. The rule read the bodies alone, with assertCanCreateContacts listed by
     * hand: on the current code that dropped updateContact, and with it crm_update_contact and
     * tag_contact, from the crm_edit list.
     */
    const reachesGate = (re: RegExp, m: string, seen = new Set<string>()): boolean => {
      if (seen.has(m)) return false;
      seen.add(m);
      const body = memberBody(crm, m) ?? '';
      if (re.test(body)) return true;
      return [...body.matchAll(/this\.([a-zA-Z0-9_$]+)\s*\(/g)].some(([, c]) => c !== m && ownMembers.has(c) && reachesGate(re, c, seen));
    };
    const gated = (re: RegExp) => new Set(methods.filter((m) => reachesGate(re, m)).map((m) => `CrmService.${m}`));
    const editGated = gated(/access\.editScope/);
    const deleteGated = gated(/access\.deleteScope/);
    const cases = dispatcherCases();
    const SUB = ((policyModule as Record<string, unknown>).CRM_SUBPERMISSION_TOOLS ?? {}) as Record<string, readonly string[]>;
    const grantedCalling = (set: Set<string>) =>
      Object.keys(derived.mapping.crm)
        .filter((t) => (calls.get(t) ?? []).some((c) => set.has(c)))
        .sort();

    it('the gated service methods are the ones resolveCrmAccess bounds over HTTP', () => {
      expect([...editGated].sort()).toEqual(
        [
          'CrmService.assertCanCreateContacts',
          'CrmService.assertCanEditContact',
          'CrmService.bulkUpdateContacts',
          'CrmService.createContact',
          'CrmService.findOrCreateContact',
          'CrmService.updateContact',
        ].sort(),
      );
      expect([...deleteGated].sort()).toEqual(['CrmService.bulkDeleteContacts', 'CrmService.softDeleteContact']);
    });

    it('updateContact is gated through assertCanEditContact, which refuses an edit scope of none before the contact is read or written', () => {
      const update = memberBody(crm, 'updateContact')!;
      // the gate is not in its own body any more: only the helper reads editScope
      expect(update).not.toMatch(/access\.editScope/);
      const check = update.indexOf('await this.assertCanEditContact(input.businessId, input.contactId, input.actorUserId);');
      expect(check).toBeGreaterThan(-1);
      expect(check).toBeLessThan(update.indexOf('tx.contact.update('));
      const helper = memberBody(crm, 'assertCanEditContact')!;
      expect(helper).toMatch(/const access = await resolveCrmAccess\(this\.prisma, businessId, actorUserId\);/);
      expect(helper).toMatch(/if \(access\.editScope === 'none'\) \{\s*throw new ForbiddenException\('You do not have permission to edit contacts'\);/);
      expect(helper).toMatch(/if \(access\.editScope === 'owned'\) \{/);
      // without an actor (the dispatcher passes none) it checks nothing: the grant has to
      expect(helper).toMatch(/if \(!actorUserId\) return \{ access: null, reachableWhere \};/);
      expect(cases.get('crm_update_contact'), 'crm_update_contact').not.toMatch(/actorUserId/);
    });

    it('CRM_SUBPERMISSION_TOOLS lists exactly the granted tools that call them', () => {
      expect([...(SUB.crm_edit ?? [])].sort()).toEqual(grantedCalling(editGated));
      expect([...(SUB.crm_delete ?? [])].sort()).toEqual(grantedCalling(deleteGated));
      expect(grantedCalling(editGated)).toEqual(['crm_create_contact', 'crm_update_contact', 'tag_contact']);
      expect(grantedCalling(deleteGated)).toEqual(['crm_delete_contact']);
    });
  });

  /**
   * Review 4 DRV-1: the sub-permissions are not the only actor check. With an actor, a
   * service method that ANDs visibilityClause onto the row it reaches keeps another
   * member's PRIVATE contact out for every member but the OWNER, whatever crm_view says;
   * the dispatcher passes no actor. A tool is row-visibility-bound when one of its calls,
   * followed through the services and own-class helpers it calls, reaches visibilityClause(.
   */
  describe('review 4 DRV-1 — the tools whose service bounds the row by visibilityClause', () => {
    const crm = read('modules/crm/crm.service.ts');
    const cases = dispatcherCases();
    /**
     * Reviewed: methods that read the clause only to decide what a refusal names, not which
     * row is written. Asserted below.
     */
    const ERROR_ONLY: Record<string, string> = {
      'CrmService.rejectContactIdentityTaken':
        'names the holder of a 409 (existingContactId) only when the actor sees it; executeTool returns error.message alone',
    };
    const reachesClause = (call: string, seen = new Set<string>()): boolean => {
      if (call in ERROR_ONLY || seen.has(call)) return false;
      seen.add(call);
      const sm = serviceMethod(call);
      if (!sm) return false;
      return /\bvisibilityClause\(/.test(sm.body) || serviceDelegates(call).some((d) => reachesClause(d, seen));
    };
    const grantedTools = Object.entries(derived.mapping).flatMap(([, tools]) => Object.entries(tools) as Array<[string, Level]>);
    const bound = grantedTools.filter(([t]) => (calls.get(t) ?? []).some((c) => reachesClause(c)));
    const writes = bound.filter(([, l]) => l !== 'read').map(([t]) => t).sort();
    const reads = bound.filter(([, l]) => l === 'read').map(([t]) => t).sort();
    const ROW = ((policyModule as Record<string, unknown>).CRM_ROW_VISIBILITY_TOOLS ?? []) as readonly string[];

    it('the CrmService methods that call visibilityClause themselves', () => {
      const methods = [...crm.matchAll(/^ {2}(?:private |public )?(?:async )?([a-zA-Z]+)\(/gm)].map((m) => m[1]);
      const direct = [...new Set(methods.filter((m) => /\bvisibilityClause\(/.test(memberBody(crm, m) ?? '')))].sort();
      // R0-13c (review CR-1) moved updateContact's clause into assertCanEditContact, the check it
      // shares with the enrichment route; updateContact reaches it through that helper (below)
      expect(direct).toEqual(
        ['assertCanEditContact', 'bulkDeleteContacts', 'editableContactClause', 'listContacts', 'reassignContacts', 'rejectContactIdentityTaken', 'softDeleteContact'].sort(),
      );
    });

    it('updateContact still bounds the row it reads and writes by the clause, through assertCanEditContact', () => {
      expect(serviceDelegates('CrmService.updateContact')).toContain('CrmService.assertCanEditContact');
      expect(reachesClause('CrmService.updateContact')).toBe(true);
      const helper = memberBody(crm, 'assertCanEditContact')!;
      expect(helper).toMatch(/const visClause = visibilityClause\(access, actorUserId\);\s*if \(visClause\) reachableWhere\.AND = \[visClause\];/);
      expect(helper).toMatch(/return \{ access, reachableWhere \};/);
      const update = memberBody(crm, 'updateContact')!;
      expect(update).toMatch(/const \{ access, reachableWhere \} = await this\.assertCanEditContact\(/);
      // the row it locks and writes is the one the clause bounds
      expect(update).toMatch(/tx\.contact\.findFirst\(\{\s*where: reachableWhere,/);
    });

    it('CRM_ROW_VISIBILITY_TOOLS is exactly the granted write tools whose service reaches the clause', () => {
      expect(writes).toEqual(['crm_delete_contact', 'crm_update_contact', 'tag_contact']);
      expect([...ROW].sort()).toEqual(writes);
    });

    it('the read tools it bounds are the accepted read follow-up (KEY CRM / calendar reads apply no row visibility)', () => {
      expect(reads).toEqual(['calendar_list_events', 'crm_list_contacts', 'crm_search_contacts']);
    });

    it('the dispatcher passes them no actor, so the clause never runs on the KEY path', () => {
      for (const t of writes) {
        expect(cases.get(t), t).toBeDefined();
        expect(cases.get(t), t).not.toMatch(/actorUserId|actorId|userId/);
      }
    });

    it('ERROR_ONLY is what it says: the clause names the 409 holder only, and KEY returns error.message alone', () => {
      const body = memberBody(crm, 'rejectContactIdentityTaken')!;
      expect(body).toMatch(/const visClause = visibilityClause\(access, actorUserId\);/);
      expect(body).toMatch(/existing = await this\.prisma\.client\.contact\.findFirst\(\{ where, select: \{ id: true \} \}\);/);
      expect(body).toMatch(/existingContactId: existing\?\.id \?\? null/);
      // it never writes
      expect(body).not.toMatch(/\.(update|create|delete|upsert)(Many)?\(/);
      for (const caller of ['createContact', 'updateContact']) {
        expect(memberBody(crm, caller), caller).toMatch(/\.catch\(\(err: unknown\) => this\.rejectContactIdentityTaken\(/);
      }
      const executeTool = memberBody(read(ORCHESTRATOR), 'executeTool')!;
      expect(executeTool).toContain('error: (error as Error).message,');
      expect(executeTool).not.toMatch(/getResponse\(\)|existingContactId/);
    });
  });

  /**
   * Review 7 DRV-BRIEF / DRV5-1: GET /key-inbox/.../brief calls KeyInboxService.generateBrief
   * only when listInsights finds no brief (`if (insights.length > 0) return insights[0]`), so
   * a read holder cannot make a new brief by hand; POST brief/generate, which always does,
   * needs operations:write. The organ handler KEY reaches (key_inbox.generate_brief) generates
   * every time: a new KeyInboxInsight row, a metered AI call, a temporal event, and the brief
   * GET then serves the whole team. The derivation took the lowest level among every route
   * that calls the method and so granted inbox_brief at operations:read.
   */
  describe('review 7 DRV-BRIEF / DRV5-1 — a route that calls a method only on a cache miss does not lower its level', () => {
    const relevant = new Set([...calls.values()].flat());
    const brief = (verb: string, path: string) =>
      routes.find((r) => r.file === 'modules/key-inbox/key-inbox.controller.ts' && r.verb === verb && r.path === `/key-inbox/businesses/:businessId/${path}`)!;

    it('reads which calls of a KEY tool method a handler makes only under a guard on server state (pinned: a new one is a reviewed change)', () => {
      const guarded = routes
        .flatMap((r) => [...r.guarded].filter(([c]) => relevant.has(c)).map(([c, guard]) => `${r.verb} ${r.path} ${c} <- ${guard}`))
        .sort();
      expect(guarded).toEqual(
        [
          'POST /actions/businesses/:businessId/plan BusinessGraphService.getSnapshot <- after if (intent.clarificationNeeded) return',
          'POST /businesses/:businessId/contacts/:contactId/calls/from-next-action CallScriptService.generateScript <- if (body.autoGenerateScript && callLog.contactId)',
          "POST /commerce/businesses/:businessId/invoices/:invoiceId/send-email CommerceService.updateInvoiceStatus <- if (invoice.status === 'DRAFT')",
          'POST /drive/businesses/:businessId/email-content TransactionalEmailService.send <- after if (!user || !user.email) return',
          'GET /key-inbox/businesses/:businessId/brief KeyInboxService.generateBrief <- after if (insights.length > 0) return',
          'POST /webhooks/stripe CommerceService.markInvoicePaid <- if (invoiceId)',
        ].sort(),
      );
    });

    it('GET brief generates only when no brief exists, POST brief/generate always: inbox_brief needs operations:write', () => {
      const get = brief('GET', 'brief');
      const post = brief('POST', 'brief/generate');
      expect(get.scope).toBe('operations:read');
      expect(post.scope).toBe('operations:write');
      expect(get.body).toMatch(/const insights = await this\.keyInbox\.listInsights\(businessId, scope, 1\);\s*if \(insights\.length > 0\) return insights\[0\];/);
      expect(get.guarded.get('KeyInboxService.generateBrief')).toBe('after if (insights.length > 0) return');
      expect(post.guarded.has('KeyInboxService.generateBrief')).toBe(false);
      expect((derived.byMethod.get('KeyInboxService.generateBrief') ?? []).map((r) => `${r.verb} ${r.path} ${r.scope}`)).toEqual([
        'POST /key-inbox/businesses/:businessId/brief/generate operations:write',
      ]);
      expect(calls.get('inbox_brief')).toEqual(['KeyInboxService.generateBrief']);
      expect([...derived.toolLevels.get('inbox_brief')!]).toEqual([['operations', 'write']]);
      expect(derived.mapping.operations.inbox_brief).toBe('write');
      expect(CANONICAL_MODULE_TOOLS?.operations.inbox_brief).toBe('write');
    });

    it('drift guard: were GET brief to generate unconditionally, operations:read would grant inbox_brief (the rule is what decides)', () => {
      const unguarded = routes.map((r) => (r === brief('GET', 'brief') ? { ...r, guarded: new Map<string, string>() } : r));
      expect(derive(calls, unguarded).mapping.operations.inbox_brief).toBe('read');
    });

    it('a method only state-guarded routes call is governed by them but granted by none', () => {
      const onlyGuarded = routes.map((r) => (r === brief('POST', 'brief/generate') ? { ...r, calls: new Set<string>() } : r));
      const d = derive(calls, onlyGuarded);
      expect([...d.toolLevels.get('inbox_brief')!]).toEqual([['operations', 'read']]);
      expect(d.unknownCalls.get('inbox_brief')).toEqual(['KeyInboxService.generateBrief']);
      expect(d.mapping.operations.inbox_brief).toBeUndefined();
      expect(d.governedUngranted).toContain('inbox_brief');
    });

    it("a branch on the caller's own input is not a guard: GET payments/transactions (if (q)) still grants the read tools at revenue:read", () => {
      const tx = routes.find((r) => r.file === 'modules/payments/payments-ops.controller.ts' && r.verb === 'GET' && r.path === '/payments/businesses/:businessId/transactions')!;
      expect(tx.body).toMatch(/if \(q\) return this\.ops\.searchCharges\(/);
      expect(tx.guarded.size).toBe(0);
      expect(derived.mapping.revenue.payments_list_transactions).toBe('read');
      expect(derived.mapping.revenue.payments_search_transactions).toBe('read');
    });

    it('an early throw is a refusal, not an alternative: it does not guard the calls after it', () => {
      const g = stateGuardedCalls(
        `  async m(@Param('id') id: string) {\n    const row = await this.svc.get(id);\n    if (!row) throw new NotFoundException();\n    return this.svc.update(row);\n  }`,
        new Map([['svc', 'Svc']]),
      );
      expect([...g]).toEqual([]);
      const cached = stateGuardedCalls(
        `  async m(@Param('id') id: string) {\n    const row = await this.svc.get(id);\n    if (row) return row;\n    return this.svc.make(id);\n  }`,
        new Map([['svc', 'Svc']]),
      );
      expect([...cached]).toEqual([['Svc.make', 'after if (row) return']]);
    });

    it('the handler is what the derivation reads: with a brief cached, GET returns it and generates nothing; POST and the KEY organ generate every time', async () => {
      const cached = { id: 'ins_old', scope: 'DAILY' };
      const make = (insights: unknown[]) => {
        const inbox = { listInsights: vi.fn(async () => insights), generateBrief: vi.fn(async () => ({ id: 'ins_new' })) };
        return { inbox, controller: new KeyInboxController(inbox as any, {} as any, {} as any, {} as any) };
      };
      const withBrief = make([cached]);
      expect(await withBrief.controller.getBrief('biz_1', 'DAILY')).toBe(cached);
      expect(await withBrief.controller.getBrief('biz_1', 'DAILY')).toBe(cached);
      expect(withBrief.inbox.generateBrief).not.toHaveBeenCalled();
      const empty = make([]);
      expect(await empty.controller.getBrief('biz_1', 'DAILY')).toEqual({ id: 'ins_new' });
      expect(empty.inbox.generateBrief).toHaveBeenCalledTimes(1);
      await withBrief.controller.generateBrief('biz_1', {});
      expect(withBrief.inbox.generateBrief).toHaveBeenCalledTimes(1);

      const organ = Object.assign(Object.create(KeyInboxAdapterService.prototype), { inbox: withBrief.inbox }) as KeyInboxAdapterService;
      expect(CORTEX_TOOL_BRIDGE.inbox_brief).toBe('key_inbox.generate_brief');
      await organ.executeTool('key_inbox.generate_brief', { businessId: 'biz_1' } as any, {});
      await organ.executeTool('key_inbox.generate_brief', { businessId: 'biz_1' } as any, {});
      expect(withBrief.inbox.generateBrief).toHaveBeenCalledTimes(3);
    });
  });

  /**
   * Review 7 DRV5-2: the derivation counted POST /drive/.../email-content, which mails the
   * caller a fixed 'document_generated' notice, as an unscoped route to
   * TransactionalEmailService.send, so the send was FREE and commerce_send_invoice was granted
   * through updateInvoiceStatus (revenue:write) alone. KEY mails the customer the 'invoice_sent'
   * pay link before the status change and never checks for VOID; the only route that mails an
   * invoice by hand (send-email) refuses a VOID one.
   */
  describe('review 7 DRV5-2 — commerce_send_invoice mails a customer, which no member route does through the same call', () => {
    it.each(ARGUMENT_BOUND)('$verb $path calls $call with arguments it fixes ($why)', ({ file, verb, path, call, proof }) => {
      const hit = routes.find((r) => r.file === file && r.verb === verb && r.path === path);
      expect(hit, `${verb} ${path}`).toBeDefined();
      expect(hit!.calls.has(call)).toBe(true);
      for (const p of proof) expect(hit!.body, String(p)).toMatch(p);
      // no other member route calls the same method
      expect((derived.byMethod.get(call) ?? []).map((r) => `${r.verb} ${r.path}`)).toEqual([]);
      expect((derived.guardedBy.get(call) ?? []).map((r) => `${r.verb} ${r.path}`)).toEqual([]);
    });

    it("commerce_send_invoice mails the invoice's customer an invoice_sent pay link, and is governed by revenue but granted by none", () => {
      const body = dispatcherCases().get('commerce_send_invoice')!;
      expect(body).toMatch(/this\.getTransactionalEmail\(\)\.send\(\{[\s\S]*type: 'invoice_sent',\s*recipientEmail: invoice\.contact\.email,/);
      // V1-46b: the pay link in that mail is the invoice's token link, built through the
      // dispatcher's customerInvoiceUrl helper by CommerceService.automatedInvoiceUrl (it never
      // mints a link for an invoice whose links were all revoked or expired). No member route
      // calls that method: the operator's send-email builds its link through publicInvoiceUrl.
      expect(body).toContain('const invoiceUrl = await this.customerInvoiceUrl(invoice.id, businessId);');
      expect(memberBody(read(ORCHESTRATOR), 'customerInvoiceUrl')).toContain('await this.getCommerce().automatedInvoiceUrl(invoiceId, businessId)');
      expect(derived.byMethod.get('CommerceService.automatedInvoiceUrl') ?? []).toEqual([]);
      expect(derived.guardedBy.get('CommerceService.automatedInvoiceUrl') ?? []).toEqual([]);
      expect(calls.get('commerce_send_invoice')!.sort()).toEqual(
        ['ActivityLogService.createActivity', 'CommerceService.automatedInvoiceUrl', 'CommerceService.updateInvoiceStatus', 'TransactionalEmailService.send'].sort(),
      );
      expect([...derived.toolLevels.get('commerce_send_invoice')!]).toEqual([['revenue', 'write']]);
      expect([...derived.unknownCalls.get('commerce_send_invoice')!].sort()).toEqual(['CommerceService.automatedInvoiceUrl', 'TransactionalEmailService.send']);
      expect(granted.get('commerce_send_invoice')).toBeUndefined();
      expect(GOVERNED_UNGRANTED.commerce_send_invoice).toMatch(/TransactionalEmailService\.send/);
    });

    it('drift guard: without the pay-link lookup (the review 7 shape), the customer mail alone still keeps it ungranted', () => {
      const noLink = new Map(calls).set(
        'commerce_send_invoice',
        calls.get('commerce_send_invoice')!.filter((c) => c !== 'CommerceService.automatedInvoiceUrl'),
      );
      const d = derive(noLink, routes);
      expect(d.unknownCalls.get('commerce_send_invoice')).toEqual(['TransactionalEmailService.send']);
      expect(d.mapping.revenue.commerce_send_invoice).toBeUndefined();
      expect(d.governedUngranted).toContain('commerce_send_invoice');
    });

    it('drift guard: even were the drive route to send unconditionally, it does not stand in for mailing a customer', () => {
      const unguarded = routes.map((r) => (r.path === '/drive/businesses/:businessId/email-content' ? { ...r, guarded: new Map<string, string>() } : r));
      const d = derive(calls, unguarded);
      expect(d.mapping.revenue.commerce_send_invoice).toBeUndefined();
      expect(d.governedUngranted).toContain('commerce_send_invoice');
    });
  });

  /**
   * Review 8 DD8-1: call_log_outcome, call_schedule_followup and call_generate_script, which
   * crm:write grants, completed another business's call log, planted a task in its CRM and read
   * its contact into a call script over the WhatsApp staff bridge. The dispatcher passed bare ids
   * (completeCall(callLogId), createFollowUpTask(callLogId)) and CallScriptService looked both
   * rows up by findUnique({ id }). The governing routes pass only callId as well: what keeps them
   * in the tenant is the Prisma tenant extension, which TenantInterceptor arms for an
   * authenticated HTTP request. The bridge runs inside a provider webhook, with no tenant context,
   * so the derivation took a route call bound by the ambient tenant for a dispatcher call bound
   * by nothing (rule 2b).
   */
  describe('review 8 DD8-1 — a route call bound only by the ambient tenant does not stand in for a dispatcher call made with none', () => {
    const TENANT_UNBOUND = ((policyModule as Record<string, unknown>).TENANT_UNBOUND_TOOLS ?? {}) as Record<string, string>;

    it('reads the models the tenant extension scopes from packages/db, and the extension binds only while a tenant is live (guards the guard)', () => {
      expect(TENANT_MODELS.size).toBeGreaterThan(300);
      for (const m of ['callLog', 'contact', 'contactTask', 'asset', 'contentRequest', 'procurementRequest', 'staffMember']) expect(TENANT_MODELS.has(m), m).toBe(true);
      for (const m of ['user', 'business']) expect(TENANT_MODELS.has(m), m).toBe(false);
      const db = readFileSync(DB_CLIENT, 'utf8');
      expect(db).toMatch(/return !!businessId && BUSINESS_ID_MODELS\.has\(model\);/);
      expect(db).toMatch(/return _tenantContextProvider\?\.getCurrentBusinessId\(\);/);
    });

    it('the staff bridge runs the dispatcher with no tenant context: its webhooks run no AuthGuard, and TenantInterceptor arms a tenant only for a user', () => {
      for (const path of ['/whatsapp/webhook', '/whatsapp/webhook/:businessId', '/communications/inbound/sms']) {
        const hit = routes.find((r) => r.verb === 'POST' && r.path === path);
        expect(hit, path).toBeDefined();
        expect(hit!.authGuard, path).toBe(false);
      }
      expect(read('core/tenant/tenant.interceptor.ts')).toMatch(/if \(!userId \|\| !namesTenant\) \{\s*return next\.handle\(\);/);
      // and the bridge does not arm one itself: its holder is known by the phone only, and the
      // ambient user is read as an authenticated actor (onboarding completion, cortex audit)
      expect(read('modules/structure/staff-chat-bridge.service.ts')).not.toMatch(/runWithTenant/);
    });

    describe('the rule, on handlers written to its shape', () => {
      const SYN = [
        'export class SynService {',
        '  constructor(private readonly prisma: PrismaService) {}',
        '',
        '  async bare(id: string, input: { outcome: string }) {',
        '    const row = await this.prisma.client.callLog.findUnique({ where: { id } });',
        '    return this.prisma.client.callLog.update({ where: { id }, data: { outcome: input.outcome } });',
        '  }',
        '',
        '  async bound(businessId: string, id: string) {',
        '    const row = await this.prisma.client.callLog.findFirst({ where: { id, businessId } });',
        '    return this.prisma.client.callLog.update({ where: { id }, data: {} });',
        '  }',
        '',
        '  async compared(businessId: string, id: string) {',
        '    const row = await this.prisma.client.callLog.findUnique({ where: { id } });',
        '    if (!row || row.businessId !== businessId) {',
        "      throw new NotFoundException('Call log not found');",
        '    }',
        '    return row;',
        '  }',
        '',
        '  async viaHelper(id: string) {',
        '    return this.load(id);',
        '  }',
        '',
        '  async load(id: string) {',
        '    return this.prisma.client.callLog.findUnique({ where: { id } });',
        '  }',
        '',
        '  async picksKey(input: { businessId: string; title: string; assigneeId?: string }) {',
        '    return this.prisma.client.staffMember.findUnique({ where: { id: input.assigneeId } });',
        '  }',
        '',
        '  async rowItRead(businessId: string, id: string) {',
        '    const booking = await this.prisma.client.booking.findFirst({ where: { id, businessId } });',
        '    return this.prisma.client.service.findUnique({ where: { id: booking.serviceId } });',
        '  }',
        '',
        '  async tenantFromInput(input: { businessId: string; id: string }) {',
        '    return this.prisma.client.callLog.findFirst({ where: { id: input.id, businessId: input.businessId } });',
        '  }',
        '',
        '  async notATenantModel(id: string) {',
        '    return this.prisma.client.user.findUnique({ where: { id } });',
        '  }',
        '',
        '  async optionalTenant(id: string, businessId?: string) {',
        '    return this.prisma.client.contentRequest.findFirst({ where: { id, businessId } });',
        '  }',
        '',
        '  async passesNoTenant(id: string) {',
        '    return this.optionalTenant(id);',
        '  }',
        '',
        '  async passesUndefinedTenant(id: string) {',
        '    return this.optionalTenant(id, undefined);',
        '  }',
        '',
        '  async passesTenant(businessId: string, id: string) {',
        '    return this.optionalTenant(id, businessId);',
        '  }',
        '',
        '  async optionalTenantKey(input: { id: string; businessId?: string }) {',
        '    return this.prisma.client.contentRequest.findFirst({ where: { id: input.id, businessId: input.businessId } });',
        '  }',
        '',
        '  async omitsTenantKey(id: string) {',
        '    return this.optionalTenantKey({ id });',
        '  }',
        '',
        '  async handsTenantKey(businessId: string, id: string) {',
        '    return this.optionalTenantKey({ id, businessId });',
        '  }',
        '',
        '  async destructuresTenant({ id, businessId }: { id: string; businessId?: string }) {',
        '    return this.prisma.client.contentRequest.findFirst({ where: { id, businessId } });',
        '  }',
        '',
        '  async omitsDestructuredTenant(id: string) {',
        '    return this.destructuresTenant({ id });',
        '  }',
        '}',
      ].join('\n');
      SYNTHETIC_CLASSES.set('SynService', SYN);
      const ambientOf = (method: string, seeds: Seed[]) =>
        ambientCalls(new Map([['t', methodTouches(`SynService.${method}`, seeds, new Set(), `SynService.${method}`)]])).get('t') ?? [];

      it.each<[string, string, Seed[], boolean]>([
        ['a bare id the model chose is AMBIENT-BOUND', 'bare', [true, new Set(['outcome'])], true],
        ['a where that names the business binds the row (and the write after it)', 'bound', [false, true], false],
        ["a comparison of the row's businessId, then a refusal, binds it", 'compared', [false, true], false],
        ['an own-class helper that reaches the row by the bare id is followed', 'viaHelper', [true], true],
        ['a key the caller does not hand over is not chosen', 'picksKey', [new Set(['businessId', 'title'])], false],
        ['a key the caller does hand over is', 'picksKey', [new Set(['title', 'assigneeId'])], true],
        ['an id read from a row the method bound is bound by that read', 'rowItRead', [false, true], false],
        ['a tenant the model chose binds nothing', 'tenantFromInput', [new Set(['businessId', 'id'])], true],
        ['...while the tenant its caller gave does', 'tenantFromInput', [new Set(['id'])], false],
        ['a model the extension does not scope is not this rule (HTTP binds it no better)', 'notATenantModel', [true], false],
        // review 9 TD9-5: Prisma drops `businessId: undefined`, so a where whose businessId its
        // caller never handed over names no business at all
        ['a businessId parameter no caller hands over binds nothing', 'optionalTenant', [true], true],
        ['...nor through the own-class helper that leaves it out', 'passesNoTenant', [true], true],
        ['...nor one handed over as `undefined`', 'passesUndefinedTenant', [true], true],
        ['...while the business its caller hands over does', 'passesTenant', [false, true], false],
        ['a businessId key the caller leaves out of the object it hands over binds nothing', 'omitsTenantKey', [true], true],
        ['...while the key it puts in does', 'handsTenantKey', [false, true], false],
        ['a destructured businessId the caller leaves out binds nothing', 'omitsDestructuredTenant', [true], true],
      ])('%s', (_label, method, seeds, isAmbient) => {
        expect(ambientOf(method, seeds)).toEqual(isAmbient ? [`SynService.${method}`] : []);
      });
    });

    it('no granted tool reaches a tenant row by an id the model chose without binding it to the business KEY acts in', () => {
      const offenders = [...AMBIENT].filter(([t]) => granted.has(t)).map(([t, cs]) => `${t}: ${cs.join(', ')}`);
      expect(offenders).toEqual([]);
    });

    it('the call tools hand CallLogService / CallScriptService the business, and both look the rows up within it', () => {
      const cases = dispatcherCases();
      expect(cases.get('call_log_outcome')).toMatch(/this\.getCallLog\(\)\.completeCall\(businessId, args\.callLogId, \{/);
      expect(cases.get('call_schedule_followup')).toMatch(/this\.getCallLog\(\)\.createFollowUpTask\(businessId, args\.callLogId, \{/);
      expect(cases.get('call_generate_script')).toMatch(/this\.getCallScript\(\)\.generateScript\(businessId, args\.callLogId, args\.contactId\)/);
      const callLog = read('modules/call-tasks/call-log.service.ts');
      expect(memberBody(callLog, 'getCallLog')).toMatch(/this\.prisma\.client\.callLog\.findFirst\(\{\s*where: \{ id, businessId \},/);
      expect(memberBody(callLog, 'completeCall')).toMatch(/await this\.getCallLog\(businessId, id\);/);
      expect(memberBody(callLog, 'createFollowUpTask')).toMatch(/await this\.getCallLog\(businessId, callLogId\);/);
      const script = memberBody(read('modules/call-tasks/call-script.service.ts'), 'generateScript')!;
      expect(script).toMatch(/this\.prisma\.client\.contact\.findFirst\(\{\s*where: \{ id: contactId, businessId \},/);
      expect(script).toMatch(/this\.prisma\.client\.callLog\.findFirst\(\{\s*where: \{ id: callLogId, businessId \},/);
      for (const t of ['call_log_outcome', 'call_schedule_followup', 'call_generate_script']) {
        expect(AMBIENT.has(t), t).toBe(false);
        expect(derived.mapping.crm[t], t).toBe('write');
      }
    });

    it('drift guard: a dispatcher call that reaches the row by a bare id again is only a floor (crm:write would not grant it)', () => {
      const d = derive(calls, routes, new Map([...AMBIENT, ['call_log_outcome', ['CallLogService.completeCall']]]));
      expect([...d.toolLevels.get('call_log_outcome')!]).toEqual([['crm', 'write']]);
      expect(d.unknownCalls.get('call_log_outcome')).toEqual(['CallLogService.completeCall']);
      expect(d.mapping.crm.call_log_outcome).toBeUndefined();
      expect(d.governedUngranted).toContain('call_log_outcome');
    });

    it("assets_* reach AssetService by a bare id only after the dispatcher proved the asset is the business's (assetWithinBusiness)", () => {
      const cases = dispatcherCases();
      expect(memberBody(read(ORCHESTRATOR), 'assetWithinBusiness')).toMatch(COMPARES_TENANT);
      const proofless = ambientCalls(dispatcherTouches({ ignoreProofs: true }));
      for (const [t, call] of [
        ['assets_tag', 'AssetService.tagAsset'],
        ['assets_untag', 'AssetService.untagAsset'],
        ['assets_update', 'AssetService.updateAsset'],
        ['assets_delete', 'AssetService.deleteAsset'],
      ]) {
        expect(cases.get(t), t).toContain('this.assetWithinBusiness(businessId, args.assetId)');
        expect(AMBIENT.has(t), t).toBe(false);
        expect(proofless.get(t), t).toEqual([call]);
      }
    });

    it('the tenant rows each AMBIENT-BOUND tool reaches by an id the model chose (pinned: a change here is a reviewed change)', () => {
      const rows: string[] = [];
      for (const [tool, vias] of AMBIENT) {
        for (const via of vias) {
          const first = new Map<string, Touch>();
          for (const t of DISPATCHER_TOUCHES.get(tool)!) if (t.via === via && !first.has(t.model)) first.set(t.model, t);
          for (const t of first.values()) if (!t.bound) rows.push(`${tool} -> ${via} -> ${t.model}.${t.op}`);
        }
      }
      expect(rows.sort()).toEqual(
        [
          'approval_decide_step -> ApprovalRequestService.decideStep -> approvalRequest.findFirst',
          'bookings_offer_waitlist_slot -> BookingWaitlistService.offerSlot -> bookingWaitlistEntry.findFirst',
          'content_assign_request -> ContentRequestService.assignRequest -> contentRequest.findUnique',
          'content_deliver_request -> ContentRequestService.deliverRequest -> contentRequest.findUnique',
          'content_get_request -> ContentRequestService.getById -> contentRequest.findUnique',
          'content_submit_for_review -> ContentRequestService.submitForReview -> contentRequest.findUnique',
          'content_transition_status -> ContentRequestService.transitionStatus -> contentRequest.findUnique',
          'content_upload_deliverables -> ContentRequestService.uploadDeliverables -> contentRequest.findUnique',
          'evidence_verify -> EvidenceService.verify -> evidence.findFirst',
          'people_assign_task -> TaskAssignmentService.assign -> contactTask.findUnique',
          'people_assign_task -> TaskAssignmentService.assign -> projectTask.findUnique',
          'people_assign_task -> TaskAssignmentService.assign -> staffMember.findUnique',
          'procurement_acknowledge_vendor -> ProcurementService.acknowledgeVendor -> procurementRequest.update',
          'procurement_mark_fulfilled -> ProcurementService.markFulfilled -> procurementRequest.update',
          'procurement_mark_invoiced -> ProcurementService.markInvoiced -> procurementRequest.update',
          'projects_update_task -> ProjectsService.updateTask -> staffMember.findUnique',
        ].sort(),
      );
    });

    it('TENANT_UNBOUND_TOOLS is exactly the ungoverned tools with an AMBIENT-BOUND call: no key reaches them, the legacy families and the baseline included', () => {
      const ungoverned = [...AMBIENT.keys()].filter((t) => (derived.toolLevels.get(t)?.size ?? 0) === 0).sort();
      const governed = [...AMBIENT.keys()].filter((t) => (derived.toolLevels.get(t)?.size ?? 0) > 0).sort();
      // a governed one is GOVERNED_UNGRANTED by rule 4 instead: the three procurement transitions since
      // D-40 put their routes under operations (R0-13g)
      expect(governed).toEqual(['procurement_acknowledge_vendor', 'procurement_mark_fulfilled', 'procurement_mark_invoiced']);
      for (const t of governed) {
        expect(derived.governedUngranted, t).toContain(t);
        expect(Object.keys(GOVERNED_UNGRANTED), t).toContain(t);
      }
      expect(Object.keys(TENANT_UNBOUND).sort()).toEqual(ungoverned);
      for (const [t, why] of Object.entries(TENANT_UNBOUND)) expect(why, t).toMatch(new RegExp(AMBIENT.get(t)![0].replace('.', '\\.')));
    });
  });

  /**
   * Review 9 TD9-5: the drift guard counted `where: { id, businessId }` as bound when no caller
   * handed businessId over (a parameter not passed seeded as "not the model's"), but Prisma drops
   * `businessId: undefined`, so that where names no business. The review's mutation: give
   * ContentRequestService.getById an optional businessId and pass it only from
   * content_get_request; the derivation then dropped the six content tools' AMBIENT rows while
   * assignRequest, deliverRequest, submitForReview, transitionStatus and uploadDeliverables still
   * called this.getById(requestId), which on a real database returns another business's row.
   *
   * TD9-1..4: rule 2b classifies where-by-id only. A model-chosen id written into create data as
   * a foreign key (a task's projectId, a call log's contactId, a booking's serviceId and staffId,
   * an invoice's or quote's contactId) is not a where, so it is pinned here at the sites the
   * review found: each is looked up within the business before anything is written
   * (test/staff-bridge-boundary.integration.test.ts proves them on a real database).
   */
  describe('review 9 — a businessId no caller handed over binds nothing; a chosen foreign key is checked before it is written', () => {
    it("TD9-5: the review's half-fix (an optional businessId on getById, passed by content_get_request only) leaves the five other content tools AMBIENT-BOUND", () => {
      const file = CLASS_FILES.get('ContentRequestService')!;
      const real = readFileSync(file, 'utf8');
      const mutated = real
        .replace('async getById(requestId: string) {', 'async getById(requestId: string, businessId?: string) {')
        .replace(/findUnique\(\{\s*where: \{ id: requestId \},/, 'findFirst({ where: { id: requestId, businessId },');
      expect(mutated).not.toBe(real);
      expect(memberBody(mutated, 'getById')).toMatch(/findFirst\(\{ where: \{ id: requestId, businessId \},/);
      SYNTHETIC_CLASSES.set('ContentRequestService', mutated);
      try {
        const ambientOf = (method: string, seeds: Seed[]) =>
          ambientCalls(new Map([['t', methodTouches(`ContentRequestService.${method}`, seeds, new Set(), `ContentRequestService.${method}`)]])).get('t') ?? [];
        // content_get_request, half-fixed: getById(args.requestId, businessId)
        expect(ambientOf('getById', [true, false])).toEqual([]);
        for (const method of ['assignRequest', 'deliverRequest', 'submitForReview', 'transitionStatus', 'uploadDeliverables']) {
          expect(memberBody(mutated, method), method).toMatch(/this\.(?:getById|transitionStatus)\(requestId\b/);
          expect(ambientOf(method, [true, true, true, true]), method).toEqual([`ContentRequestService.${method}`]);
        }
      } finally {
        SYNTHETIC_CLASSES.delete('ContentRequestService');
      }
    });

    it('TD9-1: ProjectsService.addTask finds the project within the business before the task is written', () => {
      const body = memberBody(read('modules/projects/projects.service.ts'), 'addTask')!;
      const lookup = body.search(/this\.prisma\.client\.project\.findFirst\(\{\s*where: \{ id: projectId, businessId, deletedAt: null \},/);
      expect(lookup).toBeGreaterThan(-1);
      expect(body.slice(lookup)).toMatch(/if \(!project\) throw new NotFoundException\('Project not found'\);/);
      expect(lookup).toBeLessThan(body.indexOf('projectTask.create'));
    });

    it("TD9-2: CallLogService checks a call log's contact within the business on create and update, and the call script reads only the business's own rows", () => {
      const src = read('modules/call-tasks/call-log.service.ts');
      expect(memberBody(src, 'assertContactInBusiness')).toMatch(/this\.prisma\.client\.contact\.findFirst\(\{\s*where: \{ id: contactId, businessId \},/);
      const create = memberBody(src, 'createCallLog')!;
      const createCheck = create.indexOf('await this.assertContactInBusiness(input.businessId, input.contactId);');
      expect(createCheck).toBeGreaterThan(-1);
      expect(createCheck).toBeLessThan(create.indexOf('callLog.create'));
      const update = memberBody(src, 'updateCallLog')!;
      const updateCheck = update.indexOf('await this.assertContactInBusiness(businessId, input.contactId);');
      expect(updateCheck).toBeGreaterThan(-1);
      expect(updateCheck).toBeLessThan(update.indexOf('callLog.update'));
      const script = memberBody(read('modules/call-tasks/call-script.service.ts'), 'generateScript')!;
      for (const rel of ['deals', 'invoices', 'bookings', 'tasks']) expect(script, rel).toMatch(new RegExp(`${rel}: \\{\\s*where: \\{ businessId[,\\s}]`));
    });

    /**
     * TD9-3 on V1-06's createBooking (the merge kept V1-06's version, which covers the service,
     * the contact, the staff member and the org unit): the service and the contact are looked up
     * within the business in createBooking itself, and the staff member and the org unit in
     * assertOwnedRefs, which createBooking hands its whole input before anything is written.
     */
    it('TD9-3: BookingsService.createBooking refuses a service, staff member, contact or unit outside the business before the booking is written', () => {
      const src = read('modules/bookings/bookings.service.ts');
      const body = memberBody(src, 'createBooking')!;
      // V1-16: the write runs inside claimSlot's transaction (advisory slot lock), after every check.
      const write = body.indexOf('this.claimSlot(slot, (tx) =>');
      expect(write).toBeGreaterThan(-1);
      expect(body.indexOf('tx.booking.create', write)).toBeGreaterThan(write);
      const before = (re: RegExp, label: string) => {
        const at = body.search(re);
        expect(at, label).toBeGreaterThan(-1);
        expect(at, label).toBeLessThan(write);
        return at;
      };
      const service = before(/this\.prisma\.client\.service\.findFirst\(\{\s*where: \{ id: input\.serviceId, businessId: input\.businessId, deletedAt: null \},/, 'service lookup');
      expect(before(/if \(!bookedService\) throw new NotFoundException\('Service not found'\);/, 'service refusal')).toBeGreaterThan(service);
      const contact = before(/const contactWhere: Prisma\.ContactWhereInput = \{ \.\.\.contactWhereWithId\(input\.businessId, input\.contactId\) \};/, 'contact where');
      expect(before(/this\.prisma\.client\.contact\.findFirst\(\{ where: contactWhere,/, 'contact lookup')).toBeGreaterThan(contact);
      before(/if \(!contact\) throw new NotFoundException\('Contact not found'\);/, 'contact refusal');
      expect(read('modules/crm/crm.helpers.ts')).toMatch(
        /export function contactWhereWithId\(businessId: string, contactId: string\) \{\s*return \{ id: contactId, businessId, deletedAt: null \} as const;/,
      );
      before(/await this\.assertOwnedRefs\(input\);/, 'assertOwnedRefs');
      const refs = memberBody(src, 'assertOwnedRefs')!;
      expect(refs).toMatch(
        /this\.prisma\.client\.staffMember\.findFirst\(\{\s*where: \{ id: params\.staffId, businessId: params\.businessId, deletedAt: null \},[\s\S]*?\}\);\s*if \(!staff\) throw new NotFoundException\('Staff member not found'\);/,
      );
      expect(refs).toMatch(
        /this\.prisma\.client\.orgUnit\.findFirst\(\{\s*where: \{ id: params\.orgUnitId, businessId: params\.businessId \},[\s\S]*?\}\);\s*if \(!orgUnit\) throw new NotFoundException\('Org unit not found'\);/,
      );
      // what is written is what was checked
      expect(body).toMatch(/contactId: input\.contactId,\s*serviceId: input\.serviceId,/);
      expect(body).toMatch(/if \(input\.staffId\) createData\.staffId = input\.staffId;/);
      expect(body).toMatch(/if \(input\.orgUnitId\) createData\.orgUnitId = input\.orgUnitId;/);
    });

    describe('TD9-3, run: createBooking against rows of two businesses (the lookup must name the business to refuse)', () => {
      type Row = { id: string; businessId: string; deletedAt: null };
      const row = (id: string, businessId: string): Row => ({ id, businessId, deletedAt: null });
      const ROWS: Record<string, Row[]> = {
        service: [row('svc_a', 'biz_a'), row('svc_b', 'biz_b')],
        contact: [row('ct_a', 'biz_a'), row('ct_b', 'biz_b')],
        staffMember: [row('st_a', 'biz_a'), row('st_b', 'biz_b')],
        orgUnit: [row('ou_a', 'biz_a'), row('ou_b', 'biz_b')],
      };
      const make = () => {
        // a lookup finds the row its where names, and refuses a where shape it was not written for
        const lookup = (model: string) =>
          vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
            for (const k of Object.keys(where)) if (!['id', 'businessId', 'deletedAt'].includes(k)) throw new Error(`unexpected ${model} where key ${k}`);
            return ROWS[model].find((r) => Object.entries(where).every(([k, v]) => (r as Record<string, unknown>)[k] === v)) ?? null;
          });
        const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'bk_new', ...data, contact: null }));
        const client: Record<string, unknown> = {
          // V1-16: createBooking writes inside claimSlot's transaction (advisory lock, then the overlap re-read)
          $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(client)),
          $executeRaw: vi.fn(async () => 0),
          service: { findFirst: lookup('service') },
          contact: { findFirst: lookup('contact') },
          staffMember: { findFirst: lookup('staffMember') },
          orgUnit: { findFirst: lookup('orgUnit') },
          booking: { findFirst: vi.fn(async () => null), create },
          availability: { findMany: vi.fn(async () => []) },
          business: { findUnique: vi.fn(async () => ({ businessHours: null })) },
        };
        const svc = new BookingsService(
          { client } as any,
          { emit: vi.fn() } as any,
          { logContactEvent: vi.fn(async () => undefined) } as any,
          {} as any,
          {} as any,
          {} as any,
          {} as any,
          {} as any,
          {} as any,
        );
        return { svc, create };
      };
      const start = new Date(Date.now() + 30 * 24 * 3600_000);
      const own = { businessId: 'biz_a', contactId: 'ct_a', serviceId: 'svc_a', staffId: 'st_a', orgUnitId: 'ou_a', startTime: start, endTime: new Date(start.getTime() + 3600_000) };

      it.each([
        ['service', { serviceId: 'svc_b' }, 'Service not found'],
        ['contact', { contactId: 'ct_b' }, 'Contact not found'],
        ['staff member', { staffId: 'st_b' }, 'Staff member not found'],
        ['org unit', { orgUnitId: 'ou_b' }, 'Org unit not found'],
      ])("another business's %s is refused (404) before the booking is written", async (_label, foreign, message) => {
        const { svc, create } = make();
        const err = await svc.createBooking({ ...own, ...foreign }).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(NotFoundException);
        expect((err as Error).message).toBe(message);
        expect(create).not.toHaveBeenCalled();
      });

      it("control: the business's own service, contact, staff member and org unit are booked, and those are the ids written", async () => {
        const { svc, create } = make();
        await svc.createBooking(own);
        expect(create).toHaveBeenCalledTimes(1);
        expect(create.mock.calls[0][0].data).toMatchObject({ businessId: 'biz_a', contactId: 'ct_a', serviceId: 'svc_a', staffId: 'st_a', orgUnitId: 'ou_a' });
      });
    });

    it("TD9-4: the dispatcher finds an invoice's or a quote's contact within the business before CommerceService writes it", () => {
      const cases = dispatcherCases();
      for (const t of ['commerce_create_invoice', 'commerce_create_quote']) {
        const text = cases.get(t)!;
        const check = text.indexOf('await this.contactWithinBusiness(businessId, args.contactId);');
        expect(check, t).toBeGreaterThan(-1);
        expect(check, t).toBeLessThan(text.indexOf('this.getCommerce()'));
      }
      expect(memberBody(read(ORCHESTRATOR), 'contactWithinBusiness')).toMatch(
        /this\.prisma\.client\.contact\.findFirst\(\{\s*where: \{ id: contactId, businessId, deletedAt: null \},/,
      );
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
      else if (kind === 'floor') expect(reason, t).toMatch(/is only a floor/);
      else expect(reason, t).toMatch(/unscoped/);
    }
  });
});

