/**
 * FOLLOW3-D12-METADATA-LOCKED-WRITES — Business.metaData writers read and
 * write under the business row lock. REAL database.
 *
 * Business.metaData is one jsonb column that many writers read, change and
 * write back whole. IdentityService.updateBusiness (the profile PATCH, which
 * also clears and rotates the payment secrets) has locked the row since
 * R0-SEC2c (SELECT ... FOR NO KEY UPDATE, then read and write in one
 * transaction). The other writers did not: they read the stored value, and a
 * write that committed between their read and their write was undone when
 * they wrote their stale copy back. This suite proves the writers this packet
 * converts (SiteService.trackEvent, SiteService.updateStorefrontConfig,
 * MarketplaceService.updateDeliveryConfig, WhatsAppService.saveConfig) now
 * take the same lock (lockBusinessMeta, apps/server/src/core/prisma/business-meta.ts)
 * before they read; apps/server/src/core/prisma/business-meta-writers.spec.ts
 * is the census of every other writer.
 *
 * HOW THE INTERLEAVING IS MADE: the writer under test gets a PrismaService
 * whose client is the real one, except that one armed `business.update` call
 * (on the client or on an interactive transaction's client) stops before it
 * runs until the test releases it. The writer is started and the test waits
 * until it is stopped there: it has read metaData and is about to write. The
 * concurrent write (the owner's real PATCH through the real guards, or a
 * second call of the same writer) is then sent, and the test waits until it
 * has either committed or is waiting on the business row lock (pg_stat_activity),
 * then releases the writer. Unlocked, the concurrent write commits first and
 * the writer's stale copy overwrites it. Locked, the concurrent write waits for
 * the writer's commit and then reads the writer's result. Nothing else is
 * mocked; the services run against the database at DATABASE_URL.
 *
 * The writers are called on their services directly: the public route
 * (POST /site/businesses/:businessId/analytics/event) passes its body to
 * SiteService.trackEvent unchanged, and the WhatsApp config route calls
 * saveConfig after its owner check (proven by whatsapp-config-authority).
 *
 * FIXTURES: every user, business and membership id has the `v84l_` prefix
 * (registered in test/helpers/fixture-prefixes.json), every unique column
 * written here (User.email, User.referralCode) contains it, and every row is
 * hard-deleted with LIKE ${sqlLikePrefix(P)} in beforeAll and afterAll. No
 * $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000 });

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v84l_';
const ID = {
  owner: `${P}owner`, // OWNER membership + Business.ownerId of biz
  biz: `${P}biz`,
};
const emailOf = (id: string) => `${id}@v84l.test.local`;

const STRIPE_SECRET = `sk_live_${P}STRIPE_SECRET_3c9e`;
const SEEDED_META = {
  stripeSecretKey: STRIPE_SECRET,
  stripePublishableKey: `pk_live_${P}publishable`,
  bankName: `${P}Republic Bank`,
  otherKey: `${P}keep-me`,
};

let db: any;
let app: any;
let pausing: ReturnType<typeof pausingPrisma>;
let site: any;
let marketplace: any;
let whatsapp: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM business_blueprints WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)} OR owner_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort: cascades cover most of these */ }
  }
}

/** Put the business's metaData back to the seeded value (raw SQL: no writer under test runs). */
async function reset(meta: Record<string, unknown> = SEEDED_META) {
  await db.$executeRawUnsafe('UPDATE businesses SET meta_data = $2::jsonb WHERE id = $1', ID.biz, JSON.stringify(meta));
}

/** The stored metaData, read straight from Postgres. */
async function storedMeta(): Promise<Record<string, any>> {
  const rows = await db.$queryRawUnsafe('SELECT meta_data AS m FROM businesses WHERE id = $1', ID.biz);
  return (rows[0]?.m ?? {}) as Record<string, any>;
}

const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);

const patchBusiness = (body: Record<string, unknown>) =>
  request(app.getHttpServer()).patch(`/identity/businesses/${ID.biz}`).set('x-test-user', ID.owner).send(body);

/**
 * A PrismaService over the real client in which one armed `<model>.<op>` call
 * (on the client, or on the client an interactive $transaction hands its
 * callback) stops before it runs until the test releases it. Unarmed, every
 * call goes straight through.
 */
