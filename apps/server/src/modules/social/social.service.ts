import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SocialPublishingService } from './social-publishing.service';
import { MetaSocialConnector } from '../../core/connectors/implementations/meta-social.connector';
import { PostPublishedPayload } from '../../core/event-bus/events.types';

@Injectable()
export class SocialService {
  private readonly logger = new Logger(SocialService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(SocialPublishingService) private readonly publishingService: SocialPublishingService,
    @Optional() @Inject(MetaSocialConnector) private readonly metaConnector?: MetaSocialConnector,
  ) {}

  async createDraft(businessId: string, content: string, mediaUrls: string[], scheduledAt?: string, channelIds?: string[]) {
    const status = scheduledAt ? 'SCHEDULED' : 'DRAFT';
    const post = await this.prisma.client.socialPost.create({
      data: {
        businessId,
        content,
        mediaUrls,
        status,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        channelIds: channelIds ?? [],
      },
    });
    this.events.emit('social_post.created', { post, businessId });
    if (scheduledAt) {
      this.events.emit('social_post.scheduled', { post, businessId });
    }
    return post;
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

    const updated = await this.prisma.client.socialPost.update({
      where: { id: post.id },
      data: updateData,
    });
    this.events.emit('social_post.updated', { post: updated, businessId });
    if (data.scheduledAt) {
      this.events.emit('social_post.scheduled', { post: updated, businessId });
    }
    return updated;
  }

  async deletePost(businessId: string, postId: string) {
    const post = await this.prisma.client.socialPost.findFirst({
      where: { id: postId, businessId, deletedAt: null },
    });
    if (!post) throw new NotFoundException('Post not found');

    const result = await this.prisma.client.socialPost.update({
      where: { id: post.id },
      data: { deletedAt: new Date() },
    });
    this.events.emit('social_post.deleted', { businessId, postId: post.id });
    return result;
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

      this.metaConnector?.emitPostPublished(businessId, {
        platform: 'meta',
        postId,
      }).catch((e) => this.logger.warn(`Meta connector event emission failed: ${e.message}`));

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

  async fetchRecentExternalPosts(businessId: string, platformFilter?: string) {
    const connections = await this.prisma.client.socialConnection.findMany({
      where: { businessId, status: 'CONNECTED' },
    });
    const filtered = platformFilter
      ? connections.filter((c) => c.platform.toUpperCase() === platformFilter.toUpperCase())
      : connections;
    const results = await Promise.all(
      filtered.map(async (c) => {
        try {
          const recent = await this.publishingService.listRecentPosts(c.platform, c);
          return recent;
        } catch {
          return [];
        }
      }),
    );
    return results.flat().sort((a, b) => {
      const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return tb - ta;
    });
  }
}
