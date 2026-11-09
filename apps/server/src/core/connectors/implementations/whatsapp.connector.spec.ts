/**
 * PR196-WHATSAPP-HEALTH — the WhatsApp connector's health and smoke checks
 * read the business's OWN WhatsApp config (Business.metaData.whatsapp, as
 * WhatsAppService.saveConfig stores it, credentials encrypted at rest), and
 * nothing they answer or log carries the business's phoneNumberId, its Twilio
 * account SID or any token.
 *
 * SOURCE: PR #196 feature 4 (origin/feat/core-journeys-and-foundation-completion),
 * rebuilt with its verified defects fixed:
 *   4-D1  connectedAccount carried the phoneNumberId (the id the shared
 *         webhook routes inbound by) to every member through health, statuses
 *         and the dashboard; R0-SEC2/SEC2b answer it only to the config owner
 *         (GET whatsapp/.../config). Here nothing the connector answers carries
 *         it, nor any credential or fragment of one: the connector has no
 *         notion of the caller (GET health and POST smoke are open to every
 *         member), so it answers what any member may see.
 *   4-D2  the Twilio smoke test claimed "Verified" without asking Twilio and
 *         showed the first 6 characters of the account SID. Here it asks
 *         Twilio (GET Accounts/{sid}.json, the provider WhatsAppService already
 *         sends through) and reports no SID.
 *   4-D3  health said "connected" whenever a config was stored, so a
 *         disconnect never showed; the mock provider passed as verified. Here
 *         an explicit 'disconnected' row wins (also over the platform token),
 *         and the mock is never verified.
 *   4-D4  saveConfig marked the connector 'connected' without checking any
 *         credential, outside the config transaction, swallowing its errors.
 *         Here a save never writes 'connected': a save that changes the
 *         sending identity resets a verified row to 'disconnected' through the
 *         transaction client, so a failed status write rolls the config back.
 *   "connected" for a business's own config therefore means: a verified check
 *   (a smoke test that reached the provider with these credentials) passed,
 *   and nothing changed the sending identity or disconnected it since.
 *
 * NO PROVIDER TRAFFIC: global fetch is replaced by a stub for every case; a
 * call the stub does not expect throws and fails the case.
 *
 * The database is an in-memory stand-in for the two tables these paths touch
 * (businesses.metaData, connector_statuses); $transaction stages its writes
 * and commits them only when the callback resolves, so a failure inside the
 * transaction leaves the stored rows as they were.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { WhatsAppConnector } from './whatsapp.connector';
import { ConnectorRegistryService } from '../connector-registry.service';
import { ConnectorCredentialsService } from '../connector-credentials.service';
import { ConnectorController } from '../connector.controller';
import { WhatsAppService, type WhatsAppConfig } from '../../../modules/whatsapp/whatsapp.service';
import { encryptToken, isTokenEncrypted } from '../../crypto/token-crypto';

// ── Secret canaries ─────────────────────────────────────────────────────────
const BIZ = 'pr196wa_biz';
const PNID = '170693417358209';
const META_TOKEN = 'EAAGq7Zx2Lw9Rk4Tn8Vb3Jm6Hc1Yd5Pf0Qs';
const TWILIO_SID = 'ACgkqzvwxmhnjrtwkyqzvxgmhjtnwrqkyz';
const TWILIO_TOKEN = 'f3k9q2w8z7x1v6b4n5m0j2r7t9y3u8i1';
const FROM = '+18685550199';
const PLATFORM_TOKEN = 'EAAGw4Hs8Jd2Kq6Lz9Xc3Vb7Nm1Pt5Ry0';
const PLATFORM_PNID = '980716254331470';

const META_CONFIG: WhatsAppConfig = { provider: 'meta', phoneNumberId: PNID, fromNumber: FROM, accessToken: META_TOKEN };
const TWILIO_CONFIG: WhatsAppConfig = { provider: 'twilio', fromNumber: FROM, accountSid: TWILIO_SID, authToken: TWILIO_TOKEN };

/** Every window of `size` characters of `secret` found in `text`. */
function windowsIn(text: string, secret: string, size: number): string[] {
  const found: string[] = [];
  for (let i = 0; i + size <= secret.length; i++) {
    const w = secret.slice(i, i + size);
    if (text.includes(w)) found.push(w);
  }
  return found;
}

/**
 * What no answer or log may carry: the phoneNumberIds (any 6 digits of them),
 * the SID (any 4 characters past its fixed "AC" prefix, which covers the PR's
 * slice(0, 6) and a last-4), and the tokens (any 6 characters).
 */
function leaks(value: unknown): string[] {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return [
    ...windowsIn(text, PNID, 6).map((w) => `phoneNumberId:${w}`),
    ...windowsIn(text, PLATFORM_PNID, 6).map((w) => `platformPhoneNumberId:${w}`),
    ...windowsIn(text, TWILIO_SID.slice(2), 4).map((w) => `accountSid:${w}`),
    ...windowsIn(text, TWILIO_TOKEN, 6).map((w) => `authToken:${w}`),
    ...windowsIn(text, META_TOKEN, 6).map((w) => `accessToken:${w}`),
    ...windowsIn(text, PLATFORM_TOKEN, 6).map((w) => `platformToken:${w}`),
  ];
}

// ── In-memory stand-in for businesses.metaData and connector_statuses ──────
type Row = Record<string, unknown>;
interface Store {
  businesses: Map<string, { metaData: Record<string, unknown> | null }>;
  statuses: Map<string, Row>;
}

const clone = <T>(v: T): T => structuredClone(v);
const statusKey = (businessId: string, type: string) => `${businessId}:${type}`;

function applyUpdate(row: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && !(v instanceof Date) && 'increment' in (v as Row)) {
      row[k] = Number(row[k] ?? 0) + Number((v as { increment: number }).increment);
    } else {
      row[k] = v;
    }
  }
}

