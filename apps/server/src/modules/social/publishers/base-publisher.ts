export interface PublishResult {
  platform: string;
  success: boolean;
  platformPostId?: string;
  externalUrl?: string;
  error?: string;
  publishedAt?: string;
}

export interface RecentPost {
  platform: string;
  platformPostId: string;
  content?: string;
  externalUrl?: string;
  publishedAt?: string;
}

export abstract class BasePublisher {
  abstract platform: string;
  abstract publish(connection: any, content: string, mediaUrls?: string[]): Promise<PublishResult>;
  abstract validateToken(connection: any): Promise<boolean>;

  async listRecentPosts(_connection: any, _limit = 25): Promise<RecentPost[]> {
    return [];
  }
}
