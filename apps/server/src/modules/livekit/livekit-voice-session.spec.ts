/**
 * PR196-VOICE: the KEY live voice session, before the shell mounts its control.
 *
 * PR #196 feature 9a mounts KeyLiveVoice in every KEY chat header. Two verified
 * defects (pr196-review OK-9A-1, OK-9A-2) sit under that mount:
 *
 *   OK-9A-1  An unconfigured LiveKit answers a plain-string 503 naming the
 *            server's env vars ('LiveKit is not configured
 *            (LIVEKIT_API_KEY/LIVEKIT_API_SECRET missing)'). The global filter
 *            renders it as code UNKNOWN_ERROR, so the web's R0-07/R0-P
 *            classifier (providerUnavailableOf) cannot see it and the client
 *            toasts the raw text. The rooms route the shell probes for voice
 *            availability answers the same raw 503.
 *   OK-9A-2  The voice-session body { identity?, roomName? } is honoured: a
 *            member chooses the room (another member's live call, or a guessed
 *            room of another tenant) and the identity (an 'agent-*' identity
 *            the client trusts as KEY), and gets a publish/subscribe join token
 *            for it.
 *
 * Proven here, with no provider traffic (the LiveKit network clients are
 * recorded in process; AccessToken is real and signs locally):
 *   - unconfigured LiveKit (KEY on): createVoiceSession and the rooms listing
 *     answer the structured 503 { code: 'provider_not_configured', service:
 *     'voice' } before any room, dispatch, token or VoiceSession row, and the
 *     global filter renders it as { code, details: { service } } with no env
 *     var name in the message;
 *   - the room and identity are derived on the server from the authenticated
 *     member and the guarded business; a client-sent roomName or identity
 *     (through the real controller handler) changes nothing; room names are
 *     unguessable even within one millisecond; the join token's room and
 *     subject are the server's, and the subject is never 'agent-*';
 *   - with no authenticated member the session is refused before any room.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { ExecutionContext, HttpException, Logger } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AccessToken } from 'livekit-server-sdk';
import { LivekitService, KEY_VOICE_AGENT_NAME } from './livekit.service';
import { LivekitController, VoiceSessionMemberRateLimitGuard } from './livekit.controller';
import { GlobalHttpExceptionFilter } from '../../core/filters/http-exception.filter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CrmRateLimitGuard, RATE_LIMIT_KEY } from '../crm/guards/rate-limit.guard';

/** The LiveKit server SDK's network clients, recorded; nothing leaves the process. AccessToken stays real (it signs locally). */
const lk = vi.hoisted(() => ({
  roomClients: 0,
  rooms: [] as Array<Record<string, unknown>>,
  listRoomsCalls: 0,
  dispatchClients: 0,
  dispatches: [] as Array<{ room: string; agent: string; opts: Record<string, unknown> }>,
  tokens: 0,
}));

vi.mock('livekit-server-sdk', async (importOriginal) => {
  const actual: any = await importOriginal();
  class RoomServiceClient {
    constructor(..._a: unknown[]) {
      lk.roomClients++;
    }
    async createRoom(opts: Record<string, unknown>) {
      lk.rooms.push(opts);
      return opts;
    }
    async listRooms() {
      lk.listRoomsCalls++;
      return [];
    }
    async listParticipants() {
      return [];
    }
  }
  class AgentDispatchClient {
    constructor(..._a: unknown[]) {
      lk.dispatchClients++;
    }
    async createDispatch(room: string, agent: string, opts: Record<string, unknown>) {
      lk.dispatches.push({ room, agent, opts });
      return {};
    }
  }
  class RecordingAccessToken extends actual.AccessToken {
    constructor(...a: unknown[]) {
      lk.tokens++;
      super(...a);
    }
  }
  return { ...actual, RoomServiceClient, AgentDispatchClient, AccessToken: RecordingAccessToken };
});

