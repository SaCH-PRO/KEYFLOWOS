import { describe, expect, it, vi } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SocialService } from '../src/modules/social/social.service';
import { PrismaService } from '../src/core/prisma/prisma.service';

class PrismaMock implements Partial<PrismaService> {
  posts: any[] = [];
  client: any = {
    socialPost: {
      create: vi.fn(({ data }: any) => {
        const post = { ...data, id: `post_${this.posts.length + 1}`, deletedAt: null };
        this.posts.push(post);
        return post;
      }),
      findFirst: vi.fn(({ where }: any) => this.posts.find((p) => p.id === where.id && p.businessId === where.businessId && p.deletedAt === null) || null),
      update: vi.fn(({ where, data }: any) => {
        const post = this.posts.find((p) => p.id === where.id);
        Object.assign(post, data);
        return post;
      }),
    },
  };
}

describe('SocialService', () => {
  it('creates drafts and emits on publish', async () => {
    const prisma = new PrismaMock() as unknown as PrismaService;
    const emit = vi.fn();
    const events = { emit } as unknown as EventEmitter2;
    const service = new SocialService(prisma, events);

    const draft = await service.createDraft('biz_1', 'Hello', []);
    expect(draft.status).toBe('DRAFT');

    const published = await service.publishPost('biz_1', draft.id);
    expect(published.status).toBe('POSTED');
    expect(emit).toHaveBeenCalledWith(
      'post.published',
      expect.objectContaining({ businessId: 'biz_1', post: expect.objectContaining({ id: draft.id }) }),
    );
  });
});