function makeDb() {
  const live: Store = { businesses: new Map(), statuses: new Map() };
  const writes: Array<{ via: 'client' | 'tx'; op: string; args: unknown }> = [];
  const failures = { statusWriteInTx: false };

  const delegates = (via: 'client' | 'tx', store: Store) => ({
    business: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const b = store.businesses.get(where.id);
        return b ? { metaData: clone(b.metaData) } : null;
      },
      findFirst: async ({ where }: { where: { id?: { not?: string }; metaData?: { path: string[]; equals: unknown } } }) => {
        for (const [id, b] of store.businesses) {
          if (where.id?.not === id) continue;
          if (where.metaData) {
            let cur: unknown = b.metaData;
            for (const p of where.metaData.path) cur = (cur as Row | null)?.[p];
            if (cur === where.metaData.equals) return { id };
          }
        }
        return null;
      },
      update: async (args: { where: { id: string }; data: { metaData: Record<string, unknown> } }) => {
        writes.push({ via, op: 'business.update', args });
        store.businesses.set(args.where.id, { metaData: clone(args.data.metaData) });
        return { id: args.where.id };
      },
    },
    connectorStatus: {
      findUnique: async ({ where }: { where: { businessId_connectorType: { businessId: string; connectorType: string } } }) => {
        const { businessId, connectorType } = where.businessId_connectorType;
        const row = store.statuses.get(statusKey(businessId, connectorType));
        return row ? clone(row) : null;
      },
      findMany: async ({ where }: { where: { businessId: string } }) =>
        [...store.statuses.values()].filter((r) => r.businessId === where.businessId).map((r) => clone(r)),
      upsert: async (args: { where: { businessId_connectorType: { businessId: string; connectorType: string } }; create: Row; update: Row }) => {
        writes.push({ via, op: 'connectorStatus.upsert', args });
        if (via === 'tx' && failures.statusWriteInTx) throw new Error('connector status write failed');
        const { businessId, connectorType } = args.where.businessId_connectorType;
        const key = statusKey(businessId, connectorType);
        const existing = store.statuses.get(key);
        if (existing) applyUpdate(existing, args.update);
        else store.statuses.set(key, { status: 'disconnected', errorCount: 0, syncCount: 0, intakeEnabled: false, ...clone(args.create) });
        return clone(store.statuses.get(key));
      },
      updateMany: async (args: { where: { businessId: string; connectorType: string }; data: Row }) => {
        writes.push({ via, op: 'connectorStatus.updateMany', args });
        if (via === 'tx' && failures.statusWriteInTx) throw new Error('connector status write failed');
        const row = store.statuses.get(statusKey(args.where.businessId, args.where.connectorType));
        if (!row) return { count: 0 };
        applyUpdate(row, args.data);
        return { count: 1 };
      },
    },
  });

  // Transactions run one at a time, as the business row lock every writer
  // here takes (saveConfig's UPDATE, the connector's SELECT ... FOR NO KEY
  // UPDATE) serialises them on one business in Postgres.
  let txQueue: Promise<unknown> = Promise.resolve();
  const client = {
    ...delegates('client', live),
    $transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const run = txQueue.then(async () => {
        const staged: Store = { businesses: clone(live.businesses), statuses: clone(live.statuses) };
        const tx = {
          ...delegates('tx', staged),
          $executeRaw: async () => 0,
          // The business row lock (SELECT ... FOR NO KEY UPDATE): recorded, so a case can check it is taken before a status write.
          $queryRaw: async (sql: TemplateStringsArray) => {
            writes.push({ via: 'tx', op: '$queryRaw', args: sql.join('?') });
            return [];
          },
        };
        const result = await fn(tx);
        live.businesses = staged.businesses;
        live.statuses = staged.statuses;
        return result;
      });
      txQueue = run.catch(() => undefined);
      return run;
    },
  };

  return {
    prisma: { client } as never,
    live,
    writes,
    failures,
    status: (businessId = BIZ) => live.statuses.get(statusKey(businessId, 'whatsapp')) ?? null,
    setStatus: (row: Row, businessId = BIZ) =>
      live.statuses.set(statusKey(businessId, 'whatsapp'), { errorCount: 0, syncCount: 0, intakeEnabled: false, ...row, businessId, connectorType: 'whatsapp' }),
    seedBusiness: (metaData: Record<string, unknown> | null = {}, businessId = BIZ) => live.businesses.set(businessId, { metaData }),
    storedWhatsApp: (businessId = BIZ) => (live.businesses.get(businessId)?.metaData as Row | null)?.whatsapp as Row | undefined,
  };
}

// ── Stubbed providers ───────────────────────────────────────────────────────
interface Reply { status?: number; body?: unknown; throws?: Error }
interface FetchCall { url: string; init?: { headers?: Record<string, string>; method?: string } }

