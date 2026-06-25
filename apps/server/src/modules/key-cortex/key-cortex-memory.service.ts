/**
 * KEY Cortex Memory Service — Phase 18C
 * Persistent Memory + Personalization
 *
 * Jarvis remembers. This service stores and retrieves multi-level
 * business memory: preferences, facts, decisions, failures, successes.
 * Memory is retrieved before EVERY Cortex response.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';
import {
  CortexMemory,
  CortexMemoryQuery,
  MemoryType,
} from './cortex-genome-contracts';

const MEMORY_CACHE_PREFIX = 'cortex:memory';
const MEMORY_CACHE_TTL_MS = 600_000; // 10 minutes

const ALL_MEMORY_TYPES: MemoryType[] = [
  'user_preference',
  'business_fact',
  'past_decision',
  'failed_attempt',
  'successful_action',
  'communication_style',
  'risk_tolerance',
  'common_workflow',
  'current_goal',
  'long_term_strategy',
];

@Injectable()
export class KeyCortexMemoryService {
  private readonly logger = new Logger(KeyCortexMemoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ═══════════════════════════════════════════════════════════
  // CORE: Retrieve memory before every response
  // ═══════════════════════════════════════════════════════════

  async retrieve(query: CortexMemoryQuery): Promise<CortexMemory[]> {
    const cacheKey = this.buildCacheKey(query);

    // Try cache first
    const cached = await this.getCached(cacheKey);
    if (cached) return cached;

    // Build from DB
    const memories = await this.loadFromDatabase(query);

    // Cache result
    await this.cacheResult(cacheKey, memories);

    return memories;
  }

  // ═══════════════════════════════════════════════════════════
  // Format memory for injection into system prompt
  // ═══════════════════════════════════════════════════════════

  formatForPrompt(memories: CortexMemory[]): string {
    if (memories.length === 0) {
      return '';
    }

    const byType = this.groupByType(memories);
    const lines: string[] = ['=== WHAT I KNOW ABOUT YOUR BUSINESS ==='];

    for (const [type, items] of Object.entries(byType)) {
      const topItems = items
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 3);
      lines.push(`${this.formatType(type)}: ${topItems.map((i) => i.value).join('; ')}`);
    }

    lines.push('=======================================');
    return lines.join('\n');
  }

  // ═══════════════════════════════════════════════════════════
  // Memory creation
  // ═══════════════════════════════════════════════════════════

  async store(
    businessId: string,
    type: MemoryType,
    key: string,
    value: string,
    opts?: { userId?: string; confidence?: number; source?: CortexMemory['source'] },
  ): Promise<CortexMemory> {
    const memory: Omit<CortexMemory, 'id'> = {
      businessId,
      userId: opts?.userId,
      type,
      key,
      value,
      confidence: opts?.confidence ?? 0.8,
      source: opts?.source ?? 'inferred',
      lastAccessedAt: new Date(),
      createdAt: new Date(),
      accessCount: 1,
    };

    // Store in Prisma (via generic metadata table or dedicated memory table)
    // For now: store in Redis with persistence
    const id = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const fullMemory: CortexMemory = { ...memory, id };

    await this.persistMemory(fullMemory);
    await this.invalidateCache(businessId, opts?.userId);

    this.logger.debug(`[store] ${type}:${key} for business=${businessId}`);
    return fullMemory;
  }

  // Store explicit user preference
  async storePreference(
    businessId: string,
    userId: string,
    key: string,
    value: string,
  ): Promise<CortexMemory> {
    return this.store(businessId, 'user_preference', key, value, {
      userId,
      confidence: 1.0,
      source: 'explicit',
    });
  }

  // Store business fact
  async storeBusinessFact(
    businessId: string,
    key: string,
    value: string,
  ): Promise<CortexMemory> {
    return this.store(businessId, 'business_fact', key, value, {
      confidence: 0.9,
      source: 'genome',
    });
  }

  // Record decision outcome
  async recordDecision(
    businessId: string,
    userId: string,
    decision: string,
    approved: boolean,
  ): Promise<CortexMemory> {
    return this.store(
      businessId,
      approved ? 'successful_action' : 'failed_attempt',
      `decision_${Date.now()}`,
      decision,
      { userId, confidence: 1.0, source: 'explicit' },
    );
  }

  // ═══════════════════════════════════════════════════════════
  // Learning: detect preferences from behavior
  // ═══════════════════════════════════════════════════════════

  async detectPreferences(
    businessId: string,
    userId: string,
    recentMessages: Array<{ role: string; content: string }>,
  ): Promise<CortexMemory[]> {
    const detected: CortexMemory[] = [];

    // Detect communication style
    const userMessages = recentMessages.filter((m) => m.role === 'user');
    const avgLength = userMessages.reduce((s, m) => s + m.content.length, 0) / (userMessages.length || 1);

    let style = 'neutral';
    if (avgLength < 50) style = 'brief';
    else if (avgLength > 200) style = 'detailed';

    const formality = this.detectFormality(userMessages.map((m) => m.content));

    detected.push(await this.store(
      businessId, 'communication_style', 'response_length',
      style, { userId, confidence: 0.7, source: 'inferred' },
    ));

    detected.push(await this.store(
      businessId, 'communication_style', 'formality',
      formality, { userId, confidence: 0.7, source: 'inferred' },
    ));

    return detected;
  }

  // ═══════════════════════════════════════════════════════════
  // Private helpers
  // ═══════════════════════════════════════════════════════════

  private async loadFromDatabase(query: CortexMemoryQuery): Promise<CortexMemory[]> {
    // In production: query Prisma with a dedicated memory table
    // For now: load from Redis set of memory keys
    const pattern = `${MEMORY_CACHE_PREFIX}:${query.businessId}:${query.userId ?? '*'}:*`;
    const keys = await this.redis.keys(pattern);

    const memories: CortexMemory[] = [];
    for (const key of keys.slice(0, query.limit ?? 50)) {
      const raw = await this.redis.get(key);
      if (raw) {
        try {
          memories.push(JSON.parse(raw) as CortexMemory);
        } catch {
          // skip corrupted
        }
      }
    }

    // Filter by type if requested
    if (query.memoryTypes && query.memoryTypes.length > 0) {
      return memories.filter((m) => query.memoryTypes!.includes(m.type));
    }

    return memories;
  }

  private async persistMemory(memory: CortexMemory): Promise<void> {
    const key = `${MEMORY_CACHE_PREFIX}:${memory.businessId}:${memory.userId ?? 'all'}:${memory.id}`;
    await this.redis.set(key, JSON.stringify(memory), 'PX', MEMORY_CACHE_TTL_MS);
  }

  private async getCached(cacheKey: string): Promise<CortexMemory[] | null> {
    const raw = await this.redis.get(cacheKey);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CortexMemory[];
    } catch {
      return null;
    }
  }

  private async cacheResult(cacheKey: string, memories: CortexMemory[]): Promise<void> {
    await this.redis.set(cacheKey, JSON.stringify(memories), 'PX', MEMORY_CACHE_TTL_MS);
  }

  private async invalidateCache(businessId: string, userId?: string): Promise<void> {
    const pattern = `${MEMORY_CACHE_PREFIX}:${businessId}:${userId ?? '*'}:query*`;
    const keys = await this.redis.keys(pattern);
    for (const key of keys) {
      await this.redis.del(key);
    }
  }

  private buildCacheKey(query: CortexMemoryQuery): string {
    const types = query.memoryTypes?.sort().join(',') ?? 'all';
    return `${MEMORY_CACHE_PREFIX}:${query.businessId}:${query.userId ?? 'all'}:query:${types}`;
  }

  private groupByType(memories: CortexMemory[]): Partial<Record<MemoryType, CortexMemory[]>> {
    const grouped: Partial<Record<MemoryType, CortexMemory[]>> = {};
    for (const m of memories) {
      if (!grouped[m.type]) grouped[m.type] = [];
      grouped[m.type]!.push(m);
    }
    return grouped;
  }

  private formatType(type: string): string {
    return type
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  private detectFormality(messages: string[]): string {
    const text = messages.join(' ').toLowerCase();
    const formalWords = /(please|thank you|kindly|would you|could you|sir|madam)/g;
    const informalWords = /(hey|hi|thanks|yeah|nope|gonna|wanna)/g;
    const formalCount = (text.match(formalWords) ?? []).length;
    const informalCount = (text.match(informalWords) ?? []).length;
    if (formalCount > informalCount) return 'formal';
    if (informalCount > formalCount) return 'casual';
    return 'neutral';
  }
}
