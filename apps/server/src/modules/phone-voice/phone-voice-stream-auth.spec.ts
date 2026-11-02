/**
 * V1-14-PUB-PORTAL-VOICE-BINDING — the phone media stream takes its tenant
 * from a signed token, not from the query string (CF-47).
 *
 * THE DEFECT
 *
 *   private async handleClient(ws, req) {
 *     const url = new URL(req.url ?? '', 'http://localhost');
 *     const businessId = url.searchParams.get('businessId') ?? '';
 *
 * The WebSocket upgrade at /api/v1/cortex/phone/stream has no authentication,
 * so anyone who can reach the API host could open a stream with
 * ?businessId=<any tenant>, send a Twilio-shaped `start` frame and get a
 * realtime receptionist session bound to that tenant: its blueprint read into
 * the prompt, its calendar queried and bookings written into it, its call
 * transcripts overwritten by call sid. Live whenever an OpenAI key is set.
 *
 * THE FIX UNDER TEST
 *
 * The Twilio-verified inbound webhook mints a short-lived HMAC token naming the
 * tenant and the call, and hands it to the stream as a <Parameter> of the
 * <Stream> noun (Twilio does not forward a query string on the stream URL;
 * custom parameters arrive in the `start` frame). The stream binds the tenant
 * from that token only, before any tenant row is read or any realtime session
 * exists. A missing, tampered, foreign-secret, expired or other-call token, or
 * no `start` at all, closes the socket with 1008. A conflicting ?businessId is
 * ignored. bookings_create_booking from this untrusted-tenant surface (it is
 * not behind the action boundary) answers "Nothing was done" and runs nothing.
 *
 * WHAT IS REAL HERE
 *
 * The inbound controller, the TwiML it answers, the HTTP upgrade, the `ws`
 * server and client, the service's message handler and the onFunctionCall
 * closure it hands to the bridge are the shipped code. The realtime bridge,
 * the KEY tool executor and Prisma are recording fakes: no Twilio, no OpenAI,
 * no database. The secrets are fixed test values.
 *
 * Cases tagged NEGATIVE CONTROL fail on the unmodified code.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import twilio from 'twilio';
import WebSocket from 'ws';
import { PhoneVoiceController } from './phone-voice.controller';
import * as voiceService from './phone-voice.service';
import { PhoneVoiceService } from './phone-voice.service';

const STREAM_PATH = '/api/v1/cortex/phone/stream';
const INBOUND_PATH = '/api/v1/cortex/phone/inbound';
const PUBLIC_BASE = 'https://voice.v14.test';
const TWILIO_TEST_TOKEN = 'v14-fixed-twilio-auth-token-0000';
const STREAM_TEST_SECRET = 'v14-fixed-phone-stream-secret-0000000000';
const OTHER_SECRET = 'v14-some-other-secret-1111111111111111';

const BIZ_A = 'biz_v14_tenant_a';
const BIZ_VICTIM = 'biz_v14_victim';
const CALL_1 = 'CA_v14_call_one';
const CALL_2 = 'CA_v14_call_two';

const savedEnv = { ...process.env };

// ------------------------------------------------------------------- fixtures

type Opened = {
  instructions: string;
  tools: unknown[];
  events: {
    onAudioDelta: (p: string) => void;
    onTranscript: (role: 'user' | 'assistant', text: string) => void;
    onFunctionCall: (name: string, callId: string, argsJson: string) => Promise<unknown>;
    onError: (m: string) => void;
    onClose: () => void;
  };
};

let server: http.Server;
let port: number;
let svc: PhoneVoiceService;
let sessions: Opened[];
let openSession: ReturnType<typeof vi.fn>;
let executeToolByName: ReturnType<typeof vi.fn>;
let blueprintLookup: ReturnType<typeof vi.fn>;
let transcriptWrite: ReturnType<typeof vi.fn>;
const clients: WebSocket[] = [];

function makeRes() {
  const r: { sent: string | null; type: (t: string) => typeof r; send: (b: string) => void } = {
    sent: null,
    type: () => r,
    send: (b: string) => {
      r.sent = b;
    },
  };
  return r;
}

/** A request Twilio really signed (fixed test auth token; nothing leaves the process). */
function signedInbound(businessId: string, body: Record<string, string>) {
  const originalUrl = `${INBOUND_PATH}?businessId=${encodeURIComponent(businessId)}`;
  const signature = twilio.getExpectedTwilioSignature(TWILIO_TEST_TOKEN, `${PUBLIC_BASE}${originalUrl}`, body);
  return { headers: { 'x-twilio-signature': signature }, originalUrl, body } as never;
}

