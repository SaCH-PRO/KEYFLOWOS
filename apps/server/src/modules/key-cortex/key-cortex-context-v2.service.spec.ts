import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeyCortexContextV2Service } from './key-cortex-context-v2.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';

describe('KeyCortexContextV2Service device slice', () => {
  let service: KeyCortexContextV2Service;
  let prisma: {
    client: {
      mediaAsset: { findMany: ReturnType<typeof vi.fn> };
      visualIntake: { count: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
      extractedEntity: { findMany: ReturnType<typeof vi.fn> };
      commandItem: { findMany: ReturnType<typeof vi.fn> };
    };
  };

  beforeEach(() => {
    prisma = {
      client: {
        mediaAsset: { findMany: vi.fn() },
        visualIntake: { count: vi.fn(), findMany: vi.fn() },
        extractedEntity: { findMany: vi.fn() },
        commandItem: { findMany: vi.fn() },
      },
    };

    service = new KeyCortexContextV2Service(
      prisma as unknown as PrismaService,
      { get: vi.fn(), set: vi.fn(), del: vi.fn() } as unknown as RedisService,
      {} as CrmService,
      {} as CommerceService,
      {} as BookingsService,
      {} as AutopilotService,
      {} as TemporalFlowMemoryService,
      {} as KeyInboxIntelligenceService,
    );
  });

  it('returns device context with recent captures and high-confidence contacts', async () => {
    prisma.client.mediaAsset.findMany.mockResolvedValue([
      {
        id: 'a1',
        mediaType: 'image',
        status: 'PROCESSED',
        publicUrl: 'https://example.com/a1',
        createdAt: new Date(),
      },
    ]);
    prisma.client.visualIntake.count.mockResolvedValue(2);
    // detectedType is resolved by a second query keyed on mediaAssetId.
    prisma.client.visualIntake.findMany.mockResolvedValue([
      { mediaAssetId: 'a1', detectedType: 'business_card' },
    ]);
    prisma.client.extractedEntity.findMany.mockResolvedValue([
      {
        id: 'e1',
        entityType: 'business_card',
        proposedData: { name: 'Jane Doe', email: 'jane@example.com' },
        matchConfidence: 90,
      },
    ]);
    prisma.client.commandItem.findMany.mockResolvedValue([
      { id: 'c1', title: 'Review business card', category: 'PEOPLE', status: 'OPEN' },
    ]);

    const ctx = await service.getDeviceContext('b1');

    expect(ctx.recentCaptures).toHaveLength(1);
    expect(ctx.recentCaptures[0].detectedType).toBe('business_card');
    expect(ctx.pendingCaptures).toBe(2);
    expect(ctx.highConfidenceContacts).toHaveLength(1);
    expect(ctx.linkedCommandItems).toHaveLength(1);
  });

  it('returns empty context on error', async () => {
    prisma.client.mediaAsset.findMany.mockRejectedValue(new Error('db down'));
    const ctx = await service.getDeviceContext('b1');
    expect(ctx.recentCaptures).toHaveLength(0);
    expect(ctx.pendingCaptures).toBe(0);
  });
});