function stubFetch(replies: Record<string, Reply>) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (input: unknown, init?: FetchCall['init']) => {
    const url = String(input);
    calls.push({ url, init });
    const key = Object.keys(replies).find((prefix) => url.startsWith(prefix));
    if (!key) throw new Error(`unexpected provider call in a test: ${url}`);
    const reply = replies[key];
    if (reply.throws) throw reply.throws;
    const status = reply.status ?? 200;
    const text = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body ?? {});
    return new Response(text, { status, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

const GRAPH = `https://graph.facebook.com/v17.0/${PNID}`;
const GRAPH_PLATFORM = `https://graph.facebook.com/v17.0/${PLATFORM_PNID}`;
const TWILIO_ACCOUNT = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}.json`;
const GRAPH_OK: Reply = { body: { display_phone_number: '+1 868-555-0199', verified_name: 'Pr196 Bakery', quality_rating: 'GREEN', id: PNID } };
const TWILIO_OK: Reply = { body: { sid: TWILIO_SID, status: 'active', friendly_name: 'Pr196 Bakery', auth_token: TWILIO_TOKEN } };

// ── Harness ─────────────────────────────────────────────────────────────────
function makeHarness() {
  const db = makeDb();
  const events = { emit: vi.fn() };
  const connector = new WhatsAppConnector(db.prisma, events as never, {} as never);
  const registry = new ConnectorRegistryService(events as never, db.prisma);
  registry.register(connector);
  const service = new WhatsAppService(db.prisma, events as never, {} as never, {} as never, {} as never);
  db.seedBusiness({ name: 'pr196' });
  return { db, connector, registry, service };
}

/** Everything the connector answers about the business, as a member reads it. */
async function memberView(h: ReturnType<typeof makeHarness>) {
  const health = await h.registry.getHealth('whatsapp', BIZ);
  const statuses = await h.registry.getStatuses(BIZ);
  const dashboard = await h.registry.getDashboard(BIZ);
  return { health, status: statuses.find((s) => s.type === 'whatsapp'), dashboard: dashboard.find((d) => d.meta.type === 'whatsapp') };
}

/**
 * A verified smoke test's row: the business's stored Meta config checked
 * against the stubbed Graph API through the registry. Review SEC-WAH-3: a
 * hand-written 'connected' row is not one (no check vouched for the config),
 * so the cases that need a verified row make it this way. Afterwards any
 * provider call fails the case again.
 */
async function verifyMetaConfig(h: ReturnType<typeof makeHarness>) {
  stubFetch({ [GRAPH]: GRAPH_OK });
  expect((await h.registry.smokeTestConnector('whatsapp', BIZ)).success).toBe(true);
  stubFetch({});
}

const LOG_METHODS = ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const;
let logLines: string[] = [];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID']) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  logLines = [];
  for (const m of LOG_METHODS) {
    vi.spyOn(Logger.prototype, m as 'log').mockImplementation((...args: unknown[]) => {
      logLines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });
  }
  stubFetch({});
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PR196-WHATSAPP-HEALTH: health reads the business\'s own config', () => {
  it('[WAH-H1] RED-BEFORE: a verified Meta config of the business (no platform env vars) reads connected, and the account it shows is the business\'s sending number', async () => {
    const h = makeHarness();
    await h.service.saveConfig(BIZ, META_CONFIG);
    expect(isTokenEncrypted(h.db.storedWhatsApp()?.accessToken as string)).toBe(true);
    await verifyMetaConfig(h); // a verified smoke test's row
    h.db.setStatus({ ...h.db.status(), connectedAccount: null }); // the account shown is not the row's

    const view = await memberView(h);
    expect(view.health?.status).toBe('connected');
    expect(view.health?.connectedAccount).toBe(FROM);
    expect(view.status).toMatchObject({ status: 'connected', connectedAccount: FROM });
    expect(view.dashboard?.health.connectedAccount).toBe(FROM);
    expect(await h.connector.isConnected(BIZ)).toBe(true);
  });

  it('[WAH-H2] RED-BEFORE (4-D1): a connector row that carries the phoneNumberId (as PR #196\'s saveConfig or the platform smoke fallback wrote it) never reaches health, statuses or the dashboard; a Meta config without a sending number shows no account at all', async () => {
    const h = makeHarness();
    await h.service.saveConfig(BIZ, { provider: 'meta', phoneNumberId: PNID, accessToken: META_TOKEN });
    await verifyMetaConfig(h);
    h.db.setStatus({ ...h.db.status(), connectedAccount: PNID });

    const view = await memberView(h);
    expect(view.health?.status).toBe('connected');
    expect(view.health?.connectedAccount).toBeNull();
    expect(leaks(view)).toEqual([]);
  });

  it('[WAH-H3] RED-BEFORE (4-D3): a disconnect shows as disconnected although the config stays stored, even with the platform token set; authenticate and isConnected agree', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = PLATFORM_TOKEN;
    const h = makeHarness();
    await h.service.saveConfig(BIZ, META_CONFIG);
    h.db.setStatus({ status: 'connected', connectedAccount: FROM });

    await h.registry.disconnectConnector('whatsapp', BIZ);

    expect(h.db.storedWhatsApp()?.phoneNumberId).toBe(PNID); // the config itself is untouched
    expect((await h.registry.getHealth('whatsapp', BIZ))?.status).toBe('disconnected');
    expect(await h.connector.isConnected(BIZ)).toBe(false);
    expect((await h.connector.authenticate(BIZ)).connected).toBe(false);
  });

  it('[WAH-H4] RED-BEFORE (4-D2/4-D4): a saved config nobody verified is not connected, and the platform token does not stand in for the business\'s own credentials', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = PLATFORM_TOKEN;
    process.env.WHATSAPP_PHONE_NUMBER_ID = PLATFORM_PNID;
    const h = makeHarness();
    await h.service.saveConfig(BIZ, META_CONFIG);

    const view = await memberView(h);
    expect(view.health?.status).toBe('disconnected');
    expect(view.status?.status).toBe('disconnected');
    expect(leaks(view)).toEqual([]);
  });

  it('[WAH-H5] RED-BEFORE (4-D3): the mock provider is never connected, whatever the connector row says', async () => {
    const h = makeHarness();
    await h.service.saveConfig(BIZ, { provider: 'mock', fromNumber: FROM });
    h.db.setStatus({ status: 'connected', connectedAccount: FROM });

    expect((await h.registry.getHealth('whatsapp', BIZ))?.status).toBe('disconnected');
  });

  it('[WAH-H6] RED-BEFORE: a config missing the credentials its provider needs is not connected, whatever the connector row says', async () => {
    const h = makeHarness();
    await h.service.saveConfig(BIZ, { provider: 'meta', phoneNumberId: PNID, fromNumber: FROM });
    h.db.setStatus({ status: 'connected', connectedAccount: FROM });
    expect((await h.registry.getHealth('whatsapp', BIZ))?.status).toBe('disconnected');

    await h.service.saveConfig(BIZ, { provider: 'twilio', fromNumber: FROM, accountSid: TWILIO_SID });
    h.db.setStatus({ status: 'connected', connectedAccount: FROM });
    expect((await h.registry.getHealth('whatsapp', BIZ))?.status).toBe('disconnected');
  });

  it('[WAH-H7] NO REGRESSION: a business with no config of its own and no platform token is disconnected', async () => {
    const h = makeHarness();
    const health = await h.registry.getHealth('whatsapp', BIZ);
    expect(health).toMatchObject({ status: 'disconnected', connectedAccount: null });
  });

  it('[WAH-H8] RED-BEFORE: without a config of its own the platform path still reads the platform token, but never shows the platform phoneNumberId as the account, and an explicit disconnect wins', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = PLATFORM_TOKEN;
    process.env.WHATSAPP_PHONE_NUMBER_ID = PLATFORM_PNID;
    const h = makeHarness();

    const view = await memberView(h);
    expect(view.health?.status).toBe('connected');
    expect(view.health?.connectedAccount).toBeNull();
    expect(leaks(view)).toEqual([]);

    h.db.setStatus({ status: 'connected', connectedAccount: PLATFORM_PNID }); // a pre-packet platform smoke row
    expect(leaks(await memberView(h))).toEqual([]);

    await h.registry.disconnectConnector('whatsapp', BIZ);
    expect((await h.registry.getHealth('whatsapp', BIZ))?.status).toBe('disconnected');
  });
});

describe('PR196-WHATSAPP-HEALTH: smoke checks verify the business\'s own credentials with its provider', () => {
  it('[WAH-S1] RED-BEFORE: a Meta config with no platform env vars is verified against the Graph API with the business\'s decrypted token; on success the row reads connected and the account is the sending number', async () => {
    const h = makeHarness();
    await h.service.saveConfig(BIZ, META_CONFIG);
    const { calls } = stubFetch({ [GRAPH]: GRAPH_OK });

    const result = await h.registry.smokeTestConnector('whatsapp', BIZ);

    expect(calls).toHaveLength(1);
    expect(calls[0].url.startsWith(`${GRAPH}?`)).toBe(true);
    expect(calls[0].init?.headers?.Authorization).toBe(`Bearer ${META_TOKEN}`);
    expect(result).toMatchObject({ success: true, account: FROM });
    expect(leaks(result)).toEqual([]);
    expect(h.db.status()).toMatchObject({ status: 'connected', connectedAccount: FROM });
    const view = await memberView(h);
    expect(view.health).toMatchObject({ status: 'connected', connectedAccount: FROM });
    expect(leaks(view)).toEqual([]);
  });

  it('[WAH-S2] RED-BEFORE (4-D2): a Twilio config is verified by asking Twilio for the account (GET Accounts/{sid}.json, the business\'s decrypted SID and token); the answer carries no SID fragment and no token', async () => {
    const h = makeHarness();
    await h.service.saveConfig(BIZ, TWILIO_CONFIG);
    const { calls } = stubFetch({ [TWILIO_ACCOUNT]: TWILIO_OK });

    const result = await h.registry.smokeTestConnector('whatsapp', BIZ);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(TWILIO_ACCOUNT);
    expect(calls[0].init?.method ?? 'GET').toBe('GET');
    expect(calls[0].init?.headers?.Authorization).toBe(`Basic ${Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64')}`);
    expect(result).toMatchObject({ success: true, account: FROM });
    expect(leaks(result)).toEqual([]);
    expect(h.db.status()).toMatchObject({ status: 'connected', connectedAccount: FROM });
    expect((await h.registry.getHealth('whatsapp', BIZ))?.status).toBe('connected');
  });

  it('[WAH-S3] RED-BEFORE (4-D2): Twilio refusing the credentials fails the smoke test, writes no connected row, and the error (Twilio echoes the SID in its body) carries no SID fragment or token', async () => {
    const h = makeHarness();
    await h.service.saveConfig(BIZ, TWILIO_CONFIG);
    const { calls } = stubFetch({
      [TWILIO_ACCOUNT]: { status: 401, body: { code: 20003, message: `Authenticate: /2010-04-01/Accounts/${TWILIO_SID}.json (${TWILIO_TOKEN})`, status: 401 } },
    });

    const result = await h.registry.smokeTestConnector('whatsapp', BIZ);

    expect(calls).toHaveLength(1);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/401/);
    expect(leaks(result)).toEqual([]);
    expect(h.db.status()?.status ?? 'disconnected').not.toBe('connected');
    expect((await h.registry.getHealth('whatsapp', BIZ))?.status).toBe('disconnected');
  });

  it('[WAH-S4] RED-BEFORE (4-D2): a Twilio account that is not active fails the smoke test', async () => {
    const h = makeHarness();
    await h.service.saveConfig(BIZ, TWILIO_CONFIG);
    const { calls } = stubFetch({ [TWILIO_ACCOUNT]: { body: { sid: TWILIO_SID, status: 'suspended' } } });

    const result = await h.registry.smokeTestConnector('whatsapp', BIZ);

    expect(calls).toHaveLength(1);
    expect(result.success).toBe(false);
    expect(leaks(result)).toEqual([]);
    expect(h.db.status()?.status ?? 'disconnected').not.toBe('connected');
  });

  it('[WAH-S5] RED-BEFORE (4-D1): the Graph API refusing the token fails the smoke test, and the error (Graph echoes the object id) carries neither the phoneNumberId nor the token', async () => {
    const h = makeHarness();
    await h.service.saveConfig(BIZ, META_CONFIG);
    const { calls } = stubFetch({
      [GRAPH]: { status: 400, body: { error: { message: `Unsupported get request. Object with ID '${PNID}' does not exist (token ${META_TOKEN})`, type: 'GraphMethodException', code: 100 } } },
    });

    const result = await h.registry.smokeTestConnector('whatsapp', BIZ);

    expect(calls).toHaveLength(1);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/400/);
    expect(leaks(result)).toEqual([]);
    expect(h.db.status()?.status ?? 'disconnected').not.toBe('connected');
  });

  it('[WAH-S6] RED-BEFORE (4-D5): a Meta config missing its own token is refused as incomplete; the platform token is never paired with the business (or platform) phone number id', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = PLATFORM_TOKEN;
    process.env.WHATSAPP_PHONE_NUMBER_ID = PLATFORM_PNID;
    const h = makeHarness();
    await h.service.saveConfig(BIZ, { provider: 'meta', phoneNumberId: PNID, fromNumber: FROM });
    const { calls } = stubFetch({ [GRAPH]: GRAPH_OK, [GRAPH_PLATFORM]: GRAPH_OK });

    const result = await h.registry.smokeTestConnector('whatsapp', BIZ);

    expect(calls).toEqual([]);
    expect(result.success).toBe(false);
    expect(leaks(result)).toEqual([]);
    expect(h.db.status()?.status ?? 'disconnected').not.toBe('connected');
  });

  it('[WAH-S7] (4-D3): the mock provider is reported as configured but not verified: no provider call, no connected row', async () => {
    const h = makeHarness();
    await h.service.saveConfig(BIZ, { provider: 'mock', fromNumber: FROM });
    const { calls } = stubFetch({});

    const result = await h.registry.smokeTestConnector('whatsapp', BIZ);

    expect(calls).toEqual([]);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not verified/i);
    expect(h.db.status()).toBeNull();
  });

  it('[WAH-S8] a network failure fails the smoke test, and its message carries no credential', async () => {
    const h = makeHarness();
    await h.service.saveConfig(BIZ, TWILIO_CONFIG);
    stubFetch({ [TWILIO_ACCOUNT]: { throws: new Error(`connect ECONNREFUSED for ${TWILIO_ACCOUNT} as ${TWILIO_SID}:${TWILIO_TOKEN}`) } });

    const result = await h.registry.smokeTestConnector('whatsapp', BIZ);

    expect(result.success).toBe(false);
    expect(leaks(result)).toEqual([]);
    expect(h.db.status()?.status ?? 'disconnected').not.toBe('connected');
  });

  it('[WAH-S9] RED-BEFORE: without a config of its own the platform smoke path still runs on the platform env vars, and its account and detail never show the platform phoneNumberId', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = PLATFORM_TOKEN;
    process.env.WHATSAPP_PHONE_NUMBER_ID = PLATFORM_PNID;
    const h = makeHarness();
    const { calls } = stubFetch({ [GRAPH_PLATFORM]: { body: { quality_rating: 'GREEN', id: PLATFORM_PNID } } });

    const result = await h.registry.smokeTestConnector('whatsapp', BIZ);

    expect(calls).toHaveLength(1);
    expect(calls[0].init?.headers?.Authorization).toBe(`Bearer ${PLATFORM_TOKEN}`);
    expect(result.success).toBe(true);
    expect(leaks(result)).toEqual([]);
    expect(leaks(h.db.status())).toEqual([]);
  });
});