const ENV_KEYS = ['KEY_DISABLED', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'LIVEKIT_URL', 'LIVEKIT_WS_URL'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  lk.roomClients = 0;
  lk.rooms.length = 0;
  lk.listRoomsCalls = 0;
  lk.dispatchClients = 0;
  lk.dispatches.length = 0;
  lk.tokens = 0;
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(Logger.prototype, m).mockImplementation(() => undefined);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

const BIZ = 'pr196v-biz-A-0123456789';
const MEMBER = 'pr196v-member-1';

function service() {
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'vs-pr196v', ...data }));
  return { svc: new LivekitService({ client: { voiceSession: { create } } } as any), create };
}

function configureLivekit() {
  process.env.LIVEKIT_API_KEY = 'pr196v-livekit-key';
  process.env.LIVEKIT_API_SECRET = 'pr196v-livekit-secret-that-is-long-enough-to-sign';
}

/** The JWT payload of a LiveKit join token (signature checked elsewhere; this reads the claims the room server honours). */
function claims(token: string): { sub?: string; video?: Record<string, unknown>; metadata?: string } {
  const [, payload] = token.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

async function refusal(call: Promise<unknown>): Promise<any> {
  return call.then(
    () => {
      throw new Error('expected the call to be refused');
    },
    (e: unknown) => e,
  );
}

/** What the global filter sends for an exception: the body the web's providerUnavailableOf reads. */
function rendered(exception: unknown): { status: number; body: Record<string, any> } {
  let status = 0;
  let body: Record<string, any> = {};
  const res = {
    status(s: number) {
      status = s;
      return res;
    },
    json(b: Record<string, any>) {
      body = b;
      return res;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ url: '/api/v1/livekit/x', method: 'POST' }) }),
  };
  new GlobalHttpExceptionFilter().catch(exception, host as any);
  return { status, body };
}

/** The structured R0-07/R0-P voice 503, as thrown and as rendered. */
function expectVoiceNotConfigured(err: any) {
  expect(err, String(err?.stack ?? err)).toBeInstanceOf(HttpException);
  expect(err.getStatus()).toBe(503);
  expect(err.getResponse()).toMatchObject({ code: 'provider_not_configured', service: 'voice', error: 'Service Unavailable' });
  const { status, body } = rendered(err);
  expect(status).toBe(503);
  expect(body.code).toBe('provider_not_configured');
  expect(body.details).toEqual({ service: 'voice' });
  // No server configuration names reach the member.
  expect(String(body.message)).not.toMatch(/LIVEKIT|API_KEY|API_SECRET/i);
}

