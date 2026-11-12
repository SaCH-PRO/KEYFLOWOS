import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { CreateBusinessEventInput } from '../business-events/dto/create-business-event.dto';
import { TimelineService } from '../timeline/timeline.service';
import { CreateProcurementRequestDto } from './dto/create-procurement-request.dto';
import { UpdateProcurementRequestDto } from './dto/update-procurement-request.dto';

/** The statuses only approve and reject may set: they are decisions, and a decision is audited. */
const DECISION_STATUSES = new Set(['APPROVED', 'REJECTED']);

/**
 * W7-OPS-AUDIT-ACTOR (review SEC-R013g-4, D-40): the member who moved a request, on the feed row the
 * move records. The vendor transitions recorded no actor at all; a caller that names no member (the
 * KEY dispatcher) still writes none, rather than a USER row that names no one.
 */
function actedBy(userId?: string): { actorType?: 'USER'; actorId?: string } {
  return userId ? { actorType: 'USER', actorId: userId } : {};
}

/**
 * W7-OPS-AUDIT-ACTOR review SEC-W7OAA-1 (D-40): the vendor side of a request's life, in the order the
 * request page offers it (PO_ISSUED -> acknowledge -> VENDOR_ACKNOWLEDGED -> fulfill -> FULFILLED ->
 * invoice -> INVOICED). Each transition moves a request only from the step before it, once: a DRAFT
 * request cannot be invoiced, a replay is refused rather than writing a second feed row, and an
 * acknowledge after the invoice cannot move the request back.
 */
const VENDOR_STEPS = {
  acknowledge: { from: 'PO_ISSUED', to: 'VENDOR_ACKNOWLEDGED', done: 'acknowledged by the vendor' },
  fulfill: { from: 'VENDOR_ACKNOWLEDGED', to: 'FULFILLED', done: 'marked fulfilled' },
  invoice: { from: 'FULFILLED', to: 'INVOICED', done: 'marked invoiced' },
} as const;
type VendorStep = (typeof VENDOR_STEPS)[keyof typeof VENDOR_STEPS];

/** What a vendor transition answers (409) when another move landed between its read and its write. */
function movedDuring(step: VendorStep): string {
  return `The request changed while it was being ${step.done}; reload it and try again`;
}

/** What writeRequest writes through: the app's client, or a transaction's. */
type RequestWriter = Pick<PrismaService['client'], 'procurementRequest'>;

/**
 * Procurement requests.
 *
 * FOLLOW3-D15-PROCUREMENT-BOUND-WRITES: every write to a request goes through writeRequest, an
 * updateMany where { id, businessId } that refuses (404) unless it moved exactly one row. The
 * binding is the service's own, not the caller's: the KEY dispatcher also runs on the staff bridge,
 * with no tenant armed, and acknowledgeVendor, markFulfilled and markInvoiced used to update the
 * request where { id } alone (review SEC-R013g-2). Approve and reject write only the status (the
 * model has no approval columns) and record the decision in the audit trail, one BusinessEvent
 * naming the member who decided (D-08: BusinessEvent is the audit trail, Activity the feed),
 * written in the same transaction as the status, so a decision never stands without its row
 * (review SEC-D15-4), and only from the status the decider read (SEC-D15-2). PATCH cannot set a
 * decision status (SEC-D15-3). Acknowledge, fulfill and invoice move a request only from the step
 * before each, by the same compare-and-set (SEC-W7OAA-1, D-40: VENDOR_STEPS).
 */
