/**
 * V1-21d-KEY-DISPATCHER-TENANT-INCLUDES: KEY's tool dispatcher reads related rows only inside the
 * business, resolves every id the model hands it inside the business before using it, and what it
 * hands the model never carries a row the caller cannot see.
 *
 * Residuals of V1-KEY2, V1-21c (review ST-1, the TD9 class) and R0-SEC3 (review SEC3-ST-2):
 *
 *   INCLUDES  FlowOrchestratorService.executeToolAction (the dispatcher every KEY surface reaches:
 *             member chat, the staff WhatsApp/SMS bridge, plans, monitors) read related rows with
 *             Prisma includes that name no business. A to-one include cannot be filtered, so a row
 *             cross-linked before the TD9 repairs (an A task filed on B's project, an A booking
 *             naming B's service and contact, an A invoice naming B's contact) handed the model
 *             another business's row; a to-many include or a _count without businessId counted or
 *             listed another business's tasks under the caller's project.
 *   IDS       ~200 dispatcher sites take an id from the model. Most go to a service with the
 *             business, or to a query naming businessId; the census below found the rest:
 *             content_* (six tools) read and moved a content request by id alone, evidence_verify
 *             verified any business's evidence, approval_decide_step decided any business's
 *             approval request, bookings_offer_waitlist_slot booked a slot on another business's
 *             waiting list (and named any staff member), content_assign_request stored user ids
 *             that are no member of the business.
 *   SEC3-ST-2 commerce_mark_invoice_paid returned CommerceService.markInvoicePaid's reload
 *             (items, the whole Contact row and the whole Booking row) to the model, where the HTTP
 *             route projects through toInvoiceWriteResponse; commerce_create_invoice and
 *             commerce_create_quote returned the whole Contact row the same way.
 *
 * WHAT IS PINNED HERE (source and behaviour; the real-database proof is
 * test/key-dispatcher-tenant.integration.test.ts):
 *  1. a static census of every dispatcher case (TypeScript AST over flow-orchestrator.service.ts,
 *     relation kinds from the Prisma DMMF, declared id parameters from flow-tool-registry.ts) of
 *     (a) every relation a dispatcher read includes or selects, and (b) every model-supplied id and
 *     where it is used;
 *  2. the rules: a to-many relation (or _count) is read with a where naming businessId; a to-one
 *     relation into a tenant model is read with its businessId and passed through ownRelations,
 *     which drops it when it belongs elsewhere; a model-supplied id is used only in a query naming
 *     businessId, a *WithinBusiness helper, or a service call handed the business, or after one of
 *     those resolved it in the same case. Exceptions sit in shrink-only allowlists, each with its
 *     reason: an entry that no longer matches fails until it is removed;
 *  3. the census flags a planted dispatcher that reads by id alone or includes without a business
 *     filter (its negative control), and still sees the cases it exists for;
 *  4. the commerce write tools hand the model the write projection (no booking, the contact's
 *     id/businessId/name/email only, nothing of another business's contact).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { Prisma } from '@prisma/client';
import { FLOW_TOOLS } from './flow-tool-registry';
import * as orchestratorModule from './flow-orchestrator.service';
import { CommerceService } from '../commerce/commerce.service';

const { FlowOrchestratorService } = orchestratorModule;
/** The V1-21d exports, read loosely so the census below still runs where they do not exist yet. */
const v21d = orchestratorModule as unknown as {
  ownRelations?: (businessId: string, row: object, relations: readonly string[]) => Record<string, unknown>;
  toKeyInvoiceResult?: (businessId: string, invoice: object) => Record<string, unknown>;
  toKeyQuoteResult?: (businessId: string, quote: object) => Record<string, unknown>;
};

// ─── the census ──────────────────────────────────────────────────────────────

type DmmfModel = (typeof Prisma.dmmf.datamodel.models)[number];
const MODELS = new Map<string, DmmfModel>(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));
const DELEGATES = new Map<string, DmmfModel>(
  Prisma.dmmf.datamodel.models.map((m) => [m.name.charAt(0).toLowerCase() + m.name.slice(1), m]),
);
const tenanted = (m: DmmfModel | undefined) => !!m?.fields.some((f) => f.kind === 'scalar' && f.name === 'businessId');

/** A model-supplied id: an argument named <x>Id or <x>Ids. */
const ID_ARG = /^[a-zA-Z]*Ids?$/;
/** The services whose returned rows the commerce write tools must project (SEC3-ST-2). */
const COMMERCE_ROW_WRITES = new Set([
  'createInvoice',
  'markInvoicePaid',
  'markInvoicePaymentFailed',
  'updateInvoice',
  'updateInvoiceStatus',
  'convertQuoteToInvoice',
  'recordPayment',
  'createQuote',
  'updateQuote',
  'updateQuoteStatus',
]);
const PROJECTIONS = /^(toKeyInvoiceResult|toKeyQuoteResult)$/;