describe('PR196-WHATSAPP-HEALTH: saveConfig keeps the connector status in step with the config (4-D4)', () => {
  it('[WAH-C1] RED-BEFORE: replacing a verified config\'s credentials resets the row to disconnected through the transaction client (never connected, never the phoneNumberId), until a smoke test verifies the new ones', async () => {
    const h = makeHarness();
    await h.service.saveConfig(BIZ, META_CONFIG);
    stubFetch({ [GRAPH]: GRAPH_OK });
    expect((await h.registry.smokeTestConnector('whatsapp', BIZ)).success).toBe(true);
    h.db.setStatus({ ...h.db.status(), connectedAccount: PNID }); // a pre-packet row
    h.db.writes.length = 0;

    await h.service.saveConfig(BIZ, { ...META_CONFIG, accessToken: 'EAAGz5Yq1Wr8Ux3Kp7Hn2Mv6Bj9Cd4Lf' });

    expect(h.db.status()).toMatchObject({ status: 'disconnected', connectedAccount: FROM, connectedAt: null });
    const statusWrites = h.db.writes.filter((w) => w.op.startsWith('connectorStatus.'));
    expect(statusWrites.length).toBeGreaterThan(0);
    expect(statusWrites.every((w) => w.via === 'tx')).toBe(true);
    expect(JSON.stringify(statusWrites)).not.toContain('"connected"');
    expect(leaks(statusWrites)).toEqual([]);
    expect((await h.registry.getHealth('whatsapp', BIZ))?.status).toBe('disconnected');
  });

  it('[WAH-C2] re-saving the masked view (credentials kept, same provider, phone number id and sending number) keeps a verified status', async () => {
    const h = makeHarness();
    await h.service.saveConfig(BIZ, META_CONFIG);
    stubFetch({ [GRAPH]: GRAPH_OK });
    expect((await h.registry.smokeTestConnector('whatsapp', BIZ)).success).toBe(true);
    h.db.writes.length = 0;

    await h.service.saveConfig(BIZ, { provider: 'meta', phoneNumberId: PNID, fromNumber: FROM, accessToken: '•••• 5Pf0' });

    expect(h.db.writes.filter((w) => w.op.startsWith('connectorStatus.'))).toEqual([]);
    expect((await h.registry.getHealth('whatsapp', BIZ))?.status).toBe('connected');
  });

  it('[WAH-C3] RED-BEFORE: the status write is part of the config write: when it fails, saveConfig rejects and the stored config is unchanged', async () => {
    const h = makeHarness();
    await h.service.saveConfig(BIZ, META_CONFIG);
    h.db.setStatus({ status: 'connected', connectedAccount: FROM });
    const before = JSON.stringify(h.db.storedWhatsApp());
    h.db.failures.statusWriteInTx = true;

    await expect(h.service.saveConfig(BIZ, TWILIO_CONFIG)).rejects.toThrow(/connector status write failed/);

    expect(JSON.stringify(h.db.storedWhatsApp())).toBe(before);
    expect(h.db.status()?.status).toBe('connected');
  });

  it('[WAH-C4] RED-BEFORE: switching a verified business to the mock provider, or dropping its credentials, resets the row to disconnected', async () => {
    const h = makeHarness();
    await h.service.saveConfig(BIZ, META_CONFIG);
    h.db.setStatus({ status: 'connected', connectedAccount: FROM });
    await h.service.saveConfig(BIZ, { provider: 'mock', fromNumber: FROM });
    expect(h.db.status()?.status).toBe('disconnected');

    await h.service.saveConfig(BIZ, META_CONFIG);
    h.db.setStatus({ status: 'connected', connectedAccount: FROM });
    await h.service.saveConfig(BIZ, { provider: 'meta', fromNumber: FROM, accessToken: '' }); // phoneNumberId dropped
    expect(h.db.status()?.status).toBe('disconnected');
  });

  it('[WAH-C5] a first save creates no connector row of its own (a saved config reads disconnected until verified), and writes no connected status', async () => {
    const h = makeHarness();
    await h.service.saveConfig(BIZ, TWILIO_CONFIG);
    expect(h.db.status()).toBeNull();
    expect(h.db.writes.some((w) => w.op === 'connectorStatus.upsert')).toBe(false);
    expect((await h.registry.getHealth('whatsapp', BIZ))?.status).toBe('disconnected');
  });
});

