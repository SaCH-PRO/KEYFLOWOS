/**
 * Perception must survive being given a userId.
 *
 * The live chat ALWAYS supplies one. So a userId filter applied to a store that
 * has no userId column is not an edge case — it is every authenticated message.
 *
 * What happened: one `episodicWhere` object was shared by businessEvent,
 * aiExecutionLog and cortexActionLog, and `userId` was added to it. Only the
 * latter two have that column. Prisma rejected the businessEvent query, and
 * because all eight stores were awaited by a single Promise.all with one shared
 * `.catch()` returning eight empty arrays, EVERY store was lost. The entire
 * "WHAT YOU HAVE OBSERVED" section vanished from every authenticated message
 * and left behind exactly one warn line.
 *
 * Two properties are tested here, because fixing only the first would leave the
 * mechanism that hid it fully intact:
 *
 *   SCOPING  — userId reaches the personal stores and NOT the business-wide one.
 *   ISOLATION— one failing store costs only itself.
 *
 * The trap that made this easy to write: apps/server/prisma/schema.prisma is a
 * stale duplicate whose BusinessEvent DOES declare userId. The runtime schema is
 * packages/db/prisma/schema.prisma. This file asserts against the real one.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UnifiedMemoryRetrievalService } from './unified-memory-retrieval.service';

const BIZ = 'biz_1';
const USER = 'user_1';

/** Records the `where` each model was queried with. */
function makeSpyPrisma(failing?: string) {
  const seen: Record<string, any> = {};
  const model = (name: string) => ({
    findMany: vi.fn(async ({ where }: any) => {
      seen[name] = where;
      if (failing === name) {
        throw new Error(
          `Unknown argument \`userId\`. Available options are marked with ?.`,
        );
      }
      return [];
    }),
  });
  return {
    seen,
    prisma: {
      client: {
        aiMemory: model('aiMemory'),
        genomeMemoryEvent: model('genomeMemoryEvent'),
        temporalFlowMemory: model('temporalFlowMemory'),
        cognitionMemory: model('cognitionMemory'),
        cognitiveEvent: model('cognitiveEvent'),
        businessEvent: model('businessEvent'),
        aiExecutionLog: model('aiExecutionLog'),
        cortexActionLog: model('cortexActionLog'),
      },
    } as never,
  };
}

function makeService(failing?: string) {
  const { seen, prisma } = makeSpyPrisma(failing);
  const semantic = { search: vi.fn(async () => []) } as never;
  return { seen, service: new UnifiedMemoryRetrievalService(prisma, semantic) };
}

describe('userId narrows the personal stores only', () => {
  it('does NOT put userId on businessEvent — that column does not exist', async () => {
    const { seen, service } = makeService();
    await service.retrieveContext(BIZ, { userId: USER });

    expect(seen.businessEvent).toBeDefined();
    expect(seen.businessEvent.businessId).toBe(BIZ);
    // The whole bug, in one assertion.
    expect(seen.businessEvent.userId).toBeUndefined();
  });

  it('DOES put userId on the two stores that have it', async () => {
    const { seen, service } = makeService();
    await service.retrieveContext(BIZ, { userId: USER });

    expect(seen.aiExecutionLog.userId).toBe(USER);
    expect(seen.cortexActionLog.userId).toBe(USER);
  });

  it('never leaks another user when no userId is supplied', async () => {
    // Absence must not widen to "everyone" — it simply does not narrow.
    const { seen, service } = makeService();
    await service.retrieveContext(BIZ, {});

    expect(seen.aiExecutionLog.userId).toBeUndefined();
    expect(seen.cortexActionLog.userId).toBeUndefined();
  });

  it('scopes every store to the business, with no exceptions', async () => {
    const { seen, service } = makeService();
    await service.retrieveContext(BIZ, { userId: USER });

    for (const [name, where] of Object.entries(seen)) {
      expect(where.businessId, `${name} must be tenant-scoped`).toBe(BIZ);
    }
  });
});

describe('one broken store does not erase the others', () => {
  it('still queries all eight when businessEvent throws', async () => {
    const { seen, service } = makeService('businessEvent');
    await expect(service.retrieveContext(BIZ, { userId: USER })).resolves.toEqual([]);

    // The point: a Promise.all with a shared catch would have short-circuited.
    // Every store must still have been attempted.
    expect(Object.keys(seen).sort()).toEqual(
      [
        'aiExecutionLog', 'aiMemory', 'cognitiveEvent', 'cognitionMemory',
        'cortexActionLog', 'businessEvent', 'genomeMemoryEvent', 'temporalFlowMemory',
      ].sort(),
    );
  });

  it('resolves rather than rejecting, so the chat turn survives', async () => {
    const { service } = makeService('aiMemory');
    await expect(service.retrieveContext(BIZ, { userId: USER })).resolves.toBeInstanceOf(Array);
  });
});

describe('the mechanism that hid it is gone', () => {
  const src = readFileSync(join(__dirname, 'unified-memory-retrieval.service.ts'), 'utf8');
  const code = src
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
    .join('\n');

  it('no longer collapses every store to empty on a single failure', () => {
    // The original: `.catch(() => [[], [], [], [], [], [], [], []])`.
    // Comments are stripped first because the docblock above describes it.
    expect(code).not.toMatch(/\[\]\s*,\s*\[\]\s*,\s*\[\]\s*,\s*\[\]\s*,\s*\[\]\s*,\s*\[\]/);
  });

  it('names the store that failed, so the next one is not silent', () => {
    expect(code).toMatch(/Structured memory load failed for \$\{names\[i\]\}/);
  });
});
