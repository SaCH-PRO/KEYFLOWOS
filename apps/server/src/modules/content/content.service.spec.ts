import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContentService } from './content.service';

function makePrisma() {
  const outboundContent: any[] = [];
  const outboundCampaigns: any[] = [];
  const socialConnections: any[] = [];
  const socialPosts: any[] = [];
  const socialEngagements: any[] = [];

  const createId = () => `id_${Math.random().toString(36).slice(2)}`;

  const outboundContentClient = {
    create: vi.fn(async ({ data }: any) => {
      const record = { id: createId(), ...data, createdAt: new Date(), updatedAt: new Date() };
      outboundContent.push(record);
      return record;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const record = outboundContent.find((r) => r.id === where.id);
      if (!record) throw new Error('Record not found');
      Object.assign(record, data, { updatedAt: new Date() });
      return record;
    }),
    delete: vi.fn(async ({ where }: any) => {
      const idx = outboundContent.findIndex((r) => r.id === where.id);
      if (idx === -1) throw new Error('Record not found');
      outboundContent.splice(idx, 1);
      return {};
    }),
    findMany: vi.fn(async ({ where, take, orderBy }: any) => {
      let result = [...outboundContent];
      if (where?.businessId) result = result.filter((r) => r.businessId === where.businessId);
      if (where?.status) result = result.filter((r) => r.status === where.status);
      if (where?.scheduledAt?.gte) result = result.filter((r) => r.scheduledAt && r.scheduledAt >= new Date(where.scheduledAt.gte));
      if (orderBy?.createdAt === 'desc') result.reverse();
      if (orderBy?.scheduledAt === 'asc') result.sort((a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0));
      return take ? result.slice(0, take) : result;
    }),
    findFirst: vi.fn(async ({ where }: any) => outboundContent.find((r) => r.id === where.id && r.businessId === where.businessId) ?? null),
    count: vi.fn(async ({ where }: any) => {
      let result = [...outboundContent];
      if (where?.businessId) result = result.filter((r) => r.businessId === where.businessId);
      if (where?.status) result = result.filter((r) => r.status === where.status);
      return result.length;
    }),
  };

  const outboundCampaignClient = {
    create: vi.fn(async ({ data }: any) => {
      const record = { id: createId(), ...data, createdAt: new Date(), updatedAt: new Date(), contents: [] };
      outboundCampaigns.push(record);
      return record;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const record = outboundCampaigns.find((r) => r.id === where.id);
      if (!record) throw new Error('Campaign not found');
      Object.assign(record, data, { updatedAt: new Date() });
      return record;
    }),
    findFirst: vi.fn(async ({ where }: any) => outboundCampaigns.find((r) => r.id === where.id && r.businessId === where.businessId) ?? null),
  };

  const socialConnectionClient = {
    create: vi.fn(async ({ data }: any) => {
      const record = { id: createId(), ...data, createdAt: new Date(), updatedAt: new Date() };
      socialConnections.push(record);
      return record;
    }),
    findFirst: vi.fn(async ({ where }: any) =>
      socialConnections.find((r) => r.businessId === where.businessId && r.platform === where.platform) ?? null,
    ),
    update: vi.fn(async ({ where, data }: any) => {
      const record = socialConnections.find((r) => r.id === where.id);
      if (!record) throw new Error('Connection not found');
      Object.assign(record, data, { updatedAt: new Date() });
      return record;
    }),
    delete: vi.fn(async ({ where }: any) => {
      const idx = socialConnections.findIndex((r) => r.id === where.id);
      if (idx === -1) throw new Error('Connection not found');
      socialConnections.splice(idx, 1);
      return {};
    }),
  };

  const socialPostClient = {
    create: vi.fn(async ({ data }: any) => {
      const record = { id: createId(), ...data, createdAt: new Date(), updatedAt: new Date() };
      socialPosts.push(record);
      return record;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const record = socialPosts.find((r) => r.id === where.id);
      if (!record) throw new Error('Social post not found');
      Object.assign(record, data, { updatedAt: new Date() });
      return record;
    }),
  };

  const socialEngagementClient = {
    create: vi.fn(async ({ data }: any) => {
      const record = { id: createId(), ...data, createdAt: new Date(), updatedAt: new Date() };
      socialEngagements.push(record);
      return record;
    }),
  };

  return {
    outboundContent,
    outboundCampaigns,
    socialConnections,
    socialPosts,
    socialEngagements,
    client: {
      outboundContent: outboundContentClient,
      outboundCampaign: outboundCampaignClient,
      socialConnection: socialConnectionClient,
      socialPost: socialPostClient,
      socialEngagement: socialEngagementClient,
    },
  };
}

