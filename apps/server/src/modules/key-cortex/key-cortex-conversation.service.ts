/**
 * KEY Cortex Conversation Service
 *
 * Manages conversation sessions, message history, and memory.
 * Every conversation feeds back into the genome as a memory event,
 * creating a closed learning loop.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  CortexSession,
  CortexMessage,
  CortexPersonality,
  CortexConfig,
  DEFAULT_CORTEX_CONFIG,
} from './key-cortex.types';

@Injectable()
export class KeyCortexConversationService {
  private readonly logger = new Logger(KeyCortexConversationService.name);
  private readonly activeSessions = new Map<string, CortexSession>();
  private readonly maxMessagesPerSession = 100;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Get or create a conversation session.
   */
  async getOrCreateSession(
    businessId: string,
    userId: string,
    sessionId?: string,
    personality?: CortexPersonality,
  ): Promise<CortexSession> {
    // Try active in-memory session
    if (sessionId && this.activeSessions.has(sessionId)) {
      const session = this.activeSessions.get(sessionId)!;
      session.lastActivityAt = new Date();
      return session;
    }

    // Try load from database
    if (sessionId) {
      const dbSession = await this.loadSessionFromDb(sessionId);
      if (dbSession) {
        this.activeSessions.set(sessionId, dbSession);
        return dbSession;
      }
    }

    // Create new session
    return this.createSession(businessId, userId, personality ?? 'JARVIS');
  }

  /**
   * Add a message to the session and persist it.
   */
  async addMessage(
    session: CortexSession,
    role: CortexMessage['role'],
    content: string,
    metadata?: CortexMessage['metadata'],
  ): Promise<CortexMessage> {
    const message: CortexMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      role,
      content,
      metadata,
      createdAt: new Date(),
    };

    session.messages.push(message);
    session.lastActivityAt = new Date();

    // Trim if too long
    if (session.messages.length > this.maxMessagesPerSession) {
      session.messages = session.messages.slice(-this.maxMessagesPerSession);
    }

    // Persist to database
    await this.persistMessage(session, message);

    // Emit event for downstream processing (genome memory, learning loop)
    this.events.emit('cortex.message', {
      businessId: session.businessId,
      sessionId: session.id,
      message,
    });

    return message;
  }

  /**
   * Get recent messages for context building.
   */
  getRecentMessages(session: CortexSession, limit = 10): CortexMessage[] {
    return session.messages.slice(-limit);
  }

  /**
   * Get the full message history.
   */
  getFullHistory(session: CortexSession): CortexMessage[] {
    return [...session.messages];
  }

  /**
   * Update session personality on the fly.
   */
  updatePersonality(session: CortexSession, personality: CortexPersonality): void {
    session.personality = personality;
    this.logger.log(`Session ${session.id} personality switched to ${personality}`);
  }

  /**
   * End a session and archive it.
   */
  async endSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    session.isActive = false;
    await this.archiveSession(session);
    this.activeSessions.delete(sessionId);

    this.logger.log(`Session ${sessionId} ended and archived`);
  }

  /**
   * Clean up stale sessions (called by cron).
   */
  async cleanupStaleSessions(maxInactiveMinutes = 30): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, session] of this.activeSessions) {
      const inactiveMs = now - session.lastActivityAt.getTime();
      if (inactiveMs > maxInactiveMinutes * 60 * 1000) {
        await this.archiveSession(session);
        this.activeSessions.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.log(`Cleaned up ${cleaned} stale cortex sessions`);
    }

    return cleaned;
  }

  /**
   * Get session statistics for health monitoring.
   */
  getStats(): { activeSessions: number; totalMessages: number } {
    let totalMessages = 0;
    for (const session of this.activeSessions.values()) {
      totalMessages += session.messages.length;
    }
    return {
      activeSessions: this.activeSessions.size,
      totalMessages,
    };
  }

  // ── Private ──

  private async createSession(
    businessId: string,
    userId: string,
    personality: CortexPersonality,
  ): Promise<CortexSession> {
    const session: CortexSession = {
      id: `cortex_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      businessId,
      userId,
      personality,
      messages: [],
      contextSnapshot: null,
      isActive: true,
      lastActivityAt: new Date(),
      createdAt: new Date(),
    };

    // Persist to database
    await this.prisma.client.genomeChatMessage.create({
      data: {
        businessId,
        role: 'system',
        content: `KEY Cortex session started. Personality: ${personality}`,
        metadata: { cortexSessionId: session.id, personality, source: 'cortex' },
      },
    });

    this.activeSessions.set(session.id, session);
    this.logger.log(`Created cortex session ${session.id} for business ${businessId}`);

    return session;
  }

  private async loadSessionFromDb(sessionId: string): Promise<CortexSession | null> {
    const messages = await this.prisma.client.genomeChatMessage.findMany({
      where: {
        metadata: { path: ['cortexSessionId'], equals: sessionId },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });

    if (messages.length === 0) return null;

    const firstMsg = messages[0];
    const meta = firstMsg.metadata as Record<string, unknown> | null;
    const personality = (meta?.personality as CortexPersonality) ?? 'JARVIS';

    return {
      id: sessionId,
      businessId: firstMsg.businessId,
      userId: 'unknown',
      personality,
      messages: messages.map(m => ({
        id: m.id,
        role: m.role as CortexMessage['role'],
        content: m.content,
        metadata: (m.metadata as Record<string, unknown>) ?? undefined,
        createdAt: m.createdAt,
      })),
      contextSnapshot: null,
      isActive: true,
      lastActivityAt: messages[messages.length - 1]?.createdAt ?? new Date(),
      createdAt: firstMsg.createdAt,
    };
  }

  private async persistMessage(session: CortexSession, message: CortexMessage): Promise<void> {
    try {
      await this.prisma.client.genomeChatMessage.create({
        data: {
          businessId: session.businessId,
          role: message.role,
          content: message.content,
          metadata: {
            ...message.metadata,
            cortexSessionId: session.id,
            personality: session.personality,
          },
        },
      });
    } catch (err) {
      this.logger.error(`Failed to persist message: ${(err as Error).message}`);
    }
  }

  private async archiveSession(session: CortexSession): Promise<void> {
    // In a production system, you might move this to an archive table
    // For now, the messages are already persisted via genomeChatMessage
    this.events.emit('cortex.session.ended', {
      businessId: session.businessId,
      sessionId: session.id,
      messageCount: session.messages.length,
      durationMs: Date.now() - session.createdAt.getTime(),
    });
  }
}
