import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface ReserveBucketDto {
  id: string;
  name: string;
  purpose: string;
  targetAmount: number | null;
  currentAmount: number;
  currency: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class CashReserveService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(businessId: string): Promise<ReserveBucketDto[]> {
    const buckets = await (this.prisma.client as any).cashReserveBucket.findMany({
      where: { businessId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    return buckets.map((b: any) => this.toDto(b));
  }

  async create(businessId: string, data: { name: string; purpose: string; targetAmount?: number; currentAmount?: number; currency?: string }): Promise<ReserveBucketDto> {
    const bucket = await (this.prisma.client as any).cashReserveBucket.create({
      data: {
        businessId,
        name: data.name,
        purpose: data.purpose,
        targetAmount: data.targetAmount ?? null,
        currentAmount: data.currentAmount ?? 0,
        currency: data.currency ?? 'TTD',
        status: 'ACTIVE',
      },
    });
    return this.toDto(bucket);
  }

  async update(businessId: string, id: string, data: Partial<{ name: string; purpose: string; targetAmount: number; currentAmount: number; status: string }>): Promise<ReserveBucketDto> {
    const bucket = await (this.prisma.client as any).cashReserveBucket.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.purpose !== undefined && { purpose: data.purpose }),
        ...(data.targetAmount !== undefined && { targetAmount: data.targetAmount }),
        ...(data.currentAmount !== undefined && { currentAmount: data.currentAmount }),
        ...(data.status !== undefined && { status: data.status }),
      },
    });
    if (bucket.businessId !== businessId) throw new Error('Unauthorized');
    return this.toDto(bucket);
  }

  async delete(businessId: string, id: string): Promise<void> {
    const bucket = await (this.prisma.client as any).cashReserveBucket.findUnique({ where: { id } });
    if (!bucket || bucket.businessId !== businessId) throw new Error('Not found');
    await (this.prisma.client as any).cashReserveBucket.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });
  }

  async getTotalReserved(businessId: string): Promise<{ total: number; currency: string }> {
    const buckets = await (this.prisma.client as any).cashReserveBucket.findMany({
      where: { businessId, status: 'ACTIVE' },
      select: { currentAmount: true, currency: true },
    });
    const total = buckets.reduce((s: number, b: any) => s + Number(b.currentAmount ?? 0), 0);
    const currency = buckets[0]?.currency ?? 'TTD';
    return { total, currency };
  }

  private toDto(b: any): ReserveBucketDto {
    return {
      id: b.id,
      name: b.name,
      purpose: b.purpose,
      targetAmount: b.targetAmount ? Number(b.targetAmount) : null,
      currentAmount: Number(b.currentAmount ?? 0),
      currency: b.currency ?? 'TTD',
      status: b.status,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    };
  }
}
