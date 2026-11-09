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
 * converts (SiteService.updateStorefrontConfig,
 * MarketplaceService.updateDeliveryConfig, WhatsAppService.saveConfig) now
 * take the same lock (lockBusinessMeta, apps/server/src/core/prisma/business-meta.ts)
 * before they read, and that SiteService.trackEvent, one atomic statement that
 * writes only its own key, loses nothing and undoes nothing;
 * apps/server/src/core/prisma/business-meta-writers.spec.ts is the census of
 * every other writer.
 *
 * HOW THE INTERLEAVING IS MADE (MW-01, MW-04, MW-05): the writer under test
 * gets a PrismaService whose client is the real one, except that one armed
 * `business.update` call (on the client or on an interactive transaction's
 * client) stops before it runs until the test releases it; when it stops
 * inside a transaction, the test reads that transaction's backend pid. The
 * writer is started and the test waits until it is stopped there: it has read
 * metaData and is about to write. The owner's real PATCH (through the real
 * guards) is then sent, and the test waits until it has either committed or
 * waits, in Postgres, on a lock the writer's own backend holds
 * (pg_blocking_pids; a waiter on any other lock, another suite's included, is
 * not counted: review CR-D12-2), then releases the writer. Unlocked, the PATCH
 * commits first and the writer's stale copy overwrites it. Locked, the PATCH
 * waits for the writer's commit and then reads the writer's result; the test
 * asserts that it waited.
 *
 * SiteService.trackEvent (the public, unauthenticated storefront event) is one
 * atomic statement instead (review D12-ST-1 / CR-D12-1: an interactive
 * transaction that held the row lock and a pooled connection across its round
 * trips let an anonymous burst exhaust the shared pool). It has no read before
 * its write to stop at, so MW-02 holds the row from a test transaction, queues
 * the owner's clearing PATCH and two events behind it (counted by
 * pg_blocking_pids from the holder's backend) and then commits. MW-06 floods
 * one business with storefront events while another tenant reads and the
 * owner clears a secret. Nothing else is mocked; the services run against the
 * database at DATABASE_URL.
 *
 * The writers are called on their services directly: the public route
 * (POST /site/businesses/:businessId/analytics/event) passes its body to
 * SiteService.trackEvent unchanged, and the WhatsApp config route calls
 * saveConfig after its owner check (proven by whatsapp-config-authority).
 *
 * FOLLOW3-D13-METADATA-LOCKED-WRITES-REST (cases MW-10..MW-15 and MW-C03,
 * values tagged `v84l_f3d13_`) proves the same for the remaining internal
 * writers it converts, with the same paused-writer harness: the invoice.paid
 * gamification handler (firstSaleMade), the autopilot settings against a
 * lead-magnet write, the GA4 and Search Console syncs (which read metaData,
 * then wait on Google: the fetch is a stub here, no Google traffic) against a
 * disconnect, case-study publishes, the concierge nudge snooze and the
 * qualification config. A new case asserts the data first and that the
 * concurrent write waited last, so a RED run names the lost write.
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
let plainSite: any; // SiteService over the real PrismaService client (no pausing proxy)
let marketplace: any;
let whatsapp: any;
// FOLLOW3-D13 writers: over the pausing PrismaService, and (plain*) over the real client.
let gamification: any;
let autopilot: any;
let plainLeadMagnet: any;
let concierge: any;
let caseStudy: any;
let plainCaseStudy: any;
let qualification: any;
let SeoGa4: any;
let SeoGsc: any;
const D13 = `${P}f3d13_`; // FOLLOW3-D13 values carry this tag inside the suite's prefix

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
 * callback) stops before it runs until the test releases it. When it stops on
 * a transaction's client, `reached` resolves with that transaction's backend
 * pid (read on the stopped transaction, which is idle then); on the plain
 * client, with undefined. Unarmed, every call goes straight through.
 */
