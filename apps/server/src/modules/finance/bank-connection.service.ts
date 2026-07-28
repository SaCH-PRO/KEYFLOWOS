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

  /**
   * Remove the stored provider `accessToken` before a record leaves the service
   * boundary. The token is only needed server-side; it must never be serialized
   * into API responses. Storage is unaffected.
   */
  private strip<T extends { accessToken?: string | null }>(conn: T): Omit<T, 'accessToken'> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omit secret via rest
    const { accessToken, ...safe } = conn;
    return safe;
  }

  async list(businessId: string) {
    const items = await this.prisma.client.bankConnection.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      include: { financialAccount: { select: { id: true, name: true, type: true } } },
    });
    return items.map((c) => this.strip(c));
  }

  async get(businessId: string, id: string) {
    const conn = await this.prisma.client.bankConnection.findFirst({
      where: { id, businessId },
      include: { financialAccount: { select: { id: true, name: true, type: true } } },
    });
    if (!conn) throw new NotFoundException('Bank connection not found');
    return this.strip(conn);
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

    const created = await this.prisma.client.bankConnection.create({
      data: {
        businessId,
        financialAccountId: input.financialAccountId,
        provider: input.provider,
        providerItemId: input.providerItemId ?? null,
        accessToken: input.accessToken ?? null,
      },
      include: { financialAccount: { select: { id: true, name: true } } },
    });
    return this.strip(created);
  }

  async update(businessId: string, id: string, input: UpdateBankConnectionInput) {
    await this.get(businessId, id);
    const updated = await this.prisma.client.bankConnection.update({
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
    return this.strip(updated);
  }

  async recordSync(businessId: string, id: string, cursor?: string) {
    await this.get(businessId, id);
    const synced = await this.prisma.client.bankConnection.update({
      where: { id },
      data: {
        lastSyncAt: new Date(),
        ...(cursor !== undefined && { lastSyncCursor: cursor }),
        status: 'ACTIVE',
        errorMessage: null,
      },
    });
    return this.strip(synced);
  }

  async remove(businessId: string, id: string) {
    await this.get(businessId, id);
    const deleted = await this.prisma.client.bankConnection.delete({ where: { id } });
    return this.strip(deleted);
  }
}