interface IdSite {
  tool: string;
  arg: string;
  /** query: a dispatcher Prisma where; helper: this.<x>WithinBusiness; service: a this.* call; wholesale: `args` handed on whole. */
  kind: 'query' | 'helper' | 'service' | 'write' | 'wholesale' | 'call';
  bound: boolean;
  via: string;
  line: number;
}
interface RelationSite {
  tool: string;
  model: string;
  relation: string;
  target: string;
  toMany: boolean;
  ok: boolean;
  why: string;
  line: number;
}
interface RawRowSite {
  tool: string;
  variable: string;
  method: string;
  line: number;
}

function census(source: string) {
  const sf = ts.createSourceFile('dispatcher.ts', source, ts.ScriptTarget.Latest, true);
  const text = (n: ts.Node) => n.getText(sf).replace(/\s/g, '');
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  let method: ts.MethodDeclaration | undefined;
  const findMethod = (n: ts.Node) => {
    if (ts.isMethodDeclaration(n) && n.name.getText(sf) === 'executeToolAction') method = n;
    ts.forEachChild(n, findMethod);
  };
  findMethod(sf);
  if (!method?.body) throw new Error('executeToolAction not found');
  let sw: ts.SwitchStatement | undefined;
  const findSwitch = (n: ts.Node) => {
    if (!sw && ts.isSwitchStatement(n) && text(n.expression) === 'toolName') sw = n;
    ts.forEachChild(n, findSwitch);
  };
  findSwitch(method.body);
  if (!sw) throw new Error('the dispatcher switch (switch (toolName)) not found');

  const ids: IdSite[] = [];
  const relations: RelationSite[] = [];
  const rawRows: RawRowSite[] = [];
  const cases: string[] = [];

  const prismaCall = (call: ts.Node): { model: DmmfModel | undefined; delegate: string; op: string } | null => {
    if (!ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression)) return null;
    const opAccess = call.expression;
    if (!ts.isPropertyAccessExpression(opAccess.expression)) return null;
    const delegateAccess = opAccess.expression;
    if (text(delegateAccess.expression) !== 'this.prisma.client') return null;
    const delegate = delegateAccess.name.text;
    return { model: DELEGATES.get(delegate), delegate, op: opAccess.name.text };
  };
  const propName = (p: ts.ObjectLiteralElementLike) =>
    (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))
      ? p.name.text
      : undefined;
  const prop = (o: ts.ObjectLiteralExpression, name: string) =>
    o.properties.find((p) => propName(p) === name) as ts.PropertyAssignment | ts.ShorthandPropertyAssignment | undefined;
  const contains = (outer: ts.Node, inner: ts.Node) => inner.getStart(sf) >= outer.getStart(sf) && inner.getEnd() <= outer.getEnd();
  const mentionsBusinessId = (n: ts.Node): boolean => {
    let found = false;
    const v = (x: ts.Node) => {
      if (found) return;
      if (ts.isIdentifier(x) && x.text === 'businessId') found = true;
      else ts.forEachChild(x, v);
    };
    v(n);
    return found;
  };
  const declInit = (scope: ts.Node, name: string): ts.Expression | undefined => {
    let init: ts.Expression | undefined;
    const v = (x: ts.Node) => {
      if (ts.isVariableDeclaration(x) && ts.isIdentifier(x.name) && x.name.text === name && x.initializer) init ??= x.initializer;
      ts.forEachChild(x, v);
    };
    v(scope);
    return init;
  };
  const unwrap = (e: ts.Expression): ts.Expression =>
    ts.isAsExpression(e) || ts.isParenthesizedExpression(e) || ts.isSatisfiesExpression(e) || ts.isAwaitExpression(e) ? unwrap(e.expression) : e;
  /** A where that names the business at its top level (or in a top-level AND). */
  const whereBound = (scope: ts.Node, e: ts.Expression | undefined): boolean => {
    if (!e) return false;
    const x = unwrap(e);
    if (ts.isIdentifier(x)) return whereBound(scope, declInit(scope, x.text));
    if (!ts.isObjectLiteralExpression(x)) return false;
    if (prop(x, 'businessId')) return true;
    const and = prop(x, 'AND');
    if (and && ts.isPropertyAssignment(and) && ts.isArrayLiteralExpression(and.initializer)) {
      return and.initializer.elements.some((el) => whereBound(scope, el));
    }
    return false;
  };
  const COMPARISONS = new Set([
    ts.SyntaxKind.EqualsEqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ts.SyntaxKind.EqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsToken,
    ts.SyntaxKind.InstanceOfKeyword,
  ]);

  const analyse = (tool: string, clause: ts.CaseClause) => {
    const scope = clause;
    const sites: IdSite[] = [];
    /** Where an id goes: walk up from its reference to the first use that decides it. */
    const classify = (node: ts.Node, arg: string, seen: Set<ts.Node>) => {
      let child: ts.Node = node;
      let p: ts.Node | undefined = node.parent;
      while (p && p !== scope) {
        // tested, not used: if (args.x), args.x ? a : b, args.x !== undefined, !args.x, typeof args.x
        if (ts.isIfStatement(p) && p.expression === child) return;
        if (ts.isConditionalExpression(p) && p.condition === child) return;
        if (ts.isBinaryExpression(p) && COMPARISONS.has(p.operatorToken.kind)) return;
        if (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken) return;
        if (ts.isTypeOfExpression(p)) return;
        if (ts.isPropertyAssignment(p) && p.initializer === child && (propName(p) === 'where' || propName(p) === 'data')) {
          const owner = p.parent;
          const call = owner.parent;
          const pc = call ? prismaCall(call) : null;
          if (ts.isObjectLiteralExpression(owner) && pc && (call as ts.CallExpression).arguments[0] === owner) {
            sites.push({
              tool,
              arg,
              kind: propName(p) === 'where' ? 'query' : 'write',
              bound: propName(p) === 'where' ? whereBound(scope, p.initializer) : false,
              via: `${pc.delegate}.${pc.op}`,
              line: lineOf(node),
            });
            return;
          }
        }
        if (
          ts.isBinaryExpression(p) &&
          p.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          p.right === child &&
          ts.isPropertyAccessExpression(p.left) &&
          ts.isIdentifier(p.left.expression)
        ) {
          // where.projectId = args.projectId: bound when the where it fills was built with businessId
          const w = p.left.expression.text;
          sites.push({ tool, arg, kind: 'query', bound: whereBound(scope, declInit(scope, w)), via: `${w}.${p.left.name.text}`, line: lineOf(node) });
          return;
        }
        if (ts.isVariableDeclaration(p) && p.initializer === child) {
          // an alias (const id = String(args.obligationId ?? '')): follow each use of the alias
          const names: string[] = [];
          if (ts.isIdentifier(p.name)) names.push(p.name.text);
          else if (ts.isObjectBindingPattern(p.name)) {
            for (const el of p.name.elements) if (ts.isIdentifier(el.name) && ID_ARG.test(el.name.text)) names.push(el.name.text);
          }
          const decl = p;
          for (const name of names) {
            const v = (x: ts.Node) => {
              if (ts.isIdentifier(x) && x.text === name && !contains(decl.name, x) && !seen.has(x)) {
                seen.add(x);
                classify(x, arg, seen);
              }
              ts.forEachChild(x, v);
            };
            v(scope);
          }
          return;
        }
        if (ts.isCallExpression(p) && p.arguments.some((a) => contains(a, child))) {
          if (prismaCall(p)) {
            sites.push({ tool, arg, kind: 'call', bound: false, via: text(p.expression), line: lineOf(node) });
            return;
          }
          const callee = text(p.expression);
          if (callee.startsWith('this.')) {
            const name = callee.slice(callee.lastIndexOf('.') + 1);
            sites.push({
              tool,
              arg,
              kind: /WithinBusiness$/.test(name) ? 'helper' : 'service',
              bound: p.arguments.some(mentionsBusinessId),
              via: callee,
              line: lineOf(node),
            });
            return;
          }
          // String(), Number(), new Date(), [].map(...): keep walking to the use
        }
        child = p;
        p = p.parent;
      }
    };

    const explicit = new Set<string>();
    const wholesale: ts.Identifier[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'args' && ID_ARG.test(n.name.text)) {
        explicit.add(n.name.text);
        classify(n, n.name.text, new Set());
      } else if (
        ts.isIdentifier(n) &&
        n.text === 'args' &&
        !(ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n) &&
        !(ts.isElementAccessExpression(n.parent) && n.parent.expression === n)
      ) {
        wholesale.push(n);
      }
      ts.forEachChild(n, visit);
    };
    clause.statements.forEach(visit);
    // an id the registry declares that the case never names, handed on inside `args`
    const declared = tool
      .split('|')
      .flatMap((t) => Object.keys(FLOW_TOOLS.find((f) => f.name === t)?.parameters.properties ?? {}))
      .filter((k) => ID_ARG.test(k) && !explicit.has(k));
    for (const arg of new Set(declared)) {
      for (const n of wholesale) {
        const before = sites.length;
        classify(n, arg, new Set());
        for (const s of sites.slice(before)) s.kind = 'wholesale';
      }
    }
    // resolved before use: a use that names no business is bound when the same case already
    // resolved that id inside the business (a query naming businessId, or a *WithinBusiness helper)
    for (const s of sites) {
      if (s.bound) continue;
      const first = sites.find((o) => o !== s && o.arg === s.arg && (o.kind === 'query' || o.kind === 'helper') && o.bound && o.line < s.line);
      if (first) {
        s.bound = true;
        s.via += ` (resolved first by ${first.via})`;
      }
    }
    ids.push(...sites);

    // relations
    const ownNames = new Set<string>();
    const findOwn = (n: ts.Node) => {
      if (ts.isCallExpression(n) && /(^|\.)ownRelations$/.test(text(n.expression))) {
        for (const a of n.arguments) {
          if (ts.isArrayLiteralExpression(a)) for (const el of a.elements) if (ts.isStringLiteral(el)) ownNames.add(el.text);
        }
      }
      ts.forEachChild(n, findOwn);
    };
    clause.statements.forEach(findOwn);

    const projection = (model: DmmfModel, obj: ts.ObjectLiteralExpression) => {
      for (const p of obj.properties) {
        const name = propName(p);
        if (!name) continue;
        const value = ts.isPropertyAssignment(p) ? unwrap(p.initializer) : undefined;
        if (name === '_count') {
          const sel = value && ts.isObjectLiteralExpression(value) ? prop(value, 'select') : undefined;
          if (sel && ts.isPropertyAssignment(sel) && ts.isObjectLiteralExpression(sel.initializer)) {
            for (const c of sel.initializer.properties) {
              const rel = propName(c);
              const field = rel ? model.fields.find((f) => f.name === rel && f.kind === 'object') : undefined;
              if (!rel || !field) continue;
              const cv = ts.isPropertyAssignment(c) ? unwrap(c.initializer) : undefined;
              const where = cv && ts.isObjectLiteralExpression(cv) ? prop(cv, 'where') : undefined;
              const ok = !tenanted(MODELS.get(field.type)) || (!!where && ts.isPropertyAssignment(where) && whereBound(scope, where.initializer));
              relations.push({
                tool,
                model: model.name,
                relation: `_count.${rel}`,
                target: field.type,
                toMany: true,
                ok,
                why: ok ? 'counted with a where naming businessId' : 'counted with no businessId',
                line: lineOf(c),
              });
            }
          }
          continue;
        }
        const field = model.fields.find((f) => f.name === name && f.kind === 'object');
        if (!field) continue;
        const target = MODELS.get(field.type)!;
        const nested = value && ts.isObjectLiteralExpression(value) ? value : undefined;
        let ok: boolean;
        let why: string;
        if (!tenanted(target)) {
          ok = true;
          why = 'the related model carries no businessId';
        } else if (field.isList) {
          const where = nested ? prop(nested, 'where') : undefined;
          ok = !!where && ts.isPropertyAssignment(where) && whereBound(scope, where.initializer);
          why = ok ? 'to-many read with a where naming businessId' : 'to-many read with no businessId';
        } else {
          const sel = nested ? prop(nested, 'select') : undefined;
          const readsItsBusiness =
            value?.kind === ts.SyntaxKind.TrueKeyword ||
            (!!nested && !sel) ||
            (!!sel && ts.isPropertyAssignment(sel) && ts.isObjectLiteralExpression(sel.initializer) && !!prop(sel.initializer, 'businessId'));
          ok = readsItsBusiness && ownNames.has(name);
          why = ok
            ? 'to-one read with its businessId and dropped when foreign (ownRelations)'
            : !readsItsBusiness
              ? 'to-one read without its businessId'
              : 'to-one kept whatever its business (no ownRelations)';
        }
        relations.push({ tool, model: model.name, relation: name, target: field.type, toMany: field.isList, ok, why, line: lineOf(p) });
        if (nested) {
          for (const key of ['select', 'include']) {
            const inner = prop(nested, key);
            if (inner && ts.isPropertyAssignment(inner) && ts.isObjectLiteralExpression(unwrap(inner.initializer))) {
              projection(target, unwrap(inner.initializer) as ts.ObjectLiteralExpression);
            }
          }
        }
      }
    };
    const findPrisma = (n: ts.Node) => {
      const pc = prismaCall(n);
      if (pc?.model) {
        const arg0 = (n as ts.CallExpression).arguments[0];
        if (arg0 && ts.isObjectLiteralExpression(arg0)) {
          for (const key of ['include', 'select']) {
            const pr = prop(arg0, key);
            if (pr && ts.isPropertyAssignment(pr)) {
              const v = unwrap(pr.initializer);
              if (ts.isObjectLiteralExpression(v)) projection(pc.model, v);
              else
                relations.push({
                  tool,
                  model: pc.model.name,
                  relation: `<${key}: ${text(v)}>`,
                  target: '?',
                  toMany: false,
                  ok: false,
                  why: 'a projection not written inline cannot be checked',
                  line: lineOf(pr),
                });
            }
          }
        }
      }
      ts.forEachChild(n, findPrisma);
    };
    clause.statements.forEach(findPrisma);

    // SEC3-ST-2: a row a commerce write returned reaches the model only through a projection
    const rowVars = new Map<string, string>();
    const findRows = (n: ts.Node) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
        const init = unwrap(n.initializer);
        if (ts.isCallExpression(init) && text(init.expression).startsWith('this.getCommerce().')) {
          const name = text(init.expression).slice('this.getCommerce().'.length);
          if (COMMERCE_ROW_WRITES.has(name)) rowVars.set(n.name.text, name);
        }
      }
      ts.forEachChild(n, findRows);
    };
    clause.statements.forEach(findRows);
    /** invoice.id, (invoice as { id: string }).id, invoice!.id: a field of the row, not the row */
    const readsAProperty = (x: ts.Node) => {
      let e: ts.Node = x;
      while ((ts.isAsExpression(e.parent) || ts.isParenthesizedExpression(e.parent) || ts.isNonNullExpression(e.parent)) && e.parent.expression === e) e = e.parent;
      return ts.isPropertyAccessExpression(e.parent) && e.parent.expression === e;
    };
    const findReturns = (n: ts.Node) => {
      if (ts.isReturnStatement(n) && n.expression) {
        const ret = n.expression;
        const v = (x: ts.Node) => {
          if (ts.isIdentifier(x) && rowVars.has(x.text) && !readsAProperty(x)) {
            let q: ts.Node = x;
            let projected = false;
            while (q !== ret) {
              q = q.parent;
              if (ts.isCallExpression(q) && PROJECTIONS.test(text(q.expression).replace(/^this\./, ''))) projected = true;
            }
            if (!projected && !(ts.isPropertyAssignment(x.parent) && x.parent.name === x)) {
              rawRows.push({ tool, variable: x.text, method: rowVars.get(x.text)!, line: lineOf(x) });
            }
          }
          ts.forEachChild(x, v);
        };
        v(ret);
      }
      ts.forEachChild(n, findReturns);
    };
    clause.statements.forEach(findReturns);
  };

  let pending: string[] = [];
  for (const clause of sw.caseBlock.clauses) {
    if (!ts.isCaseClause(clause)) {
      pending = [];
      continue;
    }
    if (ts.isStringLiteral(clause.expression)) pending.push(clause.expression.text);
    if (clause.statements.length === 0) continue;
    const tool = pending.join('|');
    pending = [];
    cases.push(tool);
    analyse(tool, clause);
  }
  return { cases, ids, relations, rawRows };
}

