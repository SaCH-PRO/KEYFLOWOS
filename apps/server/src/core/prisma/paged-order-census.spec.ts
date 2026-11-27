/**
 * V1-67 (W11-PAGING-TOTAL-ORDER-A): every paged query must have a total order.
 *
 * Prisma does NOT append a primary-key tie-breaker when `orderBy` is non-empty.
 * When rows share the same sort key (e.g. rows written in one transaction or
 * `createMany` share `createdAt`/`updatedAt`, or repeating values like
 * `name`, `severity`, `status`, `stepOrder`), Postgres is free to return tied
 * rows in arbitrary heap order across requests:
 *   - Offset-paged queries (`skip` + `take`) can skip or duplicate tied rows
 *     between pages (especially after an MVCC heap update).
 *   - Cursor-paged queries (`cursor` + `skip: 1`) can drop the wrong tied row
 *     or repeat previously returned rows.
 *
 * WHAT IS INSPECTED (TypeScript AST over all non-spec, non-test `.ts` files
 * under `apps/server/src`):
 *   1. Every `.findMany({ ... })` call whose argument is an object literal
 *      containing a `skip` or `cursor` property (either directly or inside a
 *      conditional/logical spread such as `...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})`)
 *      MUST specify an `orderBy` whose final key is `id` (or a `@unique` key
 *      explicitly recorded in `UNIQUE_ORDER_KEYS` for that site).
 *      Local `const` bindings for `orderBy` and ternary branches are followed.
 *   2. Every `$queryRaw` or `Prisma.sql` tagged template containing `OFFSET`
 *      MUST contain an `ORDER BY` clause before `OFFSET` whose final sort
 *      column is an `id` column (e.g. `id`, `ci.id`, `"id"`, `ci."id"`,
 *      optionally with `ASC`/`DESC` and `NULLS FIRST`/`NULLS LAST`).
 *
 * SCOPE LIMITATION:
 *   Only literal `findMany({ ... })` arguments are inspected; `findMany(variable)`
 *   calls where the options object is assembled out-of-line are out of scope.
 *
 * STRICTLY SHRINKING RATCHET (`ALLOW_LISTED`):
 *   Pre-existing non-Group-A sites (`W11-PAGING-TOTAL-ORDER-B`,
 *   `W11-PAGING-TOTAL-ORDER-C`, and other pre-existing non-Group-A sites on
 *   base `178ef400`) are keyed by `<relative-path>::<enclosing-owner>` (never
 *   line numbers). The census fails if:
 *     - any offending site is NOT in `ALLOW_LISTED`, OR
 *     - any entry in `ALLOW_LISTED` no longer exists or no longer offends.
 *   Follow-on packets remove their entries from `ALLOW_LISTED` as they fix
 *   each site until `ALLOW_LISTED` is empty.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import * as ts from 'typescript';

const SRC_ROOT = resolve(__dirname, '../..');
const TEST_FILE = /\.(spec|test)\.ts$/;

/**
 * Sites whose final `orderBy` key is a database `@unique` column rather than
 * `id`, so the ordering is already a strict total order without appending `id`.
 */
const UNIQUE_ORDER_KEYS: Record<string, ReadonlySet<string>> = {
  // User.email is @unique in packages/db/prisma/schema.prisma
  'modules/admin-platform/admin-user.controller.ts::AdminUserController.listUsers': new Set(['email']),
};

/**
 * Strictly shrinking allow-list of pre-existing non-Group-A offending sites.
 * Keyed by `<path relative to apps/server/src>::<Class.method>` (plus `#raw`
 * suffix for `$queryRaw` / `Prisma.sql` sites) — never by line numbers.
 */
