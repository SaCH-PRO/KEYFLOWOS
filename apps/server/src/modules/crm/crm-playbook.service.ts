import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class CrmPlaybookService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreatePlaybook(params: { businessId: string; contactId: string; type?: string }) {
    const type = params.type ?? 'default';
    let playbook = await this.prisma.client.contactPlaybook.findFirst({
      where: {
        businessId: params.businessId,
        contactId: params.contactId,
        type,
      },
    });
    if (!playbook) {
      playbook = await this.prisma.client.contactPlaybook.create({
        data: {
          businessId: params.businessId,
          contactId: params.contactId,
          type,
          schemaVersion: 'v1',
          data: {},
        },
      });
    }
    return playbook;
  }

  async updatePlaybook(params: { businessId: string; contactId: string; data: any; type?: string }) {
    const type = params.type ?? 'default';
    const existing = await this.prisma.client.contactPlaybook.findFirst({
      where: {
        businessId: params.businessId,
        contactId: params.contactId,
        type,
      },
    });
    if (!existing) {
      throw new NotFoundException('Playbook not found');
    }
    return this.prisma.client.contactPlaybook.update({
      where: { id: existing.id },
      data: {
        data: params.data,
        lastUsedAt: new Date(),
      },
    });
  }
}
