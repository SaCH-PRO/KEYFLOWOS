import { BasePublisher, PublishResult } from './base-publisher';

export class LinkedInPublisher extends BasePublisher {
  platform = 'LINKEDIN';

  async publish(connection: any, content: string, mediaUrls?: string[]): Promise<PublishResult> {
    try {
      const authorUrn = connection.platformId;
      const accessToken = connection.token;

      if (!authorUrn || !accessToken) {
        return { platform: this.platform, success: false, error: 'Missing LinkedIn URN or access token' };
      }

      const url = 'https://api.linkedin.com/rest/posts';

      const body: Record<string, any> = {
        author: authorUrn,
        commentary: content,
        visibility: 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: 'PUBLISHED',
      };

      if (mediaUrls && mediaUrls.length > 0) {
        body.content = {
          article: {
            source: mediaUrls[0],
            title: content.slice(0, 100),
          },
        };
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'LinkedIn-Version': '202401',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(body),
      });

      if (response.status === 201 || response.status === 200) {
        const postUrn = response.headers.get('x-restli-id') || response.headers.get('X-RestLi-Id');
        return {
          platform: this.platform,
          success: true,
          platformPostId: postUrn || undefined,
          publishedAt: new Date().toISOString(),
        };
      }

      const data = await response.json() as any;
      const errorMsg = data?.message || `LinkedIn API error: ${response.status}`;
      return { platform: this.platform, success: false, error: errorMsg };
    } catch (err) {
      return { platform: this.platform, success: false, error: (err as Error).message };
    }
  }

  async validateToken(connection: any): Promise<boolean> {
    try {
      const response = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { 'Authorization': `Bearer ${connection.token}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
