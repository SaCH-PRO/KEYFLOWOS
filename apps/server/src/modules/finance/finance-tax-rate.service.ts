import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface UpsertTaxRateInput {
  name: string;
  rate: number;
  type?: string | null;
  isDefault?: boolean | null;
  isActive?: boolean | null;
}

/**
 * FIN5 — Per-business tax rate library. Marking one rate `isDefault`
 * automatically clears the flag on any sibling rates in the same write.
 */
@Injectable()
export class FinanceTaxRateService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(businessId: string) {
    return this.prisma.client.taxRate.findMany({
      where: { businessId },
      orderBy: [{ isDefault: 'desc' }, { isActive: 'desc' }, { name: 'asc' }],
    });
  }

  async create(businessId: string, input: UpsertTaxRateInput) {
    const name = (input.name ?? '').trim();
    if (!name) throw new BadRequestException('Name is required');
    if (!Number.isFinite(input.rate)) throw new BadRequestException('Rate must be a number');
    return this.prisma.client.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.taxRate.updateMany({
          where: { businessId, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.taxRate.create({
        data: {
          businessId,
          name,
          rate: input.rate,
          type: input.type ?? null,
          isDefault: input.isDefault ?? false,
          isActive: input.isActive ?? true,
        },
      });
    });
  }

  async update(businessId: string, id: string, input: Partial<UpsertTaxRateInput>) {
    const existing = await this.prisma.client.taxRate.findFirst({
      where: { id, businessId },
    });
    if (!existing) throw new NotFoundException('Tax rate not found');
    return this.prisma.client.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.taxRate.updateMany({
          where: { businessId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }
      const data: Record<string, unknown> = {};
      if (input.name != null) data.name = input.name.trim();
      if (input.rate != null) data.rate = input.rate;
      if (input.type !== undefined) data.type = input.type;
      if (input.isDefault != null) data.isDefault = input.isDefault;
      if (input.isActive != null) data.isActive = input.isActive;
      return tx.taxRate.update({ where: { id }, data });
    });
  }

  async remove(businessId: string, id: string) {
    const existing = await this.prisma.client.taxRate.findFirst({
      where: { id, businessId },
    });
    if (!existing) throw new NotFoundException('Tax rate not found');
    return this.prisma.client.taxRate.delete({ where: { id } });
  }
}
