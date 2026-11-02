/**
 * V1-19c-CORTEX-ACTION-AUDIT-ROW: a KEY tool execution writes its
 * CortexActionLog audit row (REAL database), and every CortexActionLog write
 * names only columns the model has.
 *
 * Read from the trial-H head (key-cortex-tool-registry.service.ts audit(),
 * V1-19b review): KeyCortexToolRegistryService.audit() called
 * cortexActionLog.create through an untyped client with a `metadata` field
 * (input, durationMs, autonomyLevel). CortexActionLog has no metadata column
 * (schema.prisma model CortexActionLog), so Prisma refused every row ("Unknown
 * argument `metadata`"), audit()'s catch logged the refusal without the
 * business id and swallowed it, and no registry tool execution was ever
 * audited. The row also never carried the command thread (commandId,
 * correlationId, proposalId) or its timing columns.
 *
 * Required, and pinned here:
 *   - one registry execution, one CortexActionLog row: businessId, userId,
 *     sessionId, actionType, status, durationMs, startedAt, completedAt,
 *     correlationId, and commandId / proposalId when the call carries them;
 *     a handler that throws or answers { success: false } is one 'error' row;
 *   - the tool input is not stored: CortexActionLog has no column for it (and
 *     it may carry personal data), so it is dropped with autonomyLevel, which
 *     has no column either;
 *   - a static check over apps/server/src: every cortexActionLog write names
 *     only fields of the Prisma model (read from Prisma's own DMMF), with no
 *     spread or variable the check cannot read;
 *   - an audit write that fails is still non-fatal (the tool's answer is
 *     returned), and is logged at error with the business id and counted;
 *   - KeyCortexLifecycleService.recordExecution (the tool loop's lifecycle
 *     record, written right after registry.execute for the same call) does not
 *     add a second CortexActionLog row for an execution the registry already
 *     audited, and still writes one for a call the registry did not audit
 *     (regression control: before this packet the lifecycle row was the only
 *     one the tool loop produced).
 *
 * Out of the write set, kept as it.todo below and reported as deviations:
 * key-cortex-actions.service.ts trackActionExecution (V1-02b owns the file)
 * names no businessId, a required column, so its row is refused too; and
 * recordExecution's AiExecutionLog write names startedAt, which AiExecutionLog
 * does not have.
 *
 * WHAT IS REAL: PrismaService and the Prisma client against DATABASE_URL,
 * KeyCortexToolRegistryService (execute, audit, its score writes) and
 * KeyCortexLifecycleService.recordExecution, writing cortex_action_logs rows.
 * Stand-ins only: the autonomy safety service (allows), the saga service, the
 * idempotency service (no call presents a key), the lifecycle's redis, event
 * bus and conversation service, and the registered tools.
 *
 * Every seeded row carries the `v19c_` prefix (business, user, session,
 * command and correlation ids) and is hard-deleted by raw SQL with
 * sqlLikePrefix() in beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { readdirSync, readFileSync, statSync } from 'fs';
import * as ts from 'typescript';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v19c_';

const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`,
  /** A business with no row: an audit insert for it fails on the business foreign key. */
  missingBiz: `${P}biz_missing`,
};

const TOOL_OK = 'v19c.create_ticket';
const TOOL_THROWS = 'v19c.throwing_ticket';
const TOOL_SOFT = 'v19c.soft_failing_ticket';

/** Personal data a tool call carries in its input; no audit column may hold it. */
const PII_EMAIL = `${P}person@example.test`;
const PII_NOTE = `${P}note: card ending 4242, lives at 12 Sentinel Road`;

let db: any;
let app: any;
let registry: any;
let lifecycle: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM cortex_action_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_execution_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM tool_outcome_scores WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

let seq = 0;
/** A fresh identity thread for one case. */
function thread(label: string) {
  const n = ++seq;
  return {
    sessionId: `${P}sess_${label}_${n}`,
    commandId: `${P}cmd_${label}_${n}`,
    correlationId: `${P}corr_${label}_${n}`,
  };
}

