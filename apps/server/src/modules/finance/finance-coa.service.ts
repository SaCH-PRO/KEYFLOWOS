import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ChartOfAccountsSeederService } from './chart-of-accounts-seeder.service';

const ALLOWED_TYPES = new Set(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'COGS', 'EXPENSE']);

export interface CreateCoaInput {
  name: string;
  type: string;
  subtype?: string | null;
  code?: string | null;
  parentId?: string | null;
}

export type UpdateCoaInput = Partial<Omit<CreateCoaInput, 'type'>> & { isActive?: boolean };

/**
 * FIN5 — CRUD on ChartOfAccount. System rows (`isSystem=true`) are
 * read-only except for `isActive` toggling, which is also blocked for
 * accounts referenced by the system seed (they back the postings engine).
 */
@Injectable()
export class FinanceCoaService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChartOfAccountsSeederService) private readonly seeder: ChartOfAccountsSeederService,
  ) {}

  async list(businessId: string) {
    await this.seeder.ensureDefaults(businessId);
    return this.prisma.client.chartOfAccount.findMany({
      where: { businessId },
      orderBy: [{ type: 'asc' }, { code: 'asc' }, { name: 'asc' }],
    });
  }

  async create(businessId: string, input: CreateCoaInput) {
    const name = (input.name ?? '').trim();
    if (!name) throw new BadRequestException('Name is required');
    if (!ALLOWED_TYPES.has(input.type)) {
      throw new BadRequestException(`Unknown account type: ${input.type}`);
    }
    if (input.parentId) {
      const parent = await this.prisma.client.chartOfAccount.findFirst({
        where: { id: input.parentId, businessId },
      });
      if (!parent) throw new BadRequestException('Parent account not found in this business');
    }
    return this.prisma.client.chartOfAccount.create({
      data: {
        businessId,
        name,
        type: input.type,
        subtype: input.subtype ?? null,
        code: input.code ?? null,
        parentId: input.parentId ?? null,
        isSystem: false,
        isActive: true,
      },
    });
  }

  async update(businessId: string, id: string, input: UpdateCoaInput) {
    const existing = await this.prisma.client.chartOfAccount.findFirst({
      where: { id, businessId },
    });
    if (!existing) throw new NotFoundException('Account not found');
    if (existing.isSystem) {
      throw new ForbiddenException('System accounts are read-only');
    }

    const data: Record<string, unknown> = {};
    if (input.name != null) data.name = input.name.trim();
    if (input.subtype !== undefined) data.subtype = input.subtype;
    if (input.code !== undefined) data.code = input.code;
    if (input.parentId !== undefined) data.parentId = input.parentId;
    if (input.isActive != null) data.isActive = input.isActive;
    return this.prisma.client.chartOfAccount.update({ where: { id }, data });
  }

  async archive(businessId: string, id: string) {
    const existing = await this.prisma.client.chartOfAccount.findFirst({
      where: { id, businessId },
    });
    if (!existing) throw new NotFoundException('Account not found');
    if (existing.isSystem) throw new ForbiddenException('System accounts cannot be archived');
    return this.prisma.client.chartOfAccount.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
