/**
 * KeyCortexContextV2Service, against a real database.
 *
 * WHY THIS EXISTS
 *
 * Every getter on this service threw in production, hourly, for an unknown
 * length of time. Eight of them, all at once. Nothing said so, because:
 *
 *   - getFullContext runs them under Promise.allSettled, which swallows every
 *     rejection and returns a context with empty slices,
 *   - 47 `prisma.client as any` casts meant tsc could not see the queries,
 *   - and the only spec mocked Prisma. Its fixture described a MediaAsset row
 *     with a nested visualIntake — a shape Prisma cannot return, from an
 *     `include` the client rejects. The mock asserted the broken thing was
 *     correct.
 *
 * A mock cannot disagree with you about a schema. This runs the real queries
 * against real Postgres, which is the only thing that can.
 *
 * WHAT IT ASSERTS, AND WHY IT IS SHAPED THIS WAY
 *
 * Against an empty business a real result and a caught-exception fallback look
 * identical — both are zeros and empty arrays. Asserting on the returned shape
 * would therefore pass while every query was failing, which is exactly the
 * failure mode this file exists to prevent.
 *
 * So the assertion is on the CATCH PATH instead: every getter logs
 * `[getXContext] Error for ...` before returning its empty fallback. The logger
 * is captured, and any such line is a failure naming the getter. That works
 * uniformly for all ten and needs no fixtures.
 *
 * Requires DATABASE_URL. CI supplies pgvector/pgvector:pg16 + db:deploy.
 */
import 'reflect-metadata';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { KeyCortexContextV2Service } from '../src/modules/key-cortex/key-cortex-context-v2.service';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import type { RedisService } from '../src/core/redis/redis.service';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { db, setTenantContextProvider } = require('@keyflow/db') as typeof import('@keyflow/db');

/**
 * Stand-in for TenantInterceptor's AsyncLocalStorage, which only exists on the
 * HTTP path. Without it the isolation extension scopes reads to no business and
 * the seeded row is invisible — the same reason these getters see nothing when
 * they run from a cron rather than a request.
 */
let ambient: string | undefined;
setTenantContextProvider({ getCurrentBusinessId: () => ambient });

const P = 'zz_ctxv2_';
const BIZ = `${P}biz`;
const OWNER = `${P}owner`;
const CONTACT = `${P}contact`;

/** Errors the service logged instead of throwing. Empty is the pass condition. */
let logged: string[] = [];
let service: KeyCortexContextV2Service;

describe('KeyCortexContextV2Service (real database)', () => {
  beforeAll(async () => {
    ambient = undefined; // seed without scoping, then read as the tenant
    await db.user.upsert({
      where: { id: OWNER },
      update: {},
      create: { id: OWNER, email: `${P}owner@example.test`, name: 'Ctx Owner' },
    });
    await db.business.upsert({
      where: { id: BIZ },
      update: {},
      create: { id: BIZ, name: 'Ctx Biz', slug: BIZ, ownerId: OWNER },
    });
    // One contact, so the CRM path exercises the select and the mapping rather
    // than short-circuiting on an empty table.
    await db.contact.upsert({
      where: { id: CONTACT },
      update: { deletedAt: null },
      create: {
        id: CONTACT,
        businessId: BIZ,
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: `${P}ada@example.test`,
        status: 'lead',
        leadScore: 90,
        pipelineStage: 'qualified',
      },
    });

    // Real Prisma. Redis stubbed to a permanent cache miss so every call runs
    // the queries — a cache hit would make this file assert nothing.
    const prisma = { client: db } as unknown as PrismaService;
    const redis = {
      get: async () => null,
      set: async () => undefined,
      del: async () => undefined,
    } as unknown as RedisService;

    ambient = BIZ;
    service = new KeyCortexContextV2Service(prisma, redis);
    (service as unknown as { logger: unknown }).logger = {
      error: (msg: string) => logged.push(msg),
      warn: () => {},
      log: () => {},
      debug: () => {},
      verbose: () => {},
    };
  });

  afterAll(async () => {
    ambient = undefined;
    await db.contact.deleteMany({ where: { businessId: BIZ } });
    await db.business.deleteMany({ where: { id: BIZ } });
    await db.user.deleteMany({ where: { id: OWNER } });
  });

  const getters = [
    'getCrmContext',
    'getCommerceContext',
    'getBookingsContext',
    'getCommunicationsContext',
    'getAutopilotContext',
    'getTemporalContext',
    'getInboxContext',
    'getGenomeContext',
    'getDeviceContext',
  ] as const;

  for (const name of getters) {
    it(`${name} runs its queries without falling into its catch`, async () => {
      logged = [];
      const result = await (service as unknown as Record<string, (b: string) => Promise<unknown>>)[name](BIZ);

      expect(
        logged,
        `${name} threw and returned its empty fallback. The message names the ` +
          `model and field Prisma rejected — that is the defect, not this test.`,
      ).toEqual([]);
      expect(result, `${name} returned nothing at all`).toBeTruthy();
    }, 30_000);
  }

  it('getCrmContext returns the seeded contact, mapped through the real columns', async () => {
    logged = [];
    const crm = await service.getCrmContext(BIZ);

    expect(logged).toEqual([]);
    expect(crm.totalContacts).toBeGreaterThanOrEqual(1);
    // Proves the rename landed end to end: the row is selected by leadScore and
    // pipelineStage, and rendered through firstName/lastName because Contact has
    // no `name` column. A regression to `name`/`score`/`stage` fails here rather
    // than silently returning an empty context.
    const ada = crm.hotLeads.find((l) => l.id === CONTACT);
    expect(ada, 'the seeded lead was not returned').toBeTruthy();
    expect(ada!.name).toBe('Ada Lovelace');
    expect(ada!.score).toBe(90);
    expect(ada!.stage).toBe('qualified');
  }, 30_000);

  it('getFullContext assembles every slice without swallowing a rejection', async () => {
    logged = [];
    const full = await service.getFullContext(BIZ);

    // Promise.allSettled is why this service failed silently for so long: it
    // turns every rejection into an empty slice and no error. Asserting on the
    // captured log is what makes that visible here.
    expect(
      logged,
      'getFullContext completed, but a getter rejected underneath allSettled — ' +
        'the context is missing that slice and nothing else would report it.',
    ).toEqual([]);
    for (const slice of ['crm', 'commerce', 'bookings', 'communications', 'autopilot', 'temporal', 'inbox', 'genome', 'device'] as const) {
      expect(full[slice], `${slice} slice missing from getFullContext`).toBeTruthy();
    }
  }, 60_000);
});
