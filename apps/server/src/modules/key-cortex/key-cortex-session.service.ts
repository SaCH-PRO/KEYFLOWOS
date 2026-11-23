import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';
import { classifyActionIntent } from './action-intent';
import {
  CortexQuery,
  CortexSession,
  CortexMessage,
} from './key-cortex.types';

// ---------------------------------------------------------------------------
// SESSION OWNERSHIP — one rule for every surface that takes a client's KEY
// session id (moved here from KeyCortexController by W11-KEY-CHAT-SESSION-BIND,
// review SEC-W11MC-1, so the HTTP routes and the WS key:chat handler apply the
// same rule; before, key:chat applied none).
//
// Review ST-1, and R0-09c review ST-1..ST-4: KeyCortexConversationService.getSession
// and KeyCortexSessionService.getOrCreateSession read the Redis entry
// `cortex:session:<id>` before the database and check no tenant there; the
// Prisma tenant extension scopes only the database fallback, and on a socket
// (no request, so no tenant context) not even that. So a member of A naming B's
// session id, once B's own traffic had cached it, read B's messages and ran
// chat, the streams and the conscious pipeline on B's session (appending A's
// turns to B's cached session). Within one tenant the services check no owner
// either, so a STAFF member naming the OWNER's session id read the OWNER's
// conversation (GET sessions/:id, GET messages), renamed or archived it (PATCH,
// DELETE), ran the reasoning engine and the conscious pipeline on it (the
// pipeline then acted for session.userId, the OWNER) and rewrote the OWNER's
// feedback on it; and over the WS key:chat handler the session's running
// summary and its last 10 messages reached the member's prompt (SEC-W11MC-1).
//
// A session is its creator's: POST sessions and the session services create it
// for the authenticated actor (R0-09c), and GET sessions lists only the actor's
// own. So a session id names one of the actor's own sessions in the tenant the
// guard (or the socket's connect decision) checked, or it names nothing the
// actor may use; there is no cross-member read, SUPER_ADMIN included. Sessions
// never change tenant or owner, so an id found to be the actor's stays theirs.
// ---------------------------------------------------------------------------

/** What the session ownership rule reads of a session: its tenant and its member. */
export interface SessionOwnerFields {
  businessId?: string | null;
  userId?: string | null;
}

/**
 * The rule: `own` when `session` is `actorId`'s in `businessId`, `none` when no
 * session was found, `foreign` for another tenant's or another member's.
 */
export function sessionOwnership(
  session: SessionOwnerFields | null | undefined,
  businessId: string,
  actorId: string,
): 'own' | 'none' | 'foreign' {
  if (!session) return 'none';
  return session.businessId === businessId && session.userId === actorId ? 'own' : 'foreign';
}

/**
 * The HTTP routes' answer (KeyCortexController.ownSession): the session when it
 * is the actor's own, null when none was found, and another tenant's or another
 * member's refused as not found, like an unknown id on the routes that read one
 * (an `error` event once an SSE stream is committed).
 */
export function ownedSession<S extends SessionOwnerFields>(
  session: S | null | undefined,
  businessId: string,
  actorId: string,
): S | null {
  const ownership = sessionOwnership(session, businessId, actorId);
  if (ownership === 'foreign') {
    throw new NotFoundException('Session not found');
  }
  return ownership === 'own' ? (session as S) : null;
}

/**
 * The session id a route may hand the session services (chat, the streams, the
 * conscious pipeline; KeyCortexController.ownSessionId): one of the actor's own
 * sessions in this tenant (`ownedSession`, read by `read`), or `undefined` when
 * no session has that id, so the services start a new session for the actor
 * under `businessId` exactly as they did for an unknown id; the caller's id
 * never reaches their cache read, so a session cached after this check cannot
 * be picked up. Another tenant's or member's is refused (`ownedSession`).
 */
export async function resolveOwnSessionId(
  read: (sessionId: string) => Promise<SessionOwnerFields | null>,
  businessId: string,
  actorId: string,
  sessionId: string | undefined,
): Promise<string | undefined> {
  if (!sessionId) return undefined;
  return ownedSession(await read(sessionId), businessId, actorId) ? sessionId : undefined;
}

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
   * The session `sessionId` as getOrCreateSession reads it: the Redis entry
   * `cortex:session:<id>` first, then the database row (which the Prisma tenant
   * extension scopes only inside a tenant context), or null when neither holds
   * it. A read only: no TTL is extended and nothing is cached. A cache entry
   * that does not parse falls through to the database.
   */
  async findSession(sessionId: string): Promise<CortexSession | null> {
    const cached = await this.redis.get(`cortex:session:${sessionId}`);
    if (cached) {
      try {
        return JSON.parse(cached) as CortexSession;
      } catch {
        this.logger.warn(`[findSession] Cache corruption for session=${sessionId}`);
      }
    }
    const dbSession = await this.prisma.client.cortexSession.findUnique({
      where: { id: sessionId },
    });
    return (dbSession as unknown as CortexSession | null) ?? null;
  }

  /**
   * W11-KEY-CHAT-SESSION-BIND (review SEC-W11MC-1): the session id a socket's
   * key:chat turn runs on, decided before anything reads a session. The
   * client's `sessionId` when it names one of `actorId`'s own sessions in
   * `businessId` (the socket's business, checked at connect and on every
   * action), by `sessionOwnership`, read as getOrCreateSession reads
   * (`findSession`); otherwise `undefined`, so the turn starts a new session
   * for the actor in `businessId`. Another member's session, another
   * business's, an id that names no session and a value that is no string at
   * all are answered alike: unlike the HTTP routes (`ownedSession`, which
   * answer another tenant's or member's id with 404 and start a new session for
   * an unknown one), nothing the socket receives tells a foreign id from one
   * that names nothing.
   */
  async chatSessionId(businessId: string, actorId: string, sessionId: unknown): Promise<string | undefined> {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined;
    const session = await this.findSession(sessionId);
    return sessionOwnership(session, businessId, actorId) === 'own' ? sessionId : undefined;
  }

  /**
   * Get an existing session from cache/DB or create a new one.
   *
   * It checks no tenant and no owner: a caller that takes a client's session id
   * resolves it first (`resolveOwnSessionId` on the HTTP routes,
   * `chatSessionId` on key:chat).
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
    if (classifyActionIntent(lower).isAction)
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
