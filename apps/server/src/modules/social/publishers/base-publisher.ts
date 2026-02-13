export interface PublishResult {
  platform: string;
  success: boolean;
  platformPostId?: string;
  error?: string;
  publishedAt?: string;
}

export abstract class BasePublisher {
  abstract platform: string;
  abstract publish(connection: any, content: string, mediaUrls?: string[]): Promise<PublishResult>;
  abstract validateToken(connection: any): Promise<boolean>;
}
