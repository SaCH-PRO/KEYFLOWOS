import { Inject, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { AccessToken, AgentDispatchClient, RoomServiceClient, WebhookReceiver } from 'livekit-server-sdk';
import { PrismaService } from '../../core/prisma/prisma.service';

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

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private get apiKey() { return process.env.LIVEKIT_API_KEY; }
  private get apiSecret() { return process.env.LIVEKIT_API_SECRET; }
  private get httpUrl() { return process.env.LIVEKIT_URL ?? 'http://localhost:7880'; }
  get wsUrl() { return process.env.LIVEKIT_WS_URL ?? 'ws://localhost:7880'; }

  isConfigured(): boolean {
    return !!(this.apiKey && this.apiSecret);
  }

  private assertConfigured() {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('LiveKit is not configured (LIVEKIT_API_KEY/LIVEKIT_API_SECRET missing)');
    }
  }

  private roomClient(): RoomServiceClient {
    this.assertConfigured();
    return new RoomServiceClient(this.httpUrl, this.apiKey!, this.apiSecret!);
  }

  /**
   * Create a voice room for the business, dispatch the KEY voice agent into
   * it, mint a user join token, and record a VoiceSession for history.
   */
  async createVoiceSession(businessId: string, userId: string | undefined, opts: { identity?: string; roomName?: string } = {}) {
    this.assertConfigured();
    const roomName = opts.roomName ?? `key-voice-${businessId.slice(0, 8)}-${Date.now().toString(36)}`;
    const identity = opts.identity ?? `user-${userId ?? 'anon'}-${Math.random().toString(36).slice(2, 6)}`;
    const metadata = JSON.stringify({ businessId, userId: userId ?? null });

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
        userId: userId ?? null,
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
