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

  listPosts(businessId: string, status?: string) {
    return this.prisma.client.socialPost.findMany({
      where: { businessId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updatePost(
    businessId: string,
    postId: string,
    input: { content?: string; mediaUrls?: string[]; status?: string; scheduledAt?: Date | null },
  ) {
    const post = await this.prisma.client.socialPost.findFirst({
      where: { id: postId, businessId },
    });
    if (!post) throw new NotFoundException('Post not found');
    const data: any = {
      content: input.content ?? undefined,
      mediaUrls: input.mediaUrls ?? undefined,
      status: input.status ?? undefined,
      scheduledAt: input.scheduledAt ?? undefined,
    };
    if (input.status === 'POSTED') {
      data.postedAt = new Date();
      data.scheduledAt = null;
    }
    if (input.status === 'DRAFT') {
      data.scheduledAt = null;
      data.postedAt = null;
    }
    const updated = await this.prisma.client.socialPost.update({
      where: { id: postId },
      data,
    });
    if (input.status === 'POSTED') {
      const payload: PostPublishedPayload = {
        post: updated,
        businessId,
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        eventName: 'post.published',
      };
      this.events.emit('post.published', payload);
    }
    return updated;
  }

  async deletePost(businessId: string, postId: string) {
    const post = await this.prisma.client.socialPost.findFirst({
      where: { id: postId, businessId },
    });
    if (!post) throw new NotFoundException('Post not found');
    await this.prisma.client.socialPost.delete({ where: { id: postId } });
    return { success: true, id: postId };
  }

  listConnections(businessId: string) {
    return this.prisma.client.socialConnection.findMany({
      where: { businessId },
      orderBy: { platform: 'asc' },
    });
  }

  createConnection(businessId: string, input: { platform: string; platformId?: string | null; token: string }) {
    return this.prisma.client.socialConnection.create({
      data: {
        businessId,
        platform: input.platform,
        platformId: input.platformId ?? null,
        token: input.token,
      },
    });
  }

  async deleteConnection(businessId: string, connectionId: string) {
    const connection = await this.prisma.client.socialConnection.findFirst({
      where: { id: connectionId, businessId },
    });
    if (!connection) throw new NotFoundException('Connection not found');
    await this.prisma.client.socialConnection.delete({ where: { id: connectionId } });
    return { success: true, id: connectionId };
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
