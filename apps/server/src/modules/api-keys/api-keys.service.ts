import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { createHash, randomBytes } from 'crypto';

@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listKeys(businessId: string) {
    const keys = await this.prisma.client.apiKey.findMany({
      where: { businessId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });
    return keys.map((k: { id: string; name: string; prefix: string; scopes: string[]; lastUsedAt: Date | null; createdAt: Date }) => ({
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      scopes: k.scopes,
      lastUsed: k.lastUsedAt?.toISOString() ?? null,
      createdAt: k.createdAt.toISOString(),
    }));
  }

  async createKey(businessId: string, name: string, scopes: string[]) {
    const rawKey = `kf_${randomBytes(32).toString('hex')}`;
    const prefix = rawKey.slice(0, 8);
    const hashedKey = createHash('sha256').update(rawKey).digest('hex');

    const apiKey = await this.prisma.client.apiKey.create({
      data: {
        businessId,
        name,
        prefix,
        hashedKey,
        scopes,
      },
    });

    return {
      key: rawKey,
      apiKey: {
        id: apiKey.id,
        name: apiKey.name,
        prefix: apiKey.prefix,
        scopes: apiKey.scopes,
        lastUsed: null,
        createdAt: apiKey.createdAt.toISOString(),
      },
    };
  }

  /**
   * SWEEP-P0-SCOPES (browser sweep BUG-013): revoking an API key is the owner's. The owner is
   * whoever holds an OWNER membership of this business (owner rulings D-116 / D-125: a co-owner
   * holding OWNER is the owner; the recorded owner holding only ADMIN or STAFF is that role, and
   * Business.ownerId grants nothing on its own). A SUPER_ADMIN keeps the platform bypass
   * BusinessGuard and ModuleScopeGuard grant it, as IdentityService.assertBusinessOwner (D-11) does.
   * A key records no creator, so a member cannot be told their own key from the owner's: anyone
   * below the owner is refused for every key.
   */
  async assertMayRevoke(businessId: string, actor: { id?: string; role?: string } | undefined): Promise<void> {
    if (!actor?.id) throw new ForbiddenException('Authentication required');
    if (actor.role === 'SUPER_ADMIN') return;
    const membership = await this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId: actor.id, businessId } },
      select: { role: true },
    });
    if (membership?.role !== 'OWNER') {
      throw new ForbiddenException('Only the business owner can revoke an API key');
    }
  }

  async revokeKey(businessId: string, keyId: string) {
    await this.prisma.client.apiKey.updateMany({
      where: { id: keyId, businessId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async validateKey(rawKey: string) {
    const prefix = rawKey.slice(0, 8);
    const hashedKey = createHash('sha256').update(rawKey).digest('hex');

    const key = await this.prisma.client.apiKey.findFirst({
      where: { prefix, hashedKey, revokedAt: null },
    });

    if (!key) return null;

    await this.prisma.client.apiKey.update({
      where: { id: key.id },
      data: { lastUsedAt: new Date() },
    });

    return { businessId: key.businessId, scopes: key.scopes, keyId: key.id };
  }
}