const ALLOW_LISTED: Readonly<Record<string, string>> = {
  // --- W11-PAGING-TOTAL-ORDER-B (18 sites: 17 findMany + 1 Prisma.sql) ---
  'modules/ai/ai-approvals.service.ts::AiApprovalsService.listItems': 'W11-PAGING-TOTAL-ORDER-B',
  'modules/ai/ai-execution-log.service.ts::AiExecutionLogService.getHistory': 'W11-PAGING-TOTAL-ORDER-B',
  'modules/ai/ai-usage.service.ts::AiUsageService.getUsageHistory': 'W11-PAGING-TOTAL-ORDER-B',
  'modules/ai/unified-inbox.service.ts::UnifiedInboxService.getInbox': 'W11-PAGING-TOTAL-ORDER-B',
  'modules/business-genesis/genome-chat.service.ts::GenomeChatService.getMessages': 'W11-PAGING-TOTAL-ORDER-B',
  'modules/business-genome/key-genome/genome-recommendation-outcome.service.ts::GenomeRecommendationOutcomeService.listOutcomes':
    'W11-PAGING-TOTAL-ORDER-B',
  'modules/command/command.service.ts::CommandService.findMany': 'W11-PAGING-TOTAL-ORDER-B',
  'modules/command/command.service.ts::CommandService.findMany#raw': 'W11-PAGING-TOTAL-ORDER-B',
  'modules/communications/omnichannel.controller.ts::OmnichannelController.listIntents': 'W11-PAGING-TOTAL-ORDER-B',
  'modules/communications/omnichannel.controller.ts::OmnichannelController.unifiedInbox': 'W11-PAGING-TOTAL-ORDER-B',
  'modules/communications/response-draft.service.ts::ResponseDraftService.listDrafts': 'W11-PAGING-TOTAL-ORDER-B',
  'modules/content-ops/content-request.service.ts::ContentRequestService.listForBusiness': 'W11-PAGING-TOTAL-ORDER-B',
  'modules/flow-signal/flow-signal.service.ts::FlowSignalService.list': 'W11-PAGING-TOTAL-ORDER-B',
  'modules/flow/flow-engine.service.ts::FlowEngineService.findMany': 'W11-PAGING-TOTAL-ORDER-B',
  'modules/flow/flow-runner.service.ts::FlowRunnerService.findRuns': 'W11-PAGING-TOTAL-ORDER-B',
  'modules/google-drive/generated-document.service.ts::GeneratedDocumentService.list': 'W11-PAGING-TOTAL-ORDER-B',
  'modules/ingestion/data-inbox.service.ts::DataInboxService.listItems': 'W11-PAGING-TOTAL-ORDER-B',
  'modules/key-inbox/key-inbox.service.ts::KeyInboxService.listThreads': 'W11-PAGING-TOTAL-ORDER-B',

  // --- W11-PAGING-TOTAL-ORDER-C (13 sites) ---
  'modules/admin-analytics/admin-analytics.service.ts::AdminAnalyticsService.getFeedbackInbox':
    'W11-PAGING-TOTAL-ORDER-C',
  'modules/admin-platform/admin-business.controller.ts::AdminBusinessController.listBusinesses':
    'W11-PAGING-TOTAL-ORDER-C',
  'modules/admin-platform/admin-event.controller.ts::AdminEventController.listEvents': 'W11-PAGING-TOTAL-ORDER-C',
  'modules/analytics/growth-insight-generator.service.ts::GrowthInsightGeneratorService.getInsights':
    'W11-PAGING-TOTAL-ORDER-C',
  'modules/business-events/business-event.service.ts::BusinessEventService.getAuditTrail': 'W11-PAGING-TOTAL-ORDER-C',
  'modules/device/device.service.ts::DeviceService.listCaptures': 'W11-PAGING-TOTAL-ORDER-C',
  'modules/device/device.service.ts::DeviceService.listVisualIntakes': 'W11-PAGING-TOTAL-ORDER-C',
  'modules/device/device.service.ts::DeviceService.listVoiceSessions': 'W11-PAGING-TOTAL-ORDER-C',
  'modules/identity/identity.service.ts::IdentityService.getTeamActivityFeed': 'W11-PAGING-TOTAL-ORDER-C',
  'modules/intelligence/signals.service.ts::SignalsService.listSignals': 'W11-PAGING-TOTAL-ORDER-C',
  'modules/product-analytics/product-analytics.service.ts::ProductAnalyticsService.listFeedback':
    'W11-PAGING-TOTAL-ORDER-C',
  'modules/product-analytics/product-analytics.service.ts::ProductAnalyticsService.listAiQualitySignals':
    'W11-PAGING-TOTAL-ORDER-C',
  'modules/product-analytics/product-analytics.service.ts::ProductAnalyticsService.listEvents':
    'W11-PAGING-TOTAL-ORDER-C',

  // --- Other pre-existing non-Group-A sites on 178ef400 (19 sites; retire in B/C or follow-up) ---
  'modules/ai/ai-usage-admin.controller.ts::AiUsageAdminController.platformAlerts': 'pre-existing-non-group-a',
  'modules/communications/delivery-queue.service.ts::DeliveryQueueService.listDeliveries': 'pre-existing-non-group-a',
  'modules/community/community.service.ts::CommunityService.listPosts': 'pre-existing-non-group-a',
  'modules/community/community.service.ts::CommunityService.searchDirectory': 'pre-existing-non-group-a',
  'modules/community/community.service.ts::CommunityService.listDirectory': 'pre-existing-non-group-a',
  'modules/community/community.service.ts::CommunityService.getConversationMessages': 'pre-existing-non-group-a',
  'modules/community/community.service.ts::CommunityService.getNotifications': 'pre-existing-non-group-a',
  'modules/community/network-activity.service.ts::NetworkActivityService.listFeed': 'pre-existing-non-group-a',
  'modules/community/opportunity.service.ts::OpportunityService.list': 'pre-existing-non-group-a',
  'modules/community/resource-marketplace.service.ts::ResourceMarketplaceService.list': 'pre-existing-non-group-a',
  'modules/crm/crm-accounts.service.ts::CrmAccountsService.listAccounts': 'pre-existing-non-group-a',
  'modules/crm/crm-deals.service.ts::CrmDealsService.listDeals': 'pre-existing-non-group-a',
  'modules/crm/crm.service.ts::CrmService.listContactRows': 'pre-existing-non-group-a',
  'modules/events/events.service.ts::EventsService.listEvents': 'pre-existing-non-group-a',
  'modules/expenses/expenses.service.ts::ExpensesService.listExpenses': 'pre-existing-non-group-a',
  'modules/key-cortex/key-cortex-awareness.service.ts::KeyCortexAwarenessService.getAwareness>fetchPage':
    'pre-existing-non-group-a',
  'modules/key-cortex/knowledge-ingestion.service.ts::KnowledgeIngestionService.listSources': 'pre-existing-non-group-a',
  'modules/key-cortex/unified-memory-retrieval.service.ts::UnifiedMemoryRetrievalService.loadStructuredMemory>loadAiMemories>fetchPage':
    'pre-existing-non-group-a',
  'modules/key-cortex/unified-memory-retrieval.service.ts::UnifiedMemoryRetrievalService.loadStructuredMemory>loadTemporalMemories>fetchPage':
    'pre-existing-non-group-a',
};

