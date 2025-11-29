import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PostPublishedPayload } from '../../core/event-bus/events.types';

@Injectable()
export class SocialService {
  constructor(private readonly prisma: PrismaService, private readonly events: EventEmitter2) {}

  createDraft(businessId: string, content: string, mediaUrls: string[]) {
    return this.prisma.client.socialPost.create({
      data: { businessId, content, mediaUrls, status: 'DRAFT' },
    });
  }

  async publishPost(businessId: string, postId: string) {
    const post = await this.prisma.client.socialPost.findFirst({
      where: { id: postId, businessId, deletedAt: null },
    });
    if (!post) {
      throw new NotFoundException('Post not found');
    }
    const updated = await this.prisma.client.socialPost.update({
      where: { id: post.id },
      data: { status: 'POSTED', postedAt: new Date() },
    });
    const payload: PostPublishedPayload = {
      post: updated,
      businessId,
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      eventName: 'post.published',
    };
    this.events.emit('post.published', payload);
    return updated;
  }
}
