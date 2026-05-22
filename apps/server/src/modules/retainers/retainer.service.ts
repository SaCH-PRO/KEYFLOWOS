import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface CreateRetainerInput {
  businessId: string;
  contactId: string;
  name: string;
  monthlyAmount: number;
  startDate: Date;
  endDate?: Date;
  includedHours?: number;
  rolloverHours?: boolean;
  rolloverCap?: number;
}

export interface UpdateRetainerInput {
  name?: string;
  monthlyAmount?: number;
  startDate?: Date;
  endDate?: Date | null;
  includedHours?: number | null;
  rolloverHours?: boolean;
  rolloverCap?: number | null;
  status?: string;
}

@Injectable()
export class RetainerService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async create(input: CreateRetainerInput) {
    return this.prisma.client.retainerAgreement.create({
      data: {
        businessId: input.businessId,
        contactId: input.contactId,
        name: input.name,
        monthlyAmount: input.monthlyAmount,
        startDate: input.startDate,
        endDate: input.endDate,
        includedHours: input.includedHours,
        rolloverHours: input.rolloverHours ?? false,
        rolloverCap: input.rolloverCap,
      },
      include: { periods: true },
    });
  }

  async list(businessId: string) {
    return this.prisma.client.retainerAgreement.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      include: {
        periods: { orderBy: { periodStart: 'desc' }, take: 3 },
      },
    });
  }

  async findById(id: string, businessId: string) {
    const retainer = await this.prisma.client.retainerAgreement.findFirst({
      where: { id, businessId },
      include: {
        periods: { orderBy: { periodStart: 'desc' } },
      },
    });
    if (!retainer) throw new NotFoundException('Retainer agreement not found');
    return retainer;
  }

  async update(id: string, businessId: string, input: UpdateRetainerInput) {
    const retainer = await this.prisma.client.retainerAgreement.findFirst({
      where: { id, businessId },
    });
    if (!retainer) throw new NotFoundException('Retainer agreement not found');

    return this.prisma.client.retainerAgreement.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.monthlyAmount !== undefined && { monthlyAmount: input.monthlyAmount }),
        ...(input.startDate !== undefined && { startDate: input.startDate }),
        ...(input.endDate !== undefined && { endDate: input.endDate }),
        ...(input.includedHours !== undefined && { includedHours: input.includedHours }),
        ...(input.rolloverHours !== undefined && { rolloverHours: input.rolloverHours }),
        ...(input.rolloverCap !== undefined && { rolloverCap: input.rolloverCap }),
        ...(input.status !== undefined && { status: input.status }),
      },
      include: { periods: true },
    });
  }

  async delete(id: string, businessId: string) {
    const retainer = await this.prisma.client.retainerAgreement.findFirst({
      where: { id, businessId },
    });
    if (!retainer) throw new NotFoundException('Retainer agreement not found');
    await this.prisma.client.retainerAgreement.delete({ where: { id } });
    return { deleted: true };
  }

  async createPeriod(retainerId: string, businessId: string, data: {
    periodStart: Date;
    periodEnd: Date;
    hoursUsed?: number;
    amountBilled?: number;
  }) {
    const retainer = await this.prisma.client.retainerAgreement.findFirst({
      where: { id: retainerId, businessId },
    });
    if (!retainer) throw new NotFoundException('Retainer agreement not found');

    const hoursUsed = data.hoursUsed ?? 0;
    const hoursBilled = Math.min(hoursUsed, retainer.includedHours ?? hoursUsed);
    const amountBilled = data.amountBilled ?? (hoursUsed > (retainer.includedHours ?? 0)
      ? (hoursUsed - (retainer.includedHours ?? 0)) * (retainer.monthlyAmount / (retainer.includedHours ?? 1))
      : 0);

    return this.prisma.client.retainerPeriod.create({
      data: {
        retainerId,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        hoursUsed,
        hoursBilled,
        amountBilled,
      },
    });
  }

  async updatePeriod(periodId: string, retainerId: string, businessId: string, data: {
    hoursUsed?: number;
    status?: string;
    invoiceId?: string;
  }) {
    const period = await this.prisma.client.retainerPeriod.findFirst({
      where: { id: periodId, retainer: { id: retainerId, businessId } },
    });
    if (!period) throw new NotFoundException('Period not found');

    return this.prisma.client.retainerPeriod.update({
      where: { id: periodId },
      data: {
        ...(data.hoursUsed !== undefined && { hoursUsed: data.hoursUsed }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.invoiceId !== undefined && { invoiceId: data.invoiceId }),
      },
    });
  }

  async getSummary(businessId: string) {
    const [total, active, totalRevenue] = await Promise.all([
      this.prisma.client.retainerAgreement.count({ where: { businessId } }),
      this.prisma.client.retainerAgreement.count({ where: { businessId, status: 'ACTIVE' } }),
      this.prisma.client.retainerPeriod.aggregate({
        where: { retainer: { businessId }, status: { in: ['INVOICED', 'PAID'] } },
        _sum: { amountBilled: true },
      }).then(r => r._sum.amountBilled ?? 0),
    ]);

    return { total, active, totalRevenue };
  }
}
