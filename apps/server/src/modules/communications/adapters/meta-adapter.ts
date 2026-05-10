import {
  ChannelAdapter,
  PublishPayload,
  PublishResponse,
  AdapterCapabilities,
  NormalizedError,
} from './channel-adapter.interface';

export class MetaAdapter implements ChannelAdapter {
  readonly provider = 'META';

  async publish(connection: any, destination: any, payload: PublishPayload): Promise<PublishResponse> {
    const platform = destination.platform;
    const meta = (destination?.destinationMeta ?? {}) as { accessToken?: string };
    const accessToken = meta.accessToken || connection.token;
    const pageId = destination.platformId;

    if (!accessToken || !pageId) {
      return { success: false, errorCode: 'MISSING_CREDENTIALS', errorMessage: 'Missing access token or page ID', isTransient: false };
    }

    try {
      if (platform === 'FACEBOOK_PAGE' || platform === 'FACEBOOK') {
        return await this.publishToFacebook(pageId, accessToken, payload);
      } else if (platform === 'INSTAGRAM_BUSINESS' || platform === 'INSTAGRAM') {
        return await this.publishToInstagram(pageId, accessToken, payload);
      }
      return { success: false, errorCode: 'UNSUPPORTED_PLATFORM', errorMessage: `Unsupported Meta platform: ${platform}`, isTransient: false };
    } catch (err) {
      const normalized = this.normalizeError(err);
      return { success: false, errorCode: normalized.code, errorMessage: normalized.message, isTransient: normalized.isTransient };
    }
  }

  private async publishToFacebook(pageId: string, accessToken: string, payload: PublishPayload): Promise<PublishResponse> {
    const imageUrls = (payload.mediaUrls ?? []).filter(u =>
      /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(u) || u.includes('drive.google.com') || u.includes('uc?export'),
    );

    if (imageUrls.length === 1) {
      const params = new URLSearchParams();
      params.append('url', imageUrls[0]);
      params.append('message', payload.textBody ?? '');
      params.append('access_token', accessToken);
      const response = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos`, { method: 'POST', body: params });
      const data = (await response.json()) as any;
      if (!response.ok) {
        return { success: false, errorCode: 'FB_API_ERROR', errorMessage: data?.error?.message ?? `Facebook error: ${response.status}`, isTransient: response.status >= 500 };
      }
      return { success: true, externalPostId: data.post_id || data.id, raw: data };
    }

    if (imageUrls.length > 1) {
      const photoIds: string[] = [];
      for (const imgUrl of imageUrls.slice(0, 10)) {
        const params = new URLSearchParams();
        params.append('url', imgUrl);
        params.append('published', 'false');
        params.append('access_token', accessToken);
        const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos`, { method: 'POST', body: params });
        const d = (await res.json()) as any;
        if (res.ok && d.id) photoIds.push(d.id);
      }
      if (photoIds.length === 0) {
        return { success: false, errorCode: 'FB_UPLOAD_FAILED', errorMessage: 'All photo uploads failed', isTransient: false };
      }
      const feedParams = new URLSearchParams();
      feedParams.append('message', payload.textBody ?? '');
      feedParams.append('access_token', accessToken);
      photoIds.forEach((pid, i) => feedParams.append(`attached_media[${i}]`, JSON.stringify({ media_fbid: pid })));
      const feedRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, { method: 'POST', body: feedParams });
      const feedData = (await feedRes.json()) as any;
      if (!feedRes.ok) {
        return { success: false, errorCode: 'FB_API_ERROR', errorMessage: feedData?.error?.message ?? 'Multi-photo post failed', isTransient: feedRes.status >= 500 };
      }
      return { success: true, externalPostId: feedData.id, raw: feedData };
    }

    const params = new URLSearchParams();
    params.append('message', payload.textBody ?? '');
    params.append('access_token', accessToken);
    if (payload.mediaUrls && payload.mediaUrls.length > 0) params.append('link', payload.mediaUrls[0]);
    const response = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, { method: 'POST', body: params });
    const data = (await response.json()) as any;
    if (!response.ok) {
      return { success: false, errorCode: 'FB_API_ERROR', errorMessage: data?.error?.message ?? `Facebook error: ${response.status}`, isTransient: response.status >= 500 };
    }
    return { success: true, externalPostId: data.id, raw: data };
  }

  private async publishToInstagram(igUserId: string, accessToken: string, payload: PublishPayload): Promise<PublishResponse> {
    if (!payload.mediaUrls || payload.mediaUrls.length === 0) {
      return { success: false, errorCode: 'IG_REQUIRES_IMAGE', errorMessage: 'Instagram requires an image', isTransient: false };
    }

    const containerResponse = await fetch(`https://graph.facebook.com/v19.0/${igUserId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: payload.mediaUrls[0], caption: payload.textBody ?? '', access_token: accessToken }),
    });
    const containerData = (await containerResponse.json()) as any;
    if (!containerResponse.ok) {
      return { success: false, errorCode: 'IG_CONTAINER_ERROR', errorMessage: containerData?.error?.message ?? `Instagram container error: ${containerResponse.status}`, isTransient: containerResponse.status >= 500 };
    }

    const publishResponse = await fetch(`https://graph.facebook.com/v19.0/${igUserId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: containerData.id, access_token: accessToken }),
    });
    const publishData = (await publishResponse.json()) as any;
    if (!publishResponse.ok) {
      return { success: false, errorCode: 'IG_PUBLISH_ERROR', errorMessage: publishData?.error?.message ?? `Instagram publish error: ${publishResponse.status}`, isTransient: publishResponse.status >= 500 };
    }
    return { success: true, externalPostId: publishData.id, raw: publishData };
  }

  normalizeError(error: unknown): NormalizedError {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      const isTransient = msg.includes('timeout') || msg.includes('econnreset') || msg.includes('rate limit') || msg.includes('too many');
      return { code: isTransient ? 'TRANSIENT' : 'META_ERROR', message: error.message, isTransient };
    }
    return { code: 'UNKNOWN', message: String(error), isTransient: false };
  }

  getCapabilities(platform: string): AdapterCapabilities {
    if (platform === 'INSTAGRAM_BUSINESS' || platform === 'INSTAGRAM') {
      return { supports_text_post: false, supports_image_post: true, supports_video_post: true, supports_scheduled_post: false, supports_campaign_email: false, supports_template_message: false };
    }
    return { supports_text_post: true, supports_image_post: true, supports_video_post: true, supports_scheduled_post: false, supports_campaign_email: false, supports_template_message: false };
  }
}