type FindingKind = 'findMany' | 'raw-sql';

interface PagedOrderFinding {
  siteKey: string;
  file: string;
  line: number;
  kind: FindingKind;
  detail: string;
}

interface ScanSummary {
  filesScanned: number;
  pagedQueriesInspected: number;
  compliantQueries: number;
  findings: PagedOrderFinding[];
}

interface RatchetEvaluation {
  unexpected: PagedOrderFinding[];
  staleAllowList: string[];
}

function unwrap(expr: ts.Expression): ts.Expression {
  let e = expr;
  for (;;) {
    if (
      ts.isParenthesizedExpression(e) ||
      ts.isAsExpression(e) ||
      ts.isSatisfiesExpression(e) ||
      ts.isTypeAssertionExpression(e) ||
      ts.isNonNullExpression(e)
    ) {
      e = e.expression;
    } else {
      return e;
    }
  }
}

function nameText(name: ts.Node | undefined): string | undefined {
  if (!name) return undefined;
  if (
    ts.isIdentifier(name) ||
    ts.isPrivateIdentifier(name) ||
    ts.isStringLiteralLike(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name)) {
    const inner = unwrap(name.expression);
    return ts.isStringLiteralLike(inner) ? inner.text : undefined;
  }
  return undefined;
}

/**
 * Deterministic, line-number-independent owner path for a node:
 * `ClassName.methodName` (or `ClassName.outerMethod>innerFn` for nested named helpers).
 */
