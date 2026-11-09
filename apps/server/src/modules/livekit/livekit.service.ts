import { Inject, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AccessToken, AgentDispatchClient, RoomServiceClient, WebhookReceiver } from 'livekit-server-sdk';
import { PrismaService } from '../../core/prisma/prisma.service';
import { keyDisabled } from '../../core/config/env';
import { keyDisabledRefusal } from '../ai/model-gateway.service';

export const KEY_VOICE_AGENT_NAME = 'key-voice-agent';

/**
 * LiveKit integration: mints join tokens for in-app KEY voice sessions,
 * creates/dispatches rooms, and ingests server webhooks (signature-verified)
 * to keep VoiceSession history in sync. Concurrency is inherent — one room
 * per session, one agent dispatch per room.
 */
@Injectable()
export class LivekitService {
  private readonly logger = new Logger(LivekitService.name);
  /** The not-configured warning is logged once per process: the chat shell probes on every visit. */
  private unconfiguredLogged = false;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private get apiKey() { return process.env.LIVEKIT_API_KEY; }
  private get apiSecret() { return process.env.LIVEKIT_API_SECRET; }
  private get httpUrl() { return process.env.LIVEKIT_URL ?? 'http://localhost:7880'; }
  get wsUrl() { return process.env.LIVEKIT_WS_URL ?? 'ws://localhost:7880'; }

  isConfigured(): boolean {
    return !!(this.apiKey && this.apiSecret);
  }

  /**
   * PR196-VOICE (pr196-review OK-9A-1): an unconfigured LiveKit answers the
   * R0-07/R0-P structured 503, which the global filter renders as
   * { statusCode: 503, code: 'provider_not_configured', message, details: { service: 'voice' } }.
   * The web's providerUnavailableOf classifies it (and fetchWithRetry hands it
   * back without retrying), so the KEY chat shell hides its live voice control
   * when its rooms probe gets this answer. It used to be a plain-string 503
   * naming the server's env vars, rendered as code UNKNOWN_ERROR and toasted
   * verbatim. The env var names now go to the server log only.
   */
  private assertConfigured() {
    if (!this.isConfigured()) {
      if (!this.unconfiguredLogged) {
        this.unconfiguredLogged = true;
        this.logger.warn('LiveKit is not configured (LIVEKIT_API_KEY/LIVEKIT_API_SECRET missing): live KEY voice answers 503 provider_not_configured');
      }
      throw new ServiceUnavailableException({
        code: 'provider_not_configured',
        service: 'voice',
        message: 'Live voice is not set up on this server',
        error: 'Service Unavailable',
      });
    }
  }

  private roomClient(): RoomServiceClient {
    this.assertConfigured();
    return new RoomServiceClient(this.httpUrl, this.apiKey!, this.apiSecret!);
  }

