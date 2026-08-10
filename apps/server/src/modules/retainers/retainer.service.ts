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
    // contactId is caller-supplied and was written unchecked. It is a bare
    // String column with no Prisma relation (schema.prisma: RetainerAgreement),
    // so there is not even database-level FK enforcement to fall back on — a
    // retainer could be attached to another tenant's contact, or to an id that
    // does not exist at all.
    //
    // This was previously unreachable because the DTO carried no validator
    // metadata and the global whitelist stripped contactId before it arrived.
    const contact = await this.prisma.client.contact.findFirst({
      where: { id: input.contactId, businessId: input.businessId },
      select: { id: true },
    });
    if (!contact) throw new NotFoundException('Contact not found');

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

    // DIVISION BY ZERO. `retainer.includedHours ?? 1` only substitutes 1 when
    // includedHours is null or undefined — and 0 is neither. A retainer created
    // with includedHours: 0 therefore divided by zero, producing Infinity, and
    // Infinity was written to amountBilled on a BILLING record.
    //
    // The nullish case is fine and separately meaningful: no included hours
    // agreed, so every hour is overage at the full monthly rate. Zero included
    // hours means the same thing, so it takes the same path rather than a
    // special case.
    const included = retainer.includedHours ?? 0;
    const perHourRate = included > 0 ? retainer.monthlyAmount / included : retainer.monthlyAmount;
    const amountBilled = data.amountBilled ?? (hoursUsed > included
      ? (hoursUsed - included) * perHourRate
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

    // The period is scoped through its retainer above, but invoiceId came from
    // the body and was written unchecked — a caller could point their retainer
    // period at another tenant's invoice.
    if (data.invoiceId !== undefined && data.invoiceId !== null) {
      const invoice = await this.prisma.client.invoice.findFirst({
        where: { id: data.invoiceId, businessId },
        select: { id: true },
      });
      if (!invoice) throw new NotFoundException('Invoice not found');
    }

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