// ─── the allowlists (shrink-only: an entry that no longer matches fails until removed) ───

/**
 * Model-supplied ids used without the business, `${tool}:${arg}` -> why that is not a read of
 * another business's row.
 */
const ID_ALLOWLIST: Record<string, string> = {
  'content_upload_deliverables:fileIds':
    "Google Drive file ids in the business's own connected Drive, not rows of this database; stored on the content request (resolved inside the business first) as POST .../upload-deliverables stores them",
  'content_upload_deliverables:folderId':
    "a Google Drive folder id in the business's own connected Drive, not a row of this database; stored as POST .../upload-deliverables stores it",
};

/** Relations a dispatcher read includes without a business filter, `${tool}:${Model}.${relation}` -> why. */
const RELATION_ALLOWLIST: Record<string, string> = {};

/** Commerce write rows a dispatcher case returns unprojected, `${tool}:${variable}` -> why. */
const RAW_ROW_ALLOWLIST: Record<string, string> = {};

const DISPATCHER = readFileSync(join(__dirname, 'flow-orchestrator.service.ts'), 'utf8');
const live = census(DISPATCHER);
const idKey = (s: IdSite) => `${s.tool}:${s.arg}`;
const relKey = (r: RelationSite) => `${r.tool}:${r.model}.${r.relation}`;
const show = (s: IdSite) => `${idKey(s)} (${s.kind} via ${s.via}, line ${s.line})`;
const showRel = (r: RelationSite) => `${relKey(r)} -> ${r.target}${r.toMany ? '[]' : ''}: ${r.why} (line ${r.line})`;

