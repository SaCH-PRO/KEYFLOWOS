import { BasePublisher, PublishResult, RecentPost } from './base-publisher';

export class InstagramPublisher extends BasePublisher {
  platform = 'INSTAGRAM';

  async publish(connection: any, content: string, mediaUrls?: string[]): Promise<PublishResult> {
    try {
      const igUserId = connection.platformId;
      const accessToken = connection.token;

      if (!igUserId || !accessToken) {
        return { platform: this.platform, success: false, error: 'Missing Instagram user ID or access token' };
      }

      if (!mediaUrls || mediaUrls.length === 0) {
        return { platform: this.platform, success: false, error: 'Instagram requires an image' };
      }

      const containerUrl = `https://graph.facebook.com/v19.0/${igUserId}/media`;
      const containerResponse = await fetch(containerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: mediaUrls[0],
          caption: content,
          access_token: accessToken,
        }),
      });

      const containerData = await containerResponse.json() as any;

      if (!containerResponse.ok) {
        const errorMsg = containerData?.error?.message || `Instagram container error: ${containerResponse.status}`;
        return { platform: this.platform, success: false, error: errorMsg };
      }

      const containerId = containerData.id;

      const publishUrl = `https://graph.facebook.com/v19.0/${igUserId}/media_publish`;
      const publishResponse = await fetch(publishUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: containerId,
          access_token: accessToken,
        }),
      });

      const publishData = await publishResponse.json() as any;

      if (!publishResponse.ok) {
        const errorMsg = publishData?.error?.message || `Instagram publish error: ${publishResponse.status}`;
        return { platform: this.platform, success: false, error: errorMsg };
      }

      let permalink: string | undefined;
      try {
        const linkRes = await fetch(`https://graph.facebook.com/v19.0/${publishData.id}?fields=permalink&access_token=${accessToken}`);
        const linkData = await linkRes.json() as any;
        permalink = linkData?.permalink;
      } catch { /* swallow */ }

      return {
        platform: this.platform,
        success: true,
        platformPostId: publishData.id,
        externalUrl: permalink,
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

  async listRecentPosts(connection: any, limit = 25): Promise<RecentPost[]> {
    try {
      const igUserId = connection.platformId;
      if (!igUserId) return [];
      const res = await fetch(
        `https://graph.facebook.com/v19.0/${igUserId}/media?fields=id,caption,timestamp,permalink&limit=${Math.min(limit, 50)}&access_token=${connection.token}`,
      );
      if (!res.ok) return [];
      const data = (await res.json()) as { data?: Array<{ id: string; caption?: string; timestamp?: string; permalink?: string }> };
      return (data.data ?? []).map((p) => ({
        platform: this.platform,
        platformPostId: p.id,
        content: p.caption,
        publishedAt: p.timestamp,
        externalUrl: p.permalink,
      }));
    } catch {
      return [];
    }
  }
}
