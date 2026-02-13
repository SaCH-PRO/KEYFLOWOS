import { BasePublisher, PublishResult } from './base-publisher';

export class LinkedInPublisher extends BasePublisher {
  platform = 'LINKEDIN';

  async publish(connection: any, content: string, _mediaUrls?: string[]): Promise<PublishResult> {
    try {
      const authorUrn = connection.platformId;
      const accessToken = connection.token;

      if (!authorUrn || !accessToken) {
        return { platform: this.platform, success: false, error: 'Missing LinkedIn URN or access token' };
      }

      const url = 'https://api.linkedin.com/v2/ugcPosts';

      const body = {
        author: authorUrn,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: {
              text: content,
            },
            shareMediaCategory: 'NONE',
          },
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
        },
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(body),
      });

      const data = await response.json() as any;

      if (!response.ok) {
        const errorMsg = data?.message || `LinkedIn API error: ${response.status}`;
        return { platform: this.platform, success: false, error: errorMsg };
      }

      return {
        platform: this.platform,
        success: true,
        platformPostId: data.id,
        publishedAt: new Date().toISOString(),
      };
    } catch (err) {
      return { platform: this.platform, success: false, error: (err as Error).message };
    }
  }

  async validateToken(connection: any): Promise<boolean> {
    try {
      const response = await fetch('https://api.linkedin.com/v2/me', {
        headers: { 'Authorization': `Bearer ${connection.token}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
