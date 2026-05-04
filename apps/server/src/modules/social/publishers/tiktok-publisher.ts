import { BasePublisher, PublishResult, RecentPost } from './base-publisher';

export class TikTokPublisher extends BasePublisher {
  platform = 'TIKTOK';

  async publish(connection: any, content: string, mediaUrls?: string[]): Promise<PublishResult> {
    try {
      const accessToken = connection.token;

      if (!accessToken) {
        return { platform: this.platform, success: false, error: 'Missing TikTok access token' };
      }

      if (!mediaUrls || mediaUrls.length === 0) {
        return await this.publishTextPost(accessToken, content);
      }

      const videoUrl = mediaUrls.find(u => /\.(mp4|mov|avi|webm)$/i.test(u));
      const imageUrl = mediaUrls.find(u => /\.(jpg|jpeg|png|gif|webp)$/i.test(u));

      if (videoUrl) {
        return await this.publishVideo(accessToken, content, videoUrl);
      } else if (imageUrl) {
        return await this.publishPhoto(accessToken, content, [imageUrl]);
      }

      return await this.publishTextPost(accessToken, content);
    } catch (err) {
      return { platform: this.platform, success: false, error: (err as Error).message };
    }
  }

  private async publishTextPost(accessToken: string, content: string): Promise<PublishResult> {
    const response = await fetch('https://open.tiktokapis.com/v2/post/publish/content/init/', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        post_info: {
          title: content.slice(0, 150),
          privacy_level: 'PUBLIC_TO_EVERYONE',
          disable_comment: false,
        },
        source_info: {
          source: 'PULL_FROM_URL',
          video_url: '',
        },
      }),
    });

    const data = await response.json() as any;

    if (data.error?.code !== 'ok' && !response.ok) {
      return {
        platform: this.platform,
        success: false,
        error: data.error?.message || `TikTok API error: ${response.status}`,
      };
    }

    return {
      platform: this.platform,
      success: true,
      platformPostId: data.data?.publish_id,
      publishedAt: new Date().toISOString(),
    };
  }

  private async publishVideo(accessToken: string, content: string, videoUrl: string): Promise<PublishResult> {
    const response = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        post_info: {
          title: content.slice(0, 150),
          privacy_level: 'PUBLIC_TO_EVERYONE',
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: 'PULL_FROM_URL',
          video_url: videoUrl,
        },
      }),
    });

    const data = await response.json() as any;

    if (data.error?.code !== 'ok' && !response.ok) {
      return {
        platform: this.platform,
        success: false,
        error: data.error?.message || `TikTok video publish error: ${response.status}`,
      };
    }

    return {
      platform: this.platform,
      success: true,
      platformPostId: data.data?.publish_id,
      publishedAt: new Date().toISOString(),
    };
  }

  private async publishPhoto(accessToken: string, content: string, imageUrls: string[]): Promise<PublishResult> {
    const response = await fetch('https://open.tiktokapis.com/v2/post/publish/content/init/', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        post_info: {
          title: content.slice(0, 150),
          privacy_level: 'PUBLIC_TO_EVERYONE',
          disable_comment: false,
        },
        source_info: {
          source: 'PULL_FROM_URL',
          photo_images: imageUrls,
        },
      }),
    });

    const data = await response.json() as any;

    if (data.error?.code !== 'ok' && !response.ok) {
      return {
        platform: this.platform,
        success: false,
        error: data.error?.message || `TikTok photo publish error: ${response.status}`,
      };
    }

    return {
      platform: this.platform,
      success: true,
      platformPostId: data.data?.publish_id,
      publishedAt: new Date().toISOString(),
    };
  }

  async validateToken(connection: any): Promise<boolean> {
    try {
      const response = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name', {
        headers: { 'Authorization': `Bearer ${connection.token}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async listRecentPosts(connection: any, limit = 25): Promise<RecentPost[]> {
    try {
      const res = await fetch(
        'https://open.tiktokapis.com/v2/video/list/?fields=id,title,create_time,share_url,video_description',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${connection.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ max_count: Math.min(limit, 20) }),
        },
      );
      if (!res.ok) return [];
      const data = (await res.json()) as { data?: { videos?: Array<{ id: string; title?: string; video_description?: string; create_time?: number; share_url?: string }> } };
      return (data.data?.videos ?? []).map((v) => ({
        platform: this.platform,
        platformPostId: v.id,
        content: v.title || v.video_description,
        publishedAt: v.create_time ? new Date(v.create_time * 1000).toISOString() : undefined,
        externalUrl: v.share_url,
      }));
    } catch {
      return [];
    }
  }
}
