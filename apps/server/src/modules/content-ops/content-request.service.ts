import { Injectable, Inject, NotFoundException, BadRequestException, Logger, Optional, forwardRef } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ApprovalRequestService } from '../approvals/approval-request.service';
import { ContentInvoiceService } from './content-invoice.service';

export interface CreateContentRequestInput {
  businessId: string;
  requestedBy: string;
  source: string;
  contentTypes: string[];
  businessGoal: string;
  targetAudience?: string;
  offer?: string;
  productOrService?: string;
  branch?: string;
  tone?: string;
  dueDate?: string;
  priority?: string;
  requiredInputs?: string[];
  attachedAssetIds?: string[];
  approvalRequired?: boolean;
  invoiceOnDelivery?: boolean;
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['assigned', 'cancelled'],
  assigned: ['in_production', 'cancelled'],
  in_production: ['internal_review', 'cancelled'],
  internal_review: ['in_production', 'user_review', 'cancelled'],
  user_review: ['in_production', 'approved', 'cancelled'],
  approved: ['uploaded_to_drive'],
  uploaded_to_drive: ['delivered'],
  delivered: [],
  cancelled: [],
};

@Injectable()
export class ContentRequestService {
  private readonly logger = new Logger(ContentRequestService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly emitter: EventEmitter2,
    @Inject(forwardRef(() => ApprovalRequestService)) private readonly approvals: ApprovalRequestService,
    @Optional() @Inject(ContentInvoiceService) private readonly contentInvoice?: ContentInvoiceService,
  ) {}

  async createRequest(input: CreateContentRequestInput) {
    const request = await this.prisma.client.contentRequest.create({
      data: {
        businessId: input.businessId,
        requestedBy: input.requestedBy,
        source: input.source,
        status: 'draft',
        contentTypes: input.contentTypes,
        businessGoal: input.businessGoal,
        targetAudience: input.targetAudience ?? null,
        offer: input.offer ?? null,
        productOrService: input.productOrService ?? null,
        branch: input.branch ?? null,
        tone: input.tone ?? null,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        priority: input.priority ?? 'normal',
        requiredInputs: input.requiredInputs ?? [],
        attachedAssetIds: input.attachedAssetIds ?? [],
        assignedTeamMemberIds: [],
        deliveryFileIds: [],
        approvalRequired: input.approvalRequired ?? true,
        invoiceOnDelivery: input.invoiceOnDelivery ?? false,
      },
    });

    this.emitEvent(input.businessId, 'content_request.created', request);
    return request;
  }

  async getById(requestId: string) {
    const request = await this.prisma.client.contentRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('Content request not found');
    return request;
  }

