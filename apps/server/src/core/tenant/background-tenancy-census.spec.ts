/**
 * P148 / RR-JOB-TENANT-CONTEXT (D-261 / D-262 / D-17 / D-103) —
 * Living AST census of EVERY background entry point in `apps/server/src`.
 *
 * WHY:
 * The Prisma tenant isolation extension (`packages/db/src/client.ts`) only
 * scopes queries when an AsyncLocalStorage tenant context is active. HTTP
 * requests install one via `TenantInterceptor`, whereas background entry points
 * (`@Cron`, `@Interval`, `safeInterval`, `setInterval`, BullMQ `new Worker`,
 * `@Processor`) run outside HTTP and have NO ambient tenant unless they wrap
 * each tenant's work in `runForTenant(businessId, fn)`.
 *
 * WHAT THIS SPEC CHECKS (TypeScript AST over `apps/server/src`, excluding tests):
 *   1. Discovers every `@Cron(...)`, `@Interval(...)`, `safeInterval(...)`,
 *      `setInterval(...)` (excluding `core/scheduling/safe-interval.ts`),
 *      BullMQ `new Worker(...)`, and `@Processor(...)` entry point.
 *   2. Enforces exact 1:1 parity against `BACKGROUND_TENANCY_CENSUS`:
 *      - Any unlisted discovered entry point fails.
 *      - Any stale registry row whose source entry point no longer exists fails.
 *      - Every entry's `file` and `kind` must match the AST discovery.
 *   3. Enforces per-mode invariants:
 *      - `PER_TENANT_WRAPPED`: MUST declare a non-empty `wrappingMethod` AND
 *        ACTUALLY invoke `runForTenant(...)` in its AST body (comments do not
 *        count).
 *      - `PER_TENANT_OPEN`: MUST name the follow-up slice/packet that will wrap it.
 *      - `GLOBAL`: MUST state an explicit reason why it is genuinely global /
 *        in-process / non-tenant.
 *   4. Synthetic AST negative controls prove the scanner catches unlisted
 *      `@Cron`, `@Interval`, `safeInterval`, `setInterval`, `new Worker`,
 *      `@Processor`, stale rows, and a `PER_TENANT_WRAPPED` claim without a
 *      real `runForTenant(...)` call.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import * as ts from 'typescript';

const SRC = resolve(__dirname, '../..');

export type BackgroundEntryKind =
  | '@Cron'
  | '@Interval'
  | 'safeInterval'
  | 'setInterval'
  | 'new Worker'
  | '@Processor';

export interface DiscoveredBackgroundEntry {
  key: string;
  file: string;
  kind: BackgroundEntryKind;
  callsRunForTenant: boolean;
}

export type BackgroundTenancyRow =
  | {
      key: string;
      file: string;
      kind: BackgroundEntryKind;
      mode: 'PER_TENANT_WRAPPED';
      wrappingMethod: string;
      notes: string;
    }
  | {
      key: string;
      file: string;
      kind: BackgroundEntryKind;
      mode: 'PER_TENANT_OPEN';
      followUpSlice: string;
    }
  | {
      key: string;
      file: string;
      kind: BackgroundEntryKind;
      mode: 'GLOBAL';
      reason: string;
    };

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTsFiles(full, out);
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

function getDecorators(node: ts.Node): readonly ts.Decorator[] {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
}

function decoratorName(dec: ts.Decorator, sf: ts.SourceFile): string {
  const expr = dec.expression;
  if (ts.isCallExpression(expr)) {
    return expr.expression.getText(sf);
  }
  return expr.getText(sf);
}

function firstStringLiteral(args: ts.NodeArray<ts.Expression> | undefined): string | null {
  if (!args || args.length === 0) return null;
  const first = args[0];
  if (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) {
    return first.text;
  }
  return null;
}

/** True iff `root` contains a real AST CallExpression invoking `runForTenant(...)`. */
function subtreeCallsRunForTenant(root: ts.Node | undefined, sf: ts.SourceFile): boolean {
  if (!root) return false;
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && callee.text === 'runForTenant') {
        found = true;
        return;
      }
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'runForTenant') {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

/** Collect `this.<methodName>(...)` method names invoked inside `root`. */
function directThisMethodCalls(root: ts.Node | undefined): string[] {
  if (!root) return [];
  const names: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.kind === ts.SyntaxKind.ThisKeyword
    ) {
      names.push(node.expression.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return names;
}

function classMethodMap(cls: ts.ClassDeclaration | undefined, sf: ts.SourceFile): Map<string, ts.MethodDeclaration> {
  const map = new Map<string, ts.MethodDeclaration>();
  if (!cls) return map;
  for (const member of cls.members) {
    if (ts.isMethodDeclaration(member)) {
      map.set(member.name.getText(sf), member);
    }
  }
  return map;
}

function callbackCallsRunForTenant(
  callbackArg: ts.Expression | undefined,
  enclosingMethodBody: ts.Node | undefined,
  methodsByName: Map<string, ts.MethodDeclaration>,
  sf: ts.SourceFile,
): boolean {
  if (subtreeCallsRunForTenant(callbackArg, sf)) return true;
  if (subtreeCallsRunForTenant(enclosingMethodBody, sf)) return true;
  for (const target of directThisMethodCalls(callbackArg)) {
    const targetMethod = methodsByName.get(target);
    if (targetMethod && subtreeCallsRunForTenant(targetMethod.body, sf)) {
      return true;
    }
  }
  return false;
}

export function scanSourceForBackgroundEntries(
  relFile: string,
  sourceText: string,
): DiscoveredBackgroundEntry[] {
  if (relFile === 'core/scheduling/safe-interval.ts') return [];

  const sf = ts.createSourceFile(relFile, sourceText, ts.ScriptTarget.Latest, true);
  const discovered: DiscoveredBackgroundEntry[] = [];
  const perMethodCounts = new Map<string, number>();

  const visit = (
    node: ts.Node,
    curClass: ts.ClassDeclaration | undefined,
    curClassName: string,
    curMethodName: string,
    curMethodBody: ts.Node | undefined,
  ) => {
    let nextClass = curClass;
    let nextClassName = curClassName;
    let nextMethodName = curMethodName;
    let nextMethodBody = curMethodBody;

    if (ts.isClassDeclaration(node)) {
      nextClass = node;
      nextClassName = node.name?.text ?? '<Anonymous>';
      for (const dec of getDecorators(node)) {
        if (decoratorName(dec, sf) === 'Processor') {
          const queueArg = ts.isCallExpression(dec.expression)
            ? firstStringLiteral(dec.expression.arguments)
            : null;
          const key = queueArg ? `${nextClassName}[${queueArg}]` : nextClassName;
          discovered.push({
            key,
            file: relFile,
            kind: '@Processor',
            callsRunForTenant: subtreeCallsRunForTenant(node, sf),
          });
        }
      }
    }

    if (ts.isConstructorDeclaration(node)) {
      nextMethodName = 'constructor';
      nextMethodBody = node.body;
    } else if (ts.isMethodDeclaration(node)) {
      nextMethodName = node.name.getText(sf);
      nextMethodBody = node.body;
      for (const dec of getDecorators(node)) {
        const dn = decoratorName(dec, sf);
        if (dn === 'Cron' || dn === 'Interval') {
          discovered.push({
            key: `${nextClassName}.${nextMethodName}`,
            file: relFile,
            kind: `@${dn}` as '@Cron' | '@Interval',
            callsRunForTenant: subtreeCallsRunForTenant(node.body, sf),
          });
        }
      }
    }

    if (ts.isCallExpression(node)) {
      const expr = node.expression.getText(sf);
      if (expr === 'safeInterval') {
        const label = firstStringLiteral(node.arguments);
        const base = `${nextClassName}.${nextMethodName}`;
        const key = label ? `${base}[${label}]` : base;
        const methods = classMethodMap(nextClass, sf);
        discovered.push({
          key,
          file: relFile,
          kind: 'safeInterval',
          callsRunForTenant: callbackCallsRunForTenant(node.arguments[2], nextMethodBody, methods, sf),
        });
      } else if (expr === 'setInterval') {
        const base = `${nextClassName}.${nextMethodName}`;
        const count = (perMethodCounts.get(`setInterval:${base}`) ?? 0) + 1;
        perMethodCounts.set(`setInterval:${base}`, count);
        const key = count === 1 ? base : `${base}[#${count}]`;
        const methods = classMethodMap(nextClass, sf);
        discovered.push({
          key,
          file: relFile,
          kind: 'setInterval',
          callsRunForTenant: callbackCallsRunForTenant(node.arguments[0], nextMethodBody, methods, sf),
        });
      }
    }

    if (ts.isNewExpression(node)) {
      const expr = node.expression.getText(sf);
      if (expr === 'Worker' || expr.endsWith('.Worker')) {
        const queueName = firstStringLiteral(node.arguments);
        const base = `${nextClassName}.${nextMethodName}`;
        const key = queueName ? `${base}[${queueName}]` : base;
        const methods = classMethodMap(nextClass, sf);
        discovered.push({
          key,
          file: relFile,
          kind: 'new Worker',
          callsRunForTenant: callbackCallsRunForTenant(node.arguments?.[1], nextMethodBody, methods, sf),
        });
      }
    }

    ts.forEachChild(node, (child) =>
      visit(child, nextClass, nextClassName, nextMethodName, nextMethodBody),
    );
  };

  visit(sf, undefined, '<module>', '<top>', undefined);
  return discovered;
}

export function scanRepoBackgroundEntries(srcRoot: string): DiscoveredBackgroundEntry[] {
  const found: DiscoveredBackgroundEntry[] = [];
  for (const absFile of walkTsFiles(srcRoot)) {
    const relFile = relative(srcRoot, absFile).split(sep).join('/');
    const sourceText = readFileSync(absFile, 'utf8');
    found.push(...scanSourceForBackgroundEntries(relFile, sourceText));
  }
  found.sort(
    (a, b) =>
      a.key.localeCompare(b.key) || a.file.localeCompare(b.file) || a.kind.localeCompare(b.kind),
  );
  return found;
}

export function diffAgainstBackgroundCensus(
  discovered: readonly DiscoveredBackgroundEntry[],
  census: readonly BackgroundTenancyRow[],
): {
  unlisted: DiscoveredBackgroundEntry[];
  stale: BackgroundTenancyRow[];
  mismatchedMeta: Array<{ key: string; expected: string; actual: string }>;
  missingRunForTenant: string[];
  duplicateCensusKeys: string[];
} {
  const censusByKey = new Map<string, BackgroundTenancyRow>();
  const duplicateCensusKeys: string[] = [];
  for (const row of census) {
    if (censusByKey.has(row.key)) duplicateCensusKeys.push(row.key);
    censusByKey.set(row.key, row);
  }

  const discoveredByKey = new Map<string, DiscoveredBackgroundEntry>();
  for (const entry of discovered) {
    discoveredByKey.set(entry.key, entry);
  }

  const unlisted = discovered.filter((d) => !censusByKey.has(d.key));
  const stale = census.filter((c) => !discoveredByKey.has(c.key));
  const mismatchedMeta: Array<{ key: string; expected: string; actual: string }> = [];
  const missingRunForTenant: string[] = [];

  for (const row of census) {
    const found = discoveredByKey.get(row.key);
    if (!found) continue;
    if (found.file !== row.file || found.kind !== row.kind) {
      mismatchedMeta.push({
        key: row.key,
        expected: `${row.kind} @ ${row.file}`,
        actual: `${found.kind} @ ${found.file}`,
      });
    }
    if (row.mode === 'PER_TENANT_WRAPPED' && !found.callsRunForTenant) {
      missingRunForTenant.push(row.key);
    }
  }

  return { unlisted, stale, mismatchedMeta, missingRunForTenant, duplicateCensusKeys };
}

/**
 * Exhaustive registry of every background entry point in `apps/server/src`.
 *
 * Counts at P148 (`RR-JOB-TENANT-CONTEXT`):
 *   - PER_TENANT_WRAPPED: 1  (`KeyCortexHomeostasisService.scheduledHomeostasis`)
 *   - PER_TENANT_OPEN:   81  (named follow-up slices; one RED per slice)
 *   - GLOBAL:             7  (in-process memory cleanup / process observability / global FX / platform RISC / WS live-revocation)
 */
export const BACKGROUND_TENANCY_CENSUS: readonly BackgroundTenancyRow[] = [
  // ── PER_TENANT_WRAPPED (1) ─────────────────────────────────────────────────
  {
    key: 'KeyCortexHomeostasisService.scheduledHomeostasis',
    file: 'modules/key-cortex/key-cortex-homeostasis.service.ts',
    kind: '@Cron',
    mode: 'PER_TENANT_WRAPPED',
    wrappingMethod: 'KeyCortexHomeostasisService.scheduledHomeostasis',
    notes: 'P148 (RR-JOB-TENANT-CONTEXT): wraps each businessId regulate() call in runForTenant(businessId, ...)',
  },

  // ── GLOBAL (7) ─────────────────────────────────────────────────────────────
  {
    key: 'AiUsageService.constructor[AiUsageService.rateLimitCleanup]',
    file: 'modules/ai/ai-usage.service.ts',
    kind: 'safeInterval',
    mode: 'GLOBAL',
    reason: 'In-process memory cleanup of sliding-window rateLimitMap entries; touches no database tables.',
  },
  {
    key: 'CurrencyRatesScheduler.onModuleInit[CurrencyRatesScheduler]',
    file: 'modules/payments/currency-rates.scheduler.ts',
    kind: 'safeInterval',
    mode: 'GLOBAL',
    reason: 'Refreshes shared global FX exchange-rate cache from external feed; not tenant-owned.',
  },
  {
    key: 'ErrorDigestService.onModuleInit[ErrorDigestService]',
    file: 'core/observability/error-digest.service.ts',
    kind: 'safeInterval',
    mode: 'GLOBAL',
    reason: 'Process-wide in-memory errorRegistry digest logger; touches no database tables.',
  },
  {
    key: 'KeyCortexExecutorService.constructor[KeyCortexExecutorService]',
    file: 'modules/key-cortex/key-cortex-executor.service.ts',
    kind: 'safeInterval',
    mode: 'GLOBAL',
    reason: 'In-process memory cleanup of expired pendingApprovals map handles; touches no database tables.',
  },
  {
    key: 'KeyCortexGateway.afterInit',
    file: 'modules/key-cortex/key-cortex.gateway.ts',
    kind: 'setInterval',
    mode: 'GLOBAL',
    reason: 'Cross-socket WebSocket live-revocation security control (R0-W) sweeping all connected sockets.',
  },
  {
    key: 'RiscRetentionService.scheduledPurgeExpiredEvents',
    file: 'modules/risc/risc-retention.service.ts',
    kind: '@Cron',
    mode: 'GLOBAL',
    reason: 'Platform-wide GDPR retention purge of Google account-level RiscEvent rows (table has no businessId).',
  },
  {
    key: 'SocialConnectionsService.constructor[SocialConnectionsService]',
    file: 'modules/social/social-connections.service.ts',
    kind: 'safeInterval',
    mode: 'GLOBAL',
    reason: 'In-process memory cleanup of expired OAuth PKCE session map entries; touches no database tables.',
  },

  // ── PER_TENANT_OPEN (81) ───────────────────────────────────────────────────
  // Slice: RR-JOB-TENANT-KEY-CORTEX (remaining KEY cortex crons & intervals)
  {
    key: 'KeyBiEngineService.refreshAll',
    file: 'modules/key-cortex/key-bi-engine.service.ts',
    kind: '@Cron',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-KEY-CORTEX',
  },
  {
    key: 'KeyCortexCerebellumService.scheduledConsolidation',
    file: 'modules/key-cortex/key-cortex-cerebellum.service.ts',
    kind: '@Cron',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-KEY-CORTEX',
  },
  {
    key: 'KeyCortexCreativityService.scheduledCreativeExploration',
    file: 'modules/key-cortex/key-cortex-creativity.service.ts',
    kind: '@Cron',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-KEY-CORTEX',
  },
  {
    key: 'KeyCortexIntuitionService.scheduledChurnAnalysis',
    file: 'modules/key-cortex/key-cortex-intuition.service.ts',
    kind: '@Cron',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-KEY-CORTEX',
  },
  {
    key: 'KeyCortexIntuitionService.scheduledIntuitionScan',
    file: 'modules/key-cortex/key-cortex-intuition.service.ts',
    kind: '@Cron',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-KEY-CORTEX',
  },
  {
    key: 'KeyCortexRealtimeService.handlePeriodicHealthPushTick',
    file: 'modules/key-cortex/key-cortex-realtime.service.ts',
    kind: '@Interval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-KEY-CORTEX',
  },
  {
    key: 'KeyCortexReflectionService.scheduledDream',
    file: 'modules/key-cortex/key-cortex-reflection.service.ts',
    kind: '@Cron',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-KEY-CORTEX',
  },
  {
    key: 'KeyCortexReflectionService.scheduledMaintenance',
    file: 'modules/key-cortex/key-cortex-reflection.service.ts',
    kind: '@Cron',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-KEY-CORTEX',
  },
  {
    key: 'KeyCortexReflectionService.scheduledReflection',
    file: 'modules/key-cortex/key-cortex-reflection.service.ts',
    kind: '@Cron',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-KEY-CORTEX',
  },
  {
    key: 'KeyCortexReflectionService.scheduledSynthesis',
    file: 'modules/key-cortex/key-cortex-reflection.service.ts',
    kind: '@Cron',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-KEY-CORTEX',
  },
  {
    key: 'KeyCortexSalienceService.scheduledAppraisal',
    file: 'modules/key-cortex/key-cortex-salience.service.ts',
    kind: '@Cron',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-KEY-CORTEX',
  },
  {
    key: 'KeyProactiveEngineService.evaluateProactiveActions',
    file: 'modules/key-cortex/key-proactive-engine.service.ts',
    kind: '@Cron',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-KEY-CORTEX',
  },
  {
    key: 'KeyProactiveEngineService.generateEndOfDayReports',
    file: 'modules/key-cortex/key-proactive-engine.service.ts',
    kind: '@Cron',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-KEY-CORTEX',
  },
  {
    key: 'KeyProactiveEngineService.generateMorningBriefs',
    file: 'modules/key-cortex/key-proactive-engine.service.ts',
    kind: '@Cron',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-KEY-CORTEX',
  },
  {
    key: 'KeyProactiveEngineService.generateWeeklyDigests',
    file: 'modules/key-cortex/key-proactive-engine.service.ts',
    kind: '@Cron',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-KEY-CORTEX',
  },
  {
    key: 'MemoryConsolidationService.scheduledConsolidation',
    file: 'modules/key-cortex/memory-consolidation.service.ts',
    kind: '@Cron',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-KEY-CORTEX',
  },

  // Slice: RR-JOB-TENANT-BULLMQ-WORKERS (BullMQ queue workers)
  {
    key: 'BusinessEventQueueService.onModuleInit[business-events]',
    file: 'modules/business-events/business-event.queue.ts',
    kind: 'new Worker',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-BULLMQ-WORKERS',
  },
  {
    key: 'QueueService.onModuleInit[ai-cron-triggers]',
    file: 'modules/ai/queue.service.ts',
    kind: 'new Worker',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-BULLMQ-WORKERS',
  },
  {
    key: 'QueueService.onModuleInit[ai-plan-steps]',
    file: 'modules/ai/queue.service.ts',
    kind: 'new Worker',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-BULLMQ-WORKERS',
  },
  {
    key: 'TemporalFlowMemoryQueueService.onModuleInit[temporal-flow-memory]',
    file: 'modules/temporal-flow/temporal-flow-memory.queue.service.ts',
    kind: 'new Worker',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-BULLMQ-WORKERS',
  },

  // Slice: RR-JOB-TENANT-AI-AUTOPILOT (AI, autopilot, temporal-flow, genome, intelligence)
  {
    key: 'AgentHealthService.onModuleInit[AgentHealthService]',
    file: 'modules/ai/agent-health.service.ts',
    kind: 'safeInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-AI-AUTOPILOT',
  },
  {
    key: 'AiUsageAlertSchedulerService.onModuleInit',
    file: 'modules/ai/ai-usage-alert-scheduler.service.ts',
    kind: 'setInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-AI-AUTOPILOT',
  },
  {
    key: 'ConnectorIntelligenceService.onModuleInit[ConnectorIntelligenceService]',
    file: 'modules/ai/connector-intelligence.service.ts',
    kind: 'safeInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-AI-AUTOPILOT',
  },
  {
    key: 'DelegationLoopService.onModuleInit',
    file: 'modules/autopilot/delegation-loop.service.ts',
    kind: 'setInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-AI-AUTOPILOT',
  },
  {
    key: 'GenomeDecayService.markStaleFacts',
    file: 'modules/business-genome/key-genome/genome-decay.service.ts',
    kind: '@Cron',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-AI-AUTOPILOT',
  },
  {
    key: 'MatchRefreshSchedulerService.onModuleInit[MatchRefreshSchedulerService]',
    file: 'modules/ai/match-refresh-scheduler.service.ts',
    kind: 'safeInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-AI-AUTOPILOT',
  },
  {
    key: 'PatternDetectorService.onModuleInit[PatternDetectorService]',
    file: 'modules/ai/pattern-detector.service.ts',
    kind: 'safeInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-AI-AUTOPILOT',
  },
  {
    key: 'PlanExecutorService.onModuleInit[PlanExecutorService]',
    file: 'modules/ai/plan-executor.service.ts',
    kind: 'safeInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-AI-AUTOPILOT',
  },
  {
    key: 'ProAutoMonitorService.onModuleInit',
    file: 'modules/ai/pro-auto-monitor.service.ts',
    kind: 'setInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-AI-AUTOPILOT',
  },
  {
    key: 'ScheduledScansService.runAllScansTick',
    file: 'modules/intelligence/scheduled-scans.service.ts',
    kind: '@Interval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-AI-AUTOPILOT',
  },
  {
    key: 'TemporalFlowGenomeBridgeService.detectPatternsForAllTick',
    file: 'modules/temporal-flow/temporal-flow-genome-bridge.service.ts',
    kind: '@Interval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-AI-AUTOPILOT',
  },

  // Slice: RR-JOB-TENANT-COMMERCE-FINANCE (commerce, finance, expenses, contracts)
  {
    key: 'ContractRenewalSweep.scheduledSweep',
    file: 'modules/contracts/contract-renewal.sweep.ts',
    kind: '@Cron',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-COMMERCE-FINANCE',
  },
  {
    key: 'FinanceIntelligenceSchedulerService.onModuleInit',
    file: 'modules/finance/finance-intelligence.scheduler.ts',
    kind: 'setInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-COMMERCE-FINANCE',
  },
  {
    key: 'FinancialBriefingSchedulerService.onModuleInit[FinancialBriefingSchedulerService]',
    file: 'modules/commerce/financial-briefing-scheduler.service.ts',
    kind: 'safeInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-COMMERCE-FINANCE',
  },
  {
    key: 'InvoiceOverdueScheduler.onModuleInit',
    file: 'modules/commerce/invoice-overdue.scheduler.ts',
    kind: 'setInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-COMMERCE-FINANCE',
  },
  {
    key: 'MarginSnapshotSchedulerService.onModuleInit[MarginSnapshotSchedulerService]',
    file: 'modules/commerce/margin-snapshot-scheduler.service.ts',
    kind: 'safeInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-COMMERCE-FINANCE',
  },
  {
    key: 'QuoteStaleScheduler.onModuleInit',
    file: 'modules/commerce/quote-stale.scheduler.ts',
    kind: 'setInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-COMMERCE-FINANCE',
  },
  {
    key: 'RecurringExpenseService.onModuleInit',
    file: 'modules/expenses/recurring-expense.service.ts',
    kind: 'setInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-COMMERCE-FINANCE',
  },
  {
    key: 'RecurringInvoiceService.onModuleInit',
    file: 'modules/commerce/recurring-invoice.service.ts',
    kind: 'setInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-COMMERCE-FINANCE',
  },
  {
    key: 'RecurringJournalEntryService.onModuleInit[RecurringJournalEntryService]',
    file: 'modules/finance/recurring-journal-entry.service.ts',
    kind: 'safeInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-COMMERCE-FINANCE',
  },
  {
    key: 'RevenueActionService.onModuleInit',
    file: 'modules/commerce/revenue-action.service.ts',
    kind: 'setInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-COMMERCE-FINANCE',
  },
  {
    key: 'RevenueReportingRollupScheduler.onModuleInit',
    file: 'modules/commerce/revenue-reporting-rollup.scheduler.ts',
    kind: 'setInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-COMMERCE-FINANCE',
  },
  {
    key: 'StatementSourceService.scheduledSweepAll',
    file: 'modules/finance/statement-source.service.ts',
    kind: '@Cron',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-COMMERCE-FINANCE',
  },
  {
    key: 'TaxLiabilityRollupScheduler.onModuleInit',
    file: 'modules/finance/tax-liability-rollup.scheduler.ts',
    kind: 'setInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-COMMERCE-FINANCE',
  },
  {
    key: 'WeeklyRevenueReviewScheduler.onModuleInit',
    file: 'modules/commerce/weekly-revenue-review.scheduler.ts',
    kind: 'setInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-COMMERCE-FINANCE',
  },

  // Slice: RR-JOB-TENANT-CRM-COMMS (CRM, email, social, WhatsApp, communications, notifications)
  {
    key: 'BestChannelSchedulerService.onModuleInit[BestChannelSchedulerService]',
    file: 'modules/crm/best-channel-scheduler.service.ts',
    kind: 'safeInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-CRM-COMMS',
  },
  {
    key: 'CampaignSchedulerService.onModuleInit[CampaignSchedulerService.briefing]',
    file: 'modules/email-marketing/campaign-scheduler.service.ts',
    kind: 'safeInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-CRM-COMMS',
  },
  {
    key: 'CampaignSchedulerService.onModuleInit[CampaignSchedulerService]',
    file: 'modules/email-marketing/campaign-scheduler.service.ts',
    kind: 'safeInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-CRM-COMMS',
  },
  {
    key: 'ContactPrivacyService.onModuleInit[ContactPrivacyService]',
    file: 'modules/crm/privacy/contact-privacy.service.ts',
    kind: 'safeInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-CRM-COMMS',
  },
  {
    key: 'CrmDataQualityScheduler.onModuleInit[CrmDataQualityScheduler]',
    file: 'modules/crm/crm-data-quality.scheduler.ts',
    kind: 'safeInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-CRM-COMMS',
  },
  {
    key: 'CrmRelationshipHealthSchedulerService.onModuleInit',
    file: 'modules/crm/crm-relationship-health-scheduler.service.ts',
    kind: 'setInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-CRM-COMMS',
  },
  {
    key: 'CrmSequenceSchedulerService.onModuleInit',
    file: 'modules/crm/crm-sequence-scheduler.service.ts',
    kind: 'setInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-CRM-COMMS',
  },
  {
    key: 'DealIntelligenceSchedulerService.onModuleInit',
    file: 'modules/crm/deal-intelligence-scheduler.service.ts',
    kind: 'setInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-CRM-COMMS',
  },
  {
    key: 'DeliveryQueueService.onModuleInit[DeliveryQueueService]',
    file: 'modules/communications/delivery-queue.service.ts',
    kind: 'safeInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-CRM-COMMS',
  },
  {
    key: 'LeadScoringScheduler.onModuleInit',
    file: 'modules/crm/lead-scoring.scheduler.ts',
    kind: 'setInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-CRM-COMMS',
  },
  {
    key: 'SocialGapDetectorService.onModuleInit',
    file: 'modules/social/social-gap-detector.service.ts',
    kind: 'setInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-CRM-COMMS',
  },
  {
    key: 'SocialSchedulerService.onModuleInit',
    file: 'modules/social/social-scheduler.service.ts',
    kind: 'setInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-CRM-COMMS',
  },
  {
    key: 'TransactionalEmailService.onModuleInit',
    file: 'modules/notifications/transactional-email.service.ts',
    kind: 'setInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-CRM-COMMS',
  },
  {
    key: 'WhatsAppService.dispatchScheduledTick',
    file: 'modules/whatsapp/whatsapp.service.ts',
    kind: '@Cron',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-CRM-COMMS',
  },

  // Slice: RR-JOB-TENANT-OPS-FLOW-ANALYTICS (bookings, calendar, connectors, flow, command, analytics, storefront, conversion, growth, momentum)
  {
    key: 'AbandonedCartRecoveryService.onModuleInit',
    file: 'modules/conversion/abandoned-cart-recovery.service.ts',
    kind: 'setInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-OPS-FLOW-ANALYTICS',
  },
  {
    key: 'AbandonedCheckoutScheduler.onModuleInit',
    file: 'modules/public-events/abandoned-checkout.scheduler.ts',
    kind: 'setInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-OPS-FLOW-ANALYTICS',
  },
  {
    key: 'AnalyticsSchedulerService.assessMaturity',
    file: 'modules/analytics/analytics-scheduler.service.ts',
    kind: '@Cron',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-OPS-FLOW-ANALYTICS',
  },
  {
    key: 'AnalyticsSchedulerService.generateDailySnapshots',
    file: 'modules/analytics/analytics-scheduler.service.ts',
    kind: '@Cron',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-OPS-FLOW-ANALYTICS',
  },
  {
    key: 'AnalyticsSchedulerService.generateInsights',
    file: 'modules/analytics/analytics-scheduler.service.ts',
    kind: '@Cron',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-OPS-FLOW-ANALYTICS',
  },
  {
    key: 'AnalyticsSchedulerService.generateMonthlySnapshots',
    file: 'modules/analytics/analytics-scheduler.service.ts',
    kind: '@Cron',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-OPS-FLOW-ANALYTICS',
  },
  {
    key: 'AnalyticsSchedulerService.generateProjections',
    file: 'modules/analytics/analytics-scheduler.service.ts',
    kind: '@Cron',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-OPS-FLOW-ANALYTICS',
  },
  {
    key: 'AnalyticsSchedulerService.generateWeeklySnapshots',
    file: 'modules/analytics/analytics-scheduler.service.ts',
    kind: '@Cron',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-OPS-FLOW-ANALYTICS',
  },
  {
    key: 'BookingsService.onModuleInit',
    file: 'modules/bookings/bookings.service.ts',
    kind: 'setInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-OPS-FLOW-ANALYTICS',
  },
  {
    key: 'CalendarInsightSchedulerService.onModuleInit',
    file: 'modules/calendar/calendar-insight-scheduler.service.ts',
    kind: 'setInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-OPS-FLOW-ANALYTICS',
  },
  {
    key: 'CalendarSyncScheduler.onModuleInit[CalendarSyncScheduler]',
    file: 'modules/calendar/calendar-sync.scheduler.ts',
    kind: 'safeInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-OPS-FLOW-ANALYTICS',
  },
  {
    key: 'CommandSchedulerService.scheduledScanTick',
    file: 'modules/command/command-scheduler.service.ts',
    kind: '@Interval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-OPS-FLOW-ANALYTICS',
  },
  {
    key: 'ConnectorHealthMonitorService.onModuleInit[ConnectorHealthMonitorService]',
    file: 'core/connectors/connector-health-monitor.service.ts',
    kind: 'safeInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-OPS-FLOW-ANALYTICS',
  },
  {
    key: 'ConnectorSyncSchedulerService.onModuleInit[ConnectorSyncSchedulerService]',
    file: 'core/connectors/connector-sync-scheduler.service.ts',
    kind: 'safeInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-OPS-FLOW-ANALYTICS',
  },
  {
    key: 'CrossModuleAgentService.startJobPoller',
    file: 'modules/flow/cross-module-agent.service.ts',
    kind: 'setInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-OPS-FLOW-ANALYTICS',
  },
  {
    key: 'FlowListener.onModuleInit',
    file: 'modules/flow/flow.listener.ts',
    kind: 'setInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-OPS-FLOW-ANALYTICS',
  },
  {
    key: 'GrowthIntelligenceSchedulerService.onModuleInit[GrowthIntelligenceSchedulerService]',
    file: 'modules/growth-intelligence/growth-intelligence-scheduler.service.ts',
    kind: 'safeInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-OPS-FLOW-ANALYTICS',
  },
  {
    key: 'MomentumSchedulerService.onModuleInit[MomentumSchedulerService]',
    file: 'modules/momentum/momentum-scheduler.service.ts',
    kind: 'safeInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-OPS-FLOW-ANALYTICS',
  },
  {
    key: 'PresenceAggregatorScheduler.onModuleInit',
    file: 'modules/public-events/presence-aggregator.scheduler.ts',
    kind: 'setInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-OPS-FLOW-ANALYTICS',
  },
  {
    key: 'ReviewSolicitationService.onModuleInit',
    file: 'modules/conversion/review-solicitation.service.ts',
    kind: 'setInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-OPS-FLOW-ANALYTICS',
  },
  {
    key: 'StorefrontConversionScheduler.onModuleInit',
    file: 'modules/site/storefront-conversion.scheduler.ts',
    kind: 'setInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-OPS-FLOW-ANALYTICS',
  },
  {
    key: 'StorefrontIntelligenceScheduler.onModuleInit',
    file: 'modules/site/presence/storefront-intelligence.scheduler.ts',
    kind: 'setInterval',
    mode: 'PER_TENANT_OPEN',
    followUpSlice: 'RR-JOB-TENANT-OPS-FLOW-ANALYTICS',
  },
];

describe('P148 (RR-JOB-TENANT-CONTEXT): background tenancy census', () => {
  const discovered = scanRepoBackgroundEntries(SRC);

  it('finds a non-empty set of background entry points across apps/server/src (gate-vacuity control)', () => {
    expect(discovered.length).toBeGreaterThan(50);
    expect(discovered.some((e) => e.kind === '@Cron')).toBe(true);
    expect(discovered.some((e) => e.kind === '@Interval')).toBe(true);
    expect(discovered.some((e) => e.kind === 'safeInterval')).toBe(true);
    expect(discovered.some((e) => e.kind === 'setInterval')).toBe(true);
    expect(discovered.some((e) => e.kind === 'new Worker')).toBe(true);
  });

  it('every discovered background entry point is classified and no stale or duplicate census entries remain', () => {
    const { unlisted, stale, mismatchedMeta, duplicateCensusKeys } = diffAgainstBackgroundCensus(
      discovered,
      BACKGROUND_TENANCY_CENSUS,
    );

    expect(duplicateCensusKeys, 'duplicate keys in BACKGROUND_TENANCY_CENSUS').toEqual([]);
    expect(
      unlisted.map((u) => `${u.key} (${u.kind} @ ${u.file})`),
      'unlisted background entry points — classify each in BACKGROUND_TENANCY_CENSUS',
    ).toEqual([]);
    expect(
      stale.map((s) => `${s.key} (${s.kind} @ ${s.file})`),
      'stale rows in BACKGROUND_TENANCY_CENSUS — remove deleted or refactored entry points',
    ).toEqual([]);
    expect(mismatchedMeta, 'census file/kind metadata drifted from AST discovery').toEqual([]);
  });

  it('every PER_TENANT_WRAPPED entry genuinely calls runForTenant(...) in its AST body', () => {
    const wrapped = BACKGROUND_TENANCY_CENSUS.filter((r) => r.mode === 'PER_TENANT_WRAPPED');
    expect(wrapped.length).toBeGreaterThanOrEqual(1);
    for (const row of wrapped) {
      expect(row.wrappingMethod.trim().length, `${row.key} missing wrappingMethod`).toBeGreaterThan(0);
      expect(row.notes.trim().length, `${row.key} missing notes`).toBeGreaterThan(0);
    }

    const { missingRunForTenant } = diffAgainstBackgroundCensus(
      discovered,
      BACKGROUND_TENANCY_CENSUS,
    );
    expect(
      missingRunForTenant,
      'PER_TENANT_WRAPPED entries that do NOT actually call runForTenant(...) in source',
    ).toEqual([]);
  });

  it('every PER_TENANT_OPEN names a followUpSlice and every GLOBAL states an explicit reason', () => {
    for (const row of BACKGROUND_TENANCY_CENSUS) {
      if (row.mode === 'PER_TENANT_OPEN') {
        expect(row.followUpSlice.trim().length, `${row.key} missing followUpSlice`).toBeGreaterThan(0);
      } else if (row.mode === 'GLOBAL') {
        expect(row.reason.trim().length, `${row.key} missing GLOBAL reason`).toBeGreaterThan(10);
      }
    }
  });
});

describe('background tenancy census scanner negative controls (synthetic AST fixtures)', () => {
  it('catches unlisted @Cron, @Interval, safeInterval, setInterval, new Worker, and @Processor entry points', () => {
    const syntheticSource = `
      import { Cron, Interval } from '@nestjs/schedule';
      import { Worker } from 'bullmq';
      import { safeInterval } from '../../core/scheduling/safe-interval';

      @Processor('synthetic-queue')
      export class SyntheticWorkerProcessor {
        @Cron('*/5 * * * *')
        async rogueCron() {}

        @Interval(60_000)
        async rogueInterval() {}

        onModuleInit() {
          safeInterval('SyntheticSafe', 1000, () => this.tick());
          setInterval(() => this.tick(), 2000);
          new Worker('rogue-bullmq', async () => {});
        }

        private tick() {}
      }
    `;

    const found = scanSourceForBackgroundEntries('modules/synthetic/rogue.service.ts', syntheticSource);
    const diff = diffAgainstBackgroundCensus(found, []);

    expect(diff.unlisted.map((e) => `${e.kind}:${e.key}`).sort()).toEqual([
      '@Cron:SyntheticWorkerProcessor.rogueCron',
      '@Interval:SyntheticWorkerProcessor.rogueInterval',
      '@Processor:SyntheticWorkerProcessor[synthetic-queue]',
      'new Worker:SyntheticWorkerProcessor.onModuleInit[rogue-bullmq]',
      'safeInterval:SyntheticWorkerProcessor.onModuleInit[SyntheticSafe]',
      'setInterval:SyntheticWorkerProcessor.onModuleInit',
    ]);
  });

  it('catches stale census rows and rejects PER_TENANT_WRAPPED claims without a real AST runForTenant(...) call', () => {
    const commentOnlySource = `
      export class FakeWrappedService {
        @Cron('0 * * * *')
        async fakeSweep() {
          // runForTenant(businessId, () => this.work(businessId)) — comment only!
          await this.work('biz_1');
        }
        private async work(_id: string) {}
      }
    `;

    const foundCommentOnly = scanSourceForBackgroundEntries(
      'modules/synthetic/fake-wrapped.service.ts',
      commentOnlySource,
    );
    const census: BackgroundTenancyRow[] = [
      {
        key: 'FakeWrappedService.fakeSweep',
        file: 'modules/synthetic/fake-wrapped.service.ts',
        kind: '@Cron',
        mode: 'PER_TENANT_WRAPPED',
        wrappingMethod: 'FakeWrappedService.fakeSweep',
        notes: 'claims wrapped without calling runForTenant',
      },
      {
        key: 'DeletedService.oldCron',
        file: 'modules/synthetic/deleted.service.ts',
        kind: '@Cron',
        mode: 'PER_TENANT_OPEN',
        followUpSlice: 'RR-JOB-TENANT-OLD',
      },
    ];

    const diff = diffAgainstBackgroundCensus(foundCommentOnly, census);
    expect(diff.unlisted).toEqual([]);
    expect(diff.stale.map((s) => s.key)).toEqual(['DeletedService.oldCron']);
    expect(diff.missingRunForTenant).toEqual(['FakeWrappedService.fakeSweep']);

    // Positive control: a real runForTenant(...) CallExpression clears missingRunForTenant.
    const realWrappedSource = `
      export class RealWrappedService {
        @Cron('0 * * * *')
        async realSweep() {
          for (const id of ['biz_1']) {
            await runForTenant(id, () => this.work(id));
          }
        }
        private async work(_id: string) {}
      }
    `;
    const foundReal = scanSourceForBackgroundEntries(
      'modules/synthetic/real-wrapped.service.ts',
      realWrappedSource,
    );
    const realDiff = diffAgainstBackgroundCensus(foundReal, [
      {
        key: 'RealWrappedService.realSweep',
        file: 'modules/synthetic/real-wrapped.service.ts',
        kind: '@Cron',
        mode: 'PER_TENANT_WRAPPED',
        wrappingMethod: 'RealWrappedService.realSweep',
        notes: 'actually calls runForTenant',
      },
    ]);
    expect(realDiff.unlisted).toEqual([]);
    expect(realDiff.stale).toEqual([]);
    expect(realDiff.missingRunForTenant).toEqual([]);
  });
});
