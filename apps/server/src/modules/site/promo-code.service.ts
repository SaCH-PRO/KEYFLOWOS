import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class PromoCodeService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: {
    businessId: string;
    code: string;
    type: 'PERCENT' | 'FIXED' | 'FREE_SHIPPING';
    value: number;
    minOrderValue?: number;
    maxUses?: number;
    validFrom?: Date | string;
    validTo?: Date | string;
    active?: boolean;
  }) {
    const normalizedCode = input.code.trim().toUpperCase();
    const existing = await this.prisma.client.promoCode.findUnique({
      where: { businessId_code: { businessId: input.businessId, code: normalizedCode } },
    });
    if (existing) {
      throw new BadRequestException('A promo code with this code already exists');
    }

    return this.prisma.client.promoCode.create({
      data: {
        businessId: input.businessId,
        code: normalizedCode,
        type: input.type,
        value: input.value,
        minOrderValue: input.minOrderValue ?? null,
        maxUses: input.maxUses ?? null,
        validFrom: input.validFrom ? new Date(input.validFrom) : null,
        validTo: input.validTo ? new Date(input.validTo) : null,
        active: input.active ?? true,
      },
    });
  }

  async list(businessId: string) {
    return this.prisma.client.promoCode.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async validate(businessId: string, code: string, orderSubtotal: number) {
    const normalizedCode = code.trim().toUpperCase();
    const promo = await this.prisma.client.promoCode.findUnique({
      where: { businessId_code: { businessId, code: normalizedCode } },
    });

    if (!promo) {
      throw new BadRequestException('Invalid promo code');
    }

    if (!promo.active) {
      throw new BadRequestException('This promo code is no longer active');
    }

    const now = new Date();
    if (promo.validFrom && now < promo.validFrom) {
      throw new BadRequestException('This promo code is not yet valid');
    }
    if (promo.validTo && now > promo.validTo) {
      throw new BadRequestException('This promo code has expired');
    }

    if (promo.maxUses !== null && promo.currentUses >= promo.maxUses) {
      throw new BadRequestException('This promo code has reached its usage limit');
    }

    if (promo.minOrderValue !== null && orderSubtotal < promo.minOrderValue) {
      throw new BadRequestException(
        `Minimum order value of ${promo.minOrderValue} required for this promo code`,
      );
    }

    return promo;
  }

  apply(promo: { type: string; value: number }, subtotal: number): { discount: number; freeShipping: boolean } {
    switch (promo.type) {
      case 'PERCENT': {
        const discount = Math.round(((subtotal * promo.value) / 100) * 100) / 100;
        return { discount: Math.min(discount, subtotal), freeShipping: false };
      }
      case 'FIXED': {
        return { discount: Math.min(promo.value, subtotal), freeShipping: false };
      }
      case 'FREE_SHIPPING': {
        return { discount: 0, freeShipping: true };
      }
      default:
        return { discount: 0, freeShipping: false };
    }
  }

  async incrementUsage(promoId: string) {
    await this.prisma.client.$executeRawUnsafe(
      `UPDATE "promo_codes" SET "current_uses" = "current_uses" + 1 WHERE "id" = $1 AND ("max_uses" IS NULL OR "current_uses" < "max_uses")`,
      promoId,
    );
  }

  async update(businessId: string, promoId: string, input: Partial<{
    code: string;
    type: string;
    value: number;
    minOrderValue: number | null;
    maxUses: number | null;
    validFrom: Date | string | null;
    validTo: Date | string | null;
    active: boolean;
  }>) {
    const promo = await this.prisma.client.promoCode.findFirst({
      where: { id: promoId, businessId },
    });
    if (!promo) throw new NotFoundException('Promo code not found');

    const data: any = {};
    if (input.code !== undefined) data.code = input.code.trim().toUpperCase();
    if (input.type !== undefined) data.type = input.type;
    if (input.value !== undefined) data.value = input.value;
    if (input.minOrderValue !== undefined) data.minOrderValue = input.minOrderValue;
    if (input.maxUses !== undefined) data.maxUses = input.maxUses;
    if (input.validFrom !== undefined) data.validFrom = input.validFrom ? new Date(input.validFrom) : null;
    if (input.validTo !== undefined) data.validTo = input.validTo ? new Date(input.validTo) : null;
    if (input.active !== undefined) data.active = input.active;

    return this.prisma.client.promoCode.update({
      where: { id: promoId },
      data,
    });
  }

  async delete(businessId: string, promoId: string) {
    const promo = await this.prisma.client.promoCode.findFirst({
      where: { id: promoId, businessId },
    });
    if (!promo) throw new NotFoundException('Promo code not found');

    return this.prisma.client.promoCode.delete({ where: { id: promoId } });
  }
}