describe('PR196-WHATSAPP-HEALTH: the whole cycle, as any member reads it', () => {
  it('[WAH-F1] save, verify, disconnect, re-verify, rotate: every answer and every log line is free of the phoneNumberId, the SID and the tokens', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = PLATFORM_TOKEN;
    process.env.WHATSAPP_PHONE_NUMBER_ID = PLATFORM_PNID;
    const h = makeHarness();
    const answers: unknown[] = [];

    await h.service.saveConfig(BIZ, META_CONFIG);
    answers.push(await memberView(h));
    expect((answers.at(-1) as Awaited<ReturnType<typeof memberView>>).health?.status).toBe('disconnected');

    stubFetch({ [GRAPH]: GRAPH_OK });
    answers.push(await h.registry.smokeTestConnector('whatsapp', BIZ));
    answers.push(await memberView(h));
    expect((answers.at(-1) as Awaited<ReturnType<typeof memberView>>).health?.status).toBe('connected');

    await h.registry.disconnectConnector('whatsapp', BIZ);
    answers.push(await memberView(h));
    expect((answers.at(-1) as Awaited<ReturnType<typeof memberView>>).health?.status).toBe('disconnected');

    answers.push(await h.registry.smokeTestConnector('whatsapp', BIZ));
    expect((await h.registry.getHealth('whatsapp', BIZ))?.status).toBe('connected');

    await h.service.saveConfig(BIZ, TWILIO_CONFIG);
    answers.push(await memberView(h));
    expect((answers.at(-1) as Awaited<ReturnType<typeof memberView>>).health?.status).toBe('disconnected');

    stubFetch({ [TWILIO_ACCOUNT]: { status: 401, body: { code: 20003, message: `Accounts/${TWILIO_SID}` } } });
    answers.push(await h.registry.smokeTestConnector('whatsapp', BIZ));
    stubFetch({ [TWILIO_ACCOUNT]: TWILIO_OK });
    answers.push(await h.registry.smokeTestConnector('whatsapp', BIZ));
    answers.push(await memberView(h));
    expect((answers.at(-1) as Awaited<ReturnType<typeof memberView>>).health?.status).toBe('connected');

    expect(leaks(answers)).toEqual([]);
    expect(leaks(h.db.live.statuses.get(`${BIZ}:whatsapp`))).toEqual([]);
    expect(leaks(logLines.join('\n'))).toEqual([]);
    expect(isTokenEncrypted(h.db.storedWhatsApp()?.authToken as string)).toBe(true);
    expect(encryptToken('x')).not.toBe('x'); // the at-rest encryption these reads decrypt is live
  });
});

