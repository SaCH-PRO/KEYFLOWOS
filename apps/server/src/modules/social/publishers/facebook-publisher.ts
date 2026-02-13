import { BasePublisher, PublishResult } from './base-publisher';

export class FacebookPublisher extends BasePublisher {
  platform = 'FACEBOOK';

  async publish(connection: any, content: string, mediaUrls?: string[]): Promise<PublishResult> {
    try {
      const pageId = connection.platformId;
      const accessToken = connection.token;

      if (!pageId || !accessToken) {
        return { platform: this.platform, success: false, error: 'Missing page ID or access token' };
      }

      const url = `https://graph.facebook.com/v19.0/${pageId}/feed`;

      const body: Record<string, string> = { message: content, access_token: accessToken };

      if (mediaUrls && mediaUrls.length > 0) {
        body.link = mediaUrls[0];
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json() as any;

      if (!response.ok) {
        const errorMsg = data?.error?.message || `Facebook API error: ${response.status}`;
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
      const response = await fetch(
        `https://graph.facebook.com/v19.0/me?access_token=${connection.token}`,
      );
      return response.ok;
    } catch {
      return false;
    }
  }
}
