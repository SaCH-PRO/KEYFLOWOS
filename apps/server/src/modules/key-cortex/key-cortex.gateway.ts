/**
 * KEY Cortex WebSocket Gateway
 * Real-time bidirectional communication layer for KEY AI.
 *
 * Provides:
 *   - Live chat streaming (key:chat → key:stream)
 *   - Approval workflows (key:approve / key:reject)
 *   - Typing indicators (key:typing)
 *   - Server-push alerts, insights, suggestions & health updates
 *   - Room-scoped broadcasting (per business + per user)
 *
 * Namespace : /key-cortex
 * Protocol  : socket.io (via @nestjs/platform-socket.io)
 */

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, OnModuleDestroy } from '@nestjs/common';

// -- KEY Cortex Services --
import { KeyCortexReasoningService } from './key-cortex-reasoning.service';
import { KeyCortexApprovalService } from './key-cortex-approval.service';
import { KeyCortexEventService } from './key-cortex-event.service';
import { KeyCortexExecutorService } from './key-cortex-executor.service';
import { KeyCortexWsAuthService, isAllowedWsOrigin } from './key-cortex-ws-auth.service';

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

/**
 * LIVE REVOCATION (ST-WS-R1, R0-ID-F6b-WS-LIVE-REVOCATION and its review repair).
 *
 * The connect-time decision is not kept for the socket's lifetime. The gateway
 * re-takes it for an open socket — KeyCortexWsAuthService.authenticateSocket on
 * the socket's token, which is the HTTP AuthMiddleware decision (User row
 * present, not deleted, not banned; role from the row; the logout marker and
 * the admin-token cutoff), the same userId as at connect, then
 * verifyBusinessMembership for the socket's own businessId with that fresh
 * role — before every client action (key:chat, key:approve, key:reject,
 * key:typing) and, for a socket that sends nothing, on a schedule.
 *
 * Actions. A successful check is reused for {@link KEY_CORTEX_WS_REVALIDATE_MS},
 * measured from when it started (typing indicators fire many times a second).
 * Past that the action waits for a fresh check and is performed only when it
 * passes; anything else — a refusal, an error, or no answer within
 * {@link KEY_CORTEX_WS_CHECK_TIMEOUT_MS} — refuses that action (the client gets
 * key:error {@link KEY_CORTEX_WS_RECHECK_REFUSED}). Concurrent actions share one
 * in-flight check, and the timeout ends it, so a hung provider or database call
 * never holds a socket's later actions. So nothing is performed for a principal
 * more than KEY_CORTEX_WS_REVALIDATE_MS after a ban, a delete, a demotion below
 * the authority the socket connected with, a removal from the business or a
 * logout, as the next HTTP request is refused.
 *
 * Disconnecting (which ends the business:/user: room pushes). One refused check
 * cannot tell a revocation from a database, Redis or provider blip:
 * AuthMiddleware and SupabaseAuthService report both as "no user" and
 * verifyBusinessMembership both as false (review finding CR-1). So one refusal
 * refuses actions only; the socket is disconnected, after
 * {@link KEY_CORTEX_WS_AUTH_ERROR}, when a second check started at least
 * {@link KEY_CORTEX_WS_CONFIRM_MS} after the first refuses too. An error or a
 * timeout is no answer at all: it never confirms a refusal, and never clears
 * one. Whatever the answers, a socket with no successful check for
 * {@link KEY_CORTEX_WS_MAX_UNVERIFIED_MS} is disconnected (fail closed).
 *
 * The schedule. Every {@link KEY_CORTEX_WS_TICK_MS} one timer looks at every
 * open socket, with no I/O: it disconnects the ones past
 * KEY_CORTEX_WS_MAX_UNVERIFIED_MS and queues a check for each socket last
 * verified {@link KEY_CORTEX_WS_SWEEP_MS} ago, or whose refusal is due its
 * confirmation. At most {@link KEY_CORTEX_WS_SWEEP_CONCURRENCY} queued checks run
 * at once, each ended by the timeout, so no check, however slow, holds up the
 * others (review findings SEC-WS-1, CR-2: the sweep this replaces awaited one
 * socket after another with no timeout, and skipped every tick while one ran).
 *
 * The bounds, for a revocation written at time T. No action after
 * T + KEY_CORTEX_WS_REVALIDATE_MS. Disconnected by
 * T + KEY_CORTEX_WS_MAX_UNVERIFIED_MS + KEY_CORTEX_WS_TICK_MS (95s) whatever the
 * check latency, the number of sockets or a hung call: the last successful check
 * started before T. With checks answering, a socket that sends nothing goes
 * sooner — about KEY_CORTEX_WS_SWEEP_MS + KEY_CORTEX_WS_CONFIRM_MS + two ticks
 * (45s) plus queueing. An instance that cannot finish a check per socket per
 * KEY_CORTEX_WS_MAX_UNVERIFIED_MS (sustained: about
 * KEY_CORTEX_WS_SWEEP_CONCURRENCY x KEY_CORTEX_WS_SWEEP_MS / check latency
 * sockets) disconnects the sockets it could not re-verify rather than serve
 * them unchecked.
 *
 * Token lifetime (review finding CR-3). Re-checking the socket's token means a
 * socket lives no longer than that token, as an HTTP request with it would be
 * refused. A client keeps its socket past that by sending
 * {@link KEY_CORTEX_WS_AUTH_REFRESH} { token } with a fresh token before the old
 * one expires: the gateway takes the full connect decision for it (the same
 * user, membership of the socket's business) and, when it passes, re-checks
 * the socket with that token from then on and answers
 * {@link KEY_CORTEX_WS_AUTH_REFRESHED}. A refused refresh changes nothing.
 */
