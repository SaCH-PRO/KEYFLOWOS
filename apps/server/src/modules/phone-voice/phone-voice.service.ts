import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { WebSocketServer, WebSocket, RawData } from 'ws';
import { createHmac, randomBytes } from 'crypto';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { RealtimeBridgeService, RealtimeToolDef } from './realtime-bridge.service';
import { FlowOrchestratorService } from '../ai/flow-orchestrator.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { timingSafeStringEqual } from '../../core/security/timing-safe-equal';
import { tenantBindingOf, type ExecutionSurface } from '../key-autonomy/action-boundary/control-clearance';

const STREAM_PATH = '/api/v1/cortex/phone/stream';

// ------------------------------------------------- the stream's tenant token
//
// V1-14 (CF-47). The media stream used to bind its tenant from
// `?businessId=` on an unauthenticated WebSocket upgrade, so anyone who could
// reach the API host could open a receptionist session for any tenant: read
// its blueprint into the prompt, query its calendar, write bookings into it
// and overwrite its call transcripts by call sid.
//
// The tenant now travels in a short-lived HMAC token that only the inbound
// webhook mints, after it has verified Twilio's signature (or under the
// explicit, logged PHONE_VOICE_ALLOW_UNVERIFIED=1 dev bypass). The webhook
// hands it to the stream as a <Parameter> of the <Stream> noun: Twilio does
// not forward a query string on the stream URL, and custom parameters arrive
// in the `start` frame as start.customParameters. The stream binds the tenant
// from the token and nothing else, before any tenant row is read or any
// realtime session is opened.

/** The <Parameter> name the token travels under. */
export const PHONE_STREAM_TOKEN_PARAM = 'tenantToken';
/** Twilio connects the stream as soon as it reads the TwiML; five minutes is generous. */
export const PHONE_STREAM_TOKEN_TTL_MS = 5 * 60_000;
/** A socket that has not presented a valid token by then is closed. */
export const PHONE_STREAM_AUTH_DEADLINE_MS = 10_000;

const TOKEN_VERSION = 'v1';
const TOKEN_CONTEXT = 'keyflow.phone-stream-tenant.v1';
const TOKEN_MAX_LENGTH = 2048;
/** WebSocket close code 1008: policy violation. */
const CLOSE_NOT_AUTHORIZED = 1008;

/**
 * Last-resort key for a process with neither secret configured, which can only
 * be the dev bypass: production cannot answer an inbound call without
 * TWILIO_AUTH_TOKEN. It is never written anywhere, so a token signed with it
 * verifies only in the process that minted it. That fails closed (a stream
 * that lands on another instance is refused), never open.
 */
const PROCESS_LOCAL_SECRET = randomBytes(32).toString('hex');

/**
 * PHONE_STREAM_TOKEN_SECRET when set; otherwise TWILIO_AUTH_TOKEN, which
 * every deployment that can answer a call already has. Read per call, so a
 * rotation takes effect without a restart. The HMAC input is prefixed with
 * TOKEN_CONTEXT, so a value computed here is never a valid Twilio signature
 * (HMAC-SHA1 over the request URL) or the reverse.
 */
function phoneStreamSecret(): string {
  return process.env.PHONE_STREAM_TOKEN_SECRET || process.env.TWILIO_AUTH_TOKEN || PROCESS_LOCAL_SECRET;
}

function signPhoneStreamPayload(payload: string): string {
  return createHmac('sha256', phoneStreamSecret()).update(`${TOKEN_CONTEXT}.${payload}`).digest('base64url');
}

/**
 * Mint the token the inbound webhook hands to the stream. `callSid`, when the
 * webhook has one (Twilio always sends CallSid), binds the token to that call,
 * so it cannot open a stream for any other.
 */
export function mintPhoneStreamToken(
  businessId: string,
  opts: { callSid?: string | null; now?: number } = {},
): string {
  if (typeof businessId !== 'string' || businessId.length === 0) {
    throw new Error('A phone stream token needs a businessId');
  }
  const claims: { b: string; exp: number; c?: string } = {
    b: businessId,
    exp: (opts.now ?? Date.now()) + PHONE_STREAM_TOKEN_TTL_MS,
  };
  if (typeof opts.callSid === 'string' && opts.callSid.length > 0) claims.c = opts.callSid;
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `${TOKEN_VERSION}.${payload}.${signPhoneStreamPayload(payload)}`;
}

/**
 * The tenant a token proves, or null. Null for anything that is not a token
 * this server signed under the current secret, that has expired, or that was
 * bound to a different call than `callSid`.
 */