describe('PR196-VOICE OK-9A-1: an unconfigured LiveKit answers the structured provider_not_configured 503', () => {
  it('createVoiceSession (KEY on, LiveKit unset): the voice 503 before any room, dispatch, token or VoiceSession row', async () => {
    const { svc, create } = service();
    expectVoiceNotConfigured(await refusal(svc.createVoiceSession(BIZ, MEMBER)));
    expect(lk.roomClients).toBe(0);
    expect(lk.rooms).toEqual([]);
    expect(lk.dispatchClients).toBe(0);
    expect(lk.tokens).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('only one of the two keys set is still not configured', async () => {
    process.env.LIVEKIT_API_KEY = 'pr196v-livekit-key';
    expectVoiceNotConfigured(await refusal(service().svc.createVoiceSession(BIZ, MEMBER)));
  });

  it('the rooms listing the chat shell probes for voice availability answers the same voice 503, with no LiveKit call', async () => {
    const { svc } = service();
    expectVoiceNotConfigured(await refusal(svc.listRooms(BIZ)));
    expect(lk.roomClients).toBe(0);
    expect(lk.listRoomsCalls).toBe(0);
  });

  it('control: with LiveKit configured the rooms listing answers (an empty list here), so the shell shows the control', async () => {
    configureLivekit();
    await expect(service().svc.listRooms(BIZ)).resolves.toEqual([]);
    expect(lk.listRoomsCalls).toBe(1);
  });

  it('KEY_DISABLED still answers first (the KEY-disabled 503, reason key_disabled), with LiveKit unset', async () => {
    process.env.KEY_DISABLED = '1';
    const err = await refusal(service().svc.createVoiceSession(BIZ, MEMBER));
    expect(err.getStatus()).toBe(503);
    expect(err.getResponse()).toMatchObject({ code: 'provider_not_configured', reason: 'key_disabled', service: 'ai' });
  });
});

describe('PR196-VOICE OK-9A-2: the server alone chooses the room and the identity', () => {
  it('a client-sent roomName and agent-* identity are ignored: the room, dispatch, token and VoiceSession use server-derived values', async () => {
    configureLivekit();
    const { svc, create } = service();
    const out = await svc.createVoiceSession(BIZ, MEMBER, { roomName: 'victim-room', identity: 'agent-forged' } as any);

    expect(lk.rooms).toHaveLength(1);
    const room = String(lk.rooms[0].name);
    expect(room).not.toBe('victim-room');
    expect(room.startsWith('key-voice-')).toBe(true);
    expect(out.roomName).toBe(room);
    expect(JSON.parse(String(lk.rooms[0].metadata))).toEqual({ businessId: BIZ, userId: MEMBER });

    expect(lk.dispatches).toEqual([{ room, agent: KEY_VOICE_AGENT_NAME, opts: { metadata: JSON.stringify({ businessId: BIZ, userId: MEMBER }) } }]);

    const c = claims(out.token);
    expect(c.sub).toBe(`user-${MEMBER}`);
    expect(c.sub!.startsWith('agent-')).toBe(false);
    expect(c.video).toMatchObject({ room, roomJoin: true, canPublish: true, canSubscribe: true });
    expect(JSON.parse(String(c.metadata))).toEqual({ businessId: BIZ, role: 'user' });

    expect(create).toHaveBeenCalledTimes(1);
    const row = create.mock.calls[0][0].data as Record<string, any>;
    expect(row).toMatchObject({ businessId: BIZ, userId: MEMBER, mode: 'livekit_full_duplex', status: 'ACTIVE' });
    expect(row.commandItems[0]).toMatchObject({ roomName: room, identity: `user-${MEMBER}`, event: 'created' });
    expect(JSON.stringify(row)).not.toMatch(/victim-room|agent-forged/);
  });

  it('through the real controller handler: the request body cannot name the room or the identity', async () => {
    configureLivekit();
    const { svc } = service();
    const controller = new LivekitController(svc);
    const out = await controller.createVoiceSession(BIZ, { user: { id: MEMBER } }, { roomName: 'key-voice-other-tenant', identity: 'agent-key' });
    expect(out.roomName).not.toBe('key-voice-other-tenant');
    expect(lk.rooms.map((r) => r.name)).toEqual([out.roomName]);
    expect(claims(out.token).sub).toBe(`user-${MEMBER}`);
    expect(claims(out.token).video).toMatchObject({ room: out.roomName });
  });

  it('room names are unguessable: two sessions of one business in the same millisecond get different rooms', async () => {
    configureLivekit();
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const { svc } = service();
    const a = await svc.createVoiceSession(BIZ, MEMBER);
    const b = await svc.createVoiceSession(BIZ, MEMBER);
    expect(a.roomName).not.toBe(b.roomName);
    // At least 96 bits of randomness after the fixed prefix (a UUID v4 carries 122).
    for (const name of [a.roomName, b.roomName]) {
      expect(name).toMatch(/^key-voice-[0-9a-f-]{36}$/i);
    }
  });

  it('two members of one business get their own identities, each bound to their own room', async () => {
    configureLivekit();
    const { svc } = service();
    const a = await svc.createVoiceSession(BIZ, 'pr196v-member-a');
    const b = await svc.createVoiceSession(BIZ, 'pr196v-member-b');
    expect(claims(a.token)).toMatchObject({ sub: 'user-pr196v-member-a', video: { room: a.roomName } });
    expect(claims(b.token)).toMatchObject({ sub: 'user-pr196v-member-b', video: { room: b.roomName } });
    expect(a.roomName).not.toBe(b.roomName);
  });

  it('with no authenticated member the session is refused (401) before any room, dispatch, token or row', async () => {
    configureLivekit();
    const { svc, create } = service();
    const err = await refusal(svc.createVoiceSession(BIZ, undefined));
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(401);
    expect(lk.roomClients).toBe(0);
    expect(lk.dispatchClients).toBe(0);
    expect(lk.tokens).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });
});

/**
 * W9-LIVEKIT-VOICE: the two PR196-VOICE review findings that needed a scope
 * release (they stood here as it.todo). Both were reproduced on a real Nest app
 * with the real AuthGuard and BusinessGuard (LiveKit network clients recorded):
 *
 *   RV-VOICE-1  (D-17, the server-side KEY_DISABLED switch) With KEY_DISABLED
 *               set and LiveKit configured, GET /livekit/businesses/:id/rooms
 *               (the shell's availability probe) answered 200, so the shell
 *               showed the mic, while every click was refused with the
 *               KEY-disabled 503 (reason key_disabled). listRooms now refuses
 *               first, with that same KEY-disabled 503 and before any LiveKit
 *               client, so the probe settles on a structured
 *               provider_not_configured 503 and the shell hides the control
 *               (listParticipants reads listRooms first and is refused the same
 *               way). The KEY check is NOT in assertConfigured: the
 *               signature-verified webhook (handleWebhook calls it) still
 *               verifies and still ends VoiceSession rows on room_finished while
 *               KEY is off. The refusal's text names KEY_DISABLED: that is the
 *               V1-24 (D-17) refusal every KEY path shares, pinned by
 *               livekit.service.spec.ts (SEC-V124b-2), and not changed here.
 *   SEC-PR196V-1  POST /livekit/businesses/:id/voice-session had no rate limit
 *               (15 sequential POSTs from one STAFF member: 15 rooms, 15 agent
 *               dispatches). The handler now carries the existing
 *               CrmRateLimitGuard with @CrmRateLimit(10, 60_000), the bound the
 *               other provider-cost KEY routes use (ai/plan, ai/simulate,
 *               ai/briefing). Proven over HTTP through the real handler and the
 *               real guard: past the limit the POST answers 429 with no room,
 *               dispatch, join token or VoiceSession row.
 */
describe('PR196-VOICE review follow-ups (W9-LIVEKIT-VOICE)', () => {
  /** A LiveKit server webhook, signed the way the LiveKit server signs it (a JWT carrying the body's sha256, with the configured key and secret). */
  async function signedWebhook(event: Record<string, unknown>, secret = process.env.LIVEKIT_API_SECRET!) {
    const body = JSON.stringify(event);
    const at = new AccessToken(process.env.LIVEKIT_API_KEY!, secret);
    at.sha256 = createHash('sha256').update(body).digest('base64');
    return { body, auth: await at.toJwt() };
  }

  it('RV-VOICE-1: with KEY_DISABLED set and LiveKit configured, listRooms (the shell probe) answers the structured 503 before any LiveKit call, so the mic stays hidden, while handleWebhook still verifies and syncs room_finished (D-17; W9-LIVEKIT-VOICE, was it.todo)', async () => {
    process.env.KEY_DISABLED = '1';
    configureLivekit();
    const ROOM = 'key-voice-w9lk-room-finished';
    const findMany = vi.fn(async () => [
      { id: 'vs-w9lk-other', commandItems: [{ roomName: 'key-voice-w9lk-other-room' }] },
      { id: 'vs-w9lk-1', commandItems: [{ roomName: ROOM, identity: `user-${MEMBER}`, event: 'created' }] },
    ]);
    const update = vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({ id: where.id, ...data }));
    const create = vi.fn();
    const svc = new LivekitService({ client: { voiceSession: { create, findMany, update } } } as any);
    const controller = new LivekitController(svc);

    // The shell's probe, directly and through the real handler: the KEY-disabled 503, which the
    // global filter renders as code provider_not_configured (the code the web's
    // providerUnavailableOf reads, handed back without a retry), so the probe settles and the
    // shell shows no mic.
    for (const probe of [() => svc.listRooms(BIZ), () => controller.listRooms(BIZ)]) {
      const err = await refusal(probe());
      expect(err, String(err?.stack ?? err)).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(503);
      expect(err.getResponse()).toMatchObject({ code: 'provider_not_configured', reason: 'key_disabled', service: 'ai', error: 'Service Unavailable' });
      const { status, body } = rendered(err);
      expect(status).toBe(503);
      expect(body.code).toBe('provider_not_configured');
    }
    // The participants listing reads the rooms listing first: refused the same way.
    const viaParticipants = await refusal(controller.listParticipants(BIZ, ROOM));
    expect(viaParticipants.getStatus()).toBe(503);
    expect(viaParticipants.getResponse()).toMatchObject({ reason: 'key_disabled' });
    // All before any LiveKit client or call.
    expect(lk.roomClients).toBe(0);
    expect(lk.listRoomsCalls).toBe(0);

    // The webhook still verifies the signature and still ends the session on room_finished.
    const finished = await signedWebhook({ event: 'room_finished', id: 'EV_w9lk_1', room: { name: ROOM } });
    await expect(controller.webhook({ rawBody: Buffer.from(finished.body, 'utf8') }, finished.auth)).resolves.toEqual({
      received: true,
      event: 'room_finished',
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].where).toEqual({ id: 'vs-w9lk-1' });
    expect(update.mock.calls[0][0].data).toMatchObject({ status: 'ENDED' });
    expect(update.mock.calls[0][0].data.endedAt).toBeInstanceOf(Date);

    // ...and it still refuses a webhook it cannot verify (signed with another secret), changing nothing.
    const forged = await signedWebhook({ event: 'room_finished', id: 'EV_w9lk_2', room: { name: ROOM } }, 'w9lk-not-the-livekit-secret-but-long-enough');
    const err = await refusal(svc.handleWebhook(forged.body, forged.auth));
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(401);
    expect(update).toHaveBeenCalledTimes(1);

    // No LiveKit room traffic and nothing created at any point.
    expect(lk.roomClients).toBe(0);
    expect(lk.rooms).toEqual([]);
    expect(lk.dispatchClients).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('RV-VOICE-1 control: the rooms probe reads KEY_DISABLED per call, and the same service answers it once KEY is back on (D-17; W9-LIVEKIT-VOICE)', async () => {
    configureLivekit();
    process.env.KEY_DISABLED = 'true';
    const { svc } = service();
    expect((await refusal(svc.listRooms(BIZ))).getResponse()).toMatchObject({ reason: 'key_disabled' });
    expect(lk.listRoomsCalls).toBe(0);
    delete process.env.KEY_DISABLED;
    await expect(svc.listRooms(BIZ)).resolves.toEqual([]);
    expect(lk.listRoomsCalls).toBe(1);
  });

  it('SEC-PR196V-1: one member cannot create LiveKit rooms and agent dispatches without bound. Repeated POST voice-session answers 429 past the limit, with no room or dispatch (W9-LIVEKIT-VOICE, was it.todo)', async () => {
    configureLivekit();
    const RL_BIZ = 'w9lk-biz-ratelimit-0123456789';
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: `vs-w9lk-${create.mock.calls.length}`, ...data }));
    const moduleRef = await Test.createTestingModule({
      controllers: [LivekitController],
      providers: [LivekitService, { provide: PrismaService, useValue: { client: { voiceSession: { create } } } }],
    })
      // Identity and membership are not under test here (the real guards are proven elsewhere):
      // the stand-ins admit one member. The rate-limit guard on the handler is the real one.
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest().user = { id: MEMBER };
          return true;
        },
      })
      .overrideGuard(BusinessGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    try {
      const LIMIT = 10;
      const path = `/livekit/businesses/${RL_BIZ}/voice-session`;
      for (let i = 0; i < LIMIT; i++) {
        const res = await request(app.getHttpServer()).post(path).send({});
        expect(res.status, `POST ${i + 1}: ${JSON.stringify(res.body)}`).toBe(201);
        expect(res.body.roomName).toMatch(/^key-voice-/);
      }
      expect(lk.rooms).toHaveLength(LIMIT);
      expect(lk.dispatches).toHaveLength(LIMIT);

      for (let i = 0; i < 3; i++) {
        const res = await request(app.getHttpServer()).post(path).send({ roomName: 'w9lk-any', identity: 'agent-w9lk' });
        expect(res.status, `POST ${LIMIT + i + 1}: ${JSON.stringify(res.body)}`).toBe(429);
        expect(res.body.token).toBeUndefined();
      }
      // Past the limit: no room, no agent dispatch, no join token, no VoiceSession row.
      expect(lk.rooms).toHaveLength(LIMIT);
      expect(lk.roomClients).toBe(LIMIT);
      expect(lk.dispatches).toHaveLength(LIMIT);
      expect(lk.dispatchClients).toBe(LIMIT);
      expect(lk.tokens).toBe(LIMIT);
      expect(create).toHaveBeenCalledTimes(LIMIT);

      // Control: the rooms probe carries no such bound (the chat shell probes on every visit).
      for (let i = 0; i < LIMIT + 2; i++) {
        const res = await request(app.getHttpServer()).get(`/livekit/businesses/${RL_BIZ}/rooms`);
        expect(res.status).toBe(200);
      }

      // The bound is declared on the handler, with the existing guard (no new limiter).
      const handler = LivekitController.prototype.createVoiceSession;
      expect(Reflect.getMetadata(RATE_LIMIT_KEY, handler)).toEqual({ limit: LIMIT, windowMs: 60_000 });
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(CrmRateLimitGuard);
    } finally {
      await app.close();
    }
  });
});