@Injectable()
export class ProcurementService {
  private readonly logger = new Logger(ProcurementService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TimelineService) private readonly timeline: TimelineService,
    // The app's event bus (EventBusModule, global): a committed decision's audit row is fanned out
    // on it as BusinessEventService.emit fans out every audit row. EventEmitterModule.forRoot() provides it app-wide, so it is not @Optional() (phantom-injection spec).
    @Inject(EventEmitter2) private readonly events: EventEmitter2 | null = null,
  ) {}

  /**
   * The one write to a procurement request: bound to the business by the where itself, refused
   * unless exactly one row moved, and answered with the row as it now is.
   *
   * fromStatus makes the write a compare-and-set: it moves the request only while its status is
   * still the one the caller read, and answers 409 (conflict, when given, says why) when the request
   * is there but has moved. client is the transaction to write in (updateStatus), the app's client
   * otherwise.
   */
  private async writeRequest(
    businessId: string,
    id: string,
    data: Prisma.ProcurementRequestUpdateManyMutationInput,
    { fromStatus, client = this.prisma.client, conflict }: { fromStatus?: string; client?: RequestWriter; conflict?: string } = {},
  ) {
    // Nothing to write (PATCH {}, a body the whitelist strips, a KEY update naming no field):
    // Prisma answers count 0 for empty data without running SQL, which is not "missing" (review
    // SEC-D15-1 / CR-D15-1). Answer the request as it is, found in this business as any read is.
    if (Object.values(data).every((value) => value === undefined)) return this.get(businessId, id);
    const { count } = await client.procurementRequest.updateMany({
      where: { id, businessId, status: fromStatus },
      data,
    });
    if (count !== 1 && fromStatus !== undefined) await this.refuseIfMoved(client, businessId, id, conflict);
    if (count !== 1) throw new NotFoundException('Request not found');
    const row = await client.procurementRequest.findFirst({ where: { id, businessId } });
    if (!row) throw new NotFoundException('Request not found');
    return row;
  }

  /** A compare-and-set that moved nothing: 409 when the request is still in this business. */
  private async refuseIfMoved(client: RequestWriter, businessId: string, id: string, conflict?: string) {
    if ((await client.procurementRequest.count({ where: { id, businessId } })) > 0) {
      throw new ConflictException(conflict ?? 'The request changed while it was being decided; reload it and decide again');
    }
  }

  /**
   * A vendor transition's precondition (review SEC-W7OAA-1, D-40): the request, found in this business
   * (404 otherwise), must stand at the step before the transition; anything else is 409 and nothing is
   * written. The write that follows is a compare-and-set on that same step (as a decision is, SEC-D15-2),
   * so a transition that lands between this read and that write refuses the later one too.
   */
  private async requireStep(businessId: string, id: string, step: VendorStep) {
    const req = await this.get(businessId, id);
    if (req.status !== step.from) {
      throw new ConflictException(`A request is ${step.done} only once it is ${step.from}; this one is ${req.status}`);
    }
  }

  async list(businessId: string) {
    return (this.prisma.client as any).procurementRequest.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(businessId: string, dto: CreateProcurementRequestDto, userId?: string) {
    // Simple AI interpretation (replace with LLM when quota available)
    const interpretedNeed = {
      category: this.inferCategory(dto.userPrompt),
      urgency: dto.priority ?? 'NORMAL',
      scope: 'business_support',
    };

    const recommendedPackages = this.generatePackages(dto.userPrompt);

    const req = await (this.prisma.client as any).procurementRequest.create({
      data: {
        businessId,
        requestedByUserId: userId ?? null,
        userPrompt: dto.userPrompt,
        interpretedNeed: interpretedNeed as any,
        recommendedPackages: recommendedPackages as any,
        priority: dto.priority,
        estimatedBudget: dto.estimatedBudget as any,
      },
    });

    // Write to unified Activity ledger (Wave 1)
    this.timeline.recordEvent({
      businessId,
      module: 'procurement',
      action: 'request.created',
      entityType: 'procurement_request',
      entityId: req.id,
      title: 'Procurement request created',
      detail: dto.userPrompt.slice(0, 200),
      category: 'SYSTEM',
      actorType: 'USER',
      actorId: userId,
      priority: dto.priority as any,
      data: { interpretedCategory: interpretedNeed.category },
      occurredAt: new Date(),
    }).catch((err) => {
      this.logger.warn(`[UnifiedLedger] failed to record procurement activity: ${(err as Error).message}`);
    });

    return req;
  }

  async get(businessId: string, id: string) {
    const req = await (this.prisma.client as any).procurementRequest.findFirst({
      where: { id, businessId },
    });
    if (!req) throw new NotFoundException('Request not found');
    return req;
  }

  async update(businessId: string, id: string, dto: UpdateProcurementRequestDto) {
    // Review SEC-D15-3: approving or rejecting is a decision, made through approve and reject,
    // which record it (updateStatus). A request this business does not have answers 404 first.
    if (typeof dto.status === 'string' && DECISION_STATUSES.has(dto.status.trim().toUpperCase())) {
      await this.get(businessId, id);
      throw new BadRequestException(
        'A request is approved or rejected through its approve and reject actions, which record the decision; PATCH cannot set that status',
      );
    }
    return this.writeRequest(businessId, id, {
      status: dto.status,
      priority: dto.priority,
      internalNotes: dto.internalNotes,
      brief: dto.brief as Prisma.InputJsonValue | undefined,
    });
  }

  async submitForReview(businessId: string, id: string, userId?: string) {
    const req = await this.get(businessId, id);
    const brief = this.generateBrief(req);
    const updated = await this.writeRequest(businessId, id, {
      status: 'SUBMITTED',
      submittedAt: new Date(),
      brief: brief as Prisma.InputJsonValue,
    });

    // Write to unified Activity ledger (Wave 1)
    this.timeline.recordEvent({
      businessId,
      module: 'procurement',
      action: 'request.submitted',
      entityType: 'procurement_request',
      entityId: id,
      title: 'Procurement request submitted for review',
      detail: `Status: SUBMITTED · ${req.userPrompt.slice(0, 150)}`,
      category: 'SYSTEM',
      actorType: 'USER',
      actorId: userId, // W7-OPS-AUDIT-ACTOR: the member who submitted it
      status: 'COMPLETED',
      data: { brief },
      occurredAt: new Date(),
    }).catch((err) => {
      this.logger.warn(`[UnifiedLedger] failed to record procurement activity: ${(err as Error).message}`);
    });

    return updated;
  }

  /**
   * Approve (status APPROVED) or reject (REJECTED, with an optional reason) a request.
   *
   * FOLLOW3-D15: the request row has no approval columns, so the status is all that is written to
   * it (writing the approver, the time and the reason there answered 500 to every caller). Who
   * decided, when, and why is the audit trail's: exactly one BusinessEvent per decision.
   *
   * The status and its BusinessEvent are written in one transaction (review SEC-D15-4):
   * BusinessEventService.emit swallows a failed insert, so a decision written beside it could
   * stand with no audit row; here a failed insert rolls the status back and answers 503. The
   * status moves only from the one read (review SEC-D15-2): when another decision lands first this
   * one answers 409 and writes nothing, and the row records the status this call wrote, not a
   * re-read. A refused or failed call writes no audit row, feed row or bus event. The Activity
   * feed row below is the user-facing entry, best effort as before.
   */
  async updateStatus(businessId: string, id: string, status: string, userId?: string, reason?: string) {
    const req = await this.get(businessId, id);
    // the body is not validated by a DTO: only a non-empty string is a reason
    const why = typeof reason === 'string' && reason.trim() ? reason : undefined;
    const decision = status.toLowerCase();
    const audit: CreateBusinessEventInput = {
      businessId,
      eventType: `procurement_request.${decision}`,
      subjectType: 'procurement_request',
      subjectId: id,
      actorType: userId ? 'human' : 'system',
      actorId: userId ?? 'system',
      action: decision,
      before: { status: req.status },
      after: { status },
      source: 'web',
      metadata: why ? { reason: why } : undefined,
    };

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const row = await this.writeRequest(businessId, id, { status }, { fromStatus: req.status, client: tx });
      try {
        await tx.businessEvent.create({
          data: {
            businessId: audit.businessId,
            eventType: audit.eventType,
            subjectType: audit.subjectType,
            subjectId: audit.subjectId,
            actorType: audit.actorType,
            actorId: audit.actorId,
            action: audit.action,
            before: audit.before as Prisma.InputJsonValue,
            after: audit.after as Prisma.InputJsonValue,
            evidenceIds: [],
            messageIds: [],
            source: audit.source,
            metadata: audit.metadata as Prisma.InputJsonValue | undefined,
          },
        });
      } catch (err) {
        this.logger.error(`[ProcurementAudit] ${audit.eventType} ${id} not recorded; decision rolled back: ${(err as Error).message}`);
        throw new ServiceUnavailableException('The audit trail is unavailable; the request was not decided');
      }
      return row;
    });

    // committed: fan the audit row out as BusinessEventService.emit does (never fails the decision)
    try {
      this.events?.emit('business_event.created', audit);
    } catch (err) {
      this.logger.warn(`[ProcurementAudit] business_event.created fan-out failed: ${(err as Error).message}`);
    }

    this.timeline.recordEvent({
      businessId,
      module: 'procurement',
      action: `request.${decision}`,
      entityType: 'procurement_request',
      entityId: id,
      title: `Procurement request ${decision}`,
      detail: why ? why.slice(0, 200) : `Status changed to ${status}`,
      category: 'SYSTEM',
      actorType: 'USER',
      actorId: userId,
      status: status === 'APPROVED' ? 'COMPLETED' : 'CANCELLED',
      data: { status, reason: why },
      occurredAt: new Date(),
    }).catch((err) => {
      this.logger.warn(`[UnifiedLedger] failed to record procurement activity: ${(err as Error).message}`);
    });

    return updated;
  }

  async listSuppliers(businessId: string) {
    return this.prisma.client.supplierConnection.findMany({
      where: { businessId, isActive: true },
      orderBy: { displayName: 'asc' },
      select: { id: true, displayName: true, providerType: true, connectionHealth: true, lastSyncAt: true },
    });
  }

  async selectVendor(businessId: string, id: string, supplierConnectionId: string | null) {
    return this.writeRequest(businessId, id, { supplierConnectionId });
  }

  async issuePO(businessId: string, id: string, userId?: string) {
    const req = await this.get(businessId, id);
    if (!req.supplierConnectionId) throw new NotFoundException('No vendor selected');
    const supplier = await this.prisma.client.supplierConnection.findFirst({
      where: { id: req.supplierConnectionId, businessId },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');

    const po = await this.prisma.client.purchaseOrder.create({
      data: {
        businessId,
        poNumber: `PO-${Date.now()}`,
        status: 'DRAFT',
        supplierName: supplier.displayName,
        supplierConnectionId: supplier.id,
        items: (req.recommendedPackages as any[]) ?? [],
        subtotal: req.estimatedBudget?.max ?? req.estimatedBudget?.min ?? 0,
        total: req.estimatedBudget?.max ?? req.estimatedBudget?.min ?? 0,
        currency: 'TTD',
      },
    });

    const updated = await this.writeRequest(businessId, id, { status: 'PO_ISSUED', purchaseOrderId: po.id, poIssuedAt: new Date() });

    this.timeline.recordEvent({
      businessId,
      module: 'procurement',
      action: 'request.po_issued',
      entityType: 'procurement_request',
      entityId: id,
      title: 'Purchase order issued',
      detail: `PO ${po.poNumber} to ${supplier.displayName}`,
      actorType: 'USER',
      actorId: userId,
      occurredAt: new Date(),
    }).catch(() => {});

    return { ...updated, purchaseOrder: po };
  }

  /**
   * The three vendor transitions (acknowledge, fulfill, invoice). Each moves the request only from the
   * step before it and only once: requireStep refuses any other status (409) and the write is a
   * compare-and-set on that step (review SEC-W7OAA-1, D-40), so the feed row each writes records a move
   * that happened, and names the member who made it (W7-OPS-AUDIT-ACTOR, SEC-R013g-4).
   */
  async acknowledgeVendor(businessId: string, id: string, userId?: string) {
    const step = VENDOR_STEPS.acknowledge;
    await this.requireStep(businessId, id, step);
    const updated = await this.writeRequest(
      businessId,
      id,
      { status: step.to, vendorAcknowledgedAt: new Date() },
      { fromStatus: step.from, conflict: movedDuring(step) },
    );
    this.timeline.recordEvent({
      businessId,
      module: 'procurement',
      action: 'request.vendor_acknowledged',
      entityType: 'procurement_request',
      entityId: id,
      title: 'Vendor acknowledged PO',
      ...actedBy(userId),
      occurredAt: new Date(),
    }).catch(() => {});
    return updated;
  }

  async markFulfilled(businessId: string, id: string, userId?: string) {
    const step = VENDOR_STEPS.fulfill;
    await this.requireStep(businessId, id, step);
    const updated = await this.writeRequest(
      businessId,
      id,
      { status: step.to, fulfilledAt: new Date() },
      { fromStatus: step.from, conflict: movedDuring(step) },
    );
    this.timeline.recordEvent({
      businessId,
      module: 'procurement',
      action: 'request.fulfilled',
      entityType: 'procurement_request',
      entityId: id,
      title: 'Order fulfilled',
      ...actedBy(userId),
      occurredAt: new Date(),
    }).catch(() => {});
    return updated;
  }

  async markInvoiced(businessId: string, id: string, userId?: string) {
    const step = VENDOR_STEPS.invoice;
    await this.requireStep(businessId, id, step);
    const updated = await this.writeRequest(
      businessId,
      id,
      { status: step.to, invoicedAt: new Date() },
      { fromStatus: step.from, conflict: movedDuring(step) },
    );
    this.timeline.recordEvent({
      businessId,
      module: 'procurement',
      action: 'request.invoiced',
      entityType: 'procurement_request',
      entityId: id,
      title: 'Supplier invoice received',
      ...actedBy(userId),
      occurredAt: new Date(),
    }).catch(() => {});
    return updated;
  }

  async getStats(businessId: string) {
    const all = await (this.prisma.client as any).procurementRequest.findMany({
      where: { businessId },
      select: { status: true, priority: true, estimatedBudget: true, interpretedNeed: true },
    });

    const total = all.length;
    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    let totalBudget = 0;
    let budgetCount = 0;

    for (const r of all) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      byPriority[r.priority] = (byPriority[r.priority] ?? 0) + 1;
      const cat = (r.interpretedNeed as any)?.category ?? 'unknown';
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
      const budget = r.estimatedBudget?.max ?? r.estimatedBudget?.min ?? 0;
      if (budget > 0) { totalBudget += budget; budgetCount++; }
    }

    return {
      total,
      byStatus,
      byPriority,
      byCategory,
      averageBudget: budgetCount > 0 ? Math.round(totalBudget / budgetCount) : 0,
      totalBudget,
      pendingApprovals: (byStatus.SUBMITTED ?? 0),
    };
  }

  private inferCategory(prompt: string): string {
    const p = prompt.toLowerCase();
    if (p.includes('brand')) return 'branding';
    if (p.includes('store') || p.includes('website')) return 'storefront';
    if (p.includes('crm') || p.includes('customer')) return 'crm';
    if (p.includes('booking') || p.includes('appointment')) return 'bookings';
    if (p.includes('invoice') || p.includes('payment')) return 'commerce';
    if (p.includes('price')) return 'pricing';
    if (p.includes('follow') || p.includes('lead')) return 'sales';
    if (p.includes('inventory') || p.includes('stock')) return 'inventory';
    return 'general';
  }

  private generatePackages(prompt: string): unknown[] {
    const category = this.inferCategory(prompt);
    const packages: Record<string, unknown[]> = {
      branding: [
        { name: 'Brand Identity Refresh', description: 'Logo, colors, and brand guidelines', estimatedCost: { min: 500, max: 2000 }, timeline: '2-4 weeks' },
        { name: 'Brand Strategy Session', description: 'Positioning and messaging workshop', estimatedCost: { min: 300, max: 800 }, timeline: '1 week' },
      ],
      storefront: [
        { name: 'Storefront Optimization', description: 'Layout, copy, and conversion improvements', estimatedCost: { min: 400, max: 1500 }, timeline: '1-2 weeks' },
        { name: 'Full Storefront Build', description: 'Complete redesign with SEO', estimatedCost: { min: 1000, max: 5000 }, timeline: '3-6 weeks' },
      ],
      crm: [
        { name: 'CRM Cleanup', description: 'Contact deduplication and segmentation', estimatedCost: { min: 200, max: 800 }, timeline: '3-5 days' },
        { name: 'CRM Automation Setup', description: 'Sequences and follow-up workflows', estimatedCost: { min: 500, max: 1500 }, timeline: '1-2 weeks' },
      ],
      general: [
        { name: 'Business Operations Audit', description: 'Full system review with recommendations', estimatedCost: { min: 300, max: 1000 }, timeline: '1 week' },
        { name: 'Growth Strategy Session', description: '90-day action plan', estimatedCost: { min: 400, max: 1200 }, timeline: '3-5 days' },
      ],
    };
    return packages[category] || packages.general;
  }

  private generateBrief(req: any): Record<string, unknown> {
    return {
      businessGoal: req.userPrompt,
      interpretedCategory: (req.interpretedNeed as any)?.category,
      recommendedPackages: req.recommendedPackages,
      suggestedNextStep: 'Review packages and approve preferred option',
      aiConfidence: 75,
      missingInfo: [],
    };
  }
}