  async listForBusiness(
    businessId: string,
    options?: { status?: string; limit?: number; offset?: number },
  ) {
    const where: any = { businessId };
    if (options?.status) where.status = options.status;

    const [items, total] = await Promise.all([
      this.prisma.client.contentRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: options?.offset ?? 0,
        take: options?.limit ?? 50,
      }),
      this.prisma.client.contentRequest.count({ where }),
    ]);

    return { items, total, offset: options?.offset ?? 0, limit: options?.limit ?? 50 };
  }

  async updateRequest(requestId: string, data: {
    contentTypes?: string[];
    businessGoal?: string;
    targetAudience?: string;
    offer?: string;
    productOrService?: string;
    branch?: string;
    tone?: string;
    dueDate?: string | null;
    priority?: string;
    assignedTeamMemberIds?: string[];
    googleDriveFolderId?: string;
    approvalRequired?: boolean;
  }) {
    const existing = await this.getById(requestId);

    const updateData: any = {};
    if (data.contentTypes !== undefined) updateData.contentTypes = data.contentTypes;
    if (data.businessGoal !== undefined) updateData.businessGoal = data.businessGoal;
    if (data.targetAudience !== undefined) updateData.targetAudience = data.targetAudience;
    if (data.offer !== undefined) updateData.offer = data.offer;
    if (data.productOrService !== undefined) updateData.productOrService = data.productOrService;
    if (data.branch !== undefined) updateData.branch = data.branch;
    if (data.tone !== undefined) updateData.tone = data.tone;
    if (data.dueDate !== undefined) updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.assignedTeamMemberIds !== undefined) updateData.assignedTeamMemberIds = data.assignedTeamMemberIds;
    if (data.googleDriveFolderId !== undefined) updateData.googleDriveFolderId = data.googleDriveFolderId;
    if (data.approvalRequired !== undefined) updateData.approvalRequired = data.approvalRequired;

    const updated = await this.prisma.client.contentRequest.update({
      where: { id: requestId },
      data: updateData,
    });

    this.emitEvent(existing.businessId, 'content_request.updated', updated);
    return updated;
  }

  async transitionStatus(
    requestId: string,
    newStatus: string,
    actorId: string,
    comment?: string,
  ) {
    const request = await this.getById(requestId);
    const currentStatus = request.status;

    const validNext = VALID_TRANSITIONS[currentStatus] ?? [];
    if (!validNext.includes(newStatus)) {
      throw new BadRequestException(
        `Invalid transition: ${currentStatus} → ${newStatus}. Valid: ${validNext.join(', ') || 'none'}`,
      );
    }

    const updated = await this.prisma.client.contentRequest.update({
      where: { id: requestId },
      data: { status: newStatus },
    });

    // If transitioning to approved and approval is required, create an approval request
    if (newStatus === 'approved' && request.approvalRequired) {
      try {
        await this.approvals.createRequest({
          businessId: request.businessId,
          requestType: 'content_delivery',
          requesterId: actorId,
          title: `Approve content delivery: ${request.businessGoal}`,
          description: comment,
          payload: { contentRequestId: request.id, businessGoal: request.businessGoal },
          steps: [{ stepOrder: 0, approverId: request.requestedBy }],
        });
      } catch (err: any) {
        this.logger.warn(`Failed to create approval request: ${(err as Error).message}`);
      }
    }

    this.emitEvent(request.businessId, `content_request.${newStatus}`, updated, { actorId, comment });
    return updated;
  }

  async submitRequest(requestId: string, actorId: string) {
    return this.transitionStatus(requestId, 'submitted', actorId);
  }

  async assignRequest(requestId: string, teamMemberIds: string[], actorId: string) {
    const request = await this.getById(requestId);
    if (request.status !== 'submitted') {
      throw new BadRequestException('Request must be in submitted status to assign');
    }

    await this.prisma.client.contentRequest.update({
      where: { id: requestId },
      data: { assignedTeamMemberIds: teamMemberIds },
    });

    return this.transitionStatus(requestId, 'assigned', actorId);
  }

  async startProduction(requestId: string, actorId: string) {
    return this.transitionStatus(requestId, 'in_production', actorId);
  }

  async submitForReview(requestId: string, actorId: string, comment?: string) {
    return this.transitionStatus(requestId, 'internal_review', actorId, comment);
  }

  async reviewContent(
    requestId: string,
    action: 'approve' | 'request_changes' | 'submit_to_user',
    actorId: string,
    comment?: string,
  ) {
    const request = await this.getById(requestId);

    if (action === 'request_changes') {
      if (!['internal_review', 'user_review'].includes(request.status)) {
        throw new BadRequestException('Can only request changes from review states');
      }
      return this.transitionStatus(requestId, 'in_production', actorId, comment);
    }

    if (action === 'submit_to_user') {
      if (request.status !== 'internal_review') {
        throw new BadRequestException('Can only submit to user from internal_review');
      }
      return this.transitionStatus(requestId, 'user_review', actorId, comment);
    }

    if (action === 'approve') {
      if (request.status !== 'user_review') {
        throw new BadRequestException('Can only approve from user_review');
      }
      return this.transitionStatus(requestId, 'approved', actorId, comment);
    }

    throw new BadRequestException('Invalid review action');
  }

  async uploadDeliverables(
    requestId: string,
    fileIds: string[],
    folderId: string,
    actorId: string,
  ) {
    const request = await this.getById(requestId);
    if (request.status !== 'approved') {
      throw new BadRequestException('Request must be approved before uploading deliverables');
    }

    const updated = await this.prisma.client.contentRequest.update({
      where: { id: requestId },
      data: {
        status: 'uploaded_to_drive',
        deliveryFileIds: fileIds,
        googleDriveFolderId: folderId,
      },
    });

    // Create or update delivery package
    const existingPackage = await this.prisma.client.contentDeliveryPackage.findFirst({
      where: { contentRequestId: requestId },
    });

    if (existingPackage) {
      await this.prisma.client.contentDeliveryPackage.update({
        where: { id: existingPackage.id },
        data: {
          status: 'uploaded',
          uploadedFileIds: fileIds,
          uploadedBy: actorId,
        },
      });
    } else {
      await this.prisma.client.contentDeliveryPackage.create({
        data: {
          businessId: request.businessId,
          contentRequestId: requestId,
          destinationFolderId: folderId,
          status: 'uploaded',
          uploadedFileIds: fileIds,
          uploadedBy: actorId,
        },
      });
    }

    this.emitEvent(request.businessId, 'content_request.uploaded_to_drive', updated, { actorId, fileCount: fileIds.length });
    return updated;
  }

  async deliverRequest(requestId: string, actorId: string) {
    const request = await this.getById(requestId);
    if (request.status !== 'uploaded_to_drive') {
      throw new BadRequestException('Request must be uploaded to Drive before delivery');
    }

    const updated = await this.prisma.client.contentRequest.update({
      where: { id: requestId },
      data: { status: 'delivered' },
    });

    // Update delivery package
    await this.prisma.client.contentDeliveryPackage.updateMany({
      where: { contentRequestId: requestId },
      data: { status: 'delivered', deliveredAt: new Date(), userNotified: true },
    });

    let invoice = null;
    let invoiceError: string | null = null;
    if (request.invoiceOnDelivery && this.contentInvoice) {
      try {
        invoice = await this.contentInvoice.generateInvoiceFromDelivery(requestId, request.businessId);
      } catch (err: any) {
        invoiceError = (err as Error).message;
        this.logger.warn(`Auto-invoice generation failed: ${invoiceError}`);
      }
    }

    this.emitEvent(request.businessId, 'content_request.delivered', updated, { actorId, invoiceId: invoice?.id ?? null });

    if (invoice) {
      this.emitter.emit('content.delivered', {
        businessId: request.businessId,
        contentRequestId: request.id,
        status: updated.status,
        businessGoal: request.businessGoal,
        invoiceId: invoice.id,
        actorId,
      });
    }

    // Additive fields, not a shape change — existing callers read .status and
    // .id as before.
    //
    // The invoice outcome used to exist only in an event payload and a
    // logger.warn, so a caller could not tell whether delivery had raised an
    // invoice, failed to, or never tried. `content_deliver_request` reported
    // success either way; on a business with invoiceOnDelivery set, a silent
    // generation failure looked exactly like a delivery with no invoice due.
    return {
      ...updated,
      invoiceRequested: !!request.invoiceOnDelivery,
      deliveryInvoiceId: invoice?.id ?? null,
      invoiceError,
    };
  }

  async cancelRequest(requestId: string, actorId: string) {
    return this.transitionStatus(requestId, 'cancelled', actorId);
  }

  async getPipeline(businessId: string) {
    const requests = await this.prisma.client.contentRequest.findMany({
      where: { businessId, status: { not: 'cancelled' } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const byStatus: Record<string, any[]> = {};
    for (const r of requests) {
      byStatus[r.status] = byStatus[r.status] ?? [];
      byStatus[r.status].push(r);
    }

    return {
      pipeline: byStatus,
      counts: Object.fromEntries(Object.entries(byStatus).map(([k, v]) => [k, v.length])),
      total: requests.length,
    };
  }

  async getDeliveryPackage(requestId: string) {
    const pkg = await this.prisma.client.contentDeliveryPackage.findFirst({
      where: { contentRequestId: requestId },
    });
    return pkg;
  }

  private emitEvent(
    businessId: string,
    eventType: string,
    request: any,
    extra?: Record<string, unknown>,
  ) {
    this.emitter.emit(eventType, {
      businessId,
      contentRequestId: request.id,
      status: request.status,
      businessGoal: request.businessGoal,
      ...extra,
    });
  }
}