/** What the inbound webhook tells Twilio: the stream URL and its custom parameters. */
function inboundTwiml(businessId: string, callSid: string = CALL_1) {
  const res = makeRes();
  new PhoneVoiceController().inbound(
    businessId,
    signedInbound(businessId, { CallSid: callSid, From: '+15550000001', To: '+15550000002' }),
    res as never,
  );
  const twiml = res.sent ?? '';
  const streamUrl = /<Stream url="([^"]+)"/.exec(twiml)?.[1] ?? '';
  const params: Record<string, string> = {};
  for (const m of twiml.matchAll(/<Parameter name="([^"]+)" value="([^"]*)"\s*\/>/g)) params[m[1]] = m[2];
  return { twiml, streamUrl, params };
}

/** The path and query Twilio would upgrade on, pointed at the local test server. */
function localStreamUrl(streamUrl: string, overrideQuery?: string) {
  const u = new URL(streamUrl.replace(/^ws/, 'http'));
  const query = overrideQuery ?? u.search;
  return `ws://127.0.0.1:${port}${u.pathname}${query}`;
}

async function connect(url: string) {
  const ws = new WebSocket(url);
  clients.push(ws);
  const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return { ws, closed };
}

function startFrame(callSid: string, customParameters?: Record<string, string>) {
  return JSON.stringify({
    event: 'start',
    start: { streamSid: `MZ_${callSid}`, callSid, ...(customParameters ? { customParameters } : {}) },
  });
}

