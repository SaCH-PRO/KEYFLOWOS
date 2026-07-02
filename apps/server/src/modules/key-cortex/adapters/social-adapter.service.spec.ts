import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SocialAdapterService } from './social-adapter.service';
import { SocialService } from '../../social/social.service';
import { SocialConnectionsService } from '../../social/social-connections.service';
import { SocialPublishingService } from '../../social/social-publishing.service';
import { SocialAnalyticsService } from '../../social/social-analytics.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ConnectorCommand } from '../key-cortex-connector.types';

const mkCmd = (action: string, parameters: Record<string, unknown> = {}): ConnectorCommand => ({
  module: 'social',
  action,
  parameters,
  businessId: 'biz_123',
  userId: 'user_456',
  source: 'key_cortex',
  timestamp: new Date(),
  correlationId: 'corr_001',
});

describe('SocialAdapterService', () => {
  let service: SocialAdapterService;
  let social: SocialService;
  let connections: SocialConnectionsService;
  let publishing: SocialPublishingService;
  let analytics: SocialAnalyticsService;
  let prisma: { client: any };

  beforeEach(() => {
    social = {
      createDraft: vi.fn(),
      publishPost: vi.fn(),
      deletePost: vi.fn(),
    } as unknown as SocialService;

    connections = {
      upsertConnection: vi.fn(),
      deleteConnection: vi.fn(),
      listConnections: vi.fn(),
      getConnection: vi.fn(),
    } as unknown as SocialConnectionsService;

    publishing = {} as unknown as SocialPublishingService;
    analytics = {
      getAnalyticsOverview: vi.fn(),
      getAccountMetrics: vi.fn(),
    } as unknown as SocialAnalyticsService;

    prisma = {
      client: {
        socialConnection: { findFirst: vi.fn() },
        socialPost: { findMany: vi.fn() },
        socialEngagement: { create: vi.fn() },
      },
    };

    service = new SocialAdapterService(social, connections, publishing, analytics, prisma as unknown as PrismaService);
  });

  // ── Actions ───────────────────────────────────────────────────────────────

  it('connect_account delegates to upsertConnection', async () => {
    (connections.upsertConnection as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'conn1' });
    const result = await service.execute(mkCmd('connect_account', { platform: 'facebook', handle: '@acme', accessToken: 'tok' }));
    expect(result.success).toBe(true);
    expect(connections.upsertConnection).toHaveBeenCalledWith('biz_123', expect.objectContaining({ platform: 'facebook', accountName: '@acme' }));
  });

  it('disconnect_account deletes connection', async () => {
    (prisma.client.socialConnection.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'conn1', platform: 'FACEBOOK', platformId: 'pid' });
    (connections.deleteConnection as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const result = await service.execute(mkCmd('disconnect_account', { accountId: 'conn1' }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ disconnected: true, accountId: 'conn1' });
  });

  it('schedule_social_post creates scheduled draft', async () => {
    (social.createDraft as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'post1', status: 'SCHEDULED' });
    const result = await service.execute(mkCmd('schedule_social_post', { accountId: 'conn1', body: 'Hello', scheduledAt: '2026-07-01T10:00:00.000Z' }));
    expect(result.success).toBe(true);
    expect(social.createDraft).toHaveBeenCalledWith('biz_123', 'Hello', [], '2026-07-01T10:00:00.000Z', ['conn1']);
  });

  it('publish_now creates draft and publishes', async () => {
    (social.createDraft as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'post1' });
    (social.publishPost as ReturnType<typeof vi.fn>).mockResolvedValue({ posted: true });
    const result = await service.execute(mkCmd('publish_now', { accountId: 'conn1', body: 'Hello now' }));
    expect(result.success).toBe(true);
    expect(social.createDraft).toHaveBeenCalledWith('biz_123', 'Hello now', [], undefined, ['conn1']);
    expect(social.publishPost).toHaveBeenCalledWith('biz_123', 'post1', ['conn1']);
  });

  it('reply_to_comment creates engagement record', async () => {
    (prisma.client.socialConnection.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'conn1', platform: 'FACEBOOK' });
    (prisma.client.socialEngagement.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'eng1' });
    const result = await service.execute(mkCmd('reply_to_comment', { accountId: 'conn1', postId: 'p1', commentId: 'c1', reply: 'Thanks!' }));
    expect(result.success).toBe(true);
    expect(prisma.client.socialEngagement.create).toHaveBeenCalled();
  });

  it('delete_social_post delegates to deletePost', async () => {
    (social.deletePost as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'post1', deletedAt: new Date() });
    const result = await service.execute(mkCmd('delete_social_post', { accountId: 'conn1', postId: 'post1' }));
    expect(result.success).toBe(true);
    expect(social.deletePost).toHaveBeenCalledWith('biz_123', 'post1');
  });

  // ── Queries ───────────────────────────────────────────────────────────────

  it('get_connected_accounts lists connections', async () => {
    (connections.listConnections as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'conn1' }]);
    const result = await service.execute(mkCmd('get_connected_accounts', {}));
    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ id: 'conn1' }]);
  });

  it('get_scheduled_posts queries socialPost', async () => {
    (prisma.client.socialPost.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'post1', status: 'SCHEDULED' }]);
    const result = await service.execute(mkCmd('get_scheduled_posts', { accountId: 'conn1' }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ id: 'post1', status: 'SCHEDULED' }]);
  });

  it('get_engagement_stats returns overview', async () => {
    (analytics.getAnalyticsOverview as ReturnType<typeof vi.fn>).mockResolvedValue({
      totalLikes: 10,
      totalComments: 2,
      totalShares: 1,
      totalReach: 100,
      totalImpressions: 200,
      platformBreakdown: [],
    });
    const result = await service.execute(mkCmd('get_engagement_stats', { from: '2026-01-01', to: '2026-01-31' }));
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ totalLikes: 10, totalReach: 100 });
  });

  it('get_follower_growth returns metrics', async () => {
    (analytics.getAccountMetrics as ReturnType<typeof vi.fn>).mockResolvedValue([{ platform: 'facebook', followers: 100 }]);
    const result = await service.execute(mkCmd('get_follower_growth', { from: '2026-01-01', to: '2026-01-31' }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ platform: 'facebook', followers: 100, engagementRate: 0 }]);
  });

  it('returns connectorFail for unknown action', async () => {
    const result = await service.execute(mkCmd('nonexistent'));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown social action');
  });
});