// ── Review repairs (SEC-WAH-1..3, CR-PR196-1..3) ────────────────────────────
const ROTATED = 'EAAGz5Yq1Wr8Ux3Kp7Hn2Mv6Bj9Cd4Lf';

/**
 * Provider calls held open until the case releases them: the check is in
 * flight meanwhile, between reading the config and recording its result.
 */
function heldProvider() {
  const calls: FetchCall[] = [];
  const pending: Array<(reply: Reply) => void> = [];
  const fn = vi.fn(async (input: unknown, init?: FetchCall['init']) => {
    calls.push({ url: String(input), init });
    const reply = await new Promise<Reply>((resolve) => pending.push(resolve));
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return {
    calls,
    inFlight: (n = 1) => vi.waitFor(() => expect(pending.length).toBe(n)),
    release: (reply: Reply) => pending.splice(0).forEach((resolve) => resolve(reply)),
  };
}

function webhookInfoController(h: ReturnType<typeof makeHarness>) {
  return new ConnectorController(h.registry, {} as never, {} as never, new ConnectorCredentialsService(h.db.prisma), h.db.prisma, {} as never);
}

describe('PR196-WHATSAPP-HEALTH review: a check vouches only for the config it checked, and only while it stands', () => {
  it('[WAH-R1] RED-BEFORE (SEC-WAH-1, CR-PR196-3): a smoke test of the old token in flight while the owner rotates it reports failure and records nothing; the rotated token reads disconnected until a check sends it', async () => {
    const h = makeHarness();
    await h.service.saveConfig(BIZ, META_CONFIG);
    const held = heldProvider();
    const smoke = h.registry.smokeTestConnector('whatsapp', BIZ);
    await held.inFlight();
    expect(held.calls[0].init?.headers?.Authorization).toBe(`Bearer ${META_TOKEN}`);

    await h.service.saveConfig(BIZ, { ...META_CONFIG, accessToken: ROTATED });
    held.release(GRAPH_OK);
    const result = await smoke;

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/changed while it was being checked/);
    expect(leaks(result)).toEqual([]);
    expect(h.db.status()?.status ?? 'disconnected').not.toBe('connected');
    expect((await h.registry.getHealth('whatsapp', BIZ))?.status).toBe('disconnected');

    const { calls } = stubFetch({ [GRAPH]: GRAPH_OK });
    expect((await h.registry.smokeTestConnector('whatsapp', BIZ)).success).toBe(true);
    expect(calls[0].init?.headers?.Authorization).toBe(`Bearer ${ROTATED}`);
    expect((await h.registry.getHealth('whatsapp', BIZ))?.status).toBe('connected');
  });

  it('[WAH-R1b] RED-BEFORE (SEC-WAH-1, CR-PR196-3): with a verified row, the reset of a save made while a smoke test is in flight stands; nothing writes the row connected again', async () => {
    const h = makeHarness();
    await h.service.saveConfig(BIZ, META_CONFIG);
    await verifyMetaConfig(h);
    const held = heldProvider();
    const smoke = h.registry.smokeTestConnector('whatsapp', BIZ);
    await held.inFlight();

    await h.service.saveConfig(BIZ, { ...META_CONFIG, accessToken: ROTATED });
    expect(h.db.status()?.status).toBe('disconnected');
    held.release(GRAPH_OK);

    expect((await smoke).success).toBe(false);
    expect(h.db.status()?.status).toBe('disconnected');
    expect((await h.registry.getHealth('whatsapp', BIZ))?.status).toBe('disconnected');
  });

  it('[WAH-R1c] RED-BEFORE (CR-PR196-3): the owner saving while the provider answers (the save lands inside the check) is not recorded either', async () => {
    const h = makeHarness();
    await h.service.saveConfig(BIZ, META_CONFIG);
    const fn = vi.fn(async () => {
      await h.service.saveConfig(BIZ, { ...META_CONFIG, accessToken: ROTATED });
      return new Response(JSON.stringify(GRAPH_OK.body), { status: 200 });
    });
    vi.stubGlobal('fetch', fn);

    expect((await h.registry.smokeTestConnector('whatsapp', BIZ)).success).toBe(false);
    expect(fn.mock.calls.every((c) => !JSON.stringify(c).includes(ROTATED))).toBe(true);
    expect(h.db.status()?.status ?? 'disconnected').not.toBe('connected');
    expect((await h.registry.getHealth('whatsapp', BIZ))?.status).toBe('disconnected');
  });

  it('[WAH-R1d] RED-BEFORE (SEC-WAH-1): a \'connected\' status written after a save (a check\'s late write, another writer) does not vouch for the saved config: only a check of that config does', async () => {
    const h = makeHarness();
    await h.service.saveConfig(BIZ, META_CONFIG);
    await verifyMetaConfig(h);
    await h.service.saveConfig(BIZ, { ...META_CONFIG, accessToken: ROTATED });
    h.db.setStatus({ ...h.db.status(), status: 'connected' });

    expect((await h.registry.getHealth('whatsapp', BIZ))?.status).toBe('disconnected');
    expect(await h.connector.isConnected(BIZ)).toBe(false);
  });

  it('[WAH-R2] RED-BEFORE (SEC-WAH-2, 4-D3): a smoke test in flight across a disconnect reports failure and the disconnect stands, also against a later \'connected\' write', async () => {
    const h = makeHarness();
    await h.service.saveConfig(BIZ, META_CONFIG);
    await verifyMetaConfig(h);
    const held = heldProvider();
    const smoke = h.registry.smokeTestConnector('whatsapp', BIZ);
    await held.inFlight();

    await h.registry.disconnectConnector('whatsapp', BIZ);
    expect((await h.registry.getHealth('whatsapp', BIZ))?.status).toBe('disconnected');
    held.release(GRAPH_OK);
    const result = await smoke;

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/disconnected while the check ran/);
    expect(h.db.status()?.status).toBe('disconnected');
    expect((await h.registry.getHealth('whatsapp', BIZ))?.status).toBe('disconnected');
    h.db.setStatus({ ...h.db.status(), status: 'connected' }); // e.g. the registry's write landing after the disconnect
    expect((await h.registry.getHealth('whatsapp', BIZ))?.status).toBe('disconnected');
  });

  it('[WAH-R2b] RED-BEFORE (SEC-WAH-2): on the platform path too, a platform smoke test in flight across a disconnect does not undo it', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = PLATFORM_TOKEN;
    process.env.WHATSAPP_PHONE_NUMBER_ID = PLATFORM_PNID;
    const h = makeHarness();
    const held = heldProvider();
    const smoke = h.registry.smokeTestConnector('whatsapp', BIZ);
    await held.inFlight();

    await h.registry.disconnectConnector('whatsapp', BIZ);
    held.release({ body: { verified_name: 'Platform' } });

    expect((await smoke).success).toBe(false);
    expect((await h.registry.getHealth('whatsapp', BIZ))?.status).toBe('disconnected');
  });

  it('[WAH-R2c] two checks of the same config in flight together both pass and the config reads connected (the later one finds the earlier one recorded the same config)', async () => {
    const h = makeHarness();
    await h.service.saveConfig(BIZ, META_CONFIG);
    const held = heldProvider();
    const first = h.registry.smokeTestConnector('whatsapp', BIZ);
    const second = h.registry.smokeTestConnector('whatsapp', BIZ);
    await held.inFlight(2);
    held.release(GRAPH_OK);

    expect((await first).success).toBe(true);
    expect((await second).success).toBe(true);
    expect((await h.registry.getHealth('whatsapp', BIZ))?.status).toBe('connected');
  });

  it('[WAH-R3] RED-BEFORE (SEC-WAH-1, 4-D2/4-D4): a platform-token smoke test in flight while the owner saves a first config of the business\'s own never makes that config read connected', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = PLATFORM_TOKEN;
    process.env.WHATSAPP_PHONE_NUMBER_ID = PLATFORM_PNID;
    const h = makeHarness();
    const held = heldProvider();
    const smoke = h.registry.smokeTestConnector('whatsapp', BIZ);
    await held.inFlight();
    expect(held.calls[0].url.startsWith(`${GRAPH_PLATFORM}?`)).toBe(true);

    await h.service.saveConfig(BIZ, META_CONFIG);
    held.release({ body: { display_phone_number: '+1 000', verified_name: 'Platform' } });
    const result = await smoke;

    expect(result.success).toBe(false);
    expect(leaks(result)).toEqual([]);
    const view = await memberView(h);
    expect(view.health?.status).toBe('disconnected');
    expect(view.status?.status).toBe('disconnected');
    expect(leaks(view)).toEqual([]);
  });

  it('[WAH-R4] RED-BEFORE (SEC-WAH-3): a row the pre-packet platform smoke wrote \'connected\' does not vouch for the business\'s own, never-checked config; a check of its own credentials then does', async () => {
    const h = makeHarness();
    h.db.seedBusiness({ name: 'pr196', whatsapp: { provider: 'meta', phoneNumberId: PNID, fromNumber: FROM, accessToken: encryptToken(ROTATED) } });
    h.db.setStatus({ status: 'connected', connectedAccount: 'Platform verified name' });

    const view = await memberView(h);
    expect(view.health?.status).toBe('disconnected');
    expect(view.status?.status).toBe('disconnected');
    expect(view.dashboard?.health.status).toBe('disconnected');
    expect(await h.connector.isConnected(BIZ)).toBe(false);

    const { calls } = stubFetch({ [GRAPH]: GRAPH_OK });
    expect((await h.registry.smokeTestConnector('whatsapp', BIZ)).success).toBe(true);
    expect(calls[0].init?.headers?.Authorization).toBe(`Bearer ${ROTATED}`);
    expect((await h.registry.getHealth('whatsapp', BIZ))?.status).toBe('connected');
  });
});

