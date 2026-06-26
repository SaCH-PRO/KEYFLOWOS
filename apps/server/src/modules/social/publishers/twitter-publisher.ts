import { BasePublisher, PublishResult, RecentPost } from './base-publisher';

export class TwitterPublisher extends BasePublisher {
  platform = 'TWITTER';

  async publish(connection: any, content: string, mediaUrls?: string[]): Promise<PublishResult> {
    try {
      const accessToken = connection.token;

      if (!accessToken) {
        return { platform: this.platform, success: false, error: 'Missing Twitter access token' };
      }

      let tweetText = content;
      if (mediaUrls && mediaUrls.length > 0) {
        const urlsToAppend = mediaUrls
          .filter(u => !content.includes(u))
          .slice(0, 4);
        if (urlsToAppend.length > 0) {
          tweetText = `${content}\n\n${urlsToAppend.join('\n')}`;
        }
      }

      if (tweetText.length > 280) {
        tweetText = tweetText.slice(0, 277) + '...';
      }

      const url = 'https://api.twitter.com/2/tweets';

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: tweetText }),
      });

      const data = await response.json() as any;

      if (!response.ok) {
        const errorMsg = data?.detail || data?.title || `Twitter API error: ${response.status}`;
        return { platform: this.platform, success: false, error: errorMsg };
      }

      const tweetId = data?.data?.id as string | undefined;
      const username = (connection.accountName || '').replace(/^@/, '');
      const externalUrl = tweetId
        ? username
          ? `https://twitter.com/${username}/status/${tweetId}`
          : `https://twitter.com/i/web/status/${tweetId}`
        : undefined;
      return {
        platform: this.platform,
        success: true,
        platformPostId: tweetId,
        externalUrl,
        publishedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      return { platform: this.platform, success: false, error: (err as Error).message };
    }
  }

  async validateToken(connection: any): Promise<boolean> {
    try {
      const response = await fetch('https://api.twitter.com/2/users/me', {
        headers: { 'Authorization': `Bearer ${connection.token}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async listRecentPosts(connection: any, limit = 25): Promise<RecentPost[]> {
    try {
      const userId = connection.platformId;
      if (!userId) return [];
      const max = Math.min(limit, 100);
      const res = await fetch(
        `https://api.twitter.com/2/users/${userId}/tweets?max_results=${Math.max(5, max)}&tweet.fields=created_at`,
        { headers: { 'Authorization': `Bearer ${connection.token}` } },
      );
      if (!res.ok) return [];
      const data = (await res.json()) as { data?: Array<{ id: string; text: string; created_at?: string }> };
      const username = (connection.accountName || '').replace(/^@/, '');
      return (data.data ?? []).map((t) => ({
        platform: this.platform,
        platformPostId: t.id,
        content: t.text,
        publishedAt: t.created_at,
        externalUrl: username
          ? `https://twitter.com/${username}/status/${t.id}`
          : `https://twitter.com/i/web/status/${t.id}`,
      }));
    } catch {
      return [];
    }
  }
}
