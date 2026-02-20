import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SocialPublishingService } from './social-publishing.service';
import { PostPublishedPayload } from '../../core/event-bus/events.types';

@Injectable()
export class SocialService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(SocialPublishingService) private readonly publishingService: SocialPublishingService,
  ) {}

  createDraft(businessId: string, content: string, mediaUrls: string[], scheduledAt?: string, channelIds?: string[]) {
    const status = scheduledAt ? 'SCHEDULED' : 'DRAFT';
    return this.prisma.client.socialPost.create({
      data: {
        businessId,
        content,
        mediaUrls,
        status,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        channelIds: channelIds ?? [],
      },
    });
  }

  async updatePost(businessId: string, postId: string, data: { content?: string; scheduledAt?: string | null; channelIds?: string[]; mediaUrls?: string[] }) {
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
    if (data.channelIds !== undefined) updateData.channelIds = data.channelIds;
    if (data.mediaUrls !== undefined) updateData.mediaUrls = data.mediaUrls;

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

  async publishPost(businessId: string, postId: string, channelIds?: string[]) {
    const post = await this.prisma.client.socialPost.findFirst({
      where: { id: postId, businessId, deletedAt: null },
    });
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    const connections = await this.prisma.client.socialConnection.findMany({
      where: { businessId, status: 'CONNECTED' },
    });

    if ((channelIds && channelIds.length > 0) || connections.length > 0) {
      const results = await this.publishingService.publishToChannels(businessId, postId, channelIds);
      const updatedPost = await this.prisma.client.socialPost.findUnique({ where: { id: postId } });

      const payload: PostPublishedPayload = {
        post: updatedPost!,
        businessId,
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        eventName: 'post.published',
      };
      this.events.emit('post.published', payload);

      return { post: updatedPost, results };
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
