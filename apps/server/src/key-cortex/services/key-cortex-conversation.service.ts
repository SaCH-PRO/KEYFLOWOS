import { Injectable, Logger } from '@nestjs/common';

/**
 * =============================================================================
 * KeyCortexConversation — Session Management
 * =============================================================================
 * Manages conversation sessions between users and KEY's consciousness system.
 * Maintains conversation history, context windows, and session metadata.
 *
 * Features:
 *   - Session creation and lifecycle management
 *   - Context window management (sliding window with summarisation)
 *   - Conversation history retrieval
 *   - Session expiry and cleanup
 * =============================================================================
 */

export interface ConversationSession {
  sessionId: string;
  userId: string;
  businessId: string;
  createdAt: Date;
  lastActivityAt: Date;
  messages: ConversationMessage[];
  summary: string;
  metadata: Record<string, unknown>;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  emotion?: string;
  confidence?: number;
}

interface CreateSessionInput {
  userId: string;
  businessId: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class KeyCortexConversation {
  private readonly logger = new Logger(KeyCortexConversation.name);

  /** In-memory session store — production: Redis / database. */
  private sessions = new Map<string, ConversationSession>();

  /** Maximum messages before context window summarisation. */
  private readonly MAX_CONTEXT_MESSAGES = 20;

  /** Session TTL in milliseconds (30 minutes). */
  private readonly SESSION_TTL_MS = 30 * 60 * 1000;

  /** Create a new conversation session. */
  async createSession(input: CreateSessionInput): Promise<ConversationSession> {
    try {
      const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const now = new Date();

      const session: ConversationSession = {
        sessionId,
        userId: input.userId,
        businessId: input.businessId,
        createdAt: now,
        lastActivityAt: now,
        messages: [],
        summary: '',
        metadata: input.metadata ?? {},
      };

      this.sessions.set(sessionId, session);
      this.logger.log(`Session created: ${sessionId} for user=${input.userId}`);

      return { ...session };
    } catch (err) {
      this.logger.error(`Session creation failed: ${(err as Error).message}`);
      throw err;
    }
  }

  /** Add a message to an existing session. */
  async addMessage(
    sessionId: string,
    role: ConversationMessage['role'],
    content: string,
    emotion?: string,
    confidence?: number,
  ): Promise<ConversationMessage> {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      const message: ConversationMessage = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        role,
        content,
        timestamp: new Date(),
        emotion,
        confidence,
      };

      session.messages.push(message);
      session.lastActivityAt = new Date();

      // Manage context window
      if (session.messages.length > this.MAX_CONTEXT_MESSAGES) {
        await this.summariseContext(sessionId);
      }

      this.logger.verbose(`Message added to ${sessionId}: ${role}, ${content.length} chars`);
      return message;
    } catch (err) {
      this.logger.warn(`Add message failed: ${(err as Error).message}`);
      throw err;
    }
  }

  /** Get conversation history for a session. */
  async getHistory(sessionId: string, limit = 20): Promise<ConversationMessage[]> {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        this.logger.warn(`History requested for unknown session: ${sessionId}`);
        return [];
      }

      return session.messages.slice(-limit).map(m => ({ ...m }));
    } catch (err) {
      this.logger.warn(`Get history failed: ${(err as Error).message}`);
      return [];
    }
  }

  /** Get a session by ID. */
  async getSession(sessionId: string): Promise<ConversationSession | null> {
    const session = this.sessions.get(sessionId);
    return session ? { ...session, messages: session.messages.map(m => ({ ...m })) } : null;
  }

  /** Summarise older messages to compress context window. */
  private async summariseContext(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.messages.length <= this.MAX_CONTEXT_MESSAGES) return;

    // Keep the most recent 10 messages, summarise the rest
    const toSummarise = session.messages.slice(0, -10);
    const summary = this.generateSummary(toSummarise);

    session.summary = summary;
    session.messages = session.messages.slice(-10);

    this.logger.verbose(`Context summarised for ${sessionId}: ${toSummarise.length} → summary + ${session.messages.length} messages`);
  }

  /** Generate a simple summary of message history. */
  private generateSummary(messages: ConversationMessage[]): string {
    const userTopics = messages
      .filter(m => m.role === 'user')
      .map(m => m.content.substring(0, 60));

    const assistantTopics = messages
      .filter(m => m.role === 'assistant')
      .map(m => m.content.substring(0, 60));

    return `Summary of ${messages.length} messages. ` +
      `User discussed: ${userTopics.slice(0, 3).join('; ')}. ` +
      `Assistant covered: ${assistantTopics.slice(0, 3).join('; ')}.`;
  }

  /** Clean up expired sessions. */
  async cleanupExpiredSessions(): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastActivityAt.getTime() > this.SESSION_TTL_MS) {
        this.sessions.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.verbose(`Cleaned up ${cleaned} expired sessions`);
    }

    return cleaned;
  }

  /** List active sessions (with optional filtering). */
  async listSessions(filter?: { userId?: string; businessId?: string }): Promise<ConversationSession[]> {
    const sessions = Array.from(this.sessions.values());

    if (filter?.userId) {
      return sessions.filter(s => s.userId === filter.userId).map(s => ({ ...s }));
    }
    if (filter?.businessId) {
      return sessions.filter(s => s.businessId === filter.businessId).map(s => ({ ...s }));
    }

    return sessions.map(s => ({ ...s }));
  }
}