function ownerOf(node: ts.Node): string {
  const parts: string[] = [];
  let cls: string | undefined;
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (
      (ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isPropertyDeclaration(n)) &&
      n.name
    ) {
      const m = nameText(n.name);
      if (m) parts.unshift(m);
    } else if (ts.isConstructorDeclaration(n)) {
      parts.unshift('constructor');
    } else if (ts.isFunctionDeclaration(n) && n.name) {
      parts.unshift(n.name.text);
    } else if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      ts.isFunctionLike(unwrap(n.initializer))
    ) {
      parts.unshift(n.name.text);
    } else if ((ts.isClassDeclaration(n) || ts.isClassExpression(n)) && n.name) {
      cls = n.name.text;
      break;
    }
  }
  const fnPath = parts.join('>');
  if (cls && fnPath) return `${cls}.${fnPath}`;
  if (cls) return cls;
  return fnPath || '<module>';
}

function getProp(obj: ts.ObjectLiteralExpression, key: string): ts.Expression | undefined {
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop) && nameText(prop.name) === key) {
      return prop.initializer;
    }
    if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === key) {
      return prop.name;
    }
  }
  return undefined;
}

function exprHasSkipOrCursorProp(expr: ts.Expression): boolean {
  const u = unwrap(expr);
  if (ts.isObjectLiteralExpression(u)) {
    return Boolean(getProp(u, 'skip') || getProp(u, 'cursor'));
  }
  if (ts.isConditionalExpression(u)) {
    return exprHasSkipOrCursorProp(u.whenTrue) || exprHasSkipOrCursorProp(u.whenFalse);
  }
  if (
    ts.isBinaryExpression(u) &&
    (u.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      u.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      u.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return exprHasSkipOrCursorProp(u.left) || exprHasSkipOrCursorProp(u.right);
  }
  return false;
}

function hasPagingProp(obj: ts.ObjectLiteralExpression): boolean {
  if (getProp(obj, 'skip') || getProp(obj, 'cursor')) return true;
  for (const prop of obj.properties) {
    if (ts.isSpreadAssignment(prop) && exprHasSkipOrCursorProp(prop.expression)) {
      return true;
    }
  }
  return false;
}

function enclosingFnOrFile(node: ts.Node): ts.Node {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isFunctionLike(n) || ts.isSourceFile(n)) return n;
  }
  return node.getSourceFile();
}

function findLocalConstInit(ident: ts.Identifier): ts.Expression | undefined {
  const scope = enclosingFnOrFile(ident);
  const name = ident.text;
  let best: ts.VariableDeclaration | undefined;
  const visit = (n: ts.Node) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === name &&
      n.initializer &&
      n.end <= ident.pos
    ) {
      if (!best || n.pos > best.pos) best = n;
    }
    ts.forEachChild(n, visit);
  };
  visit(scope);
  if (best && best.parent && (best.parent.flags & ts.NodeFlags.Const) !== 0) {
    return best.initializer;
  }
  return undefined;
}

/**
 * Returns the final sort key name for every statically reachable branch of an
 * `orderBy` expression, or `null` when missing/empty/unresolvable.
 */
