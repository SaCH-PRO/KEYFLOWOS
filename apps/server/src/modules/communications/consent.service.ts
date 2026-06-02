import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface ConsentCheckResult {
  canContact: boolean;
  canRecordCall: boolean;
  canSendMarketing: boolean;
  channel: string;
  status: string;
  evidence?: string;
  grantedAt?: Date;
  revokedAt?: Date;
}

/**
 * Consent tracking for calls, SMS, WhatsApp, email.
 *
 * - Records explicit opt-in/opt-out
 * - Checks before sending marketing messages
 * - Call recording consent for legal compliance
 */
@Injectable()
export class ConsentService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async recordConsent(
    businessId: string,
    contactId: string,
    input: {
      channel: string;
      consentType: 'marketing' | 'recording' | 'all';
      status: 'granted' | 'revoked' | 'pending';
      source: string;
      evidence?: string;
    },
  ) {
    return this.prisma.client.consentRecord.create({
      data: {
        businessId,
        contactId,
        channel: input.channel,
        consentType: input.consentType,
        status: input.status,
        source: input.source,
        evidence: input.evidence ? { text: input.evidence } : {},
        grantedAt: input.status === 'granted' ? new Date() : null,
        revokedAt: input.status === 'revoked' ? new Date() : null,
      },
    });
  }

  async checkConsent(
    businessId: string,
    contactId: string,
    channel: string,
    consentType: 'marketing' | 'recording' = 'marketing',
  ): Promise<ConsentCheckResult> {
    const record = await this.prisma.client.consentRecord.findFirst({
      where: { businessId, contactId, channel, consentType },
      orderBy: { createdAt: 'desc' },
    });

    const status = record?.status ?? 'pending';
    const canContact = status !== 'revoked';
    const canRecordCall = consentType === 'recording' ? status === 'granted' : canContact;
    const canSendMarketing = consentType === 'marketing' ? status === 'granted' : canContact;

    return {
      canContact,
      canRecordCall,
      canSendMarketing,
      channel,
      status,
      evidence: record?.evidence ? JSON.stringify(record.evidence) : undefined,
      grantedAt: record?.grantedAt ?? undefined,
      revokedAt: record?.revokedAt ?? undefined,
    };
  }

  async listConsentRecords(
    businessId: string,
    contactId?: string,
    filters?: { channel?: string; consentType?: string; status?: string },
  ) {
    const where: Record<string, unknown> = { businessId };
    if (contactId) where.contactId = contactId;
    if (filters?.channel) where.channel = filters.channel;
    if (filters?.consentType) where.consentType = filters.consentType;
    if (filters?.status) where.status = filters.status;

    return this.prisma.client.consentRecord.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