describe('PR196-WHATSAPP-HEALTH review: the dashboard Connect/Reconnect and GET webhook-info', () => {
  it('[WAH-R5a] RED-BEFORE (CR-PR196-1): on the platform path Reconnect (and Connect after a disconnect) answers connected and health reads connected, with no provider call', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = PLATFORM_TOKEN;
    const h = makeHarness();
    const { fn } = stubFetch({});
    expect((await h.registry.getHealth('whatsapp', BIZ))?.status).toBe('connected');

    expect(await h.registry.reconnectConnector('whatsapp', BIZ)).toEqual({ connected: true });
    expect(await h.registry.reconnectConnector('whatsapp', BIZ)).toEqual({ connected: true });
    expect((await h.registry.getHealth('whatsapp', BIZ))?.status).toBe('connected');

    await h.registry.disconnectConnector('whatsapp', BIZ);
    expect((await h.registry.getHealth('whatsapp', BIZ))?.status).toBe('disconnected');
    expect(await h.registry.reconnectConnector('whatsapp', BIZ)).toEqual({ connected: true });
    expect((await h.registry.getHealth('whatsapp', BIZ))?.status).toBe('connected');
    expect(fn).not.toHaveBeenCalled();
  });

  it('[WAH-R5b] RED-BEFORE (CR-PR196-1): a verified config stays connected through Reconnect, which checks the business\'s own credentials again', async () => {
    const h = makeHarness();
    await h.service.saveConfig(BIZ, META_CONFIG);
    await verifyMetaConfig(h);
    const { calls } = stubFetch({ [GRAPH]: GRAPH_OK });

    expect(await h.registry.reconnectConnector('whatsapp', BIZ)).toEqual({ connected: true });
    expect(await h.registry.reconnectConnector('whatsapp', BIZ)).toEqual({ connected: true });

    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.init?.headers?.Authorization === `Bearer ${META_TOKEN}`)).toBe(true);
    expect((await h.registry.getHealth('whatsapp', BIZ))?.status).toBe('connected');
  });

  it('[WAH-R5c] (CR-PR196-1, 4-D2/4-D3): Connect never marks connected what fails its check: refused credentials and the mock provider stay disconnected', async () => {
    const h = makeHarness();
    await h.service.saveConfig(BIZ, META_CONFIG);
    stubFetch({ [GRAPH]: { status: 401, body: { error: { type: 'OAuthException', code: 190 } } } });
    expect(await h.registry.reconnectConnector('whatsapp', BIZ)).toEqual({ connected: false });
    expect((await h.registry.getHealth('whatsapp', BIZ))?.status).toBe('disconnected');

    await h.service.saveConfig(BIZ, { provider: 'mock', fromNumber: FROM });
    const { fn } = stubFetch({});
    expect(await h.registry.reconnectConnector('whatsapp', BIZ)).toEqual({ connected: false });
    expect(fn).not.toHaveBeenCalled();
    expect((await h.registry.getHealth('whatsapp', BIZ))?.status).toBe('disconnected');
  });

  it('[WAH-R5d] POST authenticate on a config that already reads connected answers connected without a provider call', async () => {
    const h = makeHarness();
    await h.service.saveConfig(BIZ, META_CONFIG);
    await verifyMetaConfig(h);
    const { fn } = stubFetch({});

    expect(await h.registry.authenticateConnector('whatsapp', BIZ)).toEqual({ connected: true });
    expect(fn).not.toHaveBeenCalled();
  });

  it('[WAH-R6a] RED-BEFORE (CR-PR196-2): GET webhook-info (any member) writes its row \'connected\' without a check; a saved, never-checked config still reads disconnected', async () => {
    const h = makeHarness();
    await h.service.saveConfig(BIZ, META_CONFIG);
    const { fn } = stubFetch({});

    await webhookInfoController(h).getWebhookInfo(BIZ, 'whatsapp');

    expect(fn).not.toHaveBeenCalled();
    expect(h.db.status()?.status).toBe('connected'); // the writer outside this packet, unchanged
    const view = await memberView(h);
    expect(view.health?.status).toBe('disconnected');
    expect(view.status?.status).toBe('disconnected');
  });

  it('[WAH-R6b] RED-BEFORE (CR-PR196-2, 4-D3): GET webhook-info after an explicit disconnect does not reverse it', async () => {
    const h = makeHarness();
    await h.service.saveConfig(BIZ, META_CONFIG);
    await verifyMetaConfig(h);
    await h.registry.disconnectConnector('whatsapp', BIZ);

    await webhookInfoController(h).getWebhookInfo(BIZ, 'whatsapp');

    expect(h.db.status()?.status).toBe('connected');
    expect((await h.registry.getHealth('whatsapp', BIZ))?.status).toBe('disconnected');
  });

  it('[WAH-R6c] (CR-PR196-2) no regression: GET webhook-info on a verified config keeps it connected (its secret is merged beside the verification) and answers the same secret again', async () => {
    const h = makeHarness();
    await h.service.saveConfig(BIZ, META_CONFIG);
    await verifyMetaConfig(h);
    const controller = webhookInfoController(h);

    const first = await controller.getWebhookInfo(BIZ, 'whatsapp');
    const second = await controller.getWebhookInfo(BIZ, 'whatsapp');

    expect(second.secret).toBe(first.secret);
    expect((await h.registry.getHealth('whatsapp', BIZ))?.status).toBe('connected');
  });

  it('[WAH-R7] lock order: saveConfig resets the row after it updates the business row, and a disconnect or a recorded check takes the business row lock before it writes the status row, in its transaction', async () => {
    const h = makeHarness();
    await h.service.saveConfig(BIZ, META_CONFIG);
    await verifyMetaConfig(h);

    h.db.writes.length = 0;
    await h.service.saveConfig(BIZ, { ...META_CONFIG, accessToken: ROTATED });
    let ops = h.db.writes.map((w) => w.op);
    expect(ops.indexOf('business.update')).toBeGreaterThan(-1);
    expect(ops.indexOf('business.update')).toBeLessThan(ops.indexOf('connectorStatus.updateMany'));

    h.db.writes.length = 0;
    await h.registry.disconnectConnector('whatsapp', BIZ);
    expect(h.db.writes.map((w) => `${w.via}:${w.op}`)).toEqual(['tx:$queryRaw', 'tx:connectorStatus.upsert']);
    expect(String(h.db.writes[0].args)).toMatch(/FROM businesses WHERE id = \? FOR NO KEY UPDATE/);

    h.db.writes.length = 0;
    stubFetch({ [GRAPH]: GRAPH_OK });
    expect((await h.registry.smokeTestConnector('whatsapp', BIZ)).success).toBe(true);
    ops = h.db.writes.map((w) => `${w.via}:${w.op}`);
    expect(ops.slice(0, 2)).toEqual(['tx:$queryRaw', 'tx:connectorStatus.upsert']);
  });

  it('[WAH-R8] what the row keeps of a check carries no phoneNumberId, SID or token, and nothing a member reads answers it', async () => {
    const h = makeHarness();
    await h.service.saveConfig(BIZ, TWILIO_CONFIG);
    stubFetch({ [TWILIO_ACCOUNT]: TWILIO_OK });
    expect((await h.registry.smokeTestConnector('whatsapp', BIZ)).success).toBe(true);
    expect(leaks(h.db.status())).toEqual([]);
    await h.registry.disconnectConnector('whatsapp', BIZ);
    await h.service.saveConfig(BIZ, META_CONFIG);
    await verifyMetaConfig(h);

    expect(leaks(h.db.status())).toEqual([]);
    const view = await memberView(h);
    expect(JSON.stringify(view)).not.toContain('whatsappVerification');
    expect(leaks(view)).toEqual([]);
  });
});
