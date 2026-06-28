import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';
import {
  CortexQuery,
  CortexSession,
  CortexMessage,
} from './key-cortex.types';

/**
 * KeyCortexSessionService
 *
 * Manages Cortex session lifecycle: get/create, save messages, update cognition
 * metadata, and maintain a running conversation summary.
 */
@Injectable()
export class KeyCortexSessionService {
  private readonly logger = new Logger(KeyCortexSessionService.name);
  private readonly SESSION_TTL: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
    this.SESSION_TTL =
      parseInt(process.env.KEY_CORTEX_SESSION_TTL_HOURS ?? '24', 10) * 3600;
  }

  /**
   * Get an existing session from cache/DB or create a new one.
   */
  async getOrCreateSession(query: CortexQuery): Promise<CortexSession> {
    if (query.sessionId) {
      const cached = await this.redis.get(
        `cortex:session:${query.sessionId}`,
      );
      if (cached) {
        const session = JSON.parse(cached);
        await (this.redis as any).setex(
          `cortex:session:${query.sessionId}`,
          this.SESSION_TTL,
          cached,
        );
        return session as CortexSession;
      }

      const dbSession = await (this.prisma.client as any).cortexSession.findUnique(
        {
          where: { id: query.sessionId },
        },
      );
      if (dbSession) {
        await (this.redis as any).setex(
          `cortex:session:${query.sessionId}`,
          this.SESSION_TTL,
          JSON.stringify(dbSession),
        );
        return dbSession as unknown as CortexSession;
      }
    }

    const newSession = await (this.prisma.client as any).cortexSession.create({
      data: {
        id: this.generateId(),
        businessId: query.businessId,
        userId: query.userId,
        persona: (query.persona ?? 'jarvis') as string,
        voice: (query.voice ?? 'echo') as string,
        mood: (query.mood ?? 'focused') as string,
        preferredProvider: (query.provider ?? 'openai') as string,
        status: 'active',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        lastAccessedAt: new Date(),
      },
    });

    await (this.redis as any).setex(
      `cortex:session:${newSession.id}`,
      this.SESSION_TTL,
      JSON.stringify(newSession),
    );

    this.logger.log(
      `[getOrCreateSession] Created new session=${newSession.id}`,
    );

    return newSession as unknown as CortexSession;
  }

  /**
   * Persist a message to the session (DB + Redis cache).
   */
  async saveMessage(
    sessionId: string,
    message: Omit<CortexMessage, 'id'> & { id?: string },
  ): Promise<void> {
    const session = await (this.prisma.client as any).cortexSession.findUnique({
      where: { id: sessionId },
      select: { messages: true },
    });

    if (session) {
      const messages = (session.messages as unknown as CortexMessage[]) ?? [];
      messages.push(message as CortexMessage);

      await (this.prisma.client as any).cortexSession.update({
        where: { id: sessionId },
        data: {
          messages: messages as unknown as Record<string, unknown>[],
          updatedAt: new Date(),
          lastAccessedAt: new Date(),
        },
      });
    }

    const cached = await this.redis.get(`cortex:session:${sessionId}`);
    if (cached) {
      const parsed = JSON.parse(cached);
      parsed.messages = parsed.messages ?? [];
      parsed.messages.push(message);
      parsed.lastAccessedAt = new Date().toISOString();
      await (this.redis as any).setex(
        `cortex:session:${sessionId}`,
        this.SESSION_TTL,
        JSON.stringify(parsed),
      );
    }
  }

  /**
   * Update the CortexSession row with cognition metadata.
   */
  async updateSessionCognitionMetadata(
    sessionId: string,
    metadata: {
      detectedRole?: string;
      detectedFunction?: string;
      layersUsed?: string[];
      llmCallsMade?: number;
      responseTimeMs?: number;
    },
  ): Promise<void> {
    try {
      await (this.prisma.client as any).cortexSession.update({
        where: { id: sessionId },
        data: {
          ...metadata,
          updatedAt: new Date(),
          lastAccessedAt: new Date(),
        },
      });

      const cached = await this.redis.get(`cortex:session:${sessionId}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        Object.assign(parsed, metadata);
        parsed.updatedAt = new Date().toISOString();
        parsed.lastAccessedAt = new Date().toISOString();
        await (this.redis as any).setex(
          `cortex:session:${sessionId}`,
          this.SESSION_TTL,
          JSON.stringify(parsed),
        );
      }
    } catch (err: any) {
      this.logger.warn(
        `Failed to update session cognition metadata: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Update the per-session running conversation summary after a turn.
   */
  async updateRunningSummary(
    sessionId: string,
    userText: string,
    assistantText: string,
  ): Promise<void> {
    try {
      const existing = await (this.prisma.client as any).cortexSession.findUnique(
        {
          where: { id: sessionId },
          select: { runningSummary: true },
        },
      );

      const currentSummary = (existing?.runningSummary as string) ?? '';
      const updatedSummary = this.generateRunningSummary(
        currentSummary,
        userText,
        assistantText,
      );

      await (this.prisma.client as any).cortexSession.update({
        where: { id: sessionId },
        data: {
          runningSummary: updatedSummary,
          updatedAt: new Date(),
        },
      });

      const cached = await this.redis.get(`cortex:session:${sessionId}`);
      if (cached) {
        try {
          const session = JSON.parse(cached);
          session.runningSummary = updatedSummary;
          await (this.redis as any).setex(
            `cortex:session:${sessionId}`,
            this.SESSION_TTL,
            JSON.stringify(session),
          );
        } catch {
          // Ignore cache update failures
        }
      }
    } catch (err: any) {
      this.logger.warn(
        `[updateRunningSummary] Failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Lightweight rule-based running summary generator.
   */
  generateRunningSummary(
    existingSummary: string,
    userText: string,
    assistantText: string,
  ): string {
    const topic = this.extractTopic(userText);
    const userIntent = this.extractIntent(userText);
    const actionItems = this.extractActionItems(assistantText);

    const parts: string[] = [];
    if (existingSummary) {
      parts.push(existingSummary.slice(0, 400));
    }
    parts.push(`Latest turn: ${userIntent}`);
    if (topic) parts.push(`Topic: ${topic}`);
    if (actionItems.length > 0) {
      parts.push(`Actions: ${actionItems.join('; ')}`);
    }

    const summary = parts.join(' | ');
    return summary.length > 800 ? `...${summary.slice(-800)}` : summary;
  }

  extractTopic(text: string): string {
    const match = text.match(
      /\b(revenue|profit|margin|sales|marketing|product|team|project|client|customer|invoice|task|campaign|strategy|budget|forecast|report)\b/i,
    );
    return match ? match[0].toLowerCase() : '';
  }

  extractIntent(text: string): string {
    const lower = text.toLowerCase();
    if (/\b(how|what|why|when|who|where)\b/.test(lower))
      return `question about "${text.slice(0, 60)}"`;
    if (
      /\b(create|make|schedule|send|update|delete|run|execute|build|generate|draft)\b/.test(
        lower,
      )
    )
      return `request to "${text.slice(0, 60)}"`;
    if (
      /\b(analyze|evaluate|assess|compare|recommend|suggest|advise)\b/.test(
        lower,
      )
    )
      return `analysis request: "${text.slice(0, 60)}"`;
    return `message: "${text.slice(0, 60)}"`;
  }

  extractActionItems(text: string): string[] {
    const items: string[] = [];
    const sentences = text.split(/[.!?\n]+/);
    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();
      if (
        /\b(next step|action item|todo|task|follow up|schedule|create|send|update|reminder)\b/.test(
          lower,
        )
      ) {
        const cleaned = sentence.trim().slice(0, 120);
        if (cleaned) items.push(cleaned);
      }
    }
    return items.slice(0, 3);
  }

  generateId(): string {
    return `crtx_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}