function lastOrderKeys(expr: ts.Expression | undefined, seen = new Set<ts.Node>()): Array<string | null> {
  if (!expr) return [null];
  const u = unwrap(expr);
  if (seen.has(u)) return [null];
  seen.add(u);

  if (ts.isIdentifier(u)) {
    const init = findLocalConstInit(u);
    return init ? lastOrderKeys(init, seen) : [null];
  }
  if (ts.isConditionalExpression(u)) {
    return [
      ...lastOrderKeys(u.whenTrue, new Set(seen)),
      ...lastOrderKeys(u.whenFalse, new Set(seen)),
    ];
  }
  if (ts.isObjectLiteralExpression(u)) {
    if (u.properties.length === 0) return [null];
    const last = u.properties[u.properties.length - 1];
    if (ts.isPropertyAssignment(last) || ts.isShorthandPropertyAssignment(last)) {
      return [nameText(last.name) ?? null];
    }
    return [null];
  }
  if (ts.isArrayLiteralExpression(u)) {
    if (u.elements.length === 0) return [null];
    const last = u.elements[u.elements.length - 1];
    if (ts.isSpreadElement(last)) return [null];
    return lastOrderKeys(last, seen);
  }
  return [null];
}

function sqlTemplateText(tpl: ts.TemplateLiteral): string {
  if (ts.isNoSubstitutionTemplateLiteral(tpl)) return tpl.text;
  let out = tpl.head.text;
  for (const span of tpl.templateSpans) {
    out += ` $__EXPR__ ${span.literal.text}`;
  }
  return out;
}

function rawSqlHasIdTieBreak(sql: string): boolean {
  const offsetIdx = sql.search(/\bOFFSET\b/i);
  if (offsetIdx === -1) return true;
  const beforeOffset = sql.slice(0, offsetIdx);
  const orderMatches = [...beforeOffset.matchAll(/\bORDER\s+BY\b/gi)];
  if (orderMatches.length === 0) return false;
  const lastOrder = orderMatches[orderMatches.length - 1];
  const afterOrderBy = beforeOffset.slice((lastOrder.index ?? 0) + lastOrder[0].length);
  const clause = afterOrderBy.split(/\b(?:LIMIT|FETCH|FOR)\b/i)[0].trim();
  if (!clause) return false;
  const parts = clause
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return false;
  const lastCol = parts[parts.length - 1];
  return /^(?:[A-Za-z_][A-Za-z0-9_]*\.)?"?id"?(?:\s+(?:ASC|DESC))?(?:\s+NULLS\s+(?:FIRST|LAST))?$/i.test(
    lastCol,
  );
}

function isRawSqlTag(tagText: string): boolean {
  return tagText === '$queryRaw' || /(?:\.\$queryRaw|\bPrisma\.sql)$/.test(tagText);
}