/** Resolves to the close code, or null if the socket is still open after `ms`. */
function closedWithin(closed: Promise<number>, ms = 400) {
  return Promise.race([closed, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

/** Runs one call the way Twilio would: inbound webhook, then the stream it names. */
async function placeCall(opts: {
  businessId?: string;
  callSid?: string;
  overrideQuery?: string;
  tamper?: (params: Record<string, string>) => Record<string, string> | undefined;
}) {
  const callSid = opts.callSid ?? CALL_1;
  const { streamUrl, params } = inboundTwiml(opts.businessId ?? BIZ_A, CALL_1);
  const custom = opts.tamper ? opts.tamper({ ...params }) : params;
  const { ws, closed } = await connect(localStreamUrl(streamUrl, opts.overrideQuery));
  ws.send(JSON.stringify({ event: 'connected', protocol: 'Call', version: '1.0.0' }));
  ws.send(startFrame(callSid, custom));
  return { ws, closed, params };
}

beforeAll(async () => {
  Logger.overrideLogger(false);
  server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  port = (server.address() as AddressInfo).port;

  sessions = [];
  openSession = vi.fn(async (opts: Opened) => {
    sessions.push(opts);
    return { sendAudio: vi.fn(), close: vi.fn() };
  });
  executeToolByName = vi.fn(async () => ({ ok: true }));
  blueprintLookup = vi.fn(async () => null);
  transcriptWrite = vi.fn(async () => ({ count: 1 }));

  svc = new PhoneVoiceService(
    { httpAdapter: { getHttpServer: () => server } } as never,
    { openSession } as never,
    { executeToolByName } as never,
    {
      client: {
        businessBlueprint: { findUnique: blueprintLookup },
        keyCallSession: { updateMany: transcriptWrite },
      },
    } as never,
  );
  svc.onModuleInit();
});

afterAll(async () => {
  for (const c of clients) c.terminate();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  process.env = { ...savedEnv };
});

beforeEach(() => {
  process.env.PUBLIC_BASE_URL = PUBLIC_BASE;
  process.env.TWILIO_AUTH_TOKEN = TWILIO_TEST_TOKEN;
  process.env.PHONE_STREAM_TOKEN_SECRET = STREAM_TEST_SECRET;
  delete process.env.PHONE_VOICE_ALLOW_UNVERIFIED;
  sessions.length = 0;
  openSession.mockClear();
  executeToolByName.mockClear();
  blueprintLookup.mockClear();
  transcriptWrite.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  for (const c of clients.splice(0)) c.terminate();
});

// --------------------------------------------------------- the inbound webhook

describe('the Twilio-verified inbound webhook hands the stream a signed tenant token', () => {
  it('NEGATIVE CONTROL (pre-fix FAIL expected): the stream URL carries no tenant; a tenantToken <Parameter> does', () => {
    const { twiml, streamUrl, params } = inboundTwiml(BIZ_A);
    expect(streamUrl).toBe(`${PUBLIC_BASE.replace(/^http/, 'ws')}${STREAM_PATH}`);
    expect(twiml).not.toContain('businessId');
    expect(twiml).not.toContain(BIZ_A); // the tenant is inside the signed token, not readable text
    expect(Object.keys(params)).toEqual(['tenantToken']);
    expect(params.tenantToken).toMatch(/^[A-Za-z0-9_.-]+$/); // safe inside an XML attribute
  });

  it('NEGATIVE CONTROL (pre-fix FAIL expected): the token names the webhook tenant and is bound to the call', () => {
    const { params } = inboundTwiml(BIZ_A, CALL_1);
    const verify = voiceService.verifyPhoneStreamToken;
    expect(typeof verify).toBe('function');
    expect(verify(params.tenantToken, { callSid: CALL_1 })).toEqual({ businessId: BIZ_A, callSid: CALL_1 });
    expect(verify(params.tenantToken, { callSid: CALL_2 }), 'another call may not reuse it').toBeNull();
  });

  it('NEGATIVE CONTROL (pre-fix FAIL expected): the token is short-lived', () => {
    const now = Date.UTC(2026, 10, 2, 12, 0, 0);
    const ttl = voiceService.PHONE_STREAM_TOKEN_TTL_MS;
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(10 * 60_000);
    const token = voiceService.mintPhoneStreamToken(BIZ_A, { callSid: CALL_1, now });
    expect(voiceService.verifyPhoneStreamToken(token, { callSid: CALL_1, now: now + ttl - 1000 })?.businessId).toBe(BIZ_A);
    expect(voiceService.verifyPhoneStreamToken(token, { callSid: CALL_1, now: now + ttl + 1000 })).toBeNull();
  });

  it('NEGATIVE CONTROL (pre-fix FAIL expected): verification refuses anything it did not sign', () => {
    const verify = voiceService.verifyPhoneStreamToken;
    const good = voiceService.mintPhoneStreamToken(BIZ_A, { callSid: CALL_1 });
    const [version, payload, sig] = good.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')), b: BIZ_VICTIM }),
    ).toString('base64url');
    for (const bad of [
      undefined,
      null,
      42,
      {},
      '',
      'not-a-token',
      `${version}.${payload}`,
      `${version}.${forgedPayload}.${sig}`, // tenant swapped, signature kept
      `${version}.${payload}.${sig.slice(0, -2)}AA`, // signature tampered
      `v0.${payload}.${sig}`, // unknown version
      `${good}.extra`,
    ]) {
      expect(verify(bad, { callSid: CALL_1 }), JSON.stringify(bad)).toBeNull();
    }
    process.env.PHONE_STREAM_TOKEN_SECRET = OTHER_SECRET;
    expect(verify(good, { callSid: CALL_1 }), 'a token signed under another secret').toBeNull();
  });

  it('positive control: the webhook still refuses an unsigned request and emits no TwiML', () => {
    const res = makeRes();
    const req = { headers: {}, originalUrl: `${INBOUND_PATH}?businessId=${BIZ_A}`, body: { CallSid: CALL_1 } } as never;
    expect(() => new PhoneVoiceController().inbound(BIZ_A, req, res as never)).toThrow(/signature/i);
    expect(res.sent).toBeNull();
  });
});

// ------------------------------------------------------------------ the stream

describe('the media stream binds its tenant from the token only', () => {
  it('NEGATIVE CONTROL (pre-fix FAIL expected): ?businessId=<victim> with no token is closed before a session exists', async () => {
    const { ws, closed } = await connect(`ws://127.0.0.1:${port}${STREAM_PATH}?businessId=${BIZ_VICTIM}`);
    ws.send(JSON.stringify({ event: 'connected' }));
    ws.send(startFrame(CALL_1));
    expect(await closedWithin(closed)).toBe(1008);
    expect(openSession).not.toHaveBeenCalled();
    expect(blueprintLookup, 'no tenant row may be read for an unproven tenant').not.toHaveBeenCalled();
  });

  it('NEGATIVE CONTROL (pre-fix FAIL expected): an upgrade that never presents a token is closed at the deadline', async () => {
    (svc as unknown as { streamAuthDeadlineMs: number }).streamAuthDeadlineMs = 150;
    try {
      const { ws, closed } = await connect(`ws://127.0.0.1:${port}${STREAM_PATH}?businessId=${BIZ_VICTIM}`);
      ws.send(JSON.stringify({ event: 'connected' }));
      expect(await closedWithin(closed, 1500)).toBe(1008);
      expect(openSession).not.toHaveBeenCalled();
    } finally {
      (svc as unknown as { streamAuthDeadlineMs: number }).streamAuthDeadlineMs = voiceService.PHONE_STREAM_AUTH_DEADLINE_MS;
    }
  });

  it('NEGATIVE CONTROL (pre-fix FAIL expected): a conflicting ?businessId is ignored; the token tenant is bound', async () => {
    const { closed } = await placeCall({ overrideQuery: `?businessId=${BIZ_VICTIM}` });
    await vi.waitFor(() => expect(openSession).toHaveBeenCalledTimes(1));
    expect(await closedWithin(closed, 100)).toBeNull();
    expect(blueprintLookup).toHaveBeenCalledTimes(1);
    expect(blueprintLookup.mock.calls[0][0].where).toEqual({ businessId: BIZ_A });

    await sessions[0].events.onFunctionCall('calendar_check_conflicts', 'fc_1', '{"start":"2026-03-01T10:00:00Z","end":"2026-03-01T11:00:00Z"}');
    expect(executeToolByName).toHaveBeenCalledTimes(1);
    expect(executeToolByName.mock.calls[0][0]).toBe(BIZ_A);
    expect(JSON.stringify(executeToolByName.mock.calls)).not.toContain(BIZ_VICTIM);
  });

  it('NEGATIVE CONTROL (pre-fix FAIL expected): a tampered token is closed before a session exists', async () => {
    const { closed } = await placeCall({
      overrideQuery: `?businessId=${BIZ_A}`,
      tamper: (p) => ({ tenantToken: `${p.tenantToken.slice(0, -2)}AA` }),
    });
    expect(await closedWithin(closed)).toBe(1008);
    expect(openSession).not.toHaveBeenCalled();
    expect(blueprintLookup).not.toHaveBeenCalled();
  });

  it('NEGATIVE CONTROL (pre-fix FAIL expected): a token signed under another secret is closed', async () => {
    const { streamUrl, params } = inboundTwiml(BIZ_A, CALL_1);
    process.env.PHONE_STREAM_TOKEN_SECRET = OTHER_SECRET; // the stream now checks under a key the minter did not use
    const { ws, closed } = await connect(localStreamUrl(streamUrl, `?businessId=${BIZ_A}`));
    ws.send(startFrame(CALL_1, params));
    expect(await closedWithin(closed)).toBe(1008);
    expect(openSession).not.toHaveBeenCalled();
  });

  it('NEGATIVE CONTROL (pre-fix FAIL expected): an expired token is closed before a session exists', async () => {
    const { streamUrl, params } = inboundTwiml(BIZ_A, CALL_1);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 60 * 60_000); // an hour later
    const { ws, closed } = await connect(localStreamUrl(streamUrl, `?businessId=${BIZ_A}`));
    ws.send(startFrame(CALL_1, params));
    expect(await closedWithin(closed)).toBe(1008);
    expect(openSession).not.toHaveBeenCalled();
  });

  it("NEGATIVE CONTROL (pre-fix FAIL expected): one call's token cannot open another call's stream", async () => {
    const { closed } = await placeCall({ callSid: CALL_2, overrideQuery: `?businessId=${BIZ_A}` });
    expect(await closedWithin(closed)).toBe(1008);
    expect(openSession).not.toHaveBeenCalled();
  });

  it('positive control: the genuine call opens exactly one session for its tenant and stays open', async () => {
    const { closed } = await placeCall({});
    await vi.waitFor(() => expect(openSession).toHaveBeenCalledTimes(1));
    expect(await closedWithin(closed, 150)).toBeNull();
    expect(sessions[0].instructions).toContain('receptionist');
  });

  it('NEGATIVE CONTROL (pre-fix FAIL expected): a second start frame cannot rebind the tenant or open a second session', async () => {
    const { ws } = await placeCall({});
    await vi.waitFor(() => expect(openSession).toHaveBeenCalledTimes(1));
    const victim = inboundTwiml(BIZ_VICTIM, CALL_1);
    ws.send(startFrame(CALL_1, victim.params));
    await new Promise((r) => setTimeout(r, 150));
    expect(openSession).toHaveBeenCalledTimes(1);
    expect(blueprintLookup).toHaveBeenCalledTimes(1);
    expect(blueprintLookup.mock.calls[0][0].where).toEqual({ businessId: BIZ_A });
  });

  it('NEGATIVE CONTROL (pre-fix FAIL expected): the transcript is written only to the bound tenant’s call row', async () => {
    const { ws, closed } = await placeCall({});
    await vi.waitFor(() => expect(openSession).toHaveBeenCalledTimes(1));
    sessions[0].events.onTranscript('user', 'I would like an appointment');
    ws.send(JSON.stringify({ event: 'stop' }));
    await closedWithin(closed, 1000);
    await vi.waitFor(() => expect(transcriptWrite).toHaveBeenCalled());
    for (const [arg] of transcriptWrite.mock.calls) {
      expect(arg.where).toEqual({ callSid: CALL_1, businessId: BIZ_A });
    }
  });
});

// ------------------------------------------------------------ the tool surface

describe('tools on the phone stream', () => {
  async function liveSession() {
    await placeCall({});
    await vi.waitFor(() => expect(openSession).toHaveBeenCalledTimes(1));
    return sessions[0].events;
  }

  it("NEGATIVE CONTROL (pre-fix FAIL expected): bookings_create_booking answers 'Nothing was done' and runs nothing", async () => {
    const events = await liveSession();
    const out = (await events.onFunctionCall(
      'bookings_create_booking',
      'fc_book',
      JSON.stringify({ contactName: 'Ada', contactPhone: '+15550000001', start: '2026-03-01T10:00:00Z' }),
    )) as { error?: string };
    expect(out.error).toMatch(/nothing was done/i);
    expect(executeToolByName, 'a booking was attempted from an untrusted-tenant surface').not.toHaveBeenCalled();
  });

  it('helpdesk_create_ticket still reaches the action boundary declared as PHONE_STREAM, for the token tenant', async () => {
    const events = await liveSession();
    await events.onFunctionCall('helpdesk_create_ticket', 'fc_t', '{"title":"Leaking tap"}');
    expect(executeToolByName).toHaveBeenCalledWith(BIZ_A, 'helpdesk_create_ticket', { title: 'Leaking tap' }, {
      surface: 'PHONE_STREAM',
    });
  });

  it('positive control: calendar_check_conflicts (a read) still runs for the token tenant', async () => {
    const events = await liveSession();
    await events.onFunctionCall('calendar_check_conflicts', 'fc_c', '{"start":"2026-03-01T10:00:00Z","end":"2026-03-01T11:00:00Z"}');
    expect(executeToolByName).toHaveBeenCalledTimes(1);
    expect(executeToolByName.mock.calls[0].slice(0, 2)).toEqual([BIZ_A, 'calendar_check_conflicts']);
  });

  it('malformed tool arguments are still refused without running anything', async () => {
    const events = await liveSession();
    const out = (await events.onFunctionCall('helpdesk_create_ticket', 'fc_bad', '{"title":')) as { error?: string };
    expect(out.error).toMatch(/nothing was done/i);
    expect(executeToolByName).not.toHaveBeenCalled();
  });
});