  /**
   * Create a voice room for the business, dispatch the KEY voice agent into
   * it, mint a user join token, and record a VoiceSession for history.
   *
   * PR196-VOICE (pr196-review OK-9A-2): the room and the identity are derived
   * here, from the guarded business and the authenticated member, never from
   * the request. The route's body ({ identity?, roomName? }) is accepted for
   * compatibility and ignored: a client-chosen room name let a member join
   * another member's live call (or a guessed room of another tenant) with
   * publish/subscribe rights, and a client-chosen 'agent-*' identity posed as
   * KEY to the client. The room name carries a random UUID, so it cannot be
   * guessed, and the identity is user-<member id>, never agent-*.
   */
  async createVoiceSession(businessId: string, userId: string | undefined, _clientOpts: unknown = {}) {
    // V1-24b review (SEC-V124b-2): a KEY voice session dispatches the KEY voice
    // agent, which streams the member's audio to OpenAI Realtime with the
    // business blueprint in its instructions. With KEY switched off
    // (KEY_DISABLED) it is refused, read per call, before any room, agent
    // dispatch, join token or VoiceSession row: the gateway's KEY-disabled 503.
    if (keyDisabled()) throw keyDisabledRefusal();
    this.assertConfigured();
    if (!userId) throw new UnauthorizedException('A signed-in member is required to start a voice session');
    const roomName = `key-voice-${randomUUID()}`;
    const identity = `user-${userId}`;
    const metadata = JSON.stringify({ businessId, userId });

    await this.roomClient().createRoom({
      name: roomName,
      metadata,
      emptyTimeout: 300,
      maxParticipants: 10,
    });

    // Dispatch the KEY voice agent. Best-effort: if no worker is running the
    // room still works for human-to-human voice; the user is told the agent
    // is offline by the client when no agent track arrives.
    try {
      const dispatcher = new AgentDispatchClient(this.httpUrl, this.apiKey!, this.apiSecret!);
      await dispatcher.createDispatch(roomName, KEY_VOICE_AGENT_NAME, { metadata });
    } catch (err) {
      this.logger.warn(`Agent dispatch failed for ${roomName} (agent worker offline?): ${(err as Error).message}`);
    }

    const at = new AccessToken(this.apiKey!, this.apiSecret!, {
      identity,
      metadata: JSON.stringify({ businessId, role: 'user' }),
    });
    at.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: true });
    const token = await at.toJwt();

    const session = await this.prisma.client.voiceSession.create({
      data: {
        businessId,
        userId,
        mode: 'livekit_full_duplex',
        status: 'ACTIVE',
        commandItems: [{ roomName, identity, event: 'created', at: new Date().toISOString() }],
      },
    });

    this.logger.log(`Voice session ${session.id} → room ${roomName} (business ${businessId})`);
    return { token, wsUrl: this.wsUrl, roomName, sessionId: session.id };
  }

  /** Active rooms belonging to this business (metadata-tagged). */
  async listRooms(businessId: string) {
    const rooms = await this.roomClient().listRooms();
    return rooms
      .filter((r) => {
        try { return JSON.parse(r.metadata || '{}').businessId === businessId; } catch { return false; }
      })
      .map((r) => ({
        name: r.name,
        numParticipants: r.numParticipants,
        creationTime: Number(r.creationTime),
        metadata: r.metadata,
      }));
  }

  /** Participants of a room (used by the client to detect agent presence). */
  async listParticipants(businessId: string, roomName: string) {
    const rooms = await this.listRooms(businessId);
    if (!rooms.some((r) => r.name === roomName)) {
      throw new UnauthorizedException('Room does not belong to this business');
    }
    const participants = await this.roomClient().listParticipants(roomName);
    return participants.map((p) => ({ identity: p.identity, name: p.name, metadata: p.metadata, state: p.state, tracks: p.tracks?.length ?? 0 }));
  }

  /** End a session from the client (user hangs up). Idempotent. */
  async endVoiceSession(businessId: string, sessionId: string) {
    const session = await this.prisma.client.voiceSession.findFirst({
      where: { id: sessionId, businessId },
    });
    if (!session) return { ended: false };
    if (session.status !== 'ENDED') {
      await this.prisma.client.voiceSession.update({
        where: { id: session.id },
        data: { status: 'ENDED', endedAt: new Date() },
      });
    }
    return { ended: true };
  }

  /** Signature-verified webhook ingestion. Returns the handled event type. */
  async handleWebhook(rawBody: string, authHeader: string | undefined): Promise<string> {
    this.assertConfigured();
    const receiver = new WebhookReceiver(this.apiKey!, this.apiSecret!);
    let event;
    try {
      event = await receiver.receive(rawBody, authHeader ?? '');
    } catch (err) {
      throw new UnauthorizedException(`Invalid LiveKit webhook signature: ${(err as Error).message}`);
    }

    const roomName = event.room?.name;
    this.logger.log(`LiveKit webhook: ${event.event} room=${roomName ?? 'n/a'}`);
    if ((event.event === 'room_finished' || event.event === 'room_started') && roomName) {
      await this.syncRoomSession(roomName, event.event);
    }
    return event.event;
  }

  private async syncRoomSession(roomName: string, kind: string) {
    // commandItems is a JSON array; a contains-filter keeps this index-friendly enough at our scale.
    const sessions = await this.prisma.client.voiceSession.findMany({
      where: { mode: 'livekit_full_duplex', status: 'ACTIVE' },
      select: { id: true, commandItems: true },
    });
    const match = sessions.find((s) =>
      Array.isArray(s.commandItems) && (s.commandItems as Array<{ roomName?: string }>).some((i) => i?.roomName === roomName),
    );
    if (!match) return;
    if (kind === 'room_finished') {
      await this.prisma.client.voiceSession.update({
        where: { id: match.id },
        data: { status: 'ENDED', endedAt: new Date() },
      });
    }
  }
}
