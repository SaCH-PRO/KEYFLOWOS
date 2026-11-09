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
import { HttpException, Logger } from '@nestjs/common';
import { LivekitService, KEY_VOICE_AGENT_NAME } from './livekit.service';
import { LivekitController } from './livekit.controller';
import { GlobalHttpExceptionFilter } from '../../core/filters/http-exception.filter';

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
 * PR196-VOICE review findings that need behaviour outside this packet's write
 * set (livekit.service.ts assertConfigured and createVoiceSession, the KEY
 * chat shell, specs). Both were reproduced on a real Nest app with the real
 * AuthGuard and BusinessGuard (LiveKit network clients recorded):
 *
 *   RV-VOICE-1  With KEY_DISABLED set and LiveKit configured, GET
 *               /livekit/businesses/:id/rooms (the shell's availability
 *               probe) answers 200, so the shell shows the mic, while every
 *               click is refused with the KEY-disabled 503 (reason
 *               key_disabled). The probe has to refuse in listRooms (or the
 *               roomClient helper it shares with createVoiceSession). Putting
 *               the KEY check in assertConfigured instead would also refuse the
 *               signature-verified webhook (handleWebhook calls it), so
 *               room_finished would no longer end VoiceSession rows while KEY
 *               is off. The refusal's text names KEY_DISABLED: that is the V1-24
 *               (D-17) refusal every KEY path shares, pinned by
 *               livekit.service.spec.ts (SEC-V124b-2), and not changed here.
 *   SEC-PR196V-1  POST /livekit/businesses/:id/voice-session has no rate limit
 *               (15 sequential POSTs from one STAFF member: 15 rooms, 15 agent
 *               dispatches). This was already true before the packet. The
 *               existing control is the controller-level CrmRateLimitGuard with
 *               @CrmRateLimit, which the KEY text chat routes carry
 *               (flow.controller.ts). livekit.controller.ts is outside the write set.
 */
describe('PR196-VOICE review follow-ups that need a scope release', () => {
  it.todo(
    'RV-VOICE-1: with KEY_DISABLED set and LiveKit configured, listRooms (the shell probe) answers the structured 503 before any LiveKit call, so the mic stays hidden, while handleWebhook still verifies and syncs room_finished. Needs listRooms or roomClient, which are outside the write set',
  );
  it.todo(
    'SEC-PR196V-1: one member cannot create LiveKit rooms and agent dispatches without bound. Repeated POST voice-session answers 429 past the limit, with no room or dispatch. Needs @UseGuards(CrmRateLimitGuard) and @CrmRateLimit on LivekitController.createVoiceSession, which is outside the write set',
  );
});
