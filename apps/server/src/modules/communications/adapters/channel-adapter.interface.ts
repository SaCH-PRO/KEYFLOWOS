export interface PublishPayload {
  textBody?: string;
  htmlBody?: string;
  mediaUrls?: string[];
  subject?: string;
  recipientEmail?: string;
  meta?: Record<string, unknown>;
}

export interface PublishResponse {
  success: boolean;
  externalPostId?: string;
  externalUrl?: string;
  errorCode?: string;
  errorMessage?: string;
  isTransient?: boolean;
  raw?: Record<string, unknown>;
}

export interface AdapterCapabilities {
  supports_text_post: boolean;
  supports_image_post: boolean;
  supports_video_post: boolean;
  supports_scheduled_post: boolean;
  supports_campaign_email: boolean;
  supports_template_message: boolean;
}

export interface NormalizedError {
  code: string;
  message: string;
  isTransient: boolean;
}

export interface ChannelAdapter {
  readonly provider: string;
  publish(connection: any, destination: any, payload: PublishPayload): Promise<PublishResponse>;
  normalizeError(error: unknown): NormalizedError;
  getCapabilities(platform: string): AdapterCapabilities;
}