describe('V1-21d census — it sees the dispatcher (negative control: an empty census proves nothing)', () => {
  it('walks every case of executeToolAction and finds the id sites and relation reads it exists for', () => {
    expect(live.cases.length, 'dispatcher cases').toBeGreaterThan(250);
    const pairs = new Set(live.ids.map(idKey));
    expect(pairs.size, 'distinct (tool, id) pairs').toBeGreaterThan(150);
    for (const pair of [
      'projects_list_tasks:projectId',
      'commerce_mark_invoice_paid:invoiceId',
      'content_get_request:requestId',
      'evidence_verify:evidenceId',
      'approval_decide_step:approvalRequestId',
      'bookings_offer_waitlist_slot:entryId',
      'commerce_create_invoice:contactId',
      'assets_delete:assetId',
      'command_discharge_obligation:obligationId',
    ]) {
      expect(pairs, pair).toContain(pair);
    }
    const rels = new Set(live.relations.map(relKey));
    for (const rel of [
      'projects_list_tasks:ProjectTask.project',
      'bookings_list_bookings:Booking.contact',
      'bookings_list_bookings:Booking.service',
      'projects_list:Project._count.tasks',
      'commerce_list_invoices:Invoice.contact',
      'commerce_send_invoice:Invoice.contact',
      'fetch_project_status:Project.tasks',
    ]) {
      expect(rels, rel).toContain(rel);
    }
  });

  it('flags a dispatcher that reads by id alone or includes without a business filter, and passes the bound forms', () => {
    const planted = `
      class Planted {
        private async executeToolAction(businessId: string, toolName: string, args: Record<string, any>) {
          switch (toolName) {
            case 'p_find_by_id_alone': {
              return this.prisma.client.contact.findUnique({ where: { id: args.contactId } });
            }
            case 'p_service_without_business': {
              return this.getContentRequest().getById(args.requestId);
            }
            case 'p_where_variable_without_business': {
              const where: any = { deletedAt: null };
              if (args.projectId) where.projectId = args.projectId;
              return this.prisma.client.projectTask.findMany({ where });
            }
            case 'p_alias_without_business': {
              const id = String(args.dealId ?? '');
              return this.getDeals().remove(id);
            }
            case 'p_to_one_include': {
              return this.prisma.client.projectTask.findMany({ where: { businessId }, include: { project: { select: { name: true } } } });
            }
            case 'p_to_one_with_business_but_kept': {
              return this.prisma.client.booking.findMany({ where: { businessId }, include: { service: { select: { businessId: true, name: true } } } });
            }
            case 'p_to_many_include': {
              return this.prisma.client.project.findMany({ where: { businessId }, include: { tasks: { where: { deletedAt: null } } } });
            }
            case 'p_count_include': {
              return this.prisma.client.project.findMany({ where: { businessId }, include: { _count: { select: { tasks: true } } } });
            }
            case 'p_raw_commerce_row': {
              const invoice = await this.getCommerce().markInvoicePaid(args.invoiceId, 'key', businessId);
              return { invoice, id: invoice.id };
            }
            case 'b_bound_query':
            case 'b_bound_query_alias': {
              const c = await this.prisma.client.contact.findFirst({ where: { id: args.contactId, businessId } });
              return c;
            }
            case 'b_service_with_business': {
              return this.getContracts().getContract(businessId, args.contractId);
            }
            case 'b_resolved_first': {
              await this.assetWithinBusiness(businessId, args.assetId);
              return this.getAssets().deleteAsset(args.assetId);
            }
            case 'b_where_variable': {
              const where: any = { businessId, deletedAt: null };
              if (args.projectId) where.projectId = args.projectId;
              const tasks = await this.prisma.client.projectTask.findMany({ where, include: { project: { select: { businessId: true, name: true } } } });
              return tasks.map((t) => ownRelations(businessId, t, ['project']));
            }
            case 'b_to_many_and_count': {
              return this.prisma.client.project.findMany({
                where: { businessId },
                include: { tasks: { where: { businessId } }, _count: { select: { tasks: { where: { businessId, deletedAt: null } } } }, business: { select: { name: true } } },
              });
            }
            case 'b_projected_commerce_row': {
              const invoice = await this.getCommerce().markInvoicePaid(args.invoiceId, 'key', businessId);
              return { invoice: toKeyInvoiceResult(businessId, invoice), id: invoice.id };
            }
            default:
              return null;
          }
        }
      }`;
    const c = census(planted);
    const unbound = c.ids.filter((s) => !s.bound).map(idKey).sort();
    expect(unbound).toEqual([
      'p_alias_without_business:dealId',
      'p_find_by_id_alone:contactId',
      'p_service_without_business:requestId',
      'p_where_variable_without_business:projectId',
    ]);
    expect(c.ids.filter((s) => s.tool.startsWith('b_')).every((s) => s.bound)).toBe(true);
    expect(c.relations.filter((r) => !r.ok).map(relKey).sort()).toEqual([
      'p_count_include:Project._count.tasks',
      'p_to_many_include:Project.tasks',
      'p_to_one_include:ProjectTask.project',
      'p_to_one_with_business_but_kept:Booking.service',
    ]);
    expect(c.relations.filter((r) => r.tool.startsWith('b_')).every((r) => r.ok)).toBe(true);
    expect(c.rawRows.map((r) => `${r.tool}:${r.variable}`)).toEqual(['p_raw_commerce_row:invoice']);
  });
});

