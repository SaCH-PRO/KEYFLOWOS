/**
 * V1-24b review (SEC-V124b-2): KEY_DISABLED must stop KEY voice through LiveKit.
 *
 * createVoiceSession creates a room, dispatches the KEY voice agent into it
 * (createDispatch(roomName, 'key-voice-agent', { metadata: businessId })) and
 * mints a join token. The dispatched worker (apps/voice-agent) loads the
 * tenant's blueprint into its instructions and streams the member's live audio
 * to OpenAI Realtime. Neither read KEY_DISABLED, while the boot line told the
 * operator every direct path refuses.
 *
 * Proven here:
 *   - with KEY_DISABLED set, createVoiceSession answers the KEY-disabled 503
 *     (the gateway's refusal) before any room, agent dispatch, join token or
 *     VoiceSession row, and reads the switch per call; with KEY on it does all
 *     four (the control);
 *   - the voice agent worker reads the same switch the same way (pinned to the
 *     server's keyDisabled() value by value), rejects every dispatched job while
 *     it is on and accepts otherwise, and its entry returns before it joins the
 *     room, loads a blueprint or builds the OpenAI Realtime model.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HttpException, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LivekitService, KEY_VOICE_AGENT_NAME } from './livekit.service';
import { keyDisabled as serverKeyDisabled } from '../../core/config/env';
import { keyDisabled as agentKeyDisabled, screenJobRequest } from '../../../../voice-agent/src/key-switch';

/** The LiveKit server SDK's network clients, recorded; nothing leaves the process. AccessToken stays real (it signs locally). */
const lk = vi.hoisted(() => ({
  roomClients: 0,
  rooms: [] as Array<Record<string, unknown>>,
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

/** The gateway's KEY_DISABLED refusal: the R0-07 503 with reason key_disabled. */
async function expectKeyDisabled(call: Promise<unknown>) {
  const err: any = await call.then(
    () => {
      throw new Error('expected the call to be refused');
    },
    (e: unknown) => e,
  );
  expect(err, String(err?.stack ?? err)).toBeInstanceOf(HttpException);
  expect(err.getStatus()).toBe(503);
  expect(err.getResponse()).toMatchObject({ code: 'provider_not_configured', reason: 'key_disabled', service: 'ai', error: 'Service Unavailable' });
  expect(err.getResponse().message).toMatch(/KEY_DISABLED/);
}

function service() {
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'vs-v124b', ...data }));
  return { svc: new LivekitService({ client: { voiceSession: { create } } } as any), create };
}

function configureLivekit() {
  process.env.LIVEKIT_API_KEY = 'v124b-livekit-key';
  process.env.LIVEKIT_API_SECRET = 'v124b-livekit-secret-that-is-long-enough-to-sign';
}