export const KEY_CORTEX_WS_REVALIDATE_MS = 2_000;
/** How long after its last successful check a socket that sends nothing is checked again. */
export const KEY_CORTEX_WS_SWEEP_MS = 30_000;
/** How often the gateway looks at every open socket (see The schedule, above). */
export const KEY_CORTEX_WS_TICK_MS = 5_000;
/** A check with no answer by then counts as no answer: it refuses the action it was for, and confirms nothing. */
export const KEY_CORTEX_WS_CHECK_TIMEOUT_MS = 5_000;
/** A refusal disconnects the socket only when a check started at least this long after it refuses too. */
export const KEY_CORTEX_WS_CONFIRM_MS = 5_000;
/** A socket with no successful check for this long is disconnected, whatever the reason. */
export const KEY_CORTEX_WS_MAX_UNVERIFIED_MS = 90_000;
/** How many scheduled checks run at once. */
export const KEY_CORTEX_WS_SWEEP_CONCURRENCY = 8;
/** Emitted, just before the disconnect, to a socket whose principal no longer passes the connect checks. */
export const KEY_CORTEX_WS_AUTH_ERROR = 'key:auth_error';
/** The key:error message for an action refused because the socket could not be re-verified just now. */
export const KEY_CORTEX_WS_RECHECK_REFUSED =
  'Not performed: this session could not be re-verified just now. Try again shortly.';
/** Client -> server: { token } — a fresh token for the socket's own user (see Token lifetime, above). */
export const KEY_CORTEX_WS_AUTH_REFRESH = 'key:auth_refresh';
/** Server -> client: the token sent with KEY_CORTEX_WS_AUTH_REFRESH now governs the socket. */
export const KEY_CORTEX_WS_AUTH_REFRESHED = 'key:auth_refreshed';

/** A re-check's answer: passed, refused, or no answer (an error or the timeout). */
type CheckOutcome = 'ok' | 'refused' | 'unavailable';

