import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CreateRiskDto } from './dto/create-risk.dto';

@Injectable()
export class GovernanceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async createRisk(businessId: string, dto: CreateRiskDto) {
    return this.prisma.client.businessRisk.create({
      data: {
        businessId,
        title: dto.title,
        description: dto.description,
        category: dto.category,
        severity: dto.severity,
        likelihood: dto.likelihood,
        status: dto.status ?? 'OPEN',
        ownerId: dto.ownerId,
        mitigation: dto.mitigation,
        sourceType: dto.sourceType,
        sourceId: dto.sourceId,
      },
    });
  }

  async findRisks(businessId: string, filters: { status?: string; category?: string }) {
    const where: Record<string, unknown> = { businessId };
    if (filters.status) where.status = filters.status;
    if (filters.category) where.category = filters.category;
    return this.prisma.client.businessRisk.findMany({
      where,
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findOneRisk(businessId: string, id: string) {
    const risk = await this.prisma.client.businessRisk.findFirst({ where: { id, businessId } });
    if (!risk) throw new NotFoundException('Risk not found');
    return risk;
  }

  async updateRisk(businessId: string, id: string, dto: Partial<CreateRiskDto>) {
    await this.findOneRisk(businessId, id);
    return this.prisma.client.businessRisk.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.severity !== undefined && { severity: dto.severity }),
        ...(dto.likelihood !== undefined && { likelihood: dto.likelihood }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.ownerId !== undefined && { ownerId: dto.ownerId }),
        ...(dto.mitigation !== undefined && { mitigation: dto.mitigation }),
      },
    });
  }

  async deleteRisk(businessId: string, id: string) {
    await this.findOneRisk(businessId, id);
    return this.prisma.client.businessRisk.delete({ where: { id } });
  }

  async summary(businessId: string) {
    const [open, bySeverity] = await Promise.all([
      this.prisma.client.businessRisk.count({ where: { businessId, status: 'OPEN' } }),
      this.prisma.client.businessRisk.groupBy({
        by: ['severity'],
        where: { businessId, status: 'OPEN' },
        _count: { severity: true },
      }),
    ]);
    return { open, bySeverity: bySeverity.map((s) => ({ severity: s.severity, count: s._count.severity })) };
  }
}
