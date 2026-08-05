import { describe, expect, it, vi } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SocialService } from '../src/modules/social/social.service';
import { PrismaService } from '../src/core/prisma/prisma.service';

class PrismaMock implements Partial<PrismaService> {
  posts: any[] = [];
  /** Empty by default — the state a business is in before connecting anything. */
  connections: any[] = [];
  client: any = {
    socialPost: {
      create: vi.fn(({ data }: any) => {
        const post = { ...data, id: `post_${this.posts.length + 1}`, deletedAt: null };
        this.posts.push(post);
        return post;
      }),
      findFirst: vi.fn(({ where }: any) => this.posts.find((p) => p.id === where.id && p.businessId === where.businessId && p.deletedAt === null) || null),
      findUnique: vi.fn(({ where }: any) => this.posts.find((p) => p.id === where.id) || null),
      update: vi.fn(({ where, data }: any) => {
        const post = this.posts.find((p) => p.id === where.id);
        Object.assign(post, data);
        return post;
      }),
    },
    socialConnection: {
      findMany: vi.fn(() => this.connections),
    },
  };
}

describe('SocialService', () => {
  it('creates a draft', async () => {
    const prisma = new PrismaMock() as unknown as PrismaService;
    const service = new SocialService(prisma, { emit: vi.fn() } as unknown as EventEmitter2, {
      publishToChannels: vi.fn(),
    } as any);

    const draft = await service.createDraft('biz_1', 'Hello', []);

    expect(draft.status).toBe('DRAFT');
  });

  it('REFUSES to publish with no connected account', async () => {
    // This test previously asserted the opposite: that publishing with zero
    // connections returned status POSTED and emitted post.published. It passed,
    // and it was certifying a lie — no channel, no API call, nothing anywhere on
    // the internet, and KEY reporting the post as live. The owner finds out when
    // somebody asks why the announcement never went out.
    const prisma = new PrismaMock() as unknown as PrismaService;
    const emit = vi.fn();
    const service = new SocialService(prisma, { emit } as unknown as EventEmitter2, {
      publishToChannels: vi.fn(),
    } as any);

    const draft = await service.createDraft('biz_1', 'Hello', []);

    await expect(service.publishPost('biz_1', draft.id)).rejects.toThrow(/No connected social account/);
    expect(emit).not.toHaveBeenCalledWith('post.published', expect.anything());
  });

  it('leaves the post unpublished rather than half-marking it', async () => {
    // A refusal that still stamped status or postedAt would be worse than the
    // original bug: the record would claim success while the throw claimed
    // failure.
    const prisma = new PrismaMock();
    const service = new SocialService(prisma as unknown as PrismaService, { emit: vi.fn() } as unknown as EventEmitter2, {
      publishToChannels: vi.fn(),
    } as any);

    const draft = await service.createDraft('biz_1', 'Hello', []);
    await service.publishPost('biz_1', draft.id).catch(() => undefined);

    expect(prisma.posts[0].status).toBe('DRAFT');
    expect(prisma.posts[0].postedAt).toBeUndefined();
  });

  it('publishes for real when an account IS connected', async () => {
    // The other half. A refusal that refused everything would be no better.
    const prisma = new PrismaMock();
    prisma.connections = [{ id: 'conn_1', platform: 'meta', status: 'CONNECTED' }];
    const emit = vi.fn();
    const publishToChannels = vi.fn(async () => [{ platform: 'meta', ok: true }]);
    const service = new SocialService(prisma as unknown as PrismaService, { emit } as unknown as EventEmitter2, {
      publishToChannels,
    } as any);

    const draft = await service.createDraft('biz_1', 'Hello', []);
    await service.publishPost('biz_1', draft.id);

    expect(publishToChannels).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('post.published', expect.objectContaining({ businessId: 'biz_1' }));
  });

  it('publishes when explicit channelIds are given even with no stored connection', async () => {
    const prisma = new PrismaMock();
    const publishToChannels = vi.fn(async () => []);
    const service = new SocialService(prisma as unknown as PrismaService, { emit: vi.fn() } as unknown as EventEmitter2, {
      publishToChannels,
    } as any);

    const draft = await service.createDraft('biz_1', 'Hello', []);
    await service.publishPost('biz_1', draft.id, ['chan_1']);

    expect(publishToChannels).toHaveBeenCalledTimes(1);
  });
});