/** Metadata stored for each connected socket. */
interface ClientInfo {
  userId: string;
  businessId: string;
  rooms: string[];
  /** The socket itself, for the schedule. */
  socket: Socket;
  /** When (epoch ms) the last successful check started; the connect decision is the first. */
  verifiedAt: number;
  /** When the first refusal not yet confirmed or cleared started; undefined while there is none. */
  refusedAt?: number;
  /** The token sent with key:auth_refresh that passed; re-checks use it instead of the handshake token. */
  token?: string;
  /** The check in flight, shared by concurrent actions and the schedule. */
  check?: Promise<CheckOutcome>;
  /** Waiting in the schedule's queue. */
  queued?: boolean;
  /** A key:auth_refresh in flight. */
  refreshing?: boolean;
}

/** Payload emitted on key:alert. */
interface AlertPayload {
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical' | 'success';
  actionId?: string;
}

/** Payload emitted on key:approval. */
interface ApprovalPayload {
  approvalId: string;
  description: string;
  rationale: string;
}

/** Payload emitted on key:activity. */
interface ActivityPayload {
  type: string;
  description: string;
  timestamp: Date;
}

/** Payload emitted on key:insight. */
interface InsightPayload {
  title: string;
  description: string;
  confidence: number;
}

/** Single chunk in a streaming response (key:stream). */
interface StreamChunk {
  type: 'text' | 'action' | 'thought' | 'error' | 'tool_call' | 'tool_result';
  content: string;
  done?: boolean;
  metadata?: Record<string, unknown>;
}

/** Payload emitted on key:suggestion. */
interface SuggestionPayload {
  id: string;
  title: string;
  description: string;
  impact: string;
}

/** Payload emitted on key:health. */
interface HealthPayload {
  score: number;
  trends: unknown[];
  alerts: unknown[];
}

// ------------------------------------------------------------------
// Gateway
// ------------------------------------------------------------------