describe('V1-21d IDS — every model-supplied id is resolved inside the business before use', () => {
  it('no dispatcher case uses a model-supplied id without the business, outside the allowlist', () => {
    const offenders = live.ids.filter((s) => !s.bound && !ID_ALLOWLIST[idKey(s)]);
    expect(
      offenders.map(show),
      'these read or write by an id the model chose, with nothing binding it to the business: resolve it first ' +
        '(a findFirst naming businessId, a *WithinBusiness helper) or hand it to a service together with businessId',
    ).toEqual([]);
  });

  it('the allowlist only shrinks: every entry still matches an unbound use, and names its reason', () => {
    const unbound = new Set(live.ids.filter((s) => !s.bound).map(idKey));
    for (const [key, reason] of Object.entries(ID_ALLOWLIST)) {
      expect(unbound, `${key} is bound now: remove it from ID_ALLOWLIST`).toContain(key);
      expect(reason.length, `${key} needs a reason`).toBeGreaterThan(20);
    }
  });

  it('the census found: content_*, evidence_verify, approval_decide_step and bookings_offer_waitlist_slot resolve their ids first', () => {
    const byPair = (pair: string) => live.ids.filter((s) => idKey(s) === pair);
    for (const pair of [
      'content_get_request:requestId',
      'content_assign_request:requestId',
      'content_assign_request:teamMemberIds',
      'content_transition_status:requestId',
      'content_submit_for_review:requestId',
      'content_upload_deliverables:requestId',
      'content_deliver_request:requestId',
      'evidence_verify:evidenceId',
      'approval_decide_step:approvalRequestId',
      'bookings_offer_waitlist_slot:entryId',
      'bookings_offer_waitlist_slot:serviceId',
      'bookings_offer_waitlist_slot:staffId',
    ]) {
      const sites = byPair(pair);
      expect(sites.length, pair).toBeGreaterThan(0);
      expect(sites.filter((s) => !s.bound).map(show), pair).toEqual([]);
      expect(sites.some((s) => s.kind === 'helper' || s.kind === 'query'), `${pair} is resolved in the dispatcher`).toBe(true);
    }
  });
});

