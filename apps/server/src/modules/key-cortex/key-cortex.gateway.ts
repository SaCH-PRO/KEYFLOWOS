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
import { Logger } from '@nestjs/common';

// -- KEY Cortex Services --
import { KeyCortexReasoningService } from './key-cortex-reasoning.service';
import { KeyCortexApprovalService } from './key-cortex-approval.service';
import { KeyCortexEventService } from './key-cortex-event.service';
import { KeyCortexExecutorService } from './key-cortex-executor.service';
import { KeyCortexWsAuthService, isAllowedWsOrigin } from './key-cortex-ws-auth.service';

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

/** Metadata stored for each connected socket. */
interface ClientInfo {
  userId: string;
  businessId: string;
  rooms: string[];
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
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(KeyCortexGateway.name);

  /** Track connected clients: socketId → client metadata. */
  private clients = new Map<string, ClientInfo>();

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

      const info: ClientInfo = { userId: identity.userId, businessId, rooms: [] };
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

    // Broadcast to all other sockets in the business room
    client
      .to(`business:${clientInfo.businessId}`)
      .emit('key:typing', { userId: clientInfo.userId, timestamp: new Date().toISOString() });
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
