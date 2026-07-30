import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

/**
 * Determines whether KEY has a valid L4 authority grant for an action.
 */
@Injectable()
export class AuthorityGrantRuleService {
  constructor(private readonly prisma: PrismaService) {}

  async hasValidGrant(businessId: string, actionKey: string): Promise<boolean> {
    const scope = this.inferScope(actionKey);
    if (!scope) return false;

    try {
      const grant = await this.prisma.client.authorityGrant.findFirst({
        where: {
          businessId,
          granteeType: 'KEY',
          granteeId: 'key_ai',
          scope,
          revokedAt: null,
          validFrom: { lte: new Date() },
          OR: [{ validUntil: null }, { validUntil: { gte: new Date() } }],
        },
      });
      return !!grant;
    } catch {
      return false;
    }
  }

  private inferScope(actionKey: string): string | null {
    const key = actionKey.toLowerCase();
    if (key.includes('publish') || key.includes('send') || key.includes('post')) {
      return 'tier4_publishing';
    }
    if (key.includes('invoice') || key.includes('payment') || key.includes('refund') || key.includes('expense')) {
      return 'tier4_financial';
    }
    if (key.includes('deliver') || key.includes('upload') || key.includes('deploy')) {
      return 'tier4_operations';
    }
    return null;
  }
}
