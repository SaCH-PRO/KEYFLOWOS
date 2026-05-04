import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SocialConnectionsService } from './social-connections.service';
import { BasePublisher, PublishResult, RecentPost } from './publishers/base-publisher';
import { FacebookPublisher } from './publishers/facebook-publisher';
import { InstagramPublisher } from './publishers/instagram-publisher';
import { LinkedInPublisher } from './publishers/linkedin-publisher';
import { TwitterPublisher } from './publishers/twitter-publisher';
import { TikTokPublisher } from './publishers/tiktok-publisher';

@Injectable()
export class SocialPublishingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SocialConnectionsService) private readonly connectionsService: SocialConnectionsService,
  ) {}

  async listRecentPosts(platform: string, connection: any, limit = 25): Promise<RecentPost[]> {
    const publisher = this.publishers[platform.toUpperCase()];
    if (!publisher) return [];
    return publisher.listRecentPosts(connection, limit);
  }

  private publishers: Record<string, BasePublisher> = {
    FACEBOOK: new FacebookPublisher(),
    INSTAGRAM: new InstagramPublisher(),
    LINKEDIN: new LinkedInPublisher(),
    TWITTER: new TwitterPublisher(),
    TIKTOK: new TikTokPublisher(),
  };

  async publishToChannels(
    businessId: string,
    postId: string,
    channelIds?: string[],
  ): Promise<PublishResult[]> {
    const post = await this.prisma.client.socialPost.findFirst({
      where: { id: postId, businessId, deletedAt: null },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    const allConnections = await this.connectionsService.listConnections(businessId);

    let connections = allConnections.filter((c: any) => c.status === 'CONNECTED');

    if (channelIds && channelIds.length > 0) {
      connections = connections.filter((c: any) =>
        channelIds.includes(c.platform) || channelIds.includes(c.id),
      );
    }

    if (connections.length === 0) {
      return [{ platform: 'NONE', success: false, error: 'No matching connected channels found' }];
    }

    const results: PublishResult[] = [];

    for (const connection of connections) {
      const publisher = this.publishers[connection.platform];
      if (!publisher) {
        results.push({
          platform: connection.platform,
          success: false,
          error: `No publisher available for platform: ${connection.platform}`,
        });
        continue;
      }

      const result = await publisher.publish(
        connection,
        post.content,
        (post as any).mediaUrls ?? [],
      );
      results.push(result);
    }

    const anySuccess = results.some((r) => r.success);
    const usedPlatforms = connections.map((c: any) => c.platform);
    const firstSuccess = results.find((r) => r.success);
    const firstError = results.find((r) => !r.success);

    await this.prisma.client.socialPost.update({
      where: { id: post.id },
      data: {
        publishResults: results as any,
        channelIds: usedPlatforms,
        status: anySuccess ? 'POSTED' : 'FAILED',
        postedAt: anySuccess ? new Date() : undefined,
        failedAt: anySuccess ? null : new Date(),
        externalPostId: firstSuccess?.platformPostId ?? null,
        externalUrl: firstSuccess?.externalUrl ?? null,
        lastError: anySuccess ? null : firstError?.error ?? null,
      },
    });

    return results;
  }
}
