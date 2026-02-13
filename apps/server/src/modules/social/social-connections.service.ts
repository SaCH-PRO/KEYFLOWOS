import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class SocialConnectionsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });

    if (!business?.metaData) return null;

    const meta = business.metaData as Record<string, any>;
    const creds = meta?.socialCredentials?.[platform.toUpperCase()];

    if (!creds?.clientId || !creds?.clientSecret) return null;

    return { clientId: creds.clientId, clientSecret: creds.clientSecret };
  }
}
