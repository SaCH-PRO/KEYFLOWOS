import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { SocialService } from './social.service';
import { SocialConnectionsService } from './social-connections.service';
import { SocialAnalyticsService } from './social-analytics.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { oauthRedirect } from '../../core/config/runtime-urls';

@Controller('social')
export class SocialController {
  constructor(
    @Inject(SocialService) private readonly social: SocialService,
    @Inject(SocialConnectionsService) private readonly connections: SocialConnectionsService,
    @Inject(SocialAnalyticsService) private readonly analytics: SocialAnalyticsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get('health')
  health() {
    return { status: 'ok', module: 'social' };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/posts')
  listPosts(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    const where: Record<string, unknown> = { businessId, deletedAt: null };
    if (status) where.status = status.toUpperCase();
    return this.prisma.client.socialPost.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit ? Math.min(parseInt(limit, 10) || 50, 200) : undefined,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/posts/now')
  async postNow(
    @Param('businessId') businessId: string,
    @Body() body: { content: string; mediaUrls?: string[]; channelIds?: string[] },
  ) {
    if (!body.content || !body.content.trim()) {
      throw new BadRequestException('Post content is required');
    }
    const created = await this.social.createDraft(businessId, body.content, body.mediaUrls ?? [], undefined, body.channelIds);
    const result = await this.social.publishPost(businessId, created.id, body.channelIds);
    return result;
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/posts/schedule')
  async schedulePost(
    @Param('businessId') businessId: string,
    @Body() body: { content: string; mediaUrls?: string[]; channelIds?: string[]; scheduleAt: string },
  ) {
    if (!body.content || !body.content.trim()) {
      throw new BadRequestException('Post content is required');
    }
    if (!body.scheduleAt) {
      throw new BadRequestException('scheduleAt is required');
    }
    const at = new Date(body.scheduleAt);
    if (isNaN(at.getTime())) {
      throw new BadRequestException('scheduleAt must be a valid ISO date');
    }
    if (at.getTime() <= Date.now()) {
      throw new BadRequestException('scheduleAt must be in the future');
    }
    return this.social.createDraft(businessId, body.content, body.mediaUrls ?? [], at.toISOString(), body.channelIds);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/recent-posts')
  async recentPosts(@Param('businessId') businessId: string, @Query('platform') platform?: string) {
    return this.social.fetchRecentExternalPosts(businessId, platform);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/posts')
  createPost(
    @Param('businessId') businessId: string,
    @Body() body: { content: string; mediaUrls?: string[]; scheduledFor?: string; channelIds?: string[] },
  ) {
    return this.social.createDraft(businessId, body.content, body.mediaUrls ?? [], body.scheduledFor, body.channelIds);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/posts/:postId')
  updatePost(
    @Param('businessId') businessId: string,
    @Param('postId') postId: string,
    @Body() body: { content?: string; scheduledAt?: string | null; channelIds?: string[]; mediaUrls?: string[] },
  ) {
    return this.social.updatePost(businessId, postId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/posts/:postId')
  deletePost(@Param('businessId') businessId: string, @Param('postId') postId: string) {
    return this.social.deletePost(businessId, postId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/posts/:postId/publish')
  publish(
    @Param('businessId') businessId: string,
    @Param('postId') postId: string,
    @Body() body: { channelIds?: string[] },
  ) {
    return this.social.publishPost(businessId, postId, body?.channelIds);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/connections')
  listConnections(@Param('businessId') businessId: string) {
    return this.connections.listConnections(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/connections/oauth-availability')
  async oauthAvailability(@Param('businessId') businessId: string) {
    const platforms = ['FACEBOOK', 'INSTAGRAM', 'LINKEDIN', 'TWITTER', 'TIKTOK'];
    const result: Record<string, boolean> = {};
    for (const p of platforms) {
      const creds = await this.connections.getPlatformCredentials(businessId, p);
      result[p] = !!creds;
    }
    return result;
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/connections/:platform')
  deleteConnection(
    @Param('businessId') businessId: string,
    @Param('platform') platform: string,
    @Query('platformId') platformId?: string,
  ) {
    return this.connections.deleteConnection(businessId, platform, platformId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/connections/:platform/oauth/start')
  async oauthStart(@Param('businessId') businessId: string, @Param('platform') platform: string) {
    const creds = await this.connections.getPlatformCredentials(businessId, platform);
    if (!creds) {
      throw new BadRequestException(`No OAuth credentials configured for ${platform}. Add ${platform.toUpperCase()} app credentials in Settings or as environment variables.`);
    }

    const redirectUri = oauthRedirect(`/app/social/oauth/${platform.toLowerCase()}/callback`);
    const platformUpper = platform.toUpperCase();
    const stateToken = randomBytes(16).toString('hex');
    let authUrl: string;

    switch (platformUpper) {
      case 'FACEBOOK':
        authUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${creds.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=pages_show_list,pages_manage_posts,pages_read_engagement,pages_manage_metadata,business_management&response_type=code&auth_type=rerequest&state=${stateToken}`;
        this.connections.storeOAuthSession(stateToken, { platform: platformUpper, businessId });
        break;
      case 'INSTAGRAM':
        authUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${creds.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,business_management&response_type=code&auth_type=rerequest&state=${stateToken}`;
        this.connections.storeOAuthSession(stateToken, { platform: platformUpper, businessId });
        break;
      case 'LINKEDIN':
        authUrl = `https://www.linkedin.com/oauth/v2/authorization?client_id=${creds.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=w_member_social&response_type=code&state=${stateToken}`;
        this.connections.storeOAuthSession(stateToken, { platform: platformUpper, businessId });
        break;
      case 'TWITTER': {
        const codeVerifier = randomBytes(32).toString('base64url');
        const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
        authUrl = `https://twitter.com/i/oauth2/authorize?client_id=${creds.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=tweet.write%20tweet.read%20users.read&response_type=code&code_challenge=${codeChallenge}&code_challenge_method=S256&state=${stateToken}`;
        this.connections.storeOAuthSession(stateToken, { codeVerifier, platform: platformUpper, businessId });
        break;
      }
      case 'TIKTOK': {
        authUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=${creds.clientId}&response_type=code&scope=user.info.basic,video.publish,video.upload&redirect_uri=${encodeURIComponent(redirectUri)}&state=${stateToken}`;
        this.connections.storeOAuthSession(stateToken, { platform: platformUpper, businessId });
        break;
      }
      default:
        throw new BadRequestException(`Unsupported platform: ${platform}`);
    }

    return { authUrl, redirectUri, state: stateToken };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/connections/:platform/oauth/callback')
  async oauthCallback(
    @Param('businessId') businessId: string,
    @Param('platform') platform: string,
    @Body() body: { code: string; state: string },
  ) {
    if (!body.code) {
      throw new BadRequestException('Authorization code is required');
    }
    if (!body.state) {
      throw new BadRequestException('OAuth state parameter is required for CSRF protection');
    }

    const session = this.connections.consumeOAuthSession(body.state);
    if (!session) {
      throw new BadRequestException('Invalid or expired OAuth state. Please try connecting again.');
    }
    if (session.businessId !== businessId || session.platform !== platform.toUpperCase()) {
      throw new BadRequestException('OAuth state mismatch. Please try connecting again.');
    }
    const codeVerifier = session.codeVerifier;

    const creds = await this.connections.getPlatformCredentials(businessId, platform);
    if (!creds) {
      throw new BadRequestException(`No OAuth credentials configured for ${platform}`);
    }

    const redirectUri = oauthRedirect(`/app/social/oauth/${platform.toLowerCase()}/callback`);

    const platformUpper = platform.toUpperCase();

    try {
      let tokenData: any;

      switch (platformUpper) {
        case 'FACEBOOK':
        case 'INSTAGRAM': {
          const tokenUrl = `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${creds.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${creds.clientSecret}&code=${body.code}`;
          const tokenRes = await fetch(tokenUrl);
          tokenData = await tokenRes.json() as any;

          if (tokenData.error) {
            throw new Error(tokenData.error.message || 'Failed to exchange code');
          }

          if (platformUpper === 'FACEBOOK') {
            const pagesRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token,tasks,picture&access_token=${tokenData.access_token}`);
            const pagesData = await pagesRes.json() as any;
            const pages: any[] = Array.isArray(pagesData?.data) ? pagesData.data : [];

            if (pages.length === 0) {
              throw new Error('No Facebook Pages found for this account. Make sure you are a Page admin and granted "Show a list of the Pages you manage".');
            }

            const saved = [];
            for (const page of pages) {
              if (Array.isArray(page.tasks) && !page.tasks.includes('CREATE_CONTENT')) continue;
              const connection = await this.connections.upsertConnection(businessId, {
                platform: 'FACEBOOK',
                platformId: page.id,
                accountName: page.name,
                profilePicture: page.picture?.data?.url,
                token: page.access_token,
                scopes: 'pages_manage_posts,pages_read_engagement',
              });
              saved.push(connection);
            }

            if (saved.length === 0) {
              throw new Error('You are not an admin on any of the returned Pages. Add yourself as a Page admin in Meta Business Suite, then reconnect.');
            }
            return { success: true, connection: saved[0], connections: saved };
          }

          const profileRes = await fetch(`https://graph.facebook.com/v19.0/me?access_token=${tokenData.access_token}&fields=id,name,picture`);
          const profile = await profileRes.json() as any;

          if (platformUpper === 'INSTAGRAM') {
            const pagesRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token&access_token=${tokenData.access_token}`);
            const pagesData = await pagesRes.json() as any;
            const pages: any[] = Array.isArray(pagesData?.data) ? pagesData.data : [];

            const saved = [];
            for (const page of pages) {
              const igRes = await fetch(`https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`);
              const igData = await igRes.json() as any;
              const igAccountId = igData?.instagram_business_account?.id;
              if (!igAccountId) continue;

              const igProfileRes = await fetch(`https://graph.facebook.com/v19.0/${igAccountId}?fields=id,name,username,profile_picture_url&access_token=${page.access_token}`);
              const igProfile = await igProfileRes.json() as any;

              const connection = await this.connections.upsertConnection(businessId, {
                platform: 'INSTAGRAM',
                platformId: igAccountId,
                accountName: igProfile.username ? `@${igProfile.username}` : igProfile.name || page.name,
                profilePicture: igProfile.profile_picture_url,
                token: page.access_token,
                scopes: 'instagram_basic,instagram_content_publish',
              });
              saved.push(connection);
            }

            if (saved.length === 0) {
              throw new Error('No Instagram Business accounts found. Link your IG account to a Facebook Page in Meta Business Suite, then reconnect.');
            }
            return { success: true, connection: saved[0], connections: saved };
          }

          const connection = await this.connections.upsertConnection(businessId, {
            platform: platformUpper,
            platformId: profile.id,
            accountName: profile.name,
            profilePicture: profile.picture?.data?.url,
            token: tokenData.access_token,
            expiresAt: tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : undefined,
            scopes: platformUpper === 'FACEBOOK' ? 'pages_manage_posts,pages_read_engagement' : 'instagram_basic,instagram_content_publish',
          });

          return { success: true, connection };
        }
        case 'LINKEDIN': {
          const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              code: body.code,
              redirect_uri: redirectUri,
              client_id: creds.clientId,
              client_secret: creds.clientSecret,
            }).toString(),
          });
          tokenData = await tokenRes.json() as any;

          if (tokenData.error) {
            throw new Error(tokenData.error_description || 'Failed to exchange code');
          }

          const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
            headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
          });
          const profile = await profileRes.json() as any;

          const connection = await this.connections.upsertConnection(businessId, {
            platform: 'LINKEDIN',
            platformId: profile.sub ? `urn:li:person:${profile.sub}` : undefined,
            accountName: profile.name || `${profile.given_name || ''} ${profile.family_name || ''}`.trim(),
            profilePicture: profile.picture,
            token: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresAt: tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : undefined,
            scopes: 'w_member_social',
          });

          return { success: true, connection };
        }
        case 'TWITTER': {
          if (!codeVerifier) {
            throw new BadRequestException('Missing PKCE code verifier. Please try connecting again.');
          }
          const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Authorization': `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')}`,
            },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              code: body.code,
              redirect_uri: redirectUri,
              code_verifier: codeVerifier,
            }).toString(),
          });
          tokenData = await tokenRes.json() as any;

          if (tokenData.error) {
            throw new Error(tokenData.error_description || 'Failed to exchange code');
          }

          const profileRes = await fetch('https://api.twitter.com/2/users/me', {
            headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
          });
          const twitterProfile = await profileRes.json() as any;

          const connection = await this.connections.upsertConnection(businessId, {
            platform: 'TWITTER',
            platformId: twitterProfile.data?.id,
            accountName: twitterProfile.data?.username ? `@${twitterProfile.data.username}` : undefined,
            profilePicture: twitterProfile.data?.profile_image_url,
            token: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresAt: tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : undefined,
            scopes: 'tweet.write tweet.read users.read',
          });

          return { success: true, connection };
        }
        case 'TIKTOK': {
          const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_key: creds.clientId,
              client_secret: creds.clientSecret,
              code: body.code,
              grant_type: 'authorization_code',
              redirect_uri: redirectUri,
            }).toString(),
          });
          tokenData = await tokenRes.json() as any;

          if (tokenData.error || !tokenData.access_token) {
            throw new Error(tokenData.error_description || tokenData.message || 'Failed to exchange TikTok code');
          }

          const profileRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url', {
            headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
          });
          const profileData = await profileRes.json() as any;
          const tiktokUser = profileData?.data?.user;

          const connection = await this.connections.upsertConnection(businessId, {
            platform: 'TIKTOK',
            platformId: tiktokUser?.open_id || tokenData.open_id,
            accountName: tiktokUser?.display_name || 'TikTok User',
            profilePicture: tiktokUser?.avatar_url,
            token: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresAt: tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : undefined,
            scopes: 'user.info.basic,video.publish,video.upload',
          });

          return { success: true, connection };
        }
        default:
          throw new BadRequestException(`Unsupported platform: ${platform}`);
      }
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/analytics')
  getAnalytics(@Param('businessId') businessId: string) {
    return this.analytics.getAnalyticsOverview(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/account-metrics')
  getAccountMetrics(@Param('businessId') businessId: string) {
    return this.analytics.getAccountMetrics(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/connections/:platform/test')
  async testConnection(
    @Param('businessId') businessId: string,
    @Param('platform') platform: string,
  ) {
    const conn = await this.connections.getConnection(businessId, platform);
    if (!conn) {
      return { success: false, error: 'No connection found for this platform' };
    }

    const platformUpper = platform.toUpperCase();

    try {
      switch (platformUpper) {
        case 'FACEBOOK': {
          const res = await fetch(`https://graph.facebook.com/v19.0/me?access_token=${conn.token}&fields=id,name`);
          const data = await res.json() as any;
          if (data.error) return { success: false, error: data.error.message, status: 'EXPIRED' };
          return { success: true, account: { id: data.id, name: data.name }, status: 'CONNECTED' };
        }
        case 'INSTAGRAM': {
          const res = await fetch(`https://graph.facebook.com/v19.0/me?access_token=${conn.token}&fields=id,name`);
          const data = await res.json() as any;
          if (data.error) return { success: false, error: data.error.message, status: 'EXPIRED' };
          return { success: true, account: { id: data.id, name: data.name }, status: 'CONNECTED' };
        }
        case 'LINKEDIN': {
          const res = await fetch('https://api.linkedin.com/v2/userinfo', {
            headers: { 'Authorization': `Bearer ${conn.token}` },
          });
          if (!res.ok) {
            const errText = await res.text();
            return { success: false, error: `LinkedIn API error: ${res.status}`, status: 'EXPIRED' };
          }
          const data = await res.json() as any;
          return { success: true, account: { id: data.sub, name: data.name }, status: 'CONNECTED' };
        }
        case 'TWITTER': {
          const res = await fetch('https://api.twitter.com/2/users/me', {
            headers: { 'Authorization': `Bearer ${conn.token}` },
          });
          const data = await res.json() as any;
          if (data.errors || !data.data) return { success: false, error: data.errors?.[0]?.message || 'Invalid token', status: 'EXPIRED' };
          return { success: true, account: { id: data.data.id, name: `@${data.data.username}` }, status: 'CONNECTED' };
        }
        case 'TIKTOK': {
          const res = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name', {
            headers: { 'Authorization': `Bearer ${conn.token}` },
          });
          const data = await res.json() as any;
          if (data.error?.code !== 'ok' && data.error?.code) {
            return { success: false, error: data.error.message || 'Token invalid', status: 'EXPIRED' };
          }
          const user = data?.data?.user;
          return { success: true, account: { id: user?.open_id, name: user?.display_name }, status: 'CONNECTED' };
        }
        default:
          return { success: false, error: `Unsupported platform: ${platform}` };
      }
    } catch (err) {
      return { success: false, error: (err as Error).message, status: 'ERROR' };
    }
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/connections/:platform/manual')
  async manualConnect(
    @Param('businessId') businessId: string,
    @Param('platform') platform: string,
    @Body() body: {
      token: string;
      platformId?: string;
      accountName?: string;
      refreshToken?: string;
      expiresAt?: string;
      scopes?: string;
    },
  ) {
    if (!body.token) {
      throw new BadRequestException('Token is required');
    }

    const connection = await this.connections.upsertConnection(businessId, {
      platform: platform.toUpperCase(),
      platformId: body.platformId,
      accountName: body.accountName,
      token: body.token,
      refreshToken: body.refreshToken,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
      scopes: body.scopes,
    });

    return { success: true, connection };
  }
}