export function verifyPhoneStreamToken(
  token: unknown,
  opts: { callSid?: string | null; now?: number } = {},
): { businessId: string; callSid: string | null } | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > TOKEN_MAX_LENGTH) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [version, payload, signature] = parts;
  if (version !== TOKEN_VERSION || !payload || !signature) return null;
  if (!timingSafeStringEqual(signature, signPhoneStreamPayload(payload))) return null;

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return null;
  const { b, exp, c } = claims as Record<string, unknown>;
  if (typeof b !== 'string' || b.length === 0) return null;
  if (typeof exp !== 'number' || !Number.isFinite(exp) || exp <= (opts.now ?? Date.now())) return null;
  if (c !== undefined && (typeof c !== 'string' || c !== opts.callSid)) return null;
  return { businessId: b, callSid: typeof c === 'string' ? c : null };
}

// ------------------------------------------------------- the tool surface

/** What the action boundary calls this entry point (KF-EXEC-ACTION-001, E4). */
const PHONE_SURFACE: ExecutionSurface = 'PHONE_STREAM';

/**
 * Receptionist tools that write and are NOT behind the action boundary.
 * helpdesk_create_ticket is: the boundary refuses it for this surface itself.
 * bookings_create_booking is not, so nothing downstream would refuse it. While
 * the boundary classifies PHONE_STREAM as an untrusted-tenant surface, these
 * are refused here, before the executor, and the model is told nothing was
 * done. (The signed token proves the tenant to this service; whether that is
 * enough to trust the surface is the boundary's call, in control-clearance.)
 */
const PHONE_WRITES_OUTSIDE_THE_BOUNDARY: ReadonlySet<string> = new Set(['bookings_create_booking']);

const RECEPTIONIST_TOOLS: RealtimeToolDef[] = [
  {
    name: 'calendar_check_conflicts',
    description: 'Check whether a requested appointment time conflicts with the business calendar.',
    parameters: {
      type: 'object',
      properties: {
        start: { type: 'string', description: 'Requested start (ISO)' },
        end: { type: 'string', description: 'Requested end (ISO)' },
      },
      required: ['start', 'end'],
    },
  },
  {
    name: 'bookings_create_booking',
    description: 'Book an appointment for the caller.',
    parameters: {
      type: 'object',
      properties: {
        contactName: { type: 'string', description: 'Caller name' },
        contactPhone: { type: 'string', description: 'Caller phone number' },
        start: { type: 'string', description: 'Start time (ISO)' },
        notes: { type: 'string', description: 'Reason for the visit' },
      },
      required: ['contactName', 'start'],
    },
  },
  {
    name: 'helpdesk_create_ticket',
    description: 'Take a message / open a support ticket for the caller.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short summary of the issue' },
        description: { type: 'string', description: 'Details from the caller' },
      },
      required: ['title'],
    },
  },
];

interface CallContext {
  streamSid: string;
  callSid: string;
  businessId: string;
  send: (base64Mulaw: string) => void;
  close: () => void;
  transcript: Array<{ role: 'user' | 'assistant'; text: string }>;
}

/**
 * Twilio Media Streams (plain WebSocket) ↔ OpenAI Realtime bridge.
 * socket.io can't speak Twilio's protocol, so this attaches a raw `ws`
 * upgrade handler to the underlying HTTP server for one exact path.
 */