@WebSocketGateway({
  namespace: 'key-cortex',
  cors: {
    // Restrict to the centralized allow-list (same source as HTTP CORS).
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      callback(null, isAllowedWsOrigin(origin));
    },
    credentials: true,
  },
})
export class KeyCortexGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(KeyCortexGateway.name);

  /** Track connected clients: socketId → client metadata. */
  private clients = new Map<string, ClientInfo>();
  /** The schedule's timer (see LIVE REVOCATION at the top); started in afterInit. */
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  /** Sockets waiting for a scheduled check, oldest first. */
  private sweepQueue: ClientInfo[] = [];
  /** Scheduled checks running now (at most KEY_CORTEX_WS_SWEEP_CONCURRENCY). */
  private sweepRunning = 0;

  constructor(
    private readonly reasoningService: KeyCortexReasoningService,
    private readonly approvalService: KeyCortexApprovalService,
    private readonly eventService: KeyCortexEventService,
    private readonly executorService: KeyCortexExecutorService,
    private readonly wsAuth: KeyCortexWsAuthService,
  ) {}

  // ================================================================
  // Lifecycle
  // ================================================================

  afterInit(_server: Server) {
    this.logger.log('KEY Cortex WebSocket initialized on namespace /key-cortex');
    if (!this.sweepTimer) {
      this.sweepTimer = setInterval(() => this.tick(), KEY_CORTEX_WS_TICK_MS);
      this.sweepTimer.unref?.();
    }
  }

  onModuleDestroy() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    for (const info of this.sweepQueue) info.queued = false;
    this.sweepQueue = [];
  }

  /**
   * Authenticate & authorize on connect.
   *
   * SECURITY: identity (userId/role) is derived from the validated bearer token
   * supplied via `handshake.auth.token`, NOT from query parameters. The requested
   * `businessId` is verified against the user's membership before any room join.
   * A socket that fails authentication or authorization is disconnected and never
   * stored, so downstream message handlers (which require `clients.get(id)`) treat
   * it as unauthenticated. Reconnects re-run this handler with a fresh token.
   */
  async handleConnection(client: Socket) {
    const checkStartedAt = Date.now();
    try {
      const identity = await this.wsAuth.authenticateSocket(client);
      if (!identity) {
        this.logger.warn(`Connection rejected: authentication failed (socket ${client.id})`);
        client.disconnect(true);
        return;
      }

      // businessId names the requested tenant; it is verified below. It is NOT
      // an identity claim — userId always comes from the validated token.
      const businessId =
        (client.handshake.auth?.businessId as string | undefined) ||
        (client.handshake.query?.businessId as string | undefined);

      if (!businessId) {
        this.logger.warn(`Connection rejected: missing businessId (socket ${client.id})`);
        client.disconnect(true);
        return;
      }

      const authorized = await this.wsAuth.verifyBusinessMembership(
        identity.userId,
        identity.role,
        businessId,
      );
      if (!authorized) {
        this.logger.warn(
          `Connection rejected: user ${identity.userId} lacks access to business ${businessId} (socket ${client.id})`,
        );
        client.disconnect(true);
        return;
      }

      // The connect decision is the first successful check (LIVE REVOCATION above).
      const info: ClientInfo = {
        userId: identity.userId,
        businessId,
        rooms: [],
        socket: client,
        verifiedAt: checkStartedAt,
      };
      this.clients.set(client.id, info);

      // Join scoped rooms for targeted broadcasting (only after authorization)
      const businessRoom = `business:${businessId}`;
      const userRoom = `user:${identity.userId}`;
      client.join(businessRoom);
      client.join(userRoom);
      info.rooms.push(businessRoom, userRoom);

      // Emit welcome so the client knows it's ready
      client.emit('key:connected', {
        socketId: client.id,
        userId: identity.userId,
        businessId,
        timestamp: new Date().toISOString(),
      });

      this.logger.debug(
        `Client connected: ${client.id} (user:${identity.userId}, biz:${businessId})`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Connection error: ${message} (socket ${client.id})`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const info = this.clients.get(client.id);
    this.clients.delete(client.id);

    if (info) {
      this.logger.debug(
        `Client disconnected: ${client.id} (user:${info.userId}, biz:${info.businessId})`,
      );
    } else {
      this.logger.debug(`Client disconnected: ${client.id} (no metadata)`);
    }
  }

  // ================================================================
  // Client → Server messages
  // ================================================================

  /**
   * Chat message from the client.
   * Calls the reasoning engine and streams the response back
   * as a series of key:stream events.
   */
  @SubscribeMessage('key:chat')
  async handleChat(
    @MessageBody()
    data: {
      text: string;
      sessionId?: string;
      persona?: string;
      context?: Record<string, unknown>;
    },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const clientInfo = this.clients.get(client.id);
    if (!clientInfo) {
      client.emit('key:error', { message: 'Not authenticated' });
      return;
    }
    if (!(await this.stillAuthorized(clientInfo, true))) return;

    const { userId, businessId } = clientInfo;

    try {
      // Acknowledge receipt
      client.emit('key:status', { status: 'thinking', timestamp: new Date().toISOString() });

      // Emit "thinking" chunk so UI can show a spinner / "KEY is typing…"
      const thoughtChunk: StreamChunk = {
        type: 'thought',
        content: 'Analysing your request…',
      };
      this.streamResponse(userId, thoughtChunk);

      // Stream the reasoning response
      const stream = await this.reasoningService.streamReasoning({
        userId,
        businessId,
        message: data.text,
        sessionId: data.sessionId,
        persona: data.persona,
        context: data.context,
      });

      for await (const chunk of stream) {
        const payload: StreamChunk = {
          type: chunk.type as StreamChunk['type'],
          content: chunk.content,
          done: chunk.done ?? false,
          metadata: chunk.metadata,
        };
        this.streamResponse(userId, payload);
      }

      // Final done chunk
      this.streamResponse(userId, { type: 'text', content: '', done: true });

      // Log the interaction
      this.eventService.emit('key.chat.completed', {
        userId,
        businessId,
        message: data.text,
        timestamp: new Date(),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Chat handling error: ${message}`, (err as Error)?.stack);

      this.streamResponse(userId, {
        type: 'error',
        content: `KEY encountered an error: ${message}`,
        done: true,
      });
    }
  }

  /**
   * Client approves a pending action.
   * Triggers execution of the gated action via the approval service.
   */
  @SubscribeMessage('key:approve')
  async handleApprove(
    @MessageBody() data: { approvalId: string },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const clientInfo = this.clients.get(client.id);
    if (!clientInfo) {
      client.emit('key:error', { message: 'Not authenticated' });
      return;
    }
    if (!(await this.stillAuthorized(clientInfo, true))) return;

    try {
      client.emit('key:status', { status: 'approval_processing', approvalId: data.approvalId });

      // businessId comes from clientInfo — established at connect time and
      // verified against membership — NEVER from `data`, which the client
      // controls. approvalId is still client-supplied, which is exactly why the
      // service must prove it belongs to this business before deciding it.
      const result = await this.approvalService.approveAction(data.approvalId, {
        businessId: clientInfo.businessId,
        approvedBy: clientInfo.userId,
        approvedAt: new Date(),
      });

      // Notify all clients in the business that the action was approved
      this.pushActivity(clientInfo.businessId, {
        type: 'approval',
        description: `Action approved: ${result.actionDescription || data.approvalId}`,
        timestamp: new Date(),
      });

      // Execute the approved action
      await this.executorService.executeApprovedAction(clientInfo.businessId, data.approvalId);

      client.emit('key:approval_result', {
        approvalId: data.approvalId,
        status: 'approved',
        result,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Approval error: ${message}`, (err as Error)?.stack);
      client.emit('key:error', { message: `Approval failed: ${message}` });
    }
  }

  /**
   * Client rejects a pending action.
   */
  @SubscribeMessage('key:reject')
  async handleReject(
    @MessageBody() data: { approvalId: string; reason?: string },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const clientInfo = this.clients.get(client.id);
    if (!clientInfo) {
      client.emit('key:error', { message: 'Not authenticated' });
      return;
    }
    if (!(await this.stillAuthorized(clientInfo, true))) return;

    try {
      const result = await this.approvalService.rejectAction(data.approvalId, {
        businessId: clientInfo.businessId,
        rejectedBy: clientInfo.userId,
        rejectedAt: new Date(),
        reason: data.reason || 'User rejected',
      });

      this.pushActivity(clientInfo.businessId, {
        type: 'rejection',
        description: `Action rejected: ${result.actionDescription || data.approvalId}`,
        timestamp: new Date(),
      });

      client.emit('key:approval_result', {
        approvalId: data.approvalId,
        status: 'rejected',
        result,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Rejection error: ${message}`, (err as Error)?.stack);
      client.emit('key:error', { message: `Rejection failed: ${message}` });
    }
  }

  /**
   * Typing indicator from the client.
   * Broadcasts to all *other* clients in the same business room.
   */
  @SubscribeMessage('key:typing')
  async handleTyping(
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const clientInfo = this.clients.get(client.id);
    if (!clientInfo) return;
    if (!(await this.stillAuthorized(clientInfo, false))) return;

    // Broadcast to all other sockets in the business room
    client
      .to(`business:${clientInfo.businessId}`)
      .emit('key:typing', { userId: clientInfo.userId, timestamp: new Date().toISOString() });
  }

  /**
   * In-band token refresh (see Token lifetime under LIVE REVOCATION). The new
   * token gets the full connect decision — the same user as the socket's, its
   * role from the User row, membership of the socket's businessId — and only
   * when it passes do the socket's re-checks use it from then on. A refused
   * refresh changes nothing: the token already governing the socket still does.
   * One refresh at a time per socket.
   */
  @SubscribeMessage(KEY_CORTEX_WS_AUTH_REFRESH)
  async handleAuthRefresh(
    @MessageBody() data: { token?: unknown } | undefined,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const clientInfo = this.clients.get(client.id);
    if (!clientInfo) {
      client.emit('key:error', { message: 'Not authenticated' });
      return;
    }
    const token = typeof data?.token === 'string' ? data.token.trim() : '';
    if (!token) {
      client.emit('key:error', { message: 'Token refresh refused: no token' });
      return;
    }
    if (clientInfo.refreshing) {
      client.emit('key:error', { message: 'Token refresh refused: a refresh is already in progress' });
      return;
    }

    clientInfo.refreshing = true;
    const startedAt = Date.now();
    try {
      const outcome = await this.timedConnectChecks(clientInfo, token);
      if (this.clients.get(client.id) !== clientInfo) return; // disconnected meanwhile
      if (outcome !== 'ok') {
        client.emit('key:error', {
          message:
            outcome === 'refused'
              ? 'Token refresh refused: the token is not valid for this session'
              : 'Token refresh refused: it could not be verified just now. Try again shortly.',
        });
        return;
      }
      clientInfo.token = token;
      this.record(clientInfo, 'ok', startedAt);
      client.emit(KEY_CORTEX_WS_AUTH_REFRESHED, { timestamp: new Date().toISOString() });
    } finally {
      clientInfo.refreshing = false;
    }
  }

  // ================================================================
  // Server → Client push methods
  // ================================================================

  /**
   * Push an alert to every client connected to a business.
   */
  pushAlert(businessId: string, alert: AlertPayload): void {
    this.server.to(`business:${businessId}`).emit('key:alert', {
      ...alert,
      timestamp: new Date().toISOString(),
    });
    this.logger.debug(`Alert pushed to business:${businessId} — ${alert.title}`);
  }

  /**
   * Push an approval request to every client in a business.
   */
  pushApprovalRequest(businessId: string, request: ApprovalPayload): void {
    this.server.to(`business:${businessId}`).emit('key:approval', {
      ...request,
      requestedAt: new Date().toISOString(),
    });
    this.logger.debug(`Approval request pushed to business:${businessId} — ${request.approvalId}`);
  }

  /**
   * Push a general activity update to every client in a business.
   */
  pushActivity(businessId: string, activity: ActivityPayload): void {
    this.server.to(`business:${businessId}`).emit('key:activity', {
      ...activity,
      timestamp: activity.timestamp.toISOString(),
    });
  }

  /**
   * Push an AI-generated insight to every client in a business.
   */
  pushInsight(businessId: string, insight: InsightPayload): void {
    this.server.to(`business:${businessId}`).emit('key:insight', {
      ...insight,
      generatedAt: new Date().toISOString(),
    });
    this.logger.debug(`Insight pushed to business:${businessId} — ${insight.title}`);
  }

  /**
   * Stream a response chunk to a specific user.
   * Used for real-time AI response streaming.
   */
  streamResponse(userId: string, chunk: StreamChunk): void {
    this.server.to(`user:${userId}`).emit('key:stream', {
      ...chunk,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Push a proactive suggestion to every client in a business.
   */
  pushSuggestion(businessId: string, suggestion: SuggestionPayload): void {
    this.server.to(`business:${businessId}`).emit('key:suggestion', {
      ...suggestion,
      pushedAt: new Date().toISOString(),
    });
    this.logger.debug(`Suggestion pushed to business:${businessId} — ${suggestion.title}`);
  }

  /**
   * Push a business-health update to every client in a business.
   */
  pushHealthUpdate(businessId: string, health: HealthPayload): void {
    this.server.to(`business:${businessId}`).emit('key:health', {
      ...health,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Push a system-level notification to a specific user.
   */
  pushNotification(userId: string, notification: { title: string; body: string; data?: Record<string, unknown> }): void {
    this.server.to(`user:${userId}`).emit('key:notification', {
      ...notification,
      pushedAt: new Date().toISOString(),
    });
  }

  // ================================================================
  // Live revocation (ST-WS-R1; see LIVE REVOCATION at the top)
  // ================================================================

  /**
   * Whether the socket's principal still passes the connect checks, so the
   * caller may act. Within KEY_CORTEX_WS_REVALIDATE_MS of a successful check,
   * yes without asking. A refusal awaiting its confirmation refuses at once,
   * without a new query, until KEY_CORTEX_WS_CONFIRM_MS has passed. Otherwise the
   * (shared, timed) check decides. Every answer but 'ok' refuses the action;
   * `notify` sends the client KEY_CORTEX_WS_RECHECK_REFUSED unless the check
   * just disconnected it (which has already said why).
   */
  private async stillAuthorized(info: ClientInfo, notify: boolean): Promise<boolean> {
    const now = Date.now();
    let outcome: CheckOutcome;
    if (info.refusedAt === undefined && now < info.verifiedAt + KEY_CORTEX_WS_REVALIDATE_MS) {
      outcome = 'ok';
    } else if (info.refusedAt !== undefined && now < info.refusedAt + KEY_CORTEX_WS_CONFIRM_MS) {
      outcome = 'refused';
    } else {
      outcome = await this.revalidate(info);
    }
    const registered = this.clients.get(info.socket.id) === info;
    if (outcome === 'ok' && registered) return true;
    if (notify && registered) info.socket.emit('key:error', { message: KEY_CORTEX_WS_RECHECK_REFUSED });
    return false;
  }

  /**
   * One check of the socket, shared by every caller while it runs, and its
   * answer recorded (see record). A check of a token that key:auth_refresh has
   * replaced meanwhile decides nothing for the socket.
   */
  private revalidate(info: ClientInfo): Promise<CheckOutcome> {
    if (!info.check) {
      const startedAt = Date.now();
      const token = info.token;
      info.check = this.timedConnectChecks(info, token)
        .then((outcome) => {
          if (info.token === token) {
            try {
              this.record(info, outcome, startedAt);
            } catch (err: unknown) {
              this.logger.error(`Socket re-validation bookkeeping failed (socket ${info.socket.id}): ${(err as Error)?.message ?? err}`);
            }
          }
          return outcome;
        })
        .finally(() => {
          info.check = undefined;
        });
    }
    return info.check;
  }

  /**
   * What a check's answer does to the socket. 'ok' re-verifies it and clears a
   * pending refusal. A first 'refused' only marks it; one from a check started
   * KEY_CORTEX_WS_CONFIRM_MS or more after that disconnects it. 'unavailable'
   * changes nothing, except that a socket with no successful check for
   * KEY_CORTEX_WS_MAX_UNVERIFIED_MS is disconnected.
   */
  private record(info: ClientInfo, outcome: CheckOutcome, startedAt: number): void {
    if (this.clients.get(info.socket.id) !== info) return; // disconnected meanwhile
    if (outcome === 'ok') {
      info.verifiedAt = Math.max(info.verifiedAt, startedAt);
      info.refusedAt = undefined;
    } else if (outcome === 'refused') {
      if (info.refusedAt === undefined) info.refusedAt = startedAt;
      else if (startedAt >= info.refusedAt + KEY_CORTEX_WS_CONFIRM_MS) this.cut(info, 'refused');
    } else if (Date.now() - info.verifiedAt >= KEY_CORTEX_WS_MAX_UNVERIFIED_MS) {
      this.cut(info, 'unverified');
    }
  }

  /**
   * connectChecks with KEY_CORTEX_WS_CHECK_TIMEOUT_MS: a throw or no answer in
   * time is 'unavailable'. The abandoned call is left to settle on its own;
   * nothing waits for it.
   */
  private async timedConnectChecks(info: ClientInfo, token: string | undefined): Promise<CheckOutcome> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<CheckOutcome>((resolve) => {
      timer = setTimeout(() => {
        this.logger.warn(`Socket re-validation timed out after ${KEY_CORTEX_WS_CHECK_TIMEOUT_MS}ms (socket ${info.socket.id})`);
        resolve('unavailable');
      }, KEY_CORTEX_WS_CHECK_TIMEOUT_MS);
      timer.unref?.();
    });
    const checked = this.connectChecks(info, token).then(
      (ok): CheckOutcome => (ok ? 'ok' : 'refused'),
      (err: unknown): CheckOutcome => {
        this.logger.error(`Socket re-validation failed (socket ${info.socket.id}): ${(err as Error)?.message ?? err}`);
        return 'unavailable';
      },
    );
    try {
      return await Promise.race([checked, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * handleConnection's decision again: the socket's token (the handshake one
   * through authenticateSocket, or the one key:auth_refresh installed) with
   * identity and role from the User row, the same user as at connect, and
   * membership of the socket's own businessId with that role.
   */
  private async connectChecks(info: ClientInfo, token: string | undefined): Promise<boolean> {
    const identity =
      token === undefined
        ? await this.wsAuth.authenticateSocket(info.socket)
        : await this.wsAuth.authenticateToken(token);
    if (!identity || identity.userId !== info.userId) return false;
    return this.wsAuth.verifyBusinessMembership(identity.userId, identity.role, info.businessId);
  }

  /** Forget the socket's identity, tell it why, and disconnect it (which leaves its rooms). */
  private cut(info: ClientInfo, reason: 'refused' | 'unverified'): void {
    const client = info.socket;
    if (this.clients.get(client.id) !== info) return; // already cut, or gone (concurrent actions share one check)
    this.clients.delete(client.id);
    this.logger.warn(
      reason === 'refused'
        ? `Socket ${client.id} disconnected: user ${info.userId} no longer passes the connect checks for business ${info.businessId}`
        : `Socket ${client.id} disconnected: user ${info.userId} could not be re-verified for business ${info.businessId} within ${KEY_CORTEX_WS_MAX_UNVERIFIED_MS}ms`,
    );
    client.emit(KEY_CORTEX_WS_AUTH_ERROR, {
      reason,
      message:
        reason === 'refused'
          ? 'Not authenticated: this session is no longer authorized for this business. Reconnect with a valid token.'
          : 'Not authenticated: this session could not be re-verified. Reconnect with a valid token.',
    });
    client.disconnect(true);
  }

  /**
   * The schedule (see LIVE REVOCATION at the top): with no I/O, disconnect every
   * socket past KEY_CORTEX_WS_MAX_UNVERIFIED_MS and queue a check for every
   * socket that is due one; then start queued checks up to the concurrency cap.
   */
  private tick(): void {
    const now = Date.now();
    for (const info of [...this.clients.values()]) {
      try {
        if (now - info.verifiedAt >= KEY_CORTEX_WS_MAX_UNVERIFIED_MS) {
          this.cut(info, 'unverified');
          continue;
        }
        if (info.check || info.queued) continue;
        const due =
          info.refusedAt !== undefined
            ? info.refusedAt + KEY_CORTEX_WS_CONFIRM_MS
            : info.verifiedAt + KEY_CORTEX_WS_SWEEP_MS;
        if (now >= due) {
          info.queued = true;
          this.sweepQueue.push(info);
        }
      } catch (err: unknown) {
        this.logger.error(`Socket schedule error (socket ${info.socket.id}): ${(err as Error)?.message ?? err}`);
      }
    }
    this.drainSweep();
  }

  /** Start queued checks while fewer than KEY_CORTEX_WS_SWEEP_CONCURRENCY run; each one that ends starts the next. */
  private drainSweep(): void {
    while (this.sweepRunning < KEY_CORTEX_WS_SWEEP_CONCURRENCY && this.sweepQueue.length > 0) {
      const info = this.sweepQueue.shift() as ClientInfo;
      info.queued = false;
      if (this.clients.get(info.socket.id) !== info) continue; // disconnected while queued
      this.sweepRunning++;
      void this.revalidate(info).finally(() => {
        this.sweepRunning--;
        this.drainSweep();
      });
    }
  }

  // ================================================================
  // Helpers
  // ================================================================

  /** Return the number of connected clients for a given business. */
  getConnectedCount(businessId: string): number {
    let count = 0;
    this.clients.forEach((c) => {
      if (c.businessId === businessId) count++;
    });
    return count;
  }

  /** Return the total number of connected sockets. */
  getTotalConnections(): number {
    return this.clients.size;
  }

  /** Return socket IDs for a specific business (useful for debugging). */
  getClientsForBusiness(businessId: string): string[] {
    const ids: string[] = [];
    this.clients.forEach((c, socketId) => {
      if (c.businessId === businessId) ids.push(socketId);
    });
    return ids;
  }
}