function pausingPrisma(client: any) {
  let armed: { model: string; op: string; reached: (pid: number | undefined) => void; release: Promise<void> } | undefined;
  const delegate = (d: any, model: string, owner: any, inTransaction: boolean) => new Proxy(d, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const gate = armed;
        if (gate && gate.model === model && gate.op === prop) {
          armed = undefined;
          const pid: Promise<number | undefined> = inTransaction
            ? owner.$queryRawUnsafe('SELECT pg_backend_pid() AS pid').then((r: any[]) => Number(r[0].pid))
            : Promise.resolve(undefined);
          return pid.then((p) => {
            gate.reached(p);
            return gate.release;
          }).then(() => value.apply(target, args));
        }
        return value.apply(target, args);
      };
    },
  });
  const wrap = (c: any, inTransaction: boolean): any => new Proxy(c, {
    get(target, prop) {
      if (prop === 'business') return delegate(Reflect.get(target, prop), 'business', target, inTransaction);
      if (prop === '$transaction') {
        return (arg: any, opts?: any) => (typeof arg === 'function'
          ? target.$transaction((tx: any) => arg(wrap(tx, true)), opts)
          : target.$transaction(arg, opts));
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return {
    service: { client: wrap(client, false) },
    /** Stop the next `<model>.<op>` call before it runs. */
    pauseNext(model: string, op: string) {
      let reached!: (pid: number | undefined) => void;
      let release!: () => void;
      const reachedP = new Promise<number | undefined>((r) => { reached = r; });
      const releaseP = new Promise<void>((r) => { release = r; });
      armed = { model, op, reached, release: releaseP };
      return { reached: reachedP, release };
    },
    disarm() { armed = undefined; },
  };
}

/**
 * How many backends wait in Postgres on a lock backend `pid` holds, directly
 * or queued behind another such waiter (pg_blocking_pids, followed
 * transitively). A backend waiting on anything else (another suite's lock on
 * another row, an advisory lock) is not counted.
 */
async function waitersBehind(pid: number): Promise<number> {
  const rows = await db.$queryRawUnsafe(
    `WITH RECURSIVE behind(pid) AS (
       SELECT a.pid FROM pg_stat_activity a WHERE $1::int = ANY(pg_blocking_pids(a.pid))
       UNION
       SELECT a.pid FROM pg_stat_activity a JOIN behind b ON b.pid = ANY(pg_blocking_pids(a.pid))
     )
     SELECT count(*)::int AS n FROM behind`,
    pid,
  );
  return Number(rows[0]?.n ?? 0);
}

/** Wait until `n` backends wait behind the lock(s) backend `pid` holds. */
async function waitForWaitersBehind(pid: number, n: number) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const seen = await waitersBehind(pid);
    if (seen >= n) return;
    if (Date.now() > deadline) throw new Error(`expected ${n} backend(s) waiting behind backend ${pid}, saw ${seen}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/**
 * Resolve once `p` has settled ('committed') or a backend waits on a lock the
 * writer's backend `writerPid` holds ('waiting'). A writer stopped outside a
 * transaction holds no lock (writerPid undefined): only 'committed' is possible.
 */
async function committedOrWaiting(p: Promise<unknown>, writerPid: number | undefined): Promise<'committed' | 'waiting'> {
  let settled = false;
  p.then(() => { settled = true; }, () => { settled = true; });
  const deadline = Date.now() + 10_000;
  for (;;) {
    if (settled) return 'committed';
    if (writerPid !== undefined && (await waitersBehind(writerPid)) > 0) return 'waiting';
    if (Date.now() > deadline) throw new Error('the concurrent write neither committed nor waited on the writer\'s lock');
    await new Promise((r) => setTimeout(r, 25));
  }
}

/**
 * Run `writer` until it is stopped at its `business.update` (it has read
 * metaData), then start `concurrent`, wait until that has committed or waits
 * on a lock the writer's transaction holds, release the writer and settle
 * both. The concurrent write must have waited for the writer (review
 * CR-D12-2): the row lock is held from the writer's read to its commit. With
 * `assertWaited: false` the caller asserts the returned `order` itself (after
 * its data checks, so a RED run names the lost write first).
 */
async function interleave<W, C>(writer: () => Promise<W>, concurrent: () => Promise<C>, opts: { assertWaited?: boolean } = {}) {
  const pause = pausing.pauseNext('business', 'update');
  try {
    const w = writer();
    const first = await Promise.race([
      pause.reached.then((pid) => ({ at: 'stopped at its write' as const, pid })),
      w.then(() => ({ at: 'finished without writing', pid: undefined }), (e) => ({ at: `failed: ${e?.message ?? e}`, pid: undefined })),
    ]);
    expect(first.at, 'the writer reaches business.update after its read').toBe('stopped at its write');
    const c = concurrent();
    const order = await committedOrWaiting(c, first.pid);
    pause.release();
    const [writerResult, concurrentResult] = await Promise.all([w, c]);
    if (opts.assertWaited !== false) expect(order, 'the concurrent write waited for the writer\'s row lock (held from its read to its commit)').toBe('waiting');
    return { writerResult, concurrentResult, order };
  } finally {
    pausing.disarm();
    pause.release(); // never leave a writer (and its transaction) stopped after a failure
  }
}

/**
 * Hold the business row from a test transaction (the lock the PATCH and every
 * locked writer take) until `commit`; `pid` is the holding backend. The
 * transaction is the simulated concurrent writer, not a fixture wrapper.
 */
async function holdBusinessRow(businessId: string) {
  let release!: () => void;
  const released = new Promise<void>((r) => { release = r; });
  let ready!: (pid: number) => void;
  const held = new Promise<number>((r) => { ready = r; });
  const done = db.$transaction(async (tx: any) => {
    const rows = await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');
    await tx.$queryRawUnsafe('SELECT id FROM businesses WHERE id = $1 FOR NO KEY UPDATE', businessId);
    ready(Number(rows[0].pid));
    await released;
  }, { maxWait: 10_000, timeout: 30_000 });
  const pid = await Promise.race([held, done.then(() => { throw new Error('the holding transaction ended before it held the row'); })]);
  return { pid, commit: async () => { release(); await done; } };
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
  const { GamificationListener } = await import('../src/modules/gamification/gamification.listener');
  const { AutopilotService } = await import('../src/modules/autopilot/autopilot.service');
  const { LeadMagnetService } = await import('../src/modules/conversion/lead-magnet.service');
  const { OnboardingConciergeService } = await import('../src/modules/onboarding-concierge/onboarding-concierge.service');
  const { CaseStudyService } = await import('../src/modules/site/case-study.service');
  const { QualificationService } = await import('../src/modules/site/qualification.service');
  ({ SeoGoogleAnalyticsService: SeoGa4 } = await import('../src/modules/seo/seo-ga4.service'));
  ({ SeoGoogleSearchConsoleService: SeoGsc } = await import('../src/modules/seo/seo-gsc.service'));

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
  plainSite = new SiteService({ client: db } as any, {} as any);
  marketplace = new MarketplaceService(prisma, {} as any, {} as any, new EventEmitter2(), {} as any);
  whatsapp = new WhatsAppService(prisma, new EventEmitter2(), {} as any, {} as any, {} as any);
  // FOLLOW3-D13 writers. Their other collaborators (CRM timeline, business
  // events, AI usage, catalog, blueprint, demo seeder, CRM, public events) are
  // not on the paths called here.
  gamification = new GamificationListener(prisma);
  autopilot = new AutopilotService(prisma, {} as any, {} as any);
  plainLeadMagnet = new LeadMagnetService({ client: db } as any);
  concierge = new OnboardingConciergeService(prisma, {} as any, {} as any, {} as any, {} as any);
  caseStudy = new CaseStudyService(prisma);
  plainCaseStudy = new CaseStudyService({ client: db } as any);
  qualification = new QualificationService(prisma, {} as any, {} as any);

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

  it('[MW-02] RED-BEFORE: two storefront events in flight together, queued with the owner\'s PATCH clearing stripeSecretKey behind a transaction that holds the business row: both events are recorded (2, not 1) and the clear holds (the secret is not stored again)', async () => {
    await reset();
    const BANK = `${P}FirstCitizens`;
    try {
      const hold = await holdBusinessRow(ID.biz);
      let clear: Promise<any> | undefined;
      let first: Promise<any> | undefined;
      let second: Promise<any> | undefined;
      try {
        clear = patchBusiness({ metaData: { stripeSecretKey: null, bankName: BANK } }).then((r: any) => r);
        await waitForWaitersBehind(hold.pid, 1);
        first = site.trackEvent(ID.biz, 'page_view');
        second = site.trackEvent(ID.biz, 'add_to_cart', `${P}item-1`);
        await waitForWaitersBehind(hold.pid, 3);
      } finally {
        await hold.commit();
      }
      const [cleared, firstResult, secondResult] = await Promise.all([clear, first, second]);
      expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
      expect(firstResult).toEqual({ tracked: true });
      expect(secondResult).toEqual({ tracked: true });
      const meta = await storedMeta();
      const events = (meta.storefrontEvents ?? []) as Array<{ type: string; itemId: string | null }>;
      expect(events.map((e) => e.type).sort(), 'recorded storefront events').toEqual(['add_to_cart', 'page_view']);
      expect(events.find((e) => e.type === 'add_to_cart')?.itemId).toBe(`${P}item-1`);
      expect(events.find((e) => e.type === 'page_view')?.itemId).toBeNull();
      expect(has(meta, 'stripeSecretKey'), 'the cleared stripeSecretKey stored again').toBe(false);
      expect(meta.bankName, 'the PATCH\'s bank name').toBe(BANK);
      expect(meta.otherKey).toBe(SEEDED_META.otherKey);
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

describe('FOLLOW3-D12 the public storefront event under a flood (review D12-ST-1 / CR-D12-1)', () => {
  // POST /site/businesses/:businessId/analytics/event is public and limited
  // to 60 per minute per IP (site.controller.ts), so a few IPs send hundreds
  // of events for one business at once. Each event must neither hold the
  // business row lock across round trips nor hold a pooled connection while
  // it waits (the pool, 20 connections in packages/db client.ts, is shared by
  // every tenant): the events, another tenant's query and the owner's
  // clearing PATCH all succeed, and no event is lost.
  const FLOOD = 200;
  const SEEDED_EVENTS = 1000; // the bound trackEvent keeps

  it(`[MW-06] RED-BEFORE: ${FLOOD} concurrent storefront events on a business already holding ${SEEDED_EVENTS} events, sent with another tenant's read and the owner's PATCH clearing stripeSecretKey: every event is recorded (newest ${SEEDED_EVENTS} kept), none fails, the other tenant's read and the PATCH succeed and the clear holds`, async () => {
    const seeded = Array.from({ length: SEEDED_EVENTS }, (_, i) => ({ type: 'page_view', itemId: `${P}seed-${i}`, timestamp: '2026-11-01T00:00:00.000Z' }));
    await reset({ ...SEEDED_META, storefrontEvents: seeded });
    try {
      const events = Array.from({ length: FLOOD }, (_, i) => plainSite.trackEvent(ID.biz, 'item_view', `${P}flood-${i}`));
      const startedAt = Date.now();
      const otherTenant = db.user.findFirst({ where: { NOT: { id: { startsWith: P } } }, select: { id: true } })
        .then(() => Date.now() - startedAt);
      const clear = patchBusiness({ metaData: { stripeSecretKey: null } }).then((r: any) => r);
      const [settled, other, cleared] = await Promise.all([
        Promise.allSettled(events),
        otherTenant.then((ms: number) => ({ ok: true as const, ms }), (e: any) => ({ ok: false as const, error: String(e?.message ?? e).slice(0, 160) })),
        clear,
      ]);

      const failures = [...new Set(settled.flatMap((s) => (s.status === 'rejected' ? [String((s.reason as any)?.message ?? s.reason).slice(0, 160)] : [])))];
      expect(failures, `failed storefront events (${settled.filter((s) => s.status === 'rejected').length} of ${FLOOD})`).toEqual([]);
      expect(settled.every((s) => s.status === 'fulfilled' && (s.value as any)?.tracked === true), 'every event answers { tracked: true }').toBe(true);
      expect(other, 'another tenant\'s query on the shared pool during the flood').toMatchObject({ ok: true });
      expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);

      const meta = await storedMeta();
      expect(has(meta, 'stripeSecretKey'), 'the cleared stripeSecretKey stored again').toBe(false);
      expect(meta.bankName).toBe(SEEDED_META.bankName);
      const stored = (meta.storefrontEvents ?? []) as Array<{ type: string; itemId: string | null }>;
      expect(stored.length, 'the bound').toBe(SEEDED_EVENTS);
      const flood = stored.filter((e) => String(e.itemId).startsWith(`${P}flood-`));
      expect(flood.length, 'flood events recorded (no event lost to another)').toBe(FLOOD);
      expect(new Set(flood.map((e) => e.itemId)).size).toBe(FLOOD);
      expect(stored.slice(-FLOOD).every((e) => String(e.itemId).startsWith(`${P}flood-`)), 'the new events are the newest').toBe(true);
      expect(stored.slice(0, SEEDED_EVENTS - FLOOD).map((e) => e.itemId), 'the oldest seeded events trimmed, in order')
        .toEqual(seeded.slice(FLOOD).map((e) => e.itemId));
    } finally {
      await reset();
    }
  }, 90_000);
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

// ---------------------------------------------------------------------------
// FOLLOW3-D13-METADATA-LOCKED-WRITES-REST (values tagged `v84l_f3d13_`)
// ---------------------------------------------------------------------------

/**
 * A GA4 or Search Console service over the real client whose Google fetch is
 * a stub (no Google traffic): the first fetch resolves `reached` (the sync has
 * read metaData, OAuth tokens included, and waits on Google) and answers []
 * when the test calls `answer`; a later fetch answers [] at once. The ingest
 * into SeoService is a stub too.
 */
function seoWithStubbedGoogle(kind: 'ga4' | 'gsc') {
  let fetching!: () => void;
  const reached = new Promise<void>((r) => { fetching = r; });
  let answer!: () => void;
  const answered = new Promise<unknown[]>((r) => { answer = () => r([]); });
  let first = true;
  const ingest = async () => ({ updated: 0 });
  const svc: any = kind === 'ga4'
    ? new SeoGa4({ client: db }, { ingestAnalyticsData: ingest })
    : new SeoGsc({ client: db }, { ingestSearchConsoleData: ingest });
  svc[kind === 'ga4' ? 'fetchAnalyticsData' : 'fetchSearchAnalytics'] = () => {
    if (!first) return Promise.resolve([]);
    first = false;
    fetching();
    return answered;
  };
  return { svc, reached, answer };
}

const SEO = {
  ga4: { label: 'GA4', connection: { propertyId: `${D13}property` }, sync: 'syncAnalyticsData', disconnect: 'disconnectGa4' },
  gsc: { label: 'Search Console', connection: { siteUrl: `https://${D13}site.test.local/` }, sync: 'syncSearchData', disconnect: 'disconnectGsc' },
} as const;

const caseStudyDraft = (id: string) => ({
  id,
  businessId: ID.biz,
  headline: `${D13}${id}`,
  location: '',
  industry: null,
  metrics: {
    windowDays: 60, recentOrders: 1, priorOrders: 0, recentRevenue: 100, priorRevenue: 0, currency: 'TTD',
    recentBookings: 0, priorBookings: 0, orderGrowthPct: null, revenueGrowthPct: null, bookingGrowthPct: null,
    topService: null, topProduct: null,
  },
  status: 'draft' as const,
  consent: false,
  consentedAt: null,
  consentedBy: null,
  generatedAt: '2026-11-01T00:00:00.000Z',
  publishedAt: null,
});

const magnetInput = (n: number) => ({
  title: `${D13}magnet-${n}`,
  contentType: 'pdf' as const,
  publicSlug: `${D13}magnet-${n}`,
  isActive: true,
});

const QUALIFICATION_FLOW = { enabled: true, title: `${D13}flow`, questions: [{ id: 'q1', text: `${D13}budget?` }] };

describe('FOLLOW3-D13 the remaining metaData writers read and write under the business row lock', () => {
  it('[MW-10] RED-BEFORE: the invoice.paid gamification handler (firstSaleMade) that has read metaData when the owner\'s PATCH clears stripeSecretKey: after both commit the clear holds (the secret is not stored again) and firstSaleMade is set', async () => {
    await reset();
    try {
      const { concurrentResult: patched, order } = await interleave(
        () => gamification.handleInvoicePaid({ businessId: ID.biz, invoice: { id: `${D13}invoice` } }),
        () => patchBusiness({ metaData: { stripeSecretKey: null } }).then((r: any) => r),
        { assertWaited: false },
      );
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);
      const meta = await storedMeta();
      expect(has(meta, 'stripeSecretKey'), 'the cleared stripeSecretKey stored again by the invoice.paid handler').toBe(false);
      expect(meta.firstSaleMade).toBe(true);
      expect(meta.bankName).toBe(SEEDED_META.bankName);
      expect(order, 'the PATCH waited for the handler\'s row lock (held from its read to its commit)').toBe('waiting');
    } finally {
      await reset();
    }
  });

  it('[MW-11] RED-BEFORE: an autopilot settings save (AutopilotService.updateSettings) that has read metaData while a lead magnet is created (LeadMagnetService.createLeadMagnet): both keys persist (no write lost)', async () => {
    await reset();
    try {
      const { writerResult, concurrentResult: magnet, order } = await interleave(
        () => autopilot.updateSettings(ID.biz, { quietHoursStart: '21:00' }),
        () => plainLeadMagnet.createLeadMagnet(ID.biz, magnetInput(1)),
        { assertWaited: false },
      );
      const meta = await storedMeta();
      const lost: string[] = [];
      if (!((meta.leadMagnets ?? []) as Array<{ id: string }>).some((m) => m.id === magnet.id)) lost.push('lead magnet (metaData.leadMagnets)');
      if (meta.autopilot?.quietHoursStart !== '21:00') lost.push('autopilot settings (metaData.autopilot)');
      expect(lost, 'writes lost to the interleaving').toEqual([]);
      expect(writerResult.quietHoursStart).toBe('21:00');
      expect(meta.stripeSecretKey).toBe(STRIPE_SECRET);
      expect(order, 'the lead-magnet write waited for the settings save\'s row lock').toBe('waiting');
    } finally {
      await reset();
    }
  });

  for (const kind of ['ga4', 'gsc'] as const) {
    const s = SEO[kind];
    it(`[MW-12${kind === 'ga4' ? 'a' : 'b'}] RED-BEFORE (review D12-ST-2): a ${s.label} sync that has read metaData (the OAuth tokens) and waits on Google while the owner disconnects ${s.label} and clears stripeSecretKey: neither the disconnected tokens nor the cleared secret is stored again, and the sync held no lock while it waited`, async () => {
      const connection = { ...s.connection, accessToken: `${D13}${kind}_ACCESS`, refreshToken: `${D13}${kind}_REFRESH`, connectedAt: '2026-11-01T00:00:00.000Z' };
      await reset({ ...SEEDED_META, [kind]: connection });
      const { svc, reached, answer } = seoWithStubbedGoogle(kind);
      try {
        const sync = svc[s.sync](ID.biz);
        await reached;
        // Both commit while the sync waits on Google: it holds no lock then.
        expect(await svc[s.disconnect](ID.biz)).toEqual({ disconnected: true });
        const cleared = await patchBusiness({ metaData: { stripeSecretKey: null } });
        expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
        answer();
        expect(await sync).toMatchObject({ synced: true });
        const meta = await storedMeta();
        const restored: string[] = [];
        if (has(meta, kind)) restored.push(`metaData.${kind} (the disconnected OAuth tokens)`);
        if (has(meta, 'stripeSecretKey')) restored.push('stripeSecretKey (cleared by the PATCH)');
        expect(restored, 'stored again by the sync\'s copy').toEqual([]);
        expect(meta.bankName).toBe(SEEDED_META.bankName);
      } finally {
        answer();
        await reset();
      }
    });
  }

  it('[MW-13] RED-BEFORE: a case-study publish (CaseStudyService.publish) that has read metaData while another case study is published: both are published (no publish lost)', async () => {
    await reset({ ...SEEDED_META, caseStudies: [caseStudyDraft('cs_a'), caseStudyDraft('cs_b')] });
    try {
      const { writerResult, concurrentResult, order } = await interleave(
        () => caseStudy.publish(ID.biz, 'cs_a', { consent: true, userId: ID.owner }),
        () => plainCaseStudy.publish(ID.biz, 'cs_b', { consent: true, userId: ID.owner }),
        { assertWaited: false },
      );
      expect(writerResult).toMatchObject({ id: 'cs_a', status: 'published' });
      expect(concurrentResult).toMatchObject({ id: 'cs_b', status: 'published' });
      const meta = await storedMeta();
      const status = Object.fromEntries(((meta.caseStudies ?? []) as Array<{ id: string; status: string }>).map((c) => [c.id, c.status]));
      expect(status, 'stored case-study statuses').toEqual({ cs_a: 'published', cs_b: 'published' });
      expect(meta.stripeSecretKey).toBe(STRIPE_SECRET);
      expect(order, 'the second publish waited for the first one\'s row lock').toBe('waiting');
    } finally {
      await reset();
    }
  });

  it('[MW-14] RED-BEFORE: a concierge nudge snooze (OnboardingConciergeService.snoozeNudge) that has read metaData when the owner\'s PATCH clears stripeSecretKey: the clear holds and the snooze is saved', async () => {
    await reset();
    try {
      const { writerResult, concurrentResult: patched, order } = await interleave(
        () => concierge.snoozeNudge(ID.biz, 'products', 3),
        () => patchBusiness({ metaData: { stripeSecretKey: null } }).then((r: any) => r),
        { assertWaited: false },
      );
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);
      expect(writerResult).toMatchObject({ snoozed: true });
      const meta = await storedMeta();
      expect(has(meta, 'stripeSecretKey'), 'the cleared stripeSecretKey stored again by the snooze').toBe(false);
      expect(meta.snoozedNudges?.products).toBe(writerResult.until);
      expect(order, 'the PATCH waited for the snooze\'s row lock').toBe('waiting');
    } finally {
      await reset();
    }
  });

  it('[MW-15] RED-BEFORE: a qualification config save (QualificationService.updateQualificationConfig) that has read metaData when the owner\'s PATCH clears stripeSecretKey: the clear holds and the config is saved', async () => {
    await reset();
    try {
      const { writerResult, concurrentResult: patched, order } = await interleave(
        () => qualification.updateQualificationConfig(ID.biz, QUALIFICATION_FLOW),
        () => patchBusiness({ metaData: { stripeSecretKey: null } }).then((r: any) => r),
        { assertWaited: false },
      );
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);
      expect(writerResult).toEqual(QUALIFICATION_FLOW);
      const meta = await storedMeta();
      expect(has(meta, 'stripeSecretKey'), 'the cleared stripeSecretKey stored again by the config save').toBe(false);
      expect(meta.qualificationFlow).toEqual(QUALIFICATION_FLOW);
      expect(order, 'the PATCH waited for the config save\'s row lock').toBe('waiting');
    } finally {
      await reset();
    }
  });
});

