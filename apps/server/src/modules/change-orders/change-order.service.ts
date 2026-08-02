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

  /**
   * @param businessId  the tenant the caller is acting as, from the route param
   *
   * ChangeOrder has NO businessId column (schema.prisma) — tenancy exists only
   * through `project.businessId`, which is how every read in this service
   * scopes itself. create() alone ignored it: the controller bound the route
   * param to `_businessId` and never used it, and projectId went straight into
   * the row unchecked.
   *
   * That was previously unreachable because the DTO carried no validator
   * metadata and the global whitelist stripped projectId before it arrived.
   * Making the DTO work makes it reachable, so the project must be proven to
   * belong to this business first — otherwise a caller could attach a change
   * order to another tenant's project and then read it back through
   * listByProject.
   */
  async create(input: CreateChangeOrderInput, businessId: string) {
    const project = await this.prisma.client.project.findFirst({
      where: { id: input.projectId, businessId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Project not found');

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

    // findById above proves the change order is the caller's, but invoiceId
    // comes from the body and was written unchecked — it could point at another
    // tenant's invoice. Only enforceable when businessId was supplied; the
    // parameter is optional on this method, and a caller with no tenant context
    // is already limited by findById.
    if (businessId && input.invoiceId !== undefined && input.invoiceId !== null) {
      const invoice = await this.prisma.client.invoice.findFirst({
        where: { id: input.invoiceId, businessId },
        select: { id: true },
      });
      if (!invoice) throw new NotFoundException('Invoice not found');
    }

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
