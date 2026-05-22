import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface LeadMagnetConfig {
  id: string;
  title: string;
  description?: string;
  contentUrl?: string;
  contentType: 'pdf' | 'video' | 'guide' | 'checklist';
  sequenceId?: string; // CRM sequence to enroll in
  publicSlug: string;
  isActive: boolean;
}

@Injectable()
export class LeadMagnetService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createLeadMagnet(businessId: string, data: Omit<LeadMagnetConfig, 'id'>): Promise<LeadMagnetConfig> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });
    const meta = (business?.metaData as Record<string, any>) ?? {};
    const magnets = [...(meta.leadMagnets as LeadMagnetConfig[] ?? [])];
    const newMagnet: LeadMagnetConfig = {
      ...data,
      id: `lm_${Date.now()}`,
    };
    magnets.push(newMagnet);
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { metaData: { ...meta, leadMagnets: magnets } },
    });
    return newMagnet;
  }

  async listLeadMagnets(businessId: string): Promise<LeadMagnetConfig[]> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });
    const meta = (business?.metaData as Record<string, any>) ?? {};
    return (meta.leadMagnets as LeadMagnetConfig[] ?? []).filter((m) => m.isActive);
  }

  async getLeadMagnetBySlug(businessId: string, slug: string): Promise<LeadMagnetConfig | null> {
    const magnets = await this.listLeadMagnets(businessId);
    return magnets.find((m) => m.publicSlug === slug) ?? null;
  }

  async recordLeadMagnetConversion(
    businessId: string,
    slug: string,
    contactData: { name: string; email: string; phone?: string },
  ) {
    const magnet = await this.getLeadMagnetBySlug(businessId, slug);
    if (!magnet) throw new Error('Lead magnet not found');

    // Create or update contact
    const existing = await this.prisma.client.contact.findFirst({
      where: { businessId, email: { equals: contactData.email, mode: 'insensitive' } },
    });

    let contactId: string;
    if (existing) {
      contactId = existing.id;
      const custom = (existing.custom as Record<string, any>) ?? {};
      await this.prisma.client.contact.update({
        where: { id: contactId },
        data: {
          custom: {
            ...custom,
            leadMagnetSource: magnet.title,
            leadMagnetConvertedAt: new Date().toISOString(),
          },
        },
      });
    } else {
      const nameParts = contactData.name.trim().split(' ');
      const newContact = await this.prisma.client.contact.create({
        data: {
          businessId,
          firstName: nameParts[0],
          lastName: nameParts.slice(1).join(' ') || null,
          email: contactData.email,
          phone: contactData.phone ?? null,
          status: 'LEAD',
          source: 'lead_magnet',
          sourceDetail: magnet.title,
          custom: {
            leadMagnetSource: magnet.title,
            leadMagnetConvertedAt: new Date().toISOString(),
          },
        },
      });
      contactId = newContact.id;
    }

    // Enroll in sequence if configured
    if (magnet.sequenceId) {
      try {
        // This would call CRM sequence enrollment - simplified here
        await this.prisma.client.scheduledAgentJob.create({
          data: {
            businessId,
            jobType: 'lead_magnet_enroll',
            entityId: contactId,
            checkpoint: `enroll_${magnet.sequenceId}`,
            status: 'PENDING',
            scheduledFor: new Date(),
            payload: { sequenceId: magnet.sequenceId, contactId },
          },
        });
      } catch {
        // Sequence enrollment is best-effort
      }
    }

    return { contactId, magnet };
  }
}
