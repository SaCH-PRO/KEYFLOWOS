import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { WebSocketServer, WebSocket, RawData } from 'ws';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { RealtimeBridgeService, RealtimeToolDef } from './realtime-bridge.service';
import { FlowOrchestratorService } from '../ai/flow-orchestrator.service';
import { PrismaService } from '../../core/prisma/prisma.service';

const STREAM_PATH = '/api/v1/cortex/phone/stream';

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

  private async handleClient(ws: WebSocket, req: IncomingMessage) {
    const url = new URL(req.url ?? '', 'http://localhost');
    const businessId = url.searchParams.get('businessId') ?? '';
    const ctx: Partial<CallContext> = { businessId, transcript: [] };

    ws.on('message', async (raw: RawData) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw)) as Record<string, unknown>;
      } catch {
        return;
      }

      switch (msg.event) {
        case 'connected':
          this.logger.debug(`Twilio stream connected (call business: ${businessId})`);
          break;

        case 'start': {
          const start = msg.start as { streamSid: string; callSid: string };
          ctx.streamSid = start.streamSid;
          ctx.callSid = start.callSid;
          this.logger.log(`Call started: ${start.callSid} (business ${businessId})`);

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
                return this.executeVoiceTool(businessId, name, args, ctx as CallContext);
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
        const mapped = {
          contactName: args.contactName,
          startTime: args.start,
          notes: args.notes ?? `Phone booking via KEY receptionist${args.contactPhone ? ` (${args.contactPhone})` : ''}`,
        };
        return this.flow.executeToolByName(businessId, 'bookings_create_booking', mapped);
      }
      case 'helpdesk_create_ticket':
        return this.flow.executeToolByName(businessId, 'helpdesk_create_ticket', args);
      default:
        return { error: `Unknown tool ${name}` };
    }
  }

  private async persistTranscript(ctx: Partial<CallContext>) {
    if (!ctx.callSid || !ctx.transcript?.length) return;
    try {
      await (this.prisma.client as any).keyCallSession.updateMany({
        where: { callSid: ctx.callSid },
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