describe('V1-21d INCLUDES — every relation a dispatcher read includes is filtered to the business', () => {
  it('a to-many include or _count names businessId; a to-one include is read with its businessId and dropped when foreign', () => {
    const offenders = live.relations.filter((r) => !r.ok && !RELATION_ALLOWLIST[relKey(r)]);
    expect(
      offenders.map(showRel),
      "these hand KEY a related row whatever its business (a row cross-linked before the TD9 repairs reads another business's row): " +
        'add businessId to the to-many where, or select the to-one relation with businessId and pass the row through ownRelations',
    ).toEqual([]);
  });

  it('the allowlist only shrinks', () => {
    const bad = new Set(live.relations.filter((r) => !r.ok).map(relKey));
    for (const [key, reason] of Object.entries(RELATION_ALLOWLIST)) {
      expect(bad, `${key} is filtered now: remove it from RELATION_ALLOWLIST`).toContain(key);
      expect(reason.length, `${key} needs a reason`).toBeGreaterThan(20);
    }
  });

  it('ownRelations keeps a related row of the business, drops one of another business (or none), and leaves the input alone', () => {
    expect(typeof v21d.ownRelations, 'ownRelations is exported from flow-orchestrator.service.ts').toBe('function');
    const own = v21d.ownRelations!;
    const row = {
      id: 't1',
      project: { businessId: 'biz_a', name: 'Own' },
      service: { businessId: 'biz_b', name: 'Foreign' },
      contact: { businessId: null, firstName: 'Nobody' },
      staff: null,
    };
    const out = own('biz_a', row, ['project', 'service', 'contact', 'staff']);
    expect(out).toEqual({ id: 't1', project: { businessId: 'biz_a', name: 'Own' }, service: null, contact: null, staff: null });
    expect(row.service).toEqual({ businessId: 'biz_b', name: 'Foreign' });
  });
});