describe('LiveKit KEY voice sessions honour KEY_DISABLED (SEC-V124b-2)', () => {
  it('with KEY_DISABLED=1 and LiveKit configured: createVoiceSession answers the KEY-disabled 503 before any room, agent dispatch, join token or VoiceSession row', async () => {
    process.env.KEY_DISABLED = '1';
    configureLivekit();
    expect(serverKeyDisabled()).toBe(true);
    const { svc, create } = service();

    await expectKeyDisabled(svc.createVoiceSession('v124b-biz-A', 'u1'));
    expect(lk.roomClients).toBe(0);
    expect(lk.rooms).toEqual([]);
    expect(lk.dispatchClients).toBe(0);
    expect(lk.dispatches).toEqual([]);
    expect(lk.tokens).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('KEY_DISABLED=true with LiveKit NOT configured: the KEY refusal, not the LiveKit one, answers', async () => {
    process.env.KEY_DISABLED = 'true';
    await expectKeyDisabled(service().svc.createVoiceSession('v124b-biz-A', 'u1'));
  });

  it('the switch is read at call time: a service that served a session refuses once KEY_DISABLED is set', async () => {
    configureLivekit();
    const { svc, create } = service();
    await svc.createVoiceSession('v124b-biz-A', 'u1');
    expect(lk.dispatches).toHaveLength(1);

    process.env.KEY_DISABLED = '1';
    await expectKeyDisabled(svc.createVoiceSession('v124b-biz-A', 'u1'));
    expect(lk.dispatches).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('control: with KEY on, createVoiceSession creates the room, dispatches the KEY voice agent with the business, mints a token and records the session', async () => {
    configureLivekit();
    const { svc, create } = service();
    const out = await svc.createVoiceSession('v124b-biz-A', 'u1');

    expect(lk.rooms).toHaveLength(1);
    expect(lk.dispatches).toHaveLength(1);
    expect(lk.dispatches[0].agent).toBe(KEY_VOICE_AGENT_NAME);
    expect(JSON.parse(String(lk.dispatches[0].opts.metadata))).toMatchObject({ businessId: 'v124b-biz-A' });
    expect(lk.tokens).toBe(1);
    expect(typeof out.token).toBe('string');
    expect(out.token.length).toBeGreaterThan(20);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('the KEY voice agent worker (apps/voice-agent) honours KEY_DISABLED (SEC-V124b-2)', () => {
  it('reads KEY_DISABLED exactly as the server does (1 or true, any case, surrounding space ignored)', () => {
    for (const v of [undefined, '', '0', 'false', 'no', 'yes', '1', 'true', 'TRUE', ' True ', ' 1 ', '2']) {
      if (v === undefined) delete process.env.KEY_DISABLED;
      else process.env.KEY_DISABLED = v;
      expect(agentKeyDisabled({ KEY_DISABLED: v }), `KEY_DISABLED=${JSON.stringify(v)}`).toBe(serverKeyDisabled());
      expect(agentKeyDisabled(), `KEY_DISABLED=${JSON.stringify(v)} (process.env)`).toBe(serverKeyDisabled());
    }
  });

  it('with KEY_DISABLED set, the job filter rejects every dispatched job and accepts none', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const req = { accept: vi.fn().mockResolvedValue(undefined), reject: vi.fn().mockResolvedValue(undefined) };
    await screenJobRequest(req, { KEY_DISABLED: '1' });
    expect(req.reject).toHaveBeenCalledTimes(1);
    expect(req.accept).not.toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/KEY_DISABLED/);
  });

  it('control: with KEY on, the job filter accepts the job (the agents default) and rejects nothing', async () => {
    const req = { accept: vi.fn().mockResolvedValue(undefined), reject: vi.fn().mockResolvedValue(undefined) };
    await screenJobRequest(req, {});
    expect(req.accept).toHaveBeenCalledTimes(1);
    expect(req.reject).not.toHaveBeenCalled();
  });

  it('the worker installs the job filter, and its entry returns on the switch before it joins the room, reads a blueprint or builds the OpenAI Realtime model', () => {
    const main = readFileSync(join(__dirname, '..', '..', '..', '..', 'voice-agent', 'src', 'main.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    expect(main).toMatch(/\brequestFunc\s*:\s*screenJobRequest\b/);
    const entry = main.slice(main.search(/\bentry\s*:\s*async\s*\(/));
    const guard = entry.search(/if\s*\(\s*keyDisabled\s*\(\s*\)\s*\)/);
    expect(guard, 'entry does not read keyDisabled()').toBeGreaterThan(-1);
    for (const [what, re] of [
      ['ctx.connect()', /\bctx\.connect\s*\(/],
      ['buildInstructions (blueprint read)', /\bbuildInstructions\s*\(/],
      ['new openai.realtime.RealtimeModel', /\bRealtimeModel\s*\(/],
    ] as const) {
      const at = entry.search(re);
      expect(at, `${what} not found in entry`).toBeGreaterThan(-1);
      expect(guard, `${what} runs before the KEY_DISABLED guard`).toBeLessThan(at);
    }
    expect(entry.slice(guard, entry.search(/\bctx\.connect\s*\(/))).toMatch(/\breturn\b/);
  });
});