@Injectable()
export class PhoneVoiceService implements OnModuleInit {
  private readonly logger = new Logger(PhoneVoiceService.name);
  private wss: WebSocketServer | null = null;
  /** How long an upgraded socket may stay open without a valid tenant token. */
  private streamAuthDeadlineMs = PHONE_STREAM_AUTH_DEADLINE_MS;

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly bridge: RealtimeBridgeService,
    private readonly flow: FlowOrchestratorService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    const server = this.httpAdapterHost.httpAdapter.getHttpServer();
    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const pathname = new URL(req.url ?? '', 'http://localhost').pathname;
      if (pathname !== STREAM_PATH) return; // let other upgrade handlers (socket.io) run
      this.wss!.handleUpgrade(req, socket, head, (ws: WebSocket) => {
        void this.handleClient(ws, req);
      });
    });

    this.logger.log(`Phone voice bridge listening at ${STREAM_PATH}`);
  }

  /**
   * One Twilio media stream. The upgrade request is deliberately not read: the
   * tenant used to come from its `?businessId=` (V1-14, CF-47). It now comes
   * only from the signed token in the `start` frame, and until that token
   * verifies this socket has no tenant, reads no tenant row and has no
   * realtime session. A missing, bad, expired or other-call token, or no
   * `start` before the deadline, closes the socket with 1008.
   */
  private async handleClient(ws: WebSocket, _req: IncomingMessage) {
    const ctx: Partial<CallContext> = { transcript: [] };
    let binding: 'pending' | 'bound' | 'refused' = 'pending';

    const refuse = (reason: string) => {
      if (binding === 'refused') return;
      binding = 'refused';
      clearTimeout(deadline);
      this.logger.warn(`Phone stream refused before any session: ${reason}`);
      ws.close(CLOSE_NOT_AUTHORIZED, 'stream not authorized');
    };
    const deadline = setTimeout(() => {
      if (binding === 'pending') refuse('no valid tenant token was presented in time');
    }, this.streamAuthDeadlineMs);
    deadline.unref?.();

    ws.on('message', async (raw: RawData) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw)) as Record<string, unknown>;
      } catch {
        return;
      }

      switch (msg.event) {
        case 'connected':
          this.logger.debug('Twilio stream connected (tenant not yet bound)');
          break;

        case 'start': {
          // One binding per socket. A second start must not rebind the tenant
          // or open a second realtime session.
          if (binding !== 'pending') {
            this.logger.warn(`Ignoring a repeated start frame on ${ctx.callSid ?? 'an unbound stream'}`);
            break;
          }
          const start = (msg.start && typeof msg.start === 'object' ? msg.start : {}) as Record<string, unknown>;
          const callSid = typeof start.callSid === 'string' ? start.callSid : '';
          const custom = (
            start.customParameters && typeof start.customParameters === 'object' ? start.customParameters : {}
          ) as Record<string, unknown>;
          const claims = callSid
            ? verifyPhoneStreamToken(custom[PHONE_STREAM_TOKEN_PARAM], { callSid })
            : null;
          if (!claims) {
            refuse(`start frame for ${callSid || 'no call sid'} carried no valid tenant token`);
            return;
          }
          binding = 'bound';
          clearTimeout(deadline);

          const businessId = claims.businessId;
          ctx.businessId = businessId;
          ctx.streamSid = typeof start.streamSid === 'string' ? start.streamSid : '';
          ctx.callSid = callSid;
          this.logger.log(`Call started: ${callSid} (business ${businessId}, token-bound)`);

          const instructions = await this.buildInstructions(businessId);
          const session = await this.bridge.openSession({
            instructions,
            tools: RECEPTIONIST_TOOLS,
            events: {
              onAudioDelta: (payload) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ event: 'media', streamSid: ctx.streamSid, media: { payload } }));
                }
              },
              onTranscript: (role, text) => {
                if (text.trim()) (ctx.transcript as CallContext['transcript']).push({ role, text });
              },
              onFunctionCall: async (name, _callId, argsJson) => {
                // Unparseable arguments must NOT become an empty object.
                //
                // This used to be `try { args = JSON.parse(argsJson) } catch {}`
                // with args pre-set to `{}`, so a malformed tool call from the
                // model ran the tool anyway, with nothing in it — ON A LIVE
                // CUSTOMER CALL. bookings_create_booking with `{}` maps to a
                // booking with no contactName and no startTime;
                // helpdesk_create_ticket with `{}` opens a blank ticket. The
                // caller hears "done".
                //
                // `{ error }` is what this handler already returns for an
                // unknown tool, and the realtime session feeds it back to the
                // model — so the model can ask again or tell the caller it did
                // not catch that, which is the honest outcome.
                let args: Record<string, unknown>;
                try {
                  const parsed = JSON.parse(argsJson);
                  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    throw new Error('tool arguments were not a JSON object');
                  }
                  args = parsed as Record<string, unknown>;
                } catch (err) {
                  this.logger.warn(
                    `Refusing ${name} on ${ctx.callSid}: unparseable tool arguments — ` +
                      `${err instanceof Error ? err.message : String(err)}`,
                  );
                  return {
                    error: `Could not read the arguments for ${name}. Nothing was done. Please call it again with valid JSON.`,
                  };
                }
                return this.dispatchVoiceTool(businessId, name, args, ctx as CallContext);
              },
              onError: (message) => this.logger.warn(`Realtime error on ${ctx.callSid}: ${message}`),
              onClose: () => this.logger.debug(`Realtime session closed for ${ctx.callSid}`),
            },
          });

          if (!session) {
            this.logger.error(`Realtime session failed to open for ${ctx.callSid} — closing call stream`);
            ws.close();
            return;
          }
          ctx.send = session.sendAudio;
          ctx.close = session.close;
          break;
        }

        case 'media': {
          const payload = (msg.media as { payload?: string })?.payload;
          if (payload && ctx.send) ctx.send(payload);
          break;
        }

        case 'stop': {
          this.logger.log(`Call ended: ${ctx.callSid}`);
          ctx.close?.();
          await this.persistTranscript(ctx as CallContext);
          ws.close();
          break;
        }
      }
    });

    ws.on('close', () => {
      clearTimeout(deadline);
      ctx.close?.();
      void this.persistTranscript(ctx as CallContext);
    });

    ws.on('error', () => {
      ctx.close?.();
    });
  }

  private async buildInstructions(businessId: string): Promise<string> {
    let businessName = 'the business';
    let extra = '';
    try {
      const bp = await this.prisma.client.businessBlueprint.findUnique({
        where: { businessId },
        select: { identity: true, operatingModel: true },
      });
      const identity = (bp?.identity ?? {}) as Record<string, unknown>;
      const operating = (bp?.operatingModel ?? {}) as Record<string, unknown>;
      if (typeof identity.name === 'string' && identity.name) businessName = identity.name;
      const bits = [identity.industry, operating.deliveryMode].filter(Boolean);
      if (bits.length) extra = ` They are in ${bits.join(', ')}.`;
    } catch {
      // context is best-effort
    }

    return [
      `You are KEY, the friendly AI receptionist for ${businessName}.${extra}`,
      'You are on a live phone call: keep replies SHORT (1-2 sentences), natural, and warm — this is spoken conversation, not text.',
      'Answer questions about the business, offer to book appointments (check conflicts first, then book), or take a detailed message as a support ticket.',
      'If you cannot help with something, say you will have the team call back.',
      'Never make up business facts you do not know. Ask the caller to repeat if audio is unclear.',
    ].join(' ');
  }

  /**
   * The phone stream's tool gate: what the realtime session's onFunctionCall
   * reaches once the arguments parse. A write that is not behind the action
   * boundary is refused here while the boundary does not trust this surface's
   * tenant binding, and the model is told nothing was done, so it does not
   * tell the caller an appointment exists. Everything else goes to
   * executeVoiceTool unchanged.
   */
  private async dispatchVoiceTool(
    businessId: string,
    name: string,
    args: Record<string, unknown>,
    ctx: CallContext,
  ): Promise<unknown> {
    if (PHONE_WRITES_OUTSIDE_THE_BOUNDARY.has(name) && tenantBindingOf(PHONE_SURFACE) === 'untrusted') {
      this.logger.warn(
        `${name} refused on ${ctx.callSid}: ${PHONE_SURFACE} is an untrusted-tenant surface and this write ` +
          'is not behind the action boundary',
      );
      return {
        error:
          'An appointment could not be booked from this call. Nothing was done. Tell the caller the team will call them back to arrange a time.',
      };
    }
    return this.executeVoiceTool(businessId, name, args, ctx);
  }

  private async executeVoiceTool(
    businessId: string,
    name: string,
    args: Record<string, unknown>,
    ctx: CallContext,
  ): Promise<unknown> {
    switch (name) {
      case 'calendar_check_conflicts':
        return this.flow.executeToolByName(businessId, 'calendar_check_conflicts', args);
      case 'bookings_create_booking': {
        // Reached only when dispatchVoiceTool admits it (see
        // PHONE_WRITES_OUTSIDE_THE_BOUNDARY). Declares its surface, as every
        // phone write does.
        const mapped = {
          contactName: args.contactName,
          startTime: args.start,
          notes: args.notes ?? `Phone booking via KEY receptionist${args.contactPhone ? ` (${args.contactPhone})` : ''}`,
        };
        return this.flow.executeToolByName(businessId, 'bookings_create_booking', mapped, { surface: PHONE_SURFACE });
      }
      case 'helpdesk_create_ticket':
        // KF-EXEC-ACTION-001: declared as the phone stream. Its business id now
        // comes from the signed tenant token (V1-14), but the action boundary
        // still classifies PHONE_STREAM as an untrusted-tenant surface (D1,
        // open under VOICE) and refuses it. The model is told nothing was
        // done, so it does not tell the caller a ticket exists.
        try {
          return await this.flow.executeToolByName(businessId, 'helpdesk_create_ticket', args, {
            surface: 'PHONE_STREAM',
          });
        } catch (err) {
          this.logger.warn(
            `helpdesk_create_ticket refused on ${ctx.callSid}: ${err instanceof Error ? err.message : String(err)}`,
          );
          return {
            error:
              'A support ticket could not be created from this call. Nothing was done. Tell the caller the team will call them back.',
          };
        }
      default:
        return { error: `Unknown tool ${name}` };
    }
  }

  private async persistTranscript(ctx: Partial<CallContext>) {
    // Only a token-bound stream has a businessId. The write is scoped to it:
    // a call sid alone named a row in any tenant (V1-14).
    if (!ctx.callSid || !ctx.businessId || !ctx.transcript?.length) return;
    try {
      await (this.prisma.client as any).keyCallSession.updateMany({
        where: { callSid: ctx.callSid, businessId: ctx.businessId },
        data: {
          transcript: ctx.transcript as unknown as object,
          endedAt: new Date(),
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to persist transcript for ${ctx.callSid}: ${(err as Error).message}`);
    }
  }
}
