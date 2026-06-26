import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMock } from '@golevelup/ts-vitest';
import { KeyCortexMemoryService } from '../key-cortex-memory.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { RedisService } from '../../../core/redis/redis.service';
import { CortexMemoryQuery, MemoryType } from '../cortex-genome-contracts';

describe('Phase 18C — KeyCortexMemoryService', () => {
  let service: KeyCortexMemoryService;
  let mockRedis: ReturnType<typeof createMock<RedisService>>;

  beforeEach(() => {
    mockRedis = createMock<RedisService>();
    mockRedis.keys = vi.fn().mockResolvedValue([]);
    mockRedis.get = vi.fn().mockResolvedValue(null);
    mockRedis.set = vi.fn().mockResolvedValue('OK');
    mockRedis.del = vi.fn().mockResolvedValue(1);

    service = new KeyCortexMemoryService(createMock<PrismaService>(), mockRedis);
  });

  // ── Store and retrieve ────────────────────────────────────

  describe('store', () => {
    it('should store a memory with all fields', async () => {
      const memory = await service.store('biz_1', 'business_fact', 'revenue', '10K monthly', {
        confidence: 0.9,
        source: 'genome',
      });

      expect(memory.type).toBe('business_fact');
      expect(memory.key).toBe('revenue');
      expect(memory.value).toBe('10K monthly');
      expect(memory.confidence).toBe(0.9);
      expect(mockRedis.set).toHaveBeenCalled();
    });

    it('should store explicit user preference', async () => {
      const memory = await service.storePreference('biz_1', 'user_1', 'response_length', 'brief');

      expect(memory.type).toBe('user_preference');
      expect(memory.source).toBe('explicit');
      expect(memory.confidence).toBe(1.0);
    });

    it('should store business fact', async () => {
      const memory = await service.storeBusinessFact('biz_1', 'team_size', '5');

      expect(memory.type).toBe('business_fact');
      expect(memory.source).toBe('genome');
    });

    it('should record decision outcome', async () => {
      const memory = await service.recordDecision('biz_1', 'user_1', 'Approved invoice #123', true);

      expect(memory.type).toBe('successful_action');
      expect(memory.source).toBe('explicit');
    });
  });

  // ── Retrieve ──────────────────────────────────────────────

  describe('retrieve', () => {
    it('should return empty array when no memories exist', async () => {
      mockRedis.keys = vi.fn().mockResolvedValue([]);

      const result = await service.retrieve({ businessId: 'biz_1', memoryTypes: ['business_fact'] });

      expect(result).toEqual([]);
    });

    it('should filter by memory type', async () => {
      const mem1 = { id: '1', businessId: 'biz_1', type: 'business_fact', key: 'k1', value: 'v1', confidence: 0.8, source: 'genome', lastAccessedAt: new Date(), createdAt: new Date(), accessCount: 1 };
      const mem2 = { id: '2', businessId: 'biz_1', type: 'user_preference', key: 'k2', value: 'v2', confidence: 0.8, source: 'explicit', lastAccessedAt: new Date(), createdAt: new Date(), accessCount: 1 };

      mockRedis.keys = vi.fn().mockResolvedValue(['key1', 'key2']);
      mockRedis.get = vi.fn()
        .mockResolvedValueOnce(null) // cache miss
        .mockResolvedValueOnce(JSON.stringify(mem1))
        .mockResolvedValueOnce(JSON.stringify(mem2));

      const result = await service.retrieve({ businessId: 'biz_1', memoryTypes: ['business_fact'] });

      expect(result).toHaveLength(1); // Only business_fact survives the filter
    });
  });

  // ── Format for prompt ─────────────────────────────────────

  describe('formatForPrompt', () => {
    it('should return empty string for no memories', () => {
      const result = service.formatForPrompt([]);
      expect(result).toBe('');
    });

    it('should format memories by type', () => {
      const memories = [
        { id: '1', businessId: 'biz', type: 'business_fact' as MemoryType, key: 'revenue', value: '10K', confidence: 0.9, source: 'genome' as const, lastAccessedAt: new Date(), createdAt: new Date(), accessCount: 5 },
        { id: '2', businessId: 'biz', type: 'user_preference' as MemoryType, key: 'style', value: 'brief', confidence: 0.8, source: 'explicit' as const, lastAccessedAt: new Date(), createdAt: new Date(), accessCount: 3 },
      ];

      const result = service.formatForPrompt(memories);

      expect(result).toContain('WHAT I KNOW ABOUT YOUR BUSINESS');
      expect(result).toContain('10K');
      expect(result).toContain('brief');
    });
  });

  // ── Preference detection ──────────────────────────────────

  describe('detectPreferences', () => {
    it('should detect brief communication style', async () => {
      const messages = [
        { role: 'user', content: 'Hi' },
        { role: 'user', content: 'OK' },
        { role: 'assistant', content: 'Hello there' },
      ];

      mockRedis.set = vi.fn().mockResolvedValue('OK');
      mockRedis.keys = vi.fn().mockResolvedValue([]);

      const result = await service.detectPreferences('biz_1', 'user_1', messages);

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].type).toBe('communication_style');
    });

    it('should detect formal style', async () => {
      const messages = [
        { role: 'user', content: 'Please kindly send the report' },
        { role: 'user', content: 'Thank you very much' },
      ];

      mockRedis.set = vi.fn().mockResolvedValue('OK');
      mockRedis.keys = vi.fn().mockResolvedValue([]);

      const result = await service.detectPreferences('biz_1', 'user_1', messages);

      expect(result.length).toBeGreaterThan(0);
    });
  });
});
