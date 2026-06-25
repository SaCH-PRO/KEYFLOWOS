import {
  Injectable,
  Logger,
  Inject,
  Optional,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';
import { KeyCortexMemoryService } from './key-cortex-memory.service';
import {
  CortexSession,
  CortexMessage,
  CortexSessionStatus,
  CortexPersona,
  CortexVoice,
  CortexMood,
} from './key-cortex.types';

/**
 * CreateSessionOpts -- Optional configuration when creating a new session.
 */
export interface CreateSessionOpts {
  /** AI personality persona for this session. */
  persona?: CortexPersona;
  /** Voice for TTS output. */
  voice?: CortexVoice;
  /** Override the detected mood. */
  mood?: CortexMood;
  /** Override the default AI provider. */
  preferredProvider?: string;
  /** Optional explicit session title. */
  title?: string;
}

/**
 * KeyCortexConversationService -- Conversation Manager for KEY Cortex.
 *
 * Manages the lifecycle of chat sessions: creation, message storage,
 * context-window optimization, context compression, auto-title generation,
 * and session cleanup.
 *
 * Storage strategy:
 * - Redis: Active sessions cached with TTL (24h) for fast access
 * - Prisma: Persistent storage for sessions and message history
 *
 * This service is the backbone of KEY Cortex's memory system,
 * ensuring conversations remain coherent, contextually relevant,
 * and performant even over long-running sessions.
 */
@Injectable()
export class KeyCortexConversationService {
  private readonly logger = new Logger(KeyCortexConversationService.name);

  /** Redis TTL for active sessions in seconds (default: 24h). */
  private readonly SESSION_TTL: number;

  /** Maximum tokens allowed in a context window (default: 8000). */
  private readonly MAX_CONTEXT_TOKENS: number;

  /** Rough estimate: tokens per character ratio. */
  private readonly TOKENS_PER_CHAR = 0.25;

  /** Maximum age in days before sessions are eligible for cleanup (default: 90). */
  private readonly MAX_SESSION_AGE_DAYS: number;

  /** Messages threshold before context compression kicks in (default: 40). */
  private readonly COMPRESSION_THRESHOLD = 40;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,

    // ── v4: Advanced Memory (optional — graceful degradation) ──
    @Optional()
    @Inject(KeyCortexMemoryService)
    private readonly memory?: KeyCortexMemoryService,
  ) {
    this.SESSION_TTL =
      parseInt(process.env.KEY_CORTEX_SESSION_TTL_HOURS ?? '24', 10) * 3600;
    this.MAX_CONTEXT_TOKENS = parseInt(
      process.env.KEY_CORTEX_MAX_CONTEXT_TOKENS ?? '8000',
      10,
    );
    this.MAX_SESSION_AGE_DAYS = parseInt(
      process.env.KEY_CORTEX_MAX_SESSION_AGE_DAYS ?? '90',
      10,
    );
  }

  // ---------------------------------------------------------------------------
  // 1. Session Creation
  // ---------------------------------------------------------------------------

  /**
   * Create a new chat session.
   *
   * @param businessId -- Tenant/business identifier
   * @param userId -- User who owns the session
   * @param opts -- Optional persona, voice, mood, provider, and title
   * @returns The newly created CortexSession
   */
  async createSession(
    businessId: string,
    userId: string,
    opts?: CreateSessionOpts,
  ): Promise<CortexSession> {
    this.logger.log(
      `[createSession] business=${businessId} user=${userId} persona=${opts?.persona ?? 'jarvis'}`,
    );

    try {
      const now = new Date();
      const sessionId = this.generateSessionId();

      const dbSession = await this.prisma.cortexSession.create({
        data: {
          id: sessionId,
          businessId,
          userId,
          status: 'active',
          persona: (opts?.persona ?? 'jarvis') as string,
          voice: (opts?.voice ?? 'echo') as string,
          mood: (opts?.mood ?? 'focused') as string,
          preferredProvider: (opts?.preferredProvider ?? 'openai') as string,
          title: opts?.title,
          messages: [],
          createdAt: now,
          updatedAt: now,
          lastAccessedAt: now,
        },
      });

      const session = this.mapDbToCortexSession(dbSession);

      // Cache in Redis for fast access
      await this.cacheSession(session);

      return session;
    } catch (error) {
      this.logger.error(
        `[createSession] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new BadRequestException(
        `Failed to create session: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Session Retrieval
  // ---------------------------------------------------------------------------

  /**
   * Get a session by ID, with full message history.
   *
   * Checks Redis cache first, then falls back to Prisma.
   * Updates the lastAccessedAt timestamp on successful retrieval.
   *
   * @param sessionId -- The unique session identifier
   * @returns The CortexSession or null if not found
   */
  async getSession(sessionId: string): Promise<CortexSession | null> {
    // Check Redis cache first
    const cached = await this.redis.get(`cortex:session:${sessionId}`);
    if (cached) {
      try {
        const session = JSON.parse(cached) as CortexSession;
        // Extend TTL on access
        await this.cacheSession(session);
        return session;
      } catch {
        // Cache corruption -- fall through to DB
        this.logger.warn(`[getSession] Cache corruption for session=${sessionId}`);
      }
    }

    // Fall back to Prisma
    const dbSession = await this.prisma.cortexSession.findUnique({
      where: { id: sessionId },
    });

    if (!dbSession) {
      return null;
    }

    const session = this.mapDbToCortexSession(dbSession);

    // Update last accessed and cache
    await this.prisma.cortexSession.update({
      where: { id: sessionId },
      data: { lastAccessedAt: new Date() },
    });
    await this.cacheSession(session);

    return session;
  }

  /**
   * v4: Get enriched session context with memory integration.
   * Loads the session and enriches it with context from the advanced memory service.
   */
  async getSessionContext(sessionId: string): Promise<CortexSession & { memoryContext?: string }> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new NotFoundException(`Session not found: ${sessionId}`);
    }

    // v4: Enrich with memory context if available
    if (this.memory) {
      try {
        const memories = await this.memory.retrieve({
          businessId: session.businessId,
          userId: session.userId,
          limit: 20,
        });
        (session as CortexSession & { memoryContext?: string }).memoryContext =
          this.memory.formatForPrompt(memories);
      } catch (err) {
        this.logger.warn(
          `[getSessionContext] Memory retrieval failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return session as CortexSession & { memoryContext?: string };
  }

  /**
   * Get a session or throw NotFoundException.
   */
  async getSessionOrThrow(sessionId: string): Promise<CortexSession> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new NotFoundException(`Session not found: ${sessionId}`);
    }
    return session;
  }

  // ---------------------------------------------------------------------------
  // 3. Message Management
  // ---------------------------------------------------------------------------

  /**
   * Add a message to a session.
   *
   * Persists the message to Prisma and updates the Redis cache.
   * Automatically triggers context compression if message count exceeds threshold.
   *
   * @param sessionId -- Target session ID
   * @param message -- Message data (role, content, metadata)
   * @returns The fully constructed CortexMessage with ID and timestamp
   */
  async addMessage(
    sessionId: string,
    message: Omit<CortexMessage, 'id' | 'timestamp'>,
  ): Promise<CortexMessage> {
    const session = await this.getSessionOrThrow(sessionId);

    const newMessage: CortexMessage = {
      ...message,
      id: this.generateMessageId(),
      timestamp: new Date(),
    };

    // Persist to Prisma
    const updatedMessages = [...session.messages, newMessage];

    await this.prisma.cortexSession.update({
      where: { id: sessionId },
      data: {
        messages: updatedMessages as unknown as Record<string, unknown>[],
        updatedAt: new Date(),
        lastAccessedAt: new Date(),
      },
    });

    // Update Redis cache
    const updatedSession = { ...session, messages: updatedMessages };
    await this.cacheSession(updatedSession);

    // v4: Store message in advanced memory service
    if (this.memory) {
      try {
        await this.memory.store(session.businessId, 'communication_style', `msg_${sessionId}`, message.content ?? '', {
          userId: session.userId,
          confidence: 0.9,
          source: 'conversation',
        });
      } catch (err) {
        this.logger.warn(
          `[addMessage] Memory store failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Trigger context compression if threshold exceeded
    if (updatedMessages.length >= this.COMPRESSION_THRESHOLD) {
      this.logger.debug(
        `[addMessage] Compression threshold reached (${updatedMessages.length} messages) for session=${sessionId}`,
      );
      // Fire-and-forget compression
      this.compressContext(updatedSession).catch((err) => {
        this.logger.warn(`[addMessage] Compression failed: ${err.message}`);
      });
    }

    return newMessage;
  }

  /**
   * Get recent messages from a session.
   *
   * @param sessionId -- Target session ID
   * @param limit -- Maximum number of messages to return (default: 50, max: 200)
   * @returns Array of CortexMessage, ordered by timestamp (oldest first)
   */
  async getMessages(
    sessionId: string,
    limit: number = 50,
  ): Promise<CortexMessage[]> {
    const session = await this.getSessionOrThrow(sessionId);

    const clampedLimit = Math.min(Math.max(limit, 1), 200);
    const messages = session.messages.slice(-clampedLimit);

    return messages;
  }

  // ---------------------------------------------------------------------------
  // 4. Session Listing
  // ---------------------------------------------------------------------------

  /**
   * List sessions for a business, optionally filtered by user.
   *
   * @param businessId -- Tenant/business identifier
   * @param userId -- Optional user filter
   * @param includeArchived -- Whether to include archived sessions (default: false)
   * @returns Array of CortexSession summaries (without full message history)
   */
  async listSessions(
    businessId: string,
    userId?: string,
    includeArchived: boolean = false,
  ): Promise<CortexSession[]> {
    const where: Record<string, unknown> = { businessId };

    if (userId) {
      where.userId = userId;
    }

    if (!includeArchived) {
      where.status = { not: 'archived' };
    }

    const dbSessions = await this.prisma.cortexSession.findMany({
      where,
      orderBy: { lastAccessedAt: 'desc' },
      take: 100,
    });

    return dbSessions.map((s) => this.mapDbToCortexSession(s));
  }

  // ---------------------------------------------------------------------------
  // 5. Session Updates
  // ---------------------------------------------------------------------------

  /**
   * Update session settings (persona, voice, mood, provider, title, status).
   *
   * @param sessionId -- Target session ID
   * @param updates -- Partial session fields to update
   * @returns Updated CortexSession
   */
  async updateSession(
    sessionId: string,
    updates: Partial<
      Pick<
        CortexSession,
        | 'persona'
        | 'voice'
        | 'mood'
        | 'preferredProvider'
        | 'title'
        | 'status'
      >
    >,
  ): Promise<CortexSession> {
    this.logger.log(
      `[updateSession] session=${sessionId} updates=${JSON.stringify(Object.keys(updates))}`,
    );

    const existing = await this.getSessionOrThrow(sessionId);

    // Validate status if provided
    if (updates.status) {
      const validStatuses: CortexSessionStatus[] = [
        'active',
        'paused',
        'archived',
      ];
      if (!validStatuses.includes(updates.status)) {
        throw new BadRequestException(
          `Invalid session status: ${updates.status}`,
        );
      }
    }

    // Build Prisma-compatible update data
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
      lastAccessedAt: new Date(),
    };

    if (updates.persona !== undefined) updateData.persona = updates.persona;
    if (updates.voice !== undefined) updateData.voice = updates.voice;
    if (updates.mood !== undefined) updateData.mood = updates.mood;
    if (updates.preferredProvider !== undefined)
      updateData.preferredProvider = updates.preferredProvider;
    if (updates.title !== undefined) updateData.title = updates.title;
    if (updates.status !== undefined) updateData.status = updates.status;

    const updated = await this.prisma.cortexSession.update({
      where: { id: sessionId },
      data: updateData,
    });

    const session = this.mapDbToCortexSession(updated);

    // Update cache
    await this.cacheSession(session);

    return session;
  }

  // ---------------------------------------------------------------------------
  // 6. Session Deletion (Soft Delete)
  // ---------------------------------------------------------------------------

  /**
   * Soft-delete a session by setting its status to 'archived'.
   *
   * The session data remains in the database for audit/history purposes
   * but will no longer appear in active listings.
   *
   * @param sessionId -- Target session ID
   */
  async deleteSession(sessionId: string): Promise<void> {
    this.logger.log(`[deleteSession] session=${sessionId}`);

    await this.getSessionOrThrow(sessionId);

    await this.prisma.cortexSession.update({
      where: { id: sessionId },
      data: {
        status: 'archived',
        updatedAt: new Date(),
      },
    });

    // Remove from Redis cache
    await this.redis.del(`cortex:session:${sessionId}`);
  }

  /**
   * Hard-delete a session and all its messages.
   *
   * Use with caution -- this permanently removes session data.
   *
   * @param sessionId -- Target session ID
   */
  async purgeSession(sessionId: string): Promise<void> {
    this.logger.log(`[purgeSession] session=${sessionId}`);

    await this.getSessionOrThrow(sessionId);

    await this.prisma.cortexSession.delete({
      where: { id: sessionId },
    });

    // Remove from Redis cache
    await this.redis.del(`cortex:session:${sessionId}`);
  }

  // ---------------------------------------------------------------------------
  // 7. Context Compression
  // ---------------------------------------------------------------------------

  /**
   * Compress a long conversation by summarizing older messages.
   *
   * When a session exceeds the compression threshold, this method
   * generates an AI summary of the oldest messages and replaces them
   * with a single "summary" message. This keeps the context window
   * manageable while preserving conversation coherence.
   *
   * @param session -- The CortexSession to compress
   * @returns A summary string of the compressed conversation
   */
  async compressContext(session: CortexSession): Promise<string> {
    this.logger.log(
      `[compressContext] session=${session.id} messages=${session.messages.length}`,
    );

    const messages = session.messages;
    if (messages.length < this.COMPRESSION_THRESHOLD) {
      return '';
    }

    // Split: keep the most recent 20 messages, summarize the rest
    const KEEP_RECENT = 20;
    const messagesToSummarize = messages.slice(0, -KEEP_RECENT);
    const recentMessages = messages.slice(-KEEP_RECENT);

    // Build summary text from older messages
    const conversationText = messagesToSummarize
      .map((m) => `${m.role}: ${m.content.slice(0, 300)}`)
      .join('\n\n');

    // Generate summary via AI (lightweight model)
    // Note: In production, this would call ModelGatewayService
    const summary = this.generateLocalSummary(conversationText);

    // Create summary message
    const summaryMessage: CortexMessage = {
      id: this.generateMessageId(),
      role: 'system',
      content: `[Conversation Summary] ${summary}`,
      timestamp: new Date(),
      metadata: {
        isSummary: true,
        originalMessageCount: messagesToSummarize.length,
      },
    };

    // Replace old messages with summary + recent messages
    const compressedMessages = [summaryMessage, ...recentMessages];

    // Persist compressed messages
    await this.prisma.cortexSession.update({
      where: { id: session.id },
      data: {
        messages: compressedMessages as unknown as Record<string, unknown>[],
        updatedAt: new Date(),
      },
    });

    // Update cache
    const updatedSession = { ...session, messages: compressedMessages };
    await this.cacheSession(updatedSession);

    this.logger.log(
      `[compressContext] Compressed ${messages.length} --> ${compressedMessages.length} messages for session=${session.id}`,
    );

    return summary;
  }

  // ---------------------------------------------------------------------------
  // 8. Auto Title Generation
  // ---------------------------------------------------------------------------

  /**
   * Auto-generate a session title from the first user message.
   *
   * Creates a concise, descriptive title (max 60 chars) that captures
   * the essence of the conversation's starting topic.
   *
   * @param firstMessage -- The first user message
   * @returns Generated title string
   */
  async generateTitle(firstMessage: string): Promise<string> {
    if (!firstMessage || firstMessage.trim().length === 0) {
      return 'New Conversation';
    }

    const trimmed = firstMessage.trim();

    // If the message is short enough, use it directly
    if (trimmed.length <= 50) {
      return trimmed;
    }

    // Extract key topic -- take first sentence or first 50 chars
    const firstSentence = trimmed.split(/[.!?]/, 1)[0].trim();
    if (firstSentence.length <= 60) {
      return firstSentence;
    }

    // Truncate with ellipsis
    return firstSentence.substring(0, 57) + '...';
  }

  // ---------------------------------------------------------------------------
  // 9. Context Window Optimization
  // ---------------------------------------------------------------------------

  /**
   * Optimize the context window by trimming messages to fit within maxTokens.
   *
   * This is critical for long-running sessions. The algorithm:
   * 1. Always keep the system prompt (if present)
   * 2. Always keep the most recent user query
   * 3. Keep as many recent messages as fit within the token budget
   * 4. Older messages are dropped (they may have been summarized already)
   *
   * @param messages -- Full message array
   * @param maxTokens -- Maximum tokens allowed (default: MAX_CONTEXT_TOKENS)
   * @returns Optimized message array that fits within token budget
   */
  optimizeContextWindow(
    messages: CortexMessage[],
    maxTokens?: number,
  ): CortexMessage[] {
    const budget = maxTokens ?? this.MAX_CONTEXT_TOKENS;

    if (messages.length === 0) {
      return [];
    }

    // Single-pass: count from the end, keep messages that fit
    let totalTokens = 0;
    const kept: CortexMessage[] = [];

    // Identify system messages (always keep at the start)
    const systemMessages = messages.filter((m) => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');

    // Calculate system message tokens
    for (const msg of systemMessages) {
      totalTokens += this.estimateTokens(msg.content);
    }

    // Work backwards from most recent non-system messages
    for (let i = nonSystemMessages.length - 1; i >= 0; i--) {
      const msg = nonSystemMessages[i];
      const msgTokens = this.estimateTokens(msg.content);

      if (totalTokens + msgTokens > budget) {
        // Budget exhausted -- stop
        break;
      }

      totalTokens += msgTokens;
      kept.unshift(msg);
    }

    // Result: system messages + kept recent messages
    const optimized = [...systemMessages, ...kept];

    this.logger.debug(
      `[optimizeContextWindow] ${messages.length} --> ${optimized.length} messages (${Math.round(totalTokens)} tokens)`,
    );

    return optimized;
  }

  // ---------------------------------------------------------------------------
  // 10. Session Cleanup
  // ---------------------------------------------------------------------------

  /**
   * Clean up old sessions that haven't been accessed in maxAgeDays.
   *
   * Archives sessions older than the threshold. Returns the count
   * of sessions affected.
   *
   * @param maxAgeDays -- Maximum age in days (default: MAX_SESSION_AGE_DAYS)
   * @returns Number of sessions archived
   */
  async cleanupOldSessions(maxAgeDays?: number): Promise<number> {
    const threshold = maxAgeDays ?? this.MAX_SESSION_AGE_DAYS;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - threshold);

    this.logger.log(
      `[cleanupOldSessions] Archiving sessions older than ${threshold} days (before ${cutoffDate.toISOString()})`,
    );

    const result = await this.prisma.cortexSession.updateMany({
      where: {
        lastAccessedAt: { lt: cutoffDate },
        status: { not: 'archived' },
      },
      data: {
        status: 'archived',
        updatedAt: new Date(),
      },
    });

    this.logger.log(
      `[cleanupOldSessions] Archived ${result.count} sessions`,
    );

    return result.count;
  }

  /**
   * Pause an active session.
   *
   * Paused sessions retain their data but won't be returned
   * in normal listings until resumed.
   *
   * @param sessionId -- Target session ID
   * @returns Updated CortexSession
   */
  async pauseSession(sessionId: string): Promise<CortexSession> {
    return this.updateSession(sessionId, { status: 'paused' });
  }

  /**
   * Resume a paused session.
   *
   * @param sessionId -- Target session ID
   * @returns Updated CortexSession
   */
  async resumeSession(sessionId: string): Promise<CortexSession> {
    return this.updateSession(sessionId, { status: 'active' });
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Map a Prisma CortexSession record to the domain CortexSession type.
   */
  private mapDbToCortexSession(
    dbSession: Record<string, unknown>,
  ): CortexSession {
    const messages = (dbSession.messages as unknown as CortexMessage[]) ?? [];

    return {
      id: dbSession.id as string,
      businessId: dbSession.businessId as string,
      userId: dbSession.userId as string,
      status: (dbSession.status as CortexSessionStatus) ?? 'active',
      persona: (dbSession.persona as CortexPersona) ?? 'jarvis',
      voice: (dbSession.voice as CortexVoice) ?? 'echo',
      mood: (dbSession.mood as CortexMood) ?? 'focused',
      preferredProvider:
        (dbSession.preferredProvider as string) ?? 'openai',
      messages,
      createdAt: new Date(dbSession.createdAt as string | Date),
      updatedAt: new Date(dbSession.updatedAt as string | Date),
      lastAccessedAt: new Date(dbSession.lastAccessedAt as string | Date),
      title: (dbSession.title as string) ?? undefined,
    };
  }

  /**
   * Cache a session in Redis with TTL.
   */
  private async cacheSession(session: CortexSession): Promise<void> {
    try {
      await this.redis.setex(
        `cortex:session:${session.id}`,
        this.SESSION_TTL,
        JSON.stringify(session),
      );
    } catch (error) {
      this.logger.warn(
        `[cacheSession] Failed to cache session=${session.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Estimate token count for a string.
   *
   * Uses a rough heuristic (1 token ~ 4 characters for English text).
   * For production, consider using a proper tokenizer (e.g., tiktoken).
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length * this.TOKENS_PER_CHAR);
  }

  /**
   * Generate a local summary of conversation text.
   *
   * Lightweight rule-based summarization used when AI summarization
   * is unavailable or for simple cases.
   */
  private generateLocalSummary(conversationText: string): string {
    const lines = conversationText.split('\n').filter((l) => l.trim());

    if (lines.length === 0) {
      return 'No prior conversation.';
    }

    // Extract key topics: count word frequency
    const wordFreq: Record<string, number> = {};
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
      'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
      'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above',
      'below', 'between', 'out', 'off', 'over', 'under', 'again', 'further',
      'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all',
      'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
      'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
      'and', 'but', 'if', 'or', 'because', 'until', 'while', 'i', 'me',
      'my', 'myself', 'we', 'our', 'you', 'your', 'he', 'him', 'his',
      'she', 'her', 'it', 'its', 'they', 'them', 'their', 'this', 'that',
      'these', 'those', 'am',
    ]);

    for (const line of lines) {
      const words = line
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !stopWords.has(w));

      for (const word of words) {
        wordFreq[word] = (wordFreq[word] ?? 0) + 1;
      }
    }

    // Top topics
    const topTopics = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);

    // Extract action items
    const actionLines = lines.filter(
      (l) =>
        l.toLowerCase().includes('task') ||
        l.toLowerCase().includes('action') ||
        l.toLowerCase().includes('create') ||
        l.toLowerCase().includes('schedule') ||
        l.toLowerCase().includes('remind'),
    );

    let summary = `Topics discussed: ${topTopics.join(', ')}. `;
    summary += `${lines.length} exchanges. `;

    if (actionLines.length > 0) {
      summary += `${actionLines.length} action items identified.`;
    }

    return summary;
  }

  /**
   * Generate a unique session identifier.
   */
  private generateSessionId(): string {
    return `csess_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Generate a unique message identifier.
   */
  private generateMessageId(): string {
    return `cmsg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}