function pausingPrisma(client: any) {
  let armed: { model: string; op: string; reached: () => void; release: Promise<void> } | undefined;
  const delegate = (d: any, model: string) => new Proxy(d, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const gate = armed;
        if (gate && gate.model === model && gate.op === prop) {
          armed = undefined;
          gate.reached();
          return gate.release.then(() => value.apply(target, args));
        }
        return value.apply(target, args);
      };
    },
  });
  const wrap = (c: any): any => new Proxy(c, {
    get(target, prop) {
      if (prop === 'business') return delegate(Reflect.get(target, prop), 'business');
      if (prop === '$transaction') {
        return (arg: any, opts?: any) => (typeof arg === 'function'
          ? target.$transaction((tx: any) => arg(wrap(tx)), opts)
          : target.$transaction(arg, opts));
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return {
    service: { client: wrap(client) },
    /** Stop the next `<model>.<op>` call before it runs. */
    pauseNext(model: string, op: string) {
      let reached!: () => void;
      let release!: () => void;
      const reachedP = new Promise<void>((r) => { reached = r; });
      const releaseP = new Promise<void>((r) => { release = r; });
      armed = { model, op, reached, release: releaseP };
      return { reached: reachedP, release };
    },
    disarm() { armed = undefined; },
  };
}

/** Resolve once `p` has settled ('committed') or a statement waits on a businesses row lock ('waiting'). */
async function committedOrWaiting(p: Promise<unknown>): Promise<'committed' | 'waiting'> {
  let settled = false;
  p.then(() => { settled = true; }, () => { settled = true; });
  const deadline = Date.now() + 10_000;
  for (;;) {
    if (settled) return 'committed';
    const rows = await db.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND position('businesses' in lower(query)) > 0`,
    );
    if (Number(rows[0]?.n ?? 0) > 0) return 'waiting';
    if (Date.now() > deadline) throw new Error('the concurrent write neither committed nor waited on the business row');
    await new Promise((r) => setTimeout(r, 25));
  }
}

/**
 * Run `writer` until it is stopped at its `business.update` (it has read
 * metaData), then start `concurrent`, wait until that has committed or waits
 * on the row, release the writer and settle both.
 */
async function interleave<W, C>(writer: () => Promise<W>, concurrent: () => Promise<C>) {
  const pause = pausing.pauseNext('business', 'update');
  try {
    const w = writer();
    const first = await Promise.race([
      pause.reached.then(() => 'stopped at its write' as const),
      w.then(() => 'finished without writing' as const, (e) => `failed: ${e?.message ?? e}`),
    ]);
    expect(first, 'the writer reaches business.update after its read').toBe('stopped at its write');
    const c = concurrent();
    const order = await committedOrWaiting(c);
    pause.release();
    const [writerResult, concurrentResult] = await Promise.all([w, c]);
    return { writerResult, concurrentResult, order };
  } finally {
    pausing.disarm();
    pause.release(); // never leave a writer (and its transaction) stopped after a failure
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { OptionalAuthGuard } = await import('../src/core/auth/optional-auth.guard');
  const { SupabaseAdminService } = await import('../src/core/auth/supabase-admin.service');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { IdentityController } = await import('../src/modules/identity/identity.controller');
  const { IdentityService } = await import('../src/modules/identity/identity.service');
  const { IdentitySignupService } = await import('../src/modules/identity/identity-signup.service');
  const { BusinessContextService } = await import('../src/modules/identity/business-context.service');
  const { AuthSecurityService } = await import('../src/modules/identity/auth-security.service');
  const { IdentityPasswordService } = await import('../src/modules/identity/identity-password.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { BlueprintService } = await import('../src/modules/blueprint/blueprint.service');
  const { DefaultTriggersService } = await import('../src/modules/ai/default-triggers.service');
  const { SiteService } = await import('../src/modules/site/site.service');
  const { MarketplaceService } = await import('../src/modules/marketplace/marketplace.service');
  const { WhatsAppService } = await import('../src/modules/whatsapp/whatsapp.service');

  // The owner's PATCH: the real IdentityController, IdentityService, guards and
  // PrismaService (as test/payment-secrets-write-only composes it).
  const moduleRef = await Test.createTestingModule({
    controllers: [IdentityController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      OptionalAuthGuard,
      IdentityService,
      // Not on the business PATCH authorization path.
      { provide: BlueprintService, useValue: { inferFromOnboarding: async () => null } },
      { provide: DefaultTriggersService, useValue: {} },
      { provide: IdentitySignupService, useValue: {} },
      { provide: BusinessContextService, useValue: {} },
      { provide: AiUsageService, useValue: {} },
      { provide: AuthSecurityService, useValue: {} },
      { provide: IdentityPasswordService, useValue: {} },
      { provide: SupabaseAdminService, useValue: {} },
      { provide: REDIS_CLIENT, useValue: {} },
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  // Identity attachment only, as AuthMiddleware attaches it from the User row.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  await app.init();

  // The writers under test, over the pausing PrismaService. Their other
  // collaborators are not on the paths called here.
  pausing = pausingPrisma(db);
  const prisma = pausing.service as any;
  site = new SiteService(prisma, {} as any);
  marketplace = new MarketplaceService(prisma, {} as any, {} as any, new EventEmitter2(), {} as any);
  whatsapp = new WhatsAppService(prisma, new EventEmitter2(), {} as any, {} as any, {} as any);

  await cleanup(); // in case a prior run aborted

  await db.user.create({ data: { id: ID.owner, email: emailOf(ID.owner), name: ID.owner, role: 'USER', referralCode: `${ID.owner}_ref` } });
  await db.business.create({ data: { id: ID.biz, name: `${ID.biz}-name`, ownerId: ID.owner, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}m_owner_biz`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  await reset();
}, 60_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
}, 60_000);

describe('FOLLOW3-D12 fixture sanity (real rows)', () => {
  it('[MW-X01] seeded one business owned by one OWNER, its metaData holding a payment secret, the bank name and an unrelated key', async () => {
    expect(await db.business.count({ where: { id: { startsWith: P } } })).toBe(1);
    expect(await db.membership.count({ where: { businessId: ID.biz, role: 'OWNER' } })).toBe(1);
    const meta = await storedMeta();
    expect(meta.stripeSecretKey).toBe(STRIPE_SECRET);
    expect(meta.bankName).toBe(SEEDED_META.bankName);
  });
});

describe('FOLLOW3-D12 metaData writers read and write under the business row lock', () => {
  it('[MW-01] RED-BEFORE: a WhatsApp config save that has read metaData when the owner\'s PATCH clears stripeSecretKey and changes the bank name: the saved config, the clear and the bank name all persist (no write lost, the secret not stored again)', async () => {
    await reset();
    const BANK = `${P}Scotiabank`;
    try {
      const { concurrentResult: patched } = await interleave(
        () => whatsapp.saveConfig(ID.biz, { provider: 'meta', phoneNumberId: `${P}pn_01`, fromNumber: '+18685550101', accessToken: `${P}ACCESS_TOKEN_01` }),
        () => patchBusiness({ metaData: { stripeSecretKey: null, bankName: BANK } }).then((r: any) => r),
      );
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);
      const meta = await storedMeta();
      const lost: string[] = [];
      if (meta.whatsapp?.phoneNumberId !== `${P}pn_01`) lost.push('whatsapp config');
      if (meta.bankName !== BANK) lost.push('PATCH bankName');
      if (has(meta, 'stripeSecretKey')) lost.push('PATCH clear (stripeSecretKey stored again)');
      expect(lost, 'writes lost to the interleaving').toEqual([]);
      expect(String(meta.whatsapp.accessToken)).not.toContain(`${P}ACCESS_TOKEN_01`); // stored encrypted, as before
      expect(meta.otherKey).toBe(SEEDED_META.otherKey);
    } finally {
      await reset();
    }
  });

  it('[MW-02] RED-BEFORE: two storefront events in flight together (the first has read metaData when the second arrives) record 2 events, not 1', async () => {
    await reset();
    try {
      const { writerResult, concurrentResult } = await interleave(
        () => site.trackEvent(ID.biz, 'page_view'),
        () => site.trackEvent(ID.biz, 'add_to_cart', `${P}item-1`),
      );
      expect(writerResult).toEqual({ tracked: true });
      expect(concurrentResult).toEqual({ tracked: true });
      const events = ((await storedMeta()).storefrontEvents ?? []) as Array<{ type: string; itemId: string | null }>;
      expect(events.map((e) => e.type).sort(), 'recorded storefront events').toEqual(['add_to_cart', 'page_view']);
      expect(events.find((e) => e.type === 'add_to_cart')?.itemId).toBe(`${P}item-1`);
      expect((await storedMeta()).stripeSecretKey).toBe(STRIPE_SECRET);
    } finally {
      await reset();
    }
  });

  it('[MW-04] RED-BEFORE: a storefront config save (SiteService.updateStorefrontConfig) that has read metaData when the owner\'s PATCH clears stripeSecretKey: the clear holds and the storefront config is saved', async () => {
    await reset();
    try {
      const { writerResult, concurrentResult: patched } = await interleave(
        () => site.updateStorefrontConfig(ID.biz, { headline: `${P}headline` }),
        () => patchBusiness({ metaData: { stripeSecretKey: null } }).then((r: any) => r),
      );
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);
      expect(writerResult).toEqual({ headline: `${P}headline` });
      const meta = await storedMeta();
      expect(has(meta, 'stripeSecretKey'), 'the cleared stripeSecretKey stored again').toBe(false);
      expect(meta.storefront).toEqual({ headline: `${P}headline` });
      expect(meta.bankName).toBe(SEEDED_META.bankName);
    } finally {
      await reset();
    }
  });

  it('[MW-05] RED-BEFORE: a delivery config save (MarketplaceService.updateDeliveryConfig) that has read metaData when the owner\'s PATCH clears stripeSecretKey: the clear holds, the delivery config is saved and the stored storefront keys are kept', async () => {
    await reset({ ...SEEDED_META, storefront: { headline: `${P}kept` } });
    const DELIVERY = { localPickup: { enabled: true, address: `${P}1 Frederick St`, hours: '9-5' } };
    try {
      const { writerResult, concurrentResult: patched } = await interleave(
        () => marketplace.updateDeliveryConfig(ID.biz, DELIVERY),
        () => patchBusiness({ metaData: { stripeSecretKey: null } }).then((r: any) => r),
      );
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);
      expect(writerResult).toEqual(DELIVERY);
      const meta = await storedMeta();
      expect(has(meta, 'stripeSecretKey'), 'the cleared stripeSecretKey stored again').toBe(false);
      expect(meta.storefront).toEqual({ headline: `${P}kept`, deliveryConfig: DELIVERY });
    } finally {
      await reset();
    }
  });
});

