import { BasePublisher, PublishResult } from './base-publisher';

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

      return {
        platform: this.platform,
        success: true,
        platformPostId: data?.data?.id,
        publishedAt: new Date().toISOString(),
      };
    } catch (err) {
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
}
