import { BasePublisher, PublishResult, RecentPost } from './base-publisher';

export class FacebookPublisher extends BasePublisher {
  platform = 'FACEBOOK';

  async publish(connection: any, content: string, mediaUrls?: string[]): Promise<PublishResult> {
    try {
      const pageId = connection.platformId;
      const accessToken = connection.token;

      if (!pageId || !accessToken) {
        return { platform: this.platform, success: false, error: 'Missing page ID or access token' };
      }

      const imageUrls = (mediaUrls ?? []).filter(u =>
        /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(u) ||
        u.includes('drive.google.com') ||
        u.includes('uc?export'),
      );

      if (imageUrls.length === 1) {
        const params = new URLSearchParams();
        params.append('url', imageUrls[0]);
        params.append('message', content);
        params.append('access_token', accessToken);

        const response = await fetch(
          `https://graph.facebook.com/v19.0/${pageId}/photos`,
          { method: 'POST', body: params },
        );
        const data = (await response.json()) as any;
        if (!response.ok) {
          return { platform: this.platform, success: false, error: data?.error?.message || `Facebook photo error: ${response.status}` };
        }
        const fbId = data.post_id || data.id;
        return { platform: this.platform, success: true, platformPostId: fbId, externalUrl: fbId ? `https://www.facebook.com/${fbId}` : undefined, publishedAt: new Date().toISOString() };
      }

      if (imageUrls.length > 1) {
        const photoIds: string[] = [];
        const errors: string[] = [];

        for (const imgUrl of imageUrls.slice(0, 10)) {
          const params = new URLSearchParams();
          params.append('url', imgUrl);
          params.append('published', 'false');
          params.append('access_token', accessToken);

          const res = await fetch(
            `https://graph.facebook.com/v19.0/${pageId}/photos`,
            { method: 'POST', body: params },
          );
          const d = (await res.json()) as any;
          if (res.ok && d.id) {
            photoIds.push(d.id);
          } else {
            errors.push(d?.error?.message || 'Photo upload failed');
          }
        }

        if (photoIds.length === 0) {
          return { platform: this.platform, success: false, error: `All photo uploads failed: ${errors.join('; ')}` };
        }

        const feedParams = new URLSearchParams();
        feedParams.append('message', content);
        feedParams.append('access_token', accessToken);
        photoIds.forEach((pid, i) => {
          feedParams.append(`attached_media[${i}]`, JSON.stringify({ media_fbid: pid }));
        });

        const feedRes = await fetch(
          `https://graph.facebook.com/v19.0/${pageId}/feed`,
          { method: 'POST', body: feedParams },
        );
        const feedData = (await feedRes.json()) as any;
        if (!feedRes.ok) {
          return { platform: this.platform, success: false, error: feedData?.error?.message || 'Facebook multi-photo post failed' };
        }
        return { platform: this.platform, success: true, platformPostId: feedData.id, externalUrl: feedData.id ? `https://www.facebook.com/${feedData.id}` : undefined, publishedAt: new Date().toISOString() };
      }

      const params = new URLSearchParams();
      params.append('message', content);
      params.append('access_token', accessToken);
      if (mediaUrls && mediaUrls.length > 0) {
        params.append('link', mediaUrls[0]);
      }

      const response = await fetch(
        `https://graph.facebook.com/v19.0/${pageId}/feed`,
        { method: 'POST', body: params },
      );
      const data = (await response.json()) as any;

      if (!response.ok) {
        return { platform: this.platform, success: false, error: data?.error?.message || `Facebook API error: ${response.status}` };
      }

      return {
        platform: this.platform,
        success: true,
        platformPostId: data.id,
        externalUrl: data.id ? `https://www.facebook.com/${data.id}` : undefined,
        publishedAt: new Date().toISOString(),
      };
    } catch (err: any) {
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
      const pageId = connection.platformId;
      if (!pageId) return [];
      const res = await fetch(
        `https://graph.facebook.com/v19.0/${pageId}/posts?fields=id,message,created_time,permalink_url&limit=${Math.min(limit, 50)}&access_token=${connection.token}`,
      );
      if (!res.ok) return [];
      const data = (await res.json()) as { data?: Array<{ id: string; message?: string; created_time?: string; permalink_url?: string }> };
      return (data.data ?? []).map((p) => ({
        platform: this.platform,
        platformPostId: p.id,
        content: p.message,
        publishedAt: p.created_time,
        externalUrl: p.permalink_url || `https://www.facebook.com/${p.id}`,
      }));
    } catch {
      return [];
    }
  }
}
