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
  outcomeCertainty?: 'FAILED_CONFIRMED' | 'OUTCOME_UNKNOWN';
  raw?: Record<string, unknown>;
}

export interface ProviderEffectMaterial {
  provider: string;
  recipient: string;
  sender?: string;
  subject: string;
  html: string;
  text?: string;
}

export interface ProviderEffectContext {
  effectId: string;
  attemptId: string;
  effectFingerprint: string;
  providerIdempotencyKey?: string;
  material?: ProviderEffectMaterial;
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
  outcomeCertainty?: 'FAILED_CONFIRMED' | 'OUTCOME_UNKNOWN';
}

export interface ChannelAdapter {
  readonly provider: string;
  prepareEffectMaterial?(
    connection: any,
    destination: any,
    payload: PublishPayload,
  ): Promise<ProviderEffectMaterial> | ProviderEffectMaterial;
  publish(
    connection: any,
    destination: any,
    payload: PublishPayload,
    effectContext?: ProviderEffectContext,
  ): Promise<PublishResponse>;
  normalizeError(error: unknown): NormalizedError;
  getCapabilities(platform: string): AdapterCapabilities;
}
