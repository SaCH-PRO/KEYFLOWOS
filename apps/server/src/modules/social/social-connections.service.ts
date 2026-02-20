import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

const ENV_CREDENTIAL_MAP: Record<string, { idKey: string; secretKey: string }> = {
  FACEBOOK: { idKey: 'FACEBOOK_APP_ID', secretKey: 'FACEBOOK_APP_SECRET' },
  INSTAGRAM: { idKey: 'FACEBOOK_APP_ID', secretKey: 'FACEBOOK_APP_SECRET' },
  LINKEDIN: { idKey: 'LINKEDIN_CLIENT_ID', secretKey: 'LINKEDIN_CLIENT_SECRET' },
  TWITTER: { idKey: 'TWITTER_CLIENT_ID', secretKey: 'TWITTER_CLIENT_SECRET' },
  TIKTOK: { idKey: 'TIKTOK_CLIENT_KEY', secretKey: 'TIKTOK_CLIENT_SECRET' },
};

@Injectable()
export class SocialConnectionsService {
  private oauthSessions = new Map<string, { state: string; codeVerifier?: string; platform: string; businessId: string; createdAt: number }>();

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    setInterval(() => this.cleanExpiredSessions(), 5 * 60 * 1000);
  }

  private cleanExpiredSessions() {
    const now = Date.now();
    for (const [key, session] of this.oauthSessions) {
      if (now - session.createdAt > 10 * 60 * 1000) {
        this.oauthSessions.delete(key);
      }
    }
  }

  storeOAuthSession(state: string, data: { codeVerifier?: string; platform: string; businessId: string }) {
    this.oauthSessions.set(state, { state, ...data, createdAt: Date.now() });
  }

  consumeOAuthSession(state: string) {
    const session = this.oauthSessions.get(state);
    if (session) this.oauthSessions.delete(state);
    return session || null;
  }

  async listConnections(businessId: string) {
    return this.prisma.client.socialConnection.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getConnection(businessId: string, platform: string) {
    return this.prisma.client.socialConnection.findFirst({
      where: { businessId, platform: platform.toUpperCase() },
    });
  }

  async upsertConnection(
    businessId: string,
    data: {
      platform: string;
      platformId?: string;
      accountName?: string;
      profilePicture?: string;
      token: string;
      refreshToken?: string;
      expiresAt?: Date;
      scopes?: string;
    },
  ) {
    const platform = data.platform.toUpperCase();
    const existing = await this.prisma.client.socialConnection.findFirst({
      where: { businessId, platform },
    });

    if (existing) {
      return this.prisma.client.socialConnection.update({
        where: { id: existing.id },
        data: {
          platformId: data.platformId ?? existing.platformId,
          accountName: data.accountName ?? existing.accountName,
          profilePicture: data.profilePicture ?? existing.profilePicture,
          token: data.token,
          refreshToken: data.refreshToken ?? existing.refreshToken,
          expiresAt: data.expiresAt ?? existing.expiresAt,
          scopes: data.scopes ?? existing.scopes,
          status: 'CONNECTED',
        },
      });
    }

    return this.prisma.client.socialConnection.create({
      data: {
        businessId,
        platform,
        platformId: data.platformId,
        accountName: data.accountName,
        profilePicture: data.profilePicture,
        token: data.token,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAt,
        scopes: data.scopes,
        status: 'CONNECTED',
      },
    });
  }

  async deleteConnection(businessId: string, platform: string) {
    const existing = await this.prisma.client.socialConnection.findFirst({
      where: { businessId, platform: platform.toUpperCase() },
    });

    if (!existing) {
      return { deleted: false };
    }

    await this.prisma.client.socialConnection.delete({
      where: { id: existing.id },
    });

    return { deleted: true };
  }

  async getPlatformCredentials(
    businessId: string,
    platform: string,
  ): Promise<{ clientId: string; clientSecret: string } | null> {
    const platformUpper = platform.toUpperCase();

    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });

    if (business?.metaData) {
      const meta = business.metaData as Record<string, any>;
      const creds = meta?.socialCredentials?.[platformUpper];
      if (creds?.clientId && creds?.clientSecret) {
        return { clientId: creds.clientId, clientSecret: creds.clientSecret };
      }
    }

    const envMap = ENV_CREDENTIAL_MAP[platformUpper];
    if (envMap) {
      const clientId = process.env[envMap.idKey];
      const clientSecret = process.env[envMap.secretKey];
      if (clientId && clientSecret) {
        return { clientId, clientSecret };
      }
    }

    return null;
  }

  hasPlatformEnvCredentials(platform: string): boolean {
    const envMap = ENV_CREDENTIAL_MAP[platform.toUpperCase()];
    if (!envMap) return false;
    return !!(process.env[envMap.idKey] && process.env[envMap.secretKey]);
  }
}