describe('V1-21d SEC3-ST-2 — the commerce write tools hand the model the write projection', () => {
  it('no dispatcher case returns a row a commerce write returned, outside a projection', () => {
    const offenders = live.rawRows.filter((r) => !RAW_ROW_ALLOWLIST[`${r.tool}:${r.variable}`]);
    expect(
      offenders.map((r) => `${r.tool}: ${r.variable} from getCommerce().${r.method} (line ${r.line})`),
      'project it through toKeyInvoiceResult / toKeyQuoteResult (no booking; the contact as the HTTP write routes answer it)',
    ).toEqual([]);
    for (const key of Object.keys(RAW_ROW_ALLOWLIST)) {
      expect(live.rawRows.map((r) => `${r.tool}:${r.variable}`), `${key}: remove it from RAW_ROW_ALLOWLIST`).toContain(key);
    }
  });

  const BIZ = 'biz_v21d';
  const PRIVATE = { notesInternal: 'V21D-PRIVATE-NOTE', phone: '+18685550199', ownerId: 'u_owner', visibility: 'PRIVATE' };
  const fullContact = (businessId: string) => ({
    id: 'con_1',
    businessId,
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    ...PRIVATE,
  });
  const fullInvoice = (contactBusiness: string) => ({
    id: 'inv_1',
    businessId: BIZ,
    invoiceNumber: 'INV-0001',
    status: 'PAID',
    total: 100,
    contactId: 'con_1',
    items: [{ id: 'it_1', description: 'Consulting', quantity: 1, unitPrice: 100 }],
    contact: fullContact(contactBusiness),
    booking: { id: 'bk_1', notes: 'V21D-BOOKING-NOTE', location: 'Back room', staffId: 'st_1', calendarEventId: 'cal_1' },
  });

  function dispatcher(commerce: Record<string, unknown>) {
    return Object.assign(Object.create(FlowOrchestratorService.prototype), {
      prisma: {
        client: {
          contact: { findFirst: vi.fn(async () => ({ id: 'con_1' })) },
          invoice: { count: vi.fn(async () => 0) },
          quote: { count: vi.fn(async () => 0) },
        },
      },
      moduleRef: { get: (token: unknown) => (token === CommerceService ? commerce : undefined) },
    });
  }
  const run = (d: any, tool: string, args: Record<string, unknown>) => d.executeToolAction(BIZ, tool, args);
  const CONTACT_KEYS = ['businessId', 'email', 'firstName', 'id', 'lastName'];

  it('commerce_mark_invoice_paid: no booking, the contact as toInvoiceWriteResponse answers it', async () => {
    const d = dispatcher({ markInvoicePaid: vi.fn(async () => fullInvoice(BIZ)) });
    const out = await run(d, 'commerce_mark_invoice_paid', { invoiceId: 'inv_1' });
    expect(out.id).toBe('inv_1');
    expect(out.invoice).not.toHaveProperty('booking');
    expect(Object.keys(out.invoice.contact).sort()).toEqual(CONTACT_KEYS);
    expect(out.invoice).toMatchObject({ id: 'inv_1', invoiceNumber: 'INV-0001', status: 'PAID', contactId: 'con_1', items: [{ id: 'it_1' }] });
    const json = JSON.stringify(out);
    for (const secret of ['V21D-PRIVATE-NOTE', PRIVATE.phone, 'u_owner', 'V21D-BOOKING-NOTE', 'cal_1']) expect(json).not.toContain(secret);
  });

  it("commerce_mark_invoice_paid: an invoice cross-linked to another business's contact reads no contact", async () => {
    const d = dispatcher({ markInvoicePaid: vi.fn(async () => fullInvoice('biz_other')) });
    const out = await run(d, 'commerce_mark_invoice_paid', { invoiceId: 'inv_1' });
    expect(out.invoice.contact).toBeNull();
    expect(JSON.stringify(out)).not.toContain('Lovelace');
  });

  it('commerce_create_invoice and commerce_create_quote: the contact projected the same way', async () => {
    const { booking: _booking, ...created } = fullInvoice(BIZ);
    void _booking;
    const quote = { id: 'qt_1', businessId: BIZ, quoteNumber: 'QT-0001', contactId: 'con_1', items: [], contact: fullContact(BIZ) };
    const d = dispatcher({ createInvoice: vi.fn(async () => created), createQuote: vi.fn(async () => quote) });
    const inv = await run(d, 'commerce_create_invoice', { contactId: 'con_1', items: [{ description: 'x', quantity: 1, unitPrice: 1 }] });
    expect(Object.keys(inv.invoice.contact).sort()).toEqual(CONTACT_KEYS);
    expect(inv).toMatchObject({ id: 'inv_1', invoiceNumber: 'INV-0001', invoice: { businessId: BIZ, contactId: 'con_1' } });
    const qt = await run(d, 'commerce_create_quote', { contactId: 'con_1', items: [{ description: 'x', quantity: 1, unitPrice: 1 }] });
    expect(Object.keys(qt.quote.contact).sort()).toEqual(CONTACT_KEYS);
    expect(qt).toMatchObject({ id: 'qt_1', quoteNumber: 'QT-0001', quote: { businessId: BIZ, contactId: 'con_1' } });
    expect(JSON.stringify([inv, qt])).not.toContain('V21D-PRIVATE-NOTE');
  });

  it('a row without a loaded contact passes through (only the booking is dropped)', () => {
    expect(typeof v21d.toKeyInvoiceResult).toBe('function');
    expect(typeof v21d.toKeyQuoteResult).toBe('function');
    expect(v21d.toKeyInvoiceResult!(BIZ, { id: 'inv_1', booking: { id: 'bk' } })).toEqual({ id: 'inv_1' });
    expect(v21d.toKeyQuoteResult!(BIZ, { id: 'qt_1', contact: null })).toEqual({ id: 'qt_1', contact: null });
  });
});
