import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface CreateChangeOrderInput {
  projectId: string;
  title: string;
  description?: string;
  originalScope?: string;
  newScope?: string;
  additionalAmount?: number;
  additionalHours?: number;
}

export interface UpdateChangeOrderInput {
  title?: string;
  description?: string;
  originalScope?: string;
  newScope?: string;
  additionalAmount?: number;
  additionalHours?: number;
  status?: string;
  approvedBy?: string;
  approvedAt?: Date;
  invoiceId?: string;
}

@Injectable()
export class ChangeOrderService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async create(input: CreateChangeOrderInput) {
    return this.prisma.client.changeOrder.create({
      data: {
        projectId: input.projectId,
        title: input.title,
        description: input.description,
        originalScope: input.originalScope,
        newScope: input.newScope,
        additionalAmount: input.additionalAmount,
        additionalHours: input.additionalHours,
      },
    });
  }

  async listByProject(projectId: string, businessId?: string) {
    const where: Record<string, unknown> = { projectId };
    if (businessId) {
      where.project = { businessId };
    }
    return this.prisma.client.changeOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async listByBusiness(businessId: string) {
    return this.prisma.client.changeOrder.findMany({
      where: { project: { businessId } },
      orderBy: { createdAt: 'desc' },
      include: { project: { select: { id: true, name: true } } },
    });
  }

  async findById(id: string, businessId?: string) {
    const where: Record<string, unknown> = { id };
    if (businessId) {
      where.project = { businessId };
    }
    const changeOrder = await this.prisma.client.changeOrder.findFirst({ where });
    if (!changeOrder) throw new NotFoundException('Change order not found');
    return changeOrder;
  }

  async update(id: string, input: UpdateChangeOrderInput, businessId?: string) {
    await this.findById(id, businessId);

    return this.prisma.client.changeOrder.update({
      where: { id },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.originalScope !== undefined && { originalScope: input.originalScope }),
        ...(input.newScope !== undefined && { newScope: input.newScope }),
        ...(input.additionalAmount !== undefined && { additionalAmount: input.additionalAmount }),
        ...(input.additionalHours !== undefined && { additionalHours: input.additionalHours }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.approvedBy !== undefined && { approvedBy: input.approvedBy }),
        ...(input.approvedAt !== undefined && { approvedAt: input.approvedAt }),
        ...(input.invoiceId !== undefined && { invoiceId: input.invoiceId }),
      },
    });
  }

  async delete(id: string, businessId?: string) {
    await this.findById(id, businessId);
    await this.prisma.client.changeOrder.delete({ where: { id } });
    return { deleted: true };
  }
}
