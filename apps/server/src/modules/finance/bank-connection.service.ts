import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface CreateBankConnectionInput {
  financialAccountId: string;
  provider: string;
  providerItemId?: string;
  accessToken?: string;
}

export interface UpdateBankConnectionInput {
  providerItemId?: string;
  accessToken?: string;
  status?: 'ACTIVE' | 'ERROR' | 'EXPIRED' | 'DISCONNECTED';
  lastSyncCursor?: string;
  errorMessage?: string | null;
}

@Injectable()
export class BankConnectionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(businessId: string) {
    return this.prisma.client.bankConnection.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      include: { financialAccount: { select: { id: true, name: true, type: true } } },
    });
  }

  async get(businessId: string, id: string) {
    const conn = await this.prisma.client.bankConnection.findFirst({
      where: { id, businessId },
      include: { financialAccount: { select: { id: true, name: true, type: true } } },
    });
    if (!conn) throw new NotFoundException('Bank connection not found');
    return conn;
  }

  async create(businessId: string, input: CreateBankConnectionInput) {
    const account = await this.prisma.client.financialAccount.findFirst({
      where: { id: input.financialAccountId, businessId },
    });
    if (!account) throw new BadRequestException('Financial account not found');

    const existing = await this.prisma.client.bankConnection.findFirst({
      where: { businessId, financialAccountId: input.financialAccountId, status: 'ACTIVE' },
    });
    if (existing) throw new BadRequestException('An active connection already exists for this account');

    return this.prisma.client.bankConnection.create({
      data: {
        businessId,
        financialAccountId: input.financialAccountId,
        provider: input.provider,
        providerItemId: input.providerItemId ?? null,
        accessToken: input.accessToken ?? null,
      },
      include: { financialAccount: { select: { id: true, name: true } } },
    });
  }

  async update(businessId: string, id: string, input: UpdateBankConnectionInput) {
    await this.get(businessId, id);
    return this.prisma.client.bankConnection.update({
      where: { id },
      data: {
        ...(input.providerItemId !== undefined && { providerItemId: input.providerItemId }),
        ...(input.accessToken !== undefined && { accessToken: input.accessToken }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.lastSyncCursor !== undefined && { lastSyncCursor: input.lastSyncCursor }),
        ...(input.errorMessage !== undefined && { errorMessage: input.errorMessage }),
        ...(input.status === 'ACTIVE' && { errorMessage: null }),
      },
    });
  }

  async recordSync(businessId: string, id: string, cursor?: string) {
    await this.get(businessId, id);
    return this.prisma.client.bankConnection.update({
      where: { id },
      data: {
        lastSyncAt: new Date(),
        ...(cursor !== undefined && { lastSyncCursor: cursor }),
        status: 'ACTIVE',
        errorMessage: null,
      },
    });
  }

  async remove(businessId: string, id: string) {
    await this.get(businessId, id);
    return this.prisma.client.bankConnection.delete({ where: { id } });
  }
}