describe('ContentService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: ContentService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new ContentService(prisma as any);
  });

  it('creates a post as draft by default', async () => {
    const post = await service.createPost({ businessId: 'biz_1', title: 'Hello', body: 'World' });
    expect(post.subject).toBe('Hello');
    expect(post.body).toBe('World');
    expect(post.status).toBe('Draft');
    expect(post.contentMeta).toMatchObject({ platform: 'blog', tags: [] });
  });

  it('schedules a post', async () => {
    const created = await service.createPost({ businessId: 'biz_1', title: 'T', body: 'B' });
    const scheduled = await service.schedulePost({ businessId: 'biz_1', postId: created.id, scheduledAt: '2026-07-01T12:00:00Z' });
    expect(scheduled.status).toBe('Scheduled');
    expect(scheduled.scheduledAt).toBeInstanceOf(Date);
  });

  it('publishes a post', async () => {
    const created = await service.createPost({ businessId: 'biz_1', title: 'T', body: 'B' });
    const published = await service.publishPost({ businessId: 'biz_1', postId: created.id });
    expect(published.status).toBe('Sent');
    expect(published.publishedAt).toBeInstanceOf(Date);
  });

  it('creates and sends a campaign', async () => {
    const campaign = await service.createCampaign({ businessId: 'biz_1', name: 'Summer Sale', subject: 'Sale!', body: 'Big sale' });
    expect(campaign.name).toBe('Summer Sale');
    const sent = await service.sendCampaign({ businessId: 'biz_1', campaignId: campaign.id });
    expect(sent.status).toBe('sent');
  });

  it('generates content draft', async () => {
    const draft = await service.generateContent({ businessId: 'biz_1', topic: 'AI' });
    expect(draft.topic).toBe('AI');
    expect(draft.draft).toContain('AI');
  });

  it('lists drafts and scheduled posts', async () => {
    await service.createPost({ businessId: 'biz_1', title: 'Draft', body: 'B' });
    const scheduledPost = await service.createPost({ businessId: 'biz_1', title: 'Scheduled', body: 'B', status: 'scheduled' });
    await service.schedulePost({ businessId: 'biz_1', postId: scheduledPost.id, scheduledAt: '2026-07-01T12:00:00Z' });

    const drafts = await service.getDrafts({ businessId: 'biz_1' });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].subject).toBe('Draft');

    const scheduled = await service.getScheduledPosts({ businessId: 'biz_1', from: '2026-06-01T00:00:00Z' });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].subject).toBe('Scheduled');
  });

  it('connects a social account', async () => {
    const account = await service.connectSocialAccount({ businessId: 'biz_1', platform: 'twitter', handle: '@keyflow' });
    expect(account.platform).toBe('twitter');
    expect(account.accountName).toBe('@keyflow');
  });

  it('schedules and publishes social posts', async () => {
    const scheduled = await service.scheduleSocialPost({ businessId: 'biz_1', accountId: 'acc_1', body: 'Hello', scheduledAt: '2026-07-01T12:00:00Z' });
    expect(scheduled.status).toBe('SCHEDULED');
    const published = await service.publishSocialNow({ businessId: 'biz_1', accountId: 'acc_1', body: 'Now' });
    expect(published.status).toBe('POSTED');
  });

  it('replies to a social comment', async () => {
    const reply = await service.replyToSocialComment({
      businessId: 'biz_1',
      accountId: 'acc_1',
      postId: 'post_1',
      commentId: 'comment_1',
      reply: 'Thanks!',
    });
    expect(reply.type).toBe('COMMENT');
    expect(reply.aiResponse).toBe('Thanks!');
  });
});