const rowsFor = (correlationId: string, businessId = ID.biz) =>
  db.cortexActionLog.findMany({ where: { businessId, correlationId }, orderBy: { startedAt: 'asc' } });

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const tenant = await import('../src/core/tenant/tenant-context');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: tenant.getCurrentBusinessId });

  const { Test } = await import('@nestjs/testing');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const moduleRef = await Test.createTestingModule({ providers: [PrismaService] }).compile();
  app = moduleRef;
  await app.init();
  const prisma = moduleRef.get(PrismaService);

  const { KeyCortexToolRegistryService } = await import('../src/modules/key-cortex/key-cortex-tool-registry.service');
  const safety = { check: async () => ({ allowed: true }), recordExecution: async () => undefined };
  const saga = { addStep: async () => undefined, completeStep: async () => undefined, failStep: async () => undefined, compensate: async () => [] };
  // Positionally, as Nest constructs it: prisma, safety, idempotency, saga, learning, audit service, event bus, proposals.
  registry = new KeyCortexToolRegistryService(prisma, safety as any, {} as any, saga as any, undefined, undefined, undefined, undefined);

  const toolDef = (name: string, handler: (ctx: any, input: Record<string, unknown>) => Promise<any>) => ({
    name,
    module: 'v19c',
    description: 'v19c: an audited tool',
    parameters: { type: 'object', properties: {}, required: [] },
    riskTier: 1,
    requiresApproval: false,
    handler,
  });
  registry.register(
    toolDef(TOOL_OK, async () => {
      // Long enough that durationMs is the handler's real time, not a constant.
      await new Promise((r) => setTimeout(r, 15));
      return { success: true, data: { ticketId: 'T-1' } };
    }),
  );
  registry.register(
    toolDef(TOOL_THROWS, async () => {
      throw new Error('v19c: provider said no');
    }),
  );
  registry.register(toolDef(TOOL_SOFT, async () => ({ success: false, error: 'v19c: provider declined' })));

  const { KeyCortexLifecycleService } = await import('../src/modules/key-cortex/key-cortex-lifecycle.service');
  const redis = { get: async () => null, set: async () => undefined };
  const eventBus = { emit: () => undefined, publish: async () => undefined };
  lifecycle = new KeyCortexLifecycleService(prisma, redis as any, eventBus as any, undefined as any);

  await cleanup(); // in case a prior run aborted
  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.biz, name: 'V19C Biz', ownerId: ID.owner } });
}, 120_000);

afterAll(async () => {
  if (db) await cleanup();
  if (app) await app.close();
  const dbMod = await import('@keyflow/db');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: () => undefined });
});

// ---------------------------------------------------------------------------
// Static: every cortexActionLog write names only the model's fields
// ---------------------------------------------------------------------------

const SRC = path.resolve(__dirname, '../src');
const DATA_KEYS: Record<string, string[]> = {
  create: ['data'],
  createMany: ['data'],
  createManyAndReturn: ['data'],
  update: ['data'],
  updateMany: ['data'],
  updateManyAndReturn: ['data'],
  upsert: ['create', 'update'],
};
const NO_DATA_METHODS = new Set([
  'findMany', 'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow',
  'count', 'aggregate', 'groupBy', 'delete', 'deleteMany',
]);

