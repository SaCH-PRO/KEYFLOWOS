import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface CreateExchangeRateInput {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  date: string;
  source?: string;
}

@Injectable()
export class ExchangeRateService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(businessId: string, pair?: { from: string; to: string }) {
    const where: Prisma.ExchangeRateWhereInput = { businessId };
    if (pair) {
      where.fromCurrency = pair.from;
      where.toCurrency = pair.to;
    }
    return this.prisma.client.exchangeRate.findMany({
      where,
      orderBy: { date: 'desc' },
      take: 100,
    });
  }

  async get(businessId: string, id: string) {
    const rate = await this.prisma.client.exchangeRate.findFirst({
      where: { id, businessId },
    });
    if (!rate) throw new NotFoundException('Exchange rate not found');
    return rate;
  }

  async getLatest(businessId: string, fromCurrency: string, toCurrency: string) {
    return this.prisma.client.exchangeRate.findFirst({
      where: { businessId, fromCurrency, toCurrency },
      orderBy: { date: 'desc' },
    });
  }

  async create(businessId: string, input: CreateExchangeRateInput) {
    if (input.fromCurrency === input.toCurrency) {
      throw new BadRequestException('From and to currencies must be different');
    }
    if (input.rate <= 0) {
      throw new BadRequestException('Rate must be positive');
    }

    const existing = await this.prisma.client.exchangeRate.findFirst({
      where: {
        businessId,
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        date: new Date(input.date),
      },
    });
    if (existing) throw new BadRequestException('Rate already exists for this date and currency pair');

    return this.prisma.client.exchangeRate.create({
      data: {
        businessId,
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        rate: new Prisma.Decimal(String(input.rate)),
        date: new Date(input.date),
        source: input.source ?? null,
      },
    });
  }

  async bulkCreate(businessId: string, inputs: CreateExchangeRateInput[]) {
    const results = [];
    for (const input of inputs) {
      try {
        const r = await this.create(businessId, input);
        results.push({ success: true, data: r });
      } catch (e: any) {
        results.push({ success: false, error: e.message });
      }
    }
    return results;
  }

  async remove(businessId: string, id: string) {
    await this.get(businessId, id);
    return this.prisma.client.exchangeRate.delete({ where: { id } });
  }
}