/**
 * W9-LIVEKIT-VOICE review repair (SEC-W9LK-1, on SEC-PR196V-1): the voice-session
 * bound must hold per member, not only per client address.
 *
 * CrmRateLimitGuard keys its window on `${req.ip}:${businessId}:${handler}`, with no
 * member in it. Reproduced on the packet head with trust proxy 1 (the production
 * default, TRUST_PROXY=1 in app-bootstrap.ts): one member sending each POST from a
 * fresh address (several IPv6 addresses in their /64, several networks) got a fresh
 * window every time, so every POST made a LiveKit room and a KEY voice agent dispatch
 * (an OpenAI Realtime session), with no 429. The same held across the businesses a
 * member belongs to. The handler now also carries a per-member window
 * (VoiceSessionMemberRateLimitGuard, after the address window): 10 sessions a minute
 * per authenticated member, whatever the address and whichever business.
 */
describe('PR196-VOICE review repair (W9-LIVEKIT-VOICE, SEC-W9LK-1)', () => {
  it('SEC-W9LK-1: one member sending each POST voice-session from a fresh client address, across two businesses, is still refused 429 past 10 a minute, with no room or dispatch, while another member is not affected (SEC-PR196V-1; W9-LIVEKIT-VOICE)', async () => {
    configureLivekit();
    const BIZ_A = 'w9lk-biz-rotate-A-0123456789';
    const BIZ_B = 'w9lk-biz-rotate-B-0123456789';
    const ROTATING = 'w9lk-member-rotating';
    const COLLEAGUE = 'w9lk-member-colleague';
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: `vs-w9lk-rot-${create.mock.calls.length}`, ...data }));
    const moduleRef = await Test.createTestingModule({
      controllers: [LivekitController],
      providers: [LivekitService, { provide: PrismaService, useValue: { client: { voiceSession: { create } } } }],
    })
      // The member comes from a test header (the real AuthGuard is proven elsewhere);
      // membership of both businesses is admitted. The address and member windows are real.
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest();
          req.user = { id: String(req.headers['x-test-user']) };
          return true;
        },
      })
      .overrideGuard(BusinessGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = moduleRef.createNestApplication({ logger: false });
    // The production default (TRUST_PROXY=1): req.ip is the address the front proxy saw.
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
    await app.init();
    try {
      const LIMIT = 10;
      let address = 0;
      const post = (member: string, biz: string) =>
        request(app.getHttpServer())
          .post(`/livekit/businesses/${biz}/voice-session`)
          .set('x-test-user', member)
          // A fresh client address on every request: no address window ever fills.
          .set('X-Forwarded-For', `2001:db8::${(++address).toString(16)}`)
          .send({});

      for (let i = 0; i < LIMIT; i++) {
        const res = await post(ROTATING, BIZ_A);
        expect(res.status, `POST ${i + 1}: ${JSON.stringify(res.body)}`).toBe(201);
        expect(res.body.roomName).toMatch(/^key-voice-/);
      }
      expect(lk.rooms).toHaveLength(LIMIT);
      expect(lk.dispatches).toHaveLength(LIMIT);

      // Past the member's bound: refused from fresh addresses, in either business.
      for (let i = 0; i < 6; i++) {
        const res = await post(ROTATING, i % 2 === 0 ? BIZ_A : BIZ_B);
        expect(res.status, `POST ${LIMIT + i + 1} (address ${address}): ${JSON.stringify(res.body)}`).toBe(429);
        expect(res.body.token).toBeUndefined();
      }
      // No room, no agent dispatch, no join token, no VoiceSession row past the bound.
      expect(lk.rooms).toHaveLength(LIMIT);
      expect(lk.roomClients).toBe(LIMIT);
      expect(lk.dispatches).toHaveLength(LIMIT);
      expect(lk.dispatchClients).toBe(LIMIT);
      expect(lk.tokens).toBe(LIMIT);
      expect(create).toHaveBeenCalledTimes(LIMIT);
      expect(new Set(lk.rooms.map((r) => JSON.parse(String(r.metadata)).userId))).toEqual(new Set([ROTATING]));

      // Control: the bound is the member's own. Another member of the same business is admitted.
      const colleague = await post(COLLEAGUE, BIZ_A);
      expect(colleague.status, JSON.stringify(colleague.body)).toBe(201);
      expect(claims(colleague.body.token).sub).toBe(`user-${COLLEAGUE}`);
      expect(lk.rooms).toHaveLength(LIMIT + 1);
      expect(lk.dispatches).toHaveLength(LIMIT + 1);

      // Declared on the handler: the address window (packet), then the member window (this repair).
      const guards = Reflect.getMetadata(GUARDS_METADATA, LivekitController.prototype.createVoiceSession);
      expect(guards).toEqual([AuthGuard, BusinessGuard, CrmRateLimitGuard, VoiceSessionMemberRateLimitGuard]);
    } finally {
      await app.close();
    }
  });

  it('SEC-W9LK-1 control: the member window refuses a request that reaches it with no authenticated member (401) rather than share one anonymous window (W9-LIVEKIT-VOICE)', () => {
    const guard = new VoiceSessionMemberRateLimitGuard();
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ ip: '2001:db8::ff', params: { businessId: BIZ } }) }) } as unknown as ExecutionContext;
    let err: any;
    try {
      guard.canActivate(ctx);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(401);
  });

  it('SEC-W9LK-1 control: the member window slides. A member refused at 10 in a minute is admitted again once the minute has passed (W9-LIVEKIT-VOICE)', () => {
    const guard = new VoiceSessionMemberRateLimitGuard();
    const as = (ip: string) =>
      ({ switchToHttp: () => ({ getRequest: () => ({ ip, user: { id: 'w9lk-member-window' }, params: { businessId: BIZ } }) }) }) as unknown as ExecutionContext;
    const t0 = 1_800_000_000_000;
    const now = vi.spyOn(Date, 'now').mockReturnValue(t0);
    for (let i = 0; i < 10; i++) expect(guard.canActivate(as(`2001:db8::a${i}`))).toBe(true);
    now.mockReturnValue(t0 + 59_999);
    let err: any;
    try {
      guard.canActivate(as('2001:db8::b1'));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(429);
    now.mockReturnValue(t0 + 60_000);
    expect(guard.canActivate(as('2001:db8::b2'))).toBe(true);
  });
});