describe('FOLLOW3-D12 controls (unchanged behaviour)', () => {
  it('[MW-C01] CONTROL: a storefront event is recorded and the storefront analytics read returns it; an unknown type or an over-long item id is not tracked, and an unknown business answers nothing, with nothing written', async () => {
    await reset();
    try {
      expect(await site.trackEvent(ID.biz, 'item_view', `${P}item-2`)).toEqual({ tracked: true });
      expect(await site.trackEvent(ID.biz, 'checkout_complete')).toEqual({ tracked: true });
      const analytics = await site.getAnalytics(ID.biz);
      expect(analytics.storefrontEvents).toEqual({ item_view: 1, checkout_complete: 1 });

      const before = JSON.stringify(await storedMeta());
      expect(await site.trackEvent(ID.biz, 'not_a_type')).toEqual({ tracked: false });
      expect(await site.trackEvent(ID.biz, 'page_view', 'x'.repeat(101))).toEqual({ tracked: false });
      expect(await site.trackEvent(`${P}no-such-business`, 'page_view')).toBeUndefined();
      expect(JSON.stringify(await storedMeta())).toBe(before);
    } finally {
      await reset();
    }
  });

  it('[MW-C02] CONTROL: a WhatsApp config save and a delivery config save on their own keep every other metaData key', async () => {
    await reset();
    try {
      await whatsapp.saveConfig(ID.biz, { provider: 'meta', phoneNumberId: `${P}pn_02`, accessToken: `${P}ACCESS_TOKEN_02` });
      await marketplace.updateDeliveryConfig(ID.biz, { digital: { enabled: true } });
      const meta = await storedMeta();
      for (const [k, v] of Object.entries(SEEDED_META)) expect(meta[k], `metaData.${k} kept`).toEqual(v);
      expect(meta.whatsapp.phoneNumberId).toBe(`${P}pn_02`);
      expect(meta.storefront).toEqual({ deliveryConfig: { digital: { enabled: true } } });
    } finally {
      await reset();
    }
  });
});