describe('FOLLOW3-D13 controls (unchanged behaviour)', () => {
  it('[MW-C03] CONTROL: each FOLLOW3-D13 writer on its own writes its key and keeps every other metaData key; a disconnect removes only its key; a repeated invoice.paid changes nothing; an unknown business answers as before', async () => {
    await reset();
    try {
      await gamification.handleInvoicePaid({ businessId: ID.biz, invoice: { id: `${D13}invoice-c` } });
      await gamification.handlePostPublished({ businessId: ID.biz });
      await gamification.handleFirstBooking({ businessId: ID.biz });
      await gamification.handleProductCreated({ businessId: ID.biz });
      const settings = await autopilot.updateSettings(ID.biz, { quietHoursEnd: '06:00', triggers: { follow_up: false, birthday: true, payment_reminder: true, check_in: true, offer: true } });
      expect(settings).toMatchObject({ quietHoursEnd: '06:00', triggers: { follow_up: false, birthday: true } });
      const magnet = await plainLeadMagnet.createLeadMagnet(ID.biz, magnetInput(2));
      expect(await plainLeadMagnet.listLeadMagnets(ID.biz)).toEqual([magnet]);
      expect(await qualification.updateQualificationConfig(ID.biz, QUALIFICATION_FLOW)).toEqual(QUALIFICATION_FLOW);
      expect(await qualification.getQualificationConfig(ID.biz)).toEqual(QUALIFICATION_FLOW);
      const snoozed = await concierge.snoozeNudge(ID.biz, 'storefront', 3);
      expect(await concierge.dismissConcierge(ID.biz)).toEqual({ dismissed: true });
      expect(await concierge.resumeConcierge(ID.biz)).toEqual({ resumed: true });

      const ga4 = new SeoGa4({ client: db }, {} as any);
      const GA4 = { propertyId: `${D13}prop-c`, accessToken: `${D13}ga4_ACCESS_C`, refreshToken: `${D13}ga4_REFRESH_C` };
      expect(await ga4.saveConnection(ID.biz, GA4)).toEqual({ connected: true, propertyId: GA4.propertyId });
      expect(await ga4.getConnectionStatus(ID.biz)).toMatchObject({ connected: true, propertyId: GA4.propertyId });
      const gsc = new SeoGsc({ client: db }, {} as any);
      const GSC = { siteUrl: `https://${D13}site-c.test.local/`, accessToken: `${D13}gsc_ACCESS_C`, refreshToken: `${D13}gsc_REFRESH_C` };
      expect(await gsc.saveConnection(ID.biz, GSC)).toEqual({ connected: true, siteUrl: GSC.siteUrl });
      // A sync while still connected stamps lastSync (Google stubbed).
      const stubbed = seoWithStubbedGoogle('gsc');
      stubbed.answer();
      expect(await stubbed.svc.syncSearchData(ID.biz)).toMatchObject({ synced: true });

      const meta = await storedMeta();
      for (const [k, v] of Object.entries(SEEDED_META)) expect(meta[k], `metaData.${k} kept`).toEqual(v);
      expect(meta).toMatchObject({
        firstSaleMade: true, firstPostPublished: true, firstBooking: true, firstProductCreated: true,
        conciergeDismissed: false, conciergeDismissedAt: expect.any(String),
        qualificationFlow: QUALIFICATION_FLOW,
        leadMagnets: [magnet],
        snoozedNudges: { storefront: snoozed.until },
        ga4: { ...GA4, connectedAt: expect.any(String) },
        gsc: { ...GSC, connectedAt: expect.any(String), lastSync: expect.any(String) },
      });
      expect(meta.autopilot).toMatchObject({ quietHoursEnd: '06:00', trigger_follow_up: false, trigger_birthday: true });

      // A disconnect removes its key only.
      expect(await ga4.disconnectGa4(ID.biz)).toEqual({ disconnected: true });
      const disconnected = await storedMeta();
      expect(has(disconnected, 'ga4')).toBe(false);
      expect({ ...disconnected, ga4: meta.ga4 }).toEqual(meta);

      // A second invoice.paid with firstSaleMade set changes nothing.
      const before = JSON.stringify(await storedMeta());
      await gamification.handleInvoicePaid({ businessId: ID.biz, invoice: { id: `${D13}invoice-d` } });
      expect(JSON.stringify(await storedMeta())).toBe(before);

      // Case studies: publish, list, unpublish; an unknown study is refused.
      await reset({ ...SEEDED_META, caseStudies: [caseStudyDraft('cs_c')] });
      expect(await caseStudy.publish(ID.biz, 'cs_c', { consent: true, userId: ID.owner })).toMatchObject({ status: 'published', consent: true, consentedBy: ID.owner });
      expect((await caseStudy.list(ID.biz)).map((c: any) => c.status)).toEqual(['published']);
      expect(await caseStudy.unpublish(ID.biz, 'cs_c')).toMatchObject({ status: 'draft', publishedAt: null, consent: true });
      await expect(caseStudy.publish(ID.biz, 'cs_missing', { consent: true })).rejects.toThrow('Case study not found');
      await expect(caseStudy.publish(ID.biz, 'cs_c', { consent: false })).rejects.toThrow('Explicit consent');
      const afterStudies = await storedMeta();
      for (const [k, v] of Object.entries(SEEDED_META)) expect(afterStudies[k], `metaData.${k} kept`).toEqual(v);
      expect((afterStudies.caseStudies as any[]).map((c) => c.status)).toEqual(['draft']);

      // An unknown business answers as before, with nothing written.
      const NO = `${P}no-such-business`;
      await expect(gamification.handleInvoicePaid({ businessId: NO, invoice: { id: `${D13}invoice-e` } })).resolves.toBeUndefined();
      await expect(ga4.saveConnection(NO, GA4)).rejects.toThrow('Business not found');
      expect(await ga4.disconnectGa4(NO)).toEqual({ disconnected: true });
      await expect(caseStudy.publish(NO, 'cs_c', { consent: true })).rejects.toThrow('Business not found');
      expect(await db.business.count({ where: { id: NO } })).toBe(0);
    } finally {
      await reset();
    }
  });
});
