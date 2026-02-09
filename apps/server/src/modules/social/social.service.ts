import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PostPublishedPayload } from '../../core/event-bus/events.types';

@Injectable()
export class SocialService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  createDraft(businessId: string, content: string, mediaUrls: string[], scheduledAt?: string) {
    const status = scheduledAt ? 'SCHEDULED' : 'DRAFT';
    return this.prisma.client.socialPost.create({
      data: {
        businessId,
        content,
        mediaUrls,
        status,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      },
    });
  }

  async updatePost(businessId: string, postId: string, data: { content?: string; scheduledAt?: string | null }) {
    const post = await this.prisma.client.socialPost.findFirst({
      where: { id: postId, businessId, deletedAt: null },
    });
    if (!post) throw new NotFoundException('Post not found');

    const updateData: Record<string, unknown> = {};
    if (data.content !== undefined) updateData.content = data.content;
    if (data.scheduledAt !== undefined) {
      updateData.scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : null;
      updateData.status = data.scheduledAt ? 'SCHEDULED' : 'DRAFT';
    }

    return this.prisma.client.socialPost.update({
      where: { id: post.id },
      data: updateData,
    });
  }

  async deletePost(businessId: string, postId: string) {
    const post = await this.prisma.client.socialPost.findFirst({
      where: { id: postId, businessId, deletedAt: null },
    });
    if (!post) throw new NotFoundException('Post not found');

    return this.prisma.client.socialPost.update({
      where: { id: post.id },
      data: { deletedAt: new Date() },
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
