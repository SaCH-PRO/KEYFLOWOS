import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards, BadRequestException } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { SocialService } from './social.service';
import { SocialConnectionsService } from './social-connections.service';
import { PrismaService } from '../../core/prisma/prisma.service';

@Controller('social')
export class SocialController {
  constructor(
    @Inject(SocialService) private readonly social: SocialService,
    @Inject(SocialConnectionsService) private readonly connections: SocialConnectionsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get('health')
  health() {
    return { status: 'ok', module: 'social' };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/posts')
  listPosts(@Param('businessId') businessId: string) {
    return this.prisma.client.socialPost.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
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
    @Body() body: { content?: string; scheduledAt?: string | null; channelIds?: string[] },
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
  @Delete('businesses/:businessId/connections/:platform')
  deleteConnection(@Param('businessId') businessId: string, @Param('platform') platform: string) {
    return this.connections.deleteConnection(businessId, platform);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/connections/:platform/oauth/start')
  async oauthStart(@Param('businessId') businessId: string, @Param('platform') platform: string) {
    const creds = await this.connections.getPlatformCredentials(businessId, platform);
    if (!creds) {
      throw new BadRequestException(`No OAuth credentials configured for ${platform}. Set them in business metaData.socialCredentials.${platform.toUpperCase()}`);
    }

    const domain = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS?.split(',')[0] || '';
    const redirectUri = `https://${domain}/app/social/oauth/${platform.toLowerCase()}/callback`;

    const platformUpper = platform.toUpperCase();
    let authUrl: string;

    switch (platformUpper) {
      case 'FACEBOOK':
        authUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${creds.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=pages_manage_posts,pages_read_engagement&response_type=code`;
        break;
      case 'INSTAGRAM':
        authUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${creds.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=instagram_basic,instagram_content_publish,pages_show_list&response_type=code`;
        break;
      case 'LINKEDIN':
        authUrl = `https://www.linkedin.com/oauth/v2/authorization?client_id=${creds.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=w_member_social&response_type=code`;
        break;
      case 'TWITTER': {
        const codeVerifier = randomBytes(32).toString('base64url');
        const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
        const stateToken = randomBytes(16).toString('hex');
        authUrl = `https://twitter.com/i/oauth2/authorize?client_id=${creds.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=tweet.write%20tweet.read%20users.read&response_type=code&code_challenge=${codeChallenge}&code_challenge_method=S256&state=${stateToken}`;
        return { authUrl, redirectUri, codeVerifier, state: stateToken };
      }
      default:
        throw new BadRequestException(`Unsupported platform: ${platform}`);
    }

    return { authUrl, redirectUri };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/connections/:platform/oauth/callback')
  async oauthCallback(
    @Param('businessId') businessId: string,
    @Param('platform') platform: string,
    @Body() body: { code: string; codeVerifier?: string },
  ) {
    if (!body.code) {
      throw new BadRequestException('Authorization code is required');
    }

    const creds = await this.connections.getPlatformCredentials(businessId, platform);
    if (!creds) {
      throw new BadRequestException(`No OAuth credentials configured for ${platform}`);
    }

    const domain = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS?.split(',')[0] || '';
    const redirectUri = `https://${domain}/app/social/oauth/${platform.toLowerCase()}/callback`;

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

          const profileRes = await fetch(`https://graph.facebook.com/v19.0/me?access_token=${tokenData.access_token}&fields=id,name,picture`);
          const profile = await profileRes.json() as any;

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

          const profileRes = await fetch('https://api.linkedin.com/v2/me', {
            headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
          });
          const profile = await profileRes.json() as any;

          const connection = await this.connections.upsertConnection(businessId, {
            platform: 'LINKEDIN',
            platformId: `urn:li:person:${profile.id}`,
            accountName: `${profile.localizedFirstName || ''} ${profile.localizedLastName || ''}`.trim(),
            token: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresAt: tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : undefined,
            scopes: 'w_member_social',
          });

          return { success: true, connection };
        }
        case 'TWITTER': {
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
              code_verifier: body.codeVerifier || 'challenge',
            }).toString(),
          });
          tokenData = await tokenRes.json() as any;

          if (tokenData.error) {
            throw new Error(tokenData.error_description || 'Failed to exchange code');
          }

          const profileRes = await fetch('https://api.twitter.com/2/users/me', {
            headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
          });
          const profile = await profileRes.json() as any;

          const connection = await this.connections.upsertConnection(businessId, {
            platform: 'TWITTER',
            platformId: profile.data?.id,
            accountName: profile.data?.username ? `@${profile.data.username}` : undefined,
            profilePicture: profile.data?.profile_image_url,
            token: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresAt: tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : undefined,
            scopes: 'tweet.write tweet.read users.read',
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