function scanSource(
  relPath: string,
  text: string,
  uniqueOrderKeys: Record<string, ReadonlySet<string>> = UNIQUE_ORDER_KEYS,
): Omit<ScanSummary, 'filesScanned'> {
  const sf = ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const findings: PagedOrderFinding[] = [];
  let pagedQueriesInspected = 0;
  let compliantQueries = 0;

  const visit = (n: ts.Node) => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === 'findMany'
    ) {
      const arg0 = n.arguments[0];
      if (arg0) {
        const u = unwrap(arg0);
        if (ts.isObjectLiteralExpression(u) && hasPagingProp(u)) {
          pagedQueriesInspected += 1;
          const siteKey = `${relPath}::${ownerOf(n)}`;
          const allowed = uniqueOrderKeys[siteKey];
          const orderByProp = getProp(u, 'orderBy');
          const keys = lastOrderKeys(orderByProp);
          const ok = keys.length > 0 && keys.every((k) => k === 'id' || (k !== null && Boolean(allowed?.has(k))));
          if (ok) {
            compliantQueries += 1;
          } else {
            const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
            const orderByPreview = orderByProp ? orderByProp.getText(sf).replace(/\s+/g, ' ') : '<missing>';
            findings.push({
              siteKey,
              file: relPath,
              line,
              kind: 'findMany',
              detail: `orderBy=${orderByPreview} (last keys: ${keys.map((k) => k ?? '<unknown>').join(', ')})`,
            });
          }
        }
      }
    }

    if (ts.isTaggedTemplateExpression(n) && isRawSqlTag(n.tag.getText(sf))) {
      const sql = sqlTemplateText(n.template);
      if (/\bOFFSET\b/i.test(sql)) {
        pagedQueriesInspected += 1;
        if (rawSqlHasIdTieBreak(sql)) {
          compliantQueries += 1;
        } else {
          const siteKey = `${relPath}::${ownerOf(n)}#raw`;
          const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
          findings.push({
            siteKey,
            file: relPath,
            line,
            kind: 'raw-sql',
            detail: sql.replace(/\s+/g, ' ').trim().slice(0, 140),
          });
        }
      }
    }

    ts.forEachChild(n, visit);
  };

  visit(sf);
  return { pagedQueriesInspected, compliantQueries, findings };
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (entry.name.endsWith('.ts') && !TEST_FILE.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function scanCodebase(): ScanSummary {
  const files = collectSourceFiles(SRC_ROOT).sort();
  const findings: PagedOrderFinding[] = [];
  let pagedQueriesInspected = 0;
  let compliantQueries = 0;

  for (const full of files) {
    const relPath = relative(SRC_ROOT, full).split(sep).join('/');
    const res = scanSource(relPath, readFileSync(full, 'utf8'));
    pagedQueriesInspected += res.pagedQueriesInspected;
    compliantQueries += res.compliantQueries;
    findings.push(...res.findings);
  }

  return {
    filesScanned: files.length,
    pagedQueriesInspected,
    compliantQueries,
    findings,
  };
}

function evaluateRatchet(
  findings: PagedOrderFinding[],
  allowList: Readonly<Record<string, string>>,
): RatchetEvaluation {
  const foundKeys = new Set(findings.map((f) => f.siteKey));
  const unexpected = findings.filter((f) => !(f.siteKey in allowList));
  const staleAllowList = Object.keys(allowList).filter((key) => !foundKeys.has(key));
  return { unexpected, staleAllowList };
}

describe('V1-67 paged-order census (W11-PAGING-TOTAL-ORDER-A)', () => {
  const summary = scanCodebase();
  const ratchet = evaluateRatchet(summary.findings, ALLOW_LISTED);

  it('non-vacuous: inspects non-test server sources and finds compliant paged queries', () => {
    expect(summary.filesScanned).toBeGreaterThan(200);
    expect(summary.pagedQueriesInspected).toBeGreaterThan(50);
    expect(summary.compliantQueries).toBeGreaterThan(30);
  });

  it('every paged findMany and OFFSET raw SQL query outside ALLOW_LISTED ends with an id (or @unique) tie-breaker', () => {
    expect(
      ratchet.unexpected.map((f) => `${f.siteKey} (${f.file}:${f.line} [${f.kind}] ${f.detail})`),
      'Paged query missing deterministic id tie-breaker at the end of orderBy / ORDER BY',
    ).toEqual([]);
  });

  it('strictly shrinking ratchet: every ALLOW_LISTED entry still exists and still offends', () => {
    expect(
      ratchet.staleAllowList,
      'Remove fixed or deleted sites from ALLOW_LISTED so the ratchet only shrinks',
    ).toEqual([]);
  });

  describe('self-test / negative controls', () => {
    it('flags findMany with skip and non-id orderBy, and passes when ending in { id: desc }', () => {
      const bad = scanSource(
        'synthetic/bad-offset.ts',
        `
        class Svc {
          list() {
            return this.prisma.item.findMany({ skip: 1, take: 10, orderBy: { createdAt: 'desc' } });
          }
        }
        `,
      );
      expect(bad.findings.map((f) => f.siteKey)).toEqual(['synthetic/bad-offset.ts::Svc.list']);

      const good = scanSource(
        'synthetic/good-offset.ts',
        `
        class Svc {
          list() {
            return this.prisma.item.findMany({
              skip: 1,
              take: 10,
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            });
          }
        }
        `,
      );
      expect(good.findings).toEqual([]);
      expect(good.compliantQueries).toBe(1);
    });

    it('flags cursor-paged findMany (direct and spread) without id tie-breaker and passes once added', () => {
      const badSpread = scanSource(
        'synthetic/bad-cursor.ts',
        `
        class Svc {
          list(cursor?: string) {
            return this.prisma.item.findMany({
              orderBy: { createdAt: 'desc' },
              take: 20,
              ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            });
          }
        }
        `,
      );
      expect(badSpread.findings.map((f) => f.siteKey)).toEqual(['synthetic/bad-cursor.ts::Svc.list']);

      const goodSpread = scanSource(
        'synthetic/good-cursor.ts',
        `
        class Svc {
          list(cursor?: string) {
            return this.prisma.item.findMany({
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              take: 20,
              ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            });
          }
        }
        `,
      );
      expect(goodSpread.findings).toEqual([]);
      expect(goodSpread.compliantQueries).toBe(1);
    });

    it('flags $queryRaw and Prisma.sql with OFFSET lacking trailing id in ORDER BY, and passes when present', () => {
      const badRaw = scanSource(
        'synthetic/bad-raw.ts',
        `
        class Svc {
          async page(take: number, off: number) {
            await this.prisma.$queryRaw\`SELECT id FROM items ORDER BY created_at DESC LIMIT 10 OFFSET 5\`;
            await this.prisma.$queryRaw(Prisma.sql\`SELECT ci.id FROM command_items ci ORDER BY ci.created_at DESC LIMIT \${take} OFFSET \${off}\`);
          }
        }
        `,
      );
      expect(badRaw.findings).toHaveLength(2);
      expect(badRaw.findings.every((f) => f.kind === 'raw-sql')).toBe(true);

      const goodRaw = scanSource(
        'synthetic/good-raw.ts',
        `
        class Svc {
          async page(take: number, off: number) {
            await this.prisma.$queryRaw\`SELECT id FROM items ORDER BY created_at DESC, id DESC LIMIT 10 OFFSET 5\`;
            await this.prisma.$queryRaw(Prisma.sql\`SELECT ci.id FROM command_items ci ORDER BY ci.created_at DESC, ci.id DESC LIMIT \${take} OFFSET \${off}\`);
          }
        }
        `,
      );
      expect(goodRaw.findings).toEqual([]);
      expect(goodRaw.compliantQueries).toBe(2);
    });

    it('respects UNIQUE_ORDER_KEYS only for registered sites', () => {
      const src = `
        class UsersCtrl {
          listUsers() {
            return this.prisma.user.findMany({ skip: 0, take: 20, orderBy: { email: 'asc' } });
          }
        }
      `;
      const withoutUnique = scanSource('synthetic/users.ts', src, {});
      expect(withoutUnique.findings.map((f) => f.siteKey)).toEqual(['synthetic/users.ts::UsersCtrl.listUsers']);

      const withUnique = scanSource('synthetic/users.ts', src, {
        'synthetic/users.ts::UsersCtrl.listUsers': new Set(['email']),
      });
      expect(withUnique.findings).toEqual([]);
      expect(withUnique.compliantQueries).toBe(1);
    });

    it('detects stale ALLOW_LISTED entries when a site is fixed or removed', () => {
      const fixed = scanSource(
        'synthetic/fixed.ts',
        `
        class Svc {
          list() {
            return this.prisma.item.findMany({
              skip: 0,
              take: 10,
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            });
          }
        }
        `,
      );
      const evalResult = evaluateRatchet(fixed.findings, {
        'synthetic/fixed.ts::Svc.list': 'already-fixed',
        'synthetic/deleted.ts::Ghost.list': 'no-longer-exists',
      });
      expect(evalResult.unexpected).toEqual([]);
      expect(evalResult.staleAllowList).toEqual([
        'synthetic/fixed.ts::Svc.list',
        'synthetic/deleted.ts::Ghost.list',
      ]);
    });
  });
});
