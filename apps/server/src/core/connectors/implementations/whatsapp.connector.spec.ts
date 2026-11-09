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

  const client = {
    ...delegates('client', live),
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const staged: Store = { businesses: clone(live.businesses), statuses: clone(live.statuses) };
      const tx = { ...delegates('tx', staged), $executeRaw: async () => 0 };
      const result = await fn(tx);
      live.businesses = staged.businesses;
      live.statuses = staged.statuses;
      return result;
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
    h.db.setStatus({ status: 'connected', connectedAccount: null }); // a verified smoke test's row

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
    h.db.setStatus({ status: 'connected', connectedAccount: PNID });

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