interface Write { file: string; line: number; method: string; fields: string[]; unreadable: string[] }

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      out.push(...sourceFiles(full));
    } else if (name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Every use of `<x>.cortexActionLog` in production source: the writes, and any use the check cannot read. */
function scanCortexActionLogUses(): { writes: Write[]; unreadable: string[] } {
  const writes: Write[] = [];
  const unreadable: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes('cortexActionLog')) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const rel = path.relative(SRC, file);
    const where = (node: ts.Node) => `${rel}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

    const visit = (node: ts.Node) => {
      const isModelRef =
        (ts.isPropertyAccessExpression(node) && node.name.text === 'cortexActionLog') ||
        (ts.isElementAccessExpression(node) &&
          ts.isStringLiteralLike(node.argumentExpression) &&
          node.argumentExpression.text === 'cortexActionLog');
      if (isModelRef) {
        const member = node.parent;
        const call = member?.parent;
        if (!member || !ts.isPropertyAccessExpression(member) || member.expression !== node || !call || !ts.isCallExpression(call) || call.expression !== member) {
          unreadable.push(`${where(node)} cortexActionLog is used other than as <client>.cortexActionLog.<method>(...)`);
        } else {
          const method = member.name.text;
          if (DATA_KEYS[method]) {
            const w: Write = { file: rel, line: sf.getLineAndCharacterOfPosition(call.getStart()).line + 1, method, fields: [], unreadable: [] };
            const arg = call.arguments[0];
            if (!arg || !ts.isObjectLiteralExpression(arg)) {
              w.unreadable.push('its argument is not an object literal');
            } else {
              for (const key of DATA_KEYS[method]) {
                const prop = arg.properties.find(
                  (p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name && ts.isIdentifier(p.name) && p.name.text === key,
                );
                if (!prop) {
                  if (method !== 'upsert' || key === 'create') w.unreadable.push(`no ${key} property`);
                  continue;
                }
                const value = ts.isPropertyAssignment(prop) ? prop.initializer : undefined;
                const objects = !value
                  ? []
                  : ts.isObjectLiteralExpression(value)
                    ? [value]
                    : ts.isArrayLiteralExpression(value)
                      ? value.elements.filter(ts.isObjectLiteralExpression)
                      : [];
                if (!value || objects.length === 0 || (ts.isArrayLiteralExpression(value) && objects.length !== value.elements.length)) {
                  w.unreadable.push(`${key} is not an object literal`);
                  continue;
                }
                for (const obj of objects) {
                  for (const p of obj.properties) {
                    if (ts.isSpreadAssignment(p)) w.unreadable.push(`${key} spreads ${p.expression.getText(sf)}`);
                    else if (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name))) w.fields.push(p.name.text);
                    else w.unreadable.push(`${key} has a computed key`);
                  }
                }
              }
            }
            writes.push(w);
          } else if (!NO_DATA_METHODS.has(method)) {
            unreadable.push(`${where(node)} cortexActionLog.${method}() is neither a known read nor a known write`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { writes, unreadable };
}

async function cortexActionLogModel() {
  const { Prisma } = await import('@prisma/client');
  const model = (Prisma as any).dmmf.datamodel.models.find((m: any) => m.name === 'CortexActionLog');
  if (!model) throw new Error('CortexActionLog is not in the Prisma DMMF');
  return model as { fields: Array<{ name: string; kind: string; isRequired: boolean; hasDefaultValue: boolean; relationFromFields?: string[] }> };
}

describe('static: every cortexActionLog write names only the model\'s fields', () => {
  it('finds the known writers (the scan is not silently empty)', () => {
    const { writes } = scanCortexActionLogUses();
    const files = new Set(writes.map((w) => path.basename(w.file)));
    expect([...files].sort()).toEqual(
      expect.arrayContaining([
        'key-cortex-actions.service.ts',
        'key-cortex-lifecycle.service.ts',
        'key-cortex-tool-registry.service.ts',
      ]),
    );
  });

  it('no write names a field CortexActionLog lacks, and every write can be read', async () => {
    const model = await cortexActionLogModel();
    const columns = new Set(model.fields.map((f) => f.name));
    const { writes, unreadable } = scanCortexActionLogUses();
    const offenders = [
      ...unreadable,
      ...writes.flatMap((w) => w.unreadable.map((u) => `${w.file}:${w.line} ${w.method}: ${u}`)),
      ...writes.flatMap((w) =>
        w.fields.filter((f) => !columns.has(f)).map((f) => `${w.file}:${w.line} ${w.method} names "${f}", which CortexActionLog does not have`),
      ),
    ];
    expect(offenders).toEqual([]);
  });

  it('the registry and lifecycle creates name every required column (businessId included)', async () => {
    const model = await cortexActionLogModel();
    const relationKeys = new Set(model.fields.flatMap((f) => f.relationFromFields ?? []));
    const required = model.fields
      .filter((f) => f.kind === 'scalar' && f.isRequired && !f.hasDefaultValue)
      .map((f) => f.name);
    expect(required).toEqual(expect.arrayContaining(['businessId', 'sessionId', 'actionType', 'status']));
    expect(relationKeys.has('businessId')).toBe(true);
    const missing = scanCortexActionLogUses()
      .writes.filter((w) => w.method === 'create' && /key-cortex-(tool-registry|lifecycle)\.service\.ts$/.test(w.file))
      .flatMap((w) => required.filter((r) => !w.fields.includes(r)).map((r) => `${w.file}:${w.line} names no ${r}`));
    expect(missing).toEqual([]);
  });

  it.todo(
    'key-cortex-actions.service.ts trackActionExecution names every required column: it names no businessId, so ' +
      'Prisma refuses its row ("Argument `business` is missing") and the catch logs it. Out of the V1-19c write set ' +
      '(V1-02b owns that file). Note for its fix: executeAction already runs through the registry, which now audits ' +
      'the execution, so a repaired trackActionExecution would write a second row for the same call.',
  );
});

// ---------------------------------------------------------------------------
// Real database: the registry's execution row
// ---------------------------------------------------------------------------

describe('fixture sanity (real rows)', () => {
  it('the business exists and has no CortexActionLog row yet', async () => {
    expect(await db.business.count({ where: { id: ID.biz } })).toBe(1);
    expect(await db.cortexActionLog.count({ where: { businessId: ID.biz } })).toBe(0);
  });
});

describe('a registry tool execution writes exactly one CortexActionLog row', () => {
  it('a success: the actor, the command thread, the timing, and the outcome are on the row', async () => {
    const t = thread('ok');
    const before = Date.now();
    const result = await registry.execute(
      TOOL_OK,
      { businessId: ID.biz, userId: ID.owner, autonomyLevel: 2, ...t },
      { email: PII_EMAIL, note: PII_NOTE },
    );
    const after = Date.now();
    expect(result).toMatchObject({ success: true, data: { ticketId: 'T-1' } });

    const rows = await rowsFor(t.correlationId);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({
      businessId: ID.biz,
      userId: ID.owner,
      sessionId: t.sessionId,
      commandId: t.commandId,
      correlationId: t.correlationId,
      proposalId: null,
      actionType: TOOL_OK,
      status: 'success',
      error: null,
      requiresApproval: false,
    });
    expect(JSON.parse(row.result)).toEqual({ ticketId: 'T-1' });
    expect(Number.isInteger(row.durationMs)).toBe(true);
    expect(row.durationMs).toBeGreaterThanOrEqual(10);
    expect(row.startedAt).toBeInstanceOf(Date);
    expect(row.completedAt).toBeInstanceOf(Date);
    expect(row.startedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(row.completedAt.getTime()).toBeGreaterThanOrEqual(row.startedAt.getTime());
    expect(row.completedAt.getTime()).toBeLessThanOrEqual(after);
    expect(row.completedAt.getTime() - row.startedAt.getTime()).toBe(row.durationMs);
  });

  it('the tool input is not stored: no column of the row holds it', async () => {
    const t = thread('pii');
    await registry.execute(TOOL_OK, { businessId: ID.biz, userId: ID.owner, autonomyLevel: 2, ...t }, { email: PII_EMAIL, note: PII_NOTE });
    const rows = await rowsFor(t.correlationId);
    expect(rows).toHaveLength(1);
    const stored = JSON.stringify(rows[0]);
    expect(stored).not.toContain(PII_EMAIL);
    expect(stored).not.toContain('Sentinel Road');
  });

  it('the proposal an approved run executes is named on the row', async () => {
    const t = thread('proposal');
    const proposalId = `${P}proposal_1`;
    const result = await registry.execute(
      TOOL_OK,
      { businessId: ID.biz, userId: ID.owner, preApproved: true, proposalId, ...t },
      {},
    );
    expect(result.success).toBe(true);
    const rows = await rowsFor(t.correlationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ proposalId, commandId: t.commandId, status: 'success' });
  });

  it('a call with no command thread still writes its row (sessionId falls back, commandId/correlationId stay null)', async () => {
    const before = await db.cortexActionLog.count({ where: { businessId: ID.biz, actionType: TOOL_OK, correlationId: null } });
    const result = await registry.execute(TOOL_OK, { businessId: ID.biz, autonomyLevel: 2 }, {});
    expect(result.success).toBe(true);
    const rows = await db.cortexActionLog.findMany({
      where: { businessId: ID.biz, actionType: TOOL_OK, correlationId: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(rows).toHaveLength(before + 1);
    expect(rows[0]).toMatchObject({ userId: null, commandId: null, proposalId: null, sessionId: 'unknown', status: 'success' });
  });

  it('a handler that throws: one error row with the message and the timing', async () => {
    const t = thread('throws');
    const result = await registry.execute(TOOL_THROWS, { businessId: ID.biz, userId: ID.owner, autonomyLevel: 2, ...t }, {});
    expect(result).toMatchObject({ success: false, error: 'v19c: provider said no' });
    const rows = await rowsFor(t.correlationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'error', error: 'v19c: provider said no', result: null, actionType: TOOL_THROWS });
    expect(Number.isInteger(rows[0].durationMs)).toBe(true);
    expect(rows[0].startedAt).toBeInstanceOf(Date);
  });

  it('a handler that answers { success: false }: one error row', async () => {
    const t = thread('soft');
    const result = await registry.execute(TOOL_SOFT, { businessId: ID.biz, userId: ID.owner, autonomyLevel: 2, ...t }, {});
    expect(result).toMatchObject({ success: false, error: 'v19c: provider declined' });
    const rows = await rowsFor(t.correlationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'error', error: 'v19c: provider declined', actionType: TOOL_SOFT });
  });
});

describe('an audit write that fails is non-fatal, logged at error with the business id, and counted', () => {
  it('the tool answer is returned; the failure is logged with the business id and counted', async () => {
    const t = thread('auditfail');
    const errorSpy = vi.spyOn(registry.logger, 'error');
    const countBefore = typeof registry.getAuditWriteFailureCount === 'function' ? registry.getAuditWriteFailureCount() : undefined;
    try {
      // No business row: the audit insert fails on the business foreign key (a real Prisma error).
      const result = await registry.execute(TOOL_OK, { businessId: ID.missingBiz, userId: ID.owner, autonomyLevel: 2, ...t }, {});
      expect(result).toMatchObject({ success: true, data: { ticketId: 'T-1' } });
      expect(await rowsFor(t.correlationId, ID.missingBiz)).toHaveLength(0);

      const messages = errorSpy.mock.calls.map((c) => String(c[0]));
      expect(messages.some((m) => m.includes(ID.missingBiz) && m.includes('CortexActionLog') && m.includes(TOOL_OK))).toBe(true);
      expect(countBefore).toEqual(expect.any(Number));
      expect(registry.getAuditWriteFailureCount()).toBe(countBefore + 1);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Real database: the tool loop's lifecycle record of the same call
// ---------------------------------------------------------------------------

/** As KeyCortexToolLoopService runs one tool call: registry.execute, then lifecycle.recordExecution. */
async function toolLoopCall(t: ReturnType<typeof thread>, toolName: string) {
  const startedAt = Date.now();
  const result = await registry.execute(toolName, { businessId: ID.biz, userId: ID.owner, autonomyLevel: 2, ...t }, {});
  // The tool loop does not wait for, or look at, this record (.catch(() => {})).
  await Promise.allSettled([
    lifecycle.recordExecution({
      identity: { ...t, businessId: ID.biz, userId: ID.owner },
      toolName,
      module: 'v19c',
      riskTier: 1,
      requiresApproval: false,
      input: { email: PII_EMAIL },
      output: result.data,
      success: result.success,
      error: result.error,
      durationMs: Date.now() - startedAt,
      startedAt: new Date(startedAt),
      completedAt: new Date(),
    }),
  ]);
  return result;
}

describe('the tool loop: registry.execute then lifecycle.recordExecution for the same call', () => {
  it('one execution, one CortexActionLog row (the lifecycle adds no second row)', async () => {
    const t = thread('loop');
    const result = await toolLoopCall(t, TOOL_OK);
    expect(result.success).toBe(true);
    const rows = await rowsFor(t.correlationId);
    expect(rows).toHaveLength(1);
    // The registry's row (its description), with the timing and command thread on it.
    expect(rows[0]).toMatchObject({
      actionType: TOOL_OK,
      status: 'success',
      description: `Executed tool ${TOOL_OK}`,
      commandId: t.commandId,
      sessionId: t.sessionId,
    });
    expect(rows[0].durationMs).toBeGreaterThanOrEqual(10);
  });

  it('the same tool twice in one turn: two executions, two rows', async () => {
    const t = thread('loop2');
    await toolLoopCall(t, TOOL_OK);
    await toolLoopCall(t, TOOL_OK);
    expect(await rowsFor(t.correlationId)).toHaveLength(2);
  });

  it('regression control: a call the registry did not audit still gets its lifecycle row', async () => {
    const t = thread('lifeonly');
    const now = Date.now();
    await Promise.allSettled([
      lifecycle.recordExecution({
        identity: { ...t, businessId: ID.biz, userId: ID.owner },
        toolName: 'v19c.not_registered',
        module: 'v19c',
        riskTier: 1,
        requiresApproval: false,
        input: { email: PII_EMAIL },
        output: undefined,
        success: false,
        error: 'Tool "v19c.not_registered" not found in canonical registry',
        durationMs: 1,
        startedAt: new Date(now - 1),
        completedAt: new Date(now),
      }),
    ]);
    const rows = await rowsFor(t.correlationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actionType: 'v19c.not_registered',
      status: 'error',
      commandId: t.commandId,
      sessionId: t.sessionId,
      userId: ID.owner,
    });
    expect(JSON.stringify(rows[0])).not.toContain(PII_EMAIL);
  });

  it.todo(
    'lifecycle.recordExecution writes its AiExecutionLog row: the write names startedAt, which AiExecutionLog does not ' +
      'have, so Prisma refuses it, recordExecution rejects and cortex.action_executed is never emitted. Not a ' +
      'CortexActionLog writer, and AiExecutionLog rows feed the daily action caps (agent-trigger, journey-orchestrator, ' +
      'key-cortex-executor), so turning them on is a follow-up with its own ruling, not part of V1-19c.',
  );
});
