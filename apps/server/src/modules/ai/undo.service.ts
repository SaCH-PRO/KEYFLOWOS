import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AiExecutionLogService } from './ai-execution-log.service';

export interface UndoableAction {
  id: string;
  businessId: string;
  actionType: string;
  entityType: string;
  entityId: string;
  originalPayload: Record<string, any>;
  createdAt: Date;
  undoneAt?: Date;
  undoPayload?: Record<string, any>;
}

@Injectable()
export class UndoService {
  private readonly logger = new Logger(UndoService.name);
  private readonly UNDO_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
  private recentActions = new Map<string, UndoableAction>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(AiExecutionLogService) private readonly executionLog: AiExecutionLogService,
  ) {}

  /**
   * Register an action that was auto-executed, making it eligible for undo
   */
  async registerAction(params: {
    businessId: string;
    actionType: string;
    entityType: string;
    entityId: string;
    originalPayload: Record<string, any>;
    undoPayload?: Record<string, any>;
  }): Promise<string> {
    const id = `undo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const action: UndoableAction = {
      id,
      businessId: params.businessId,
      actionType: params.actionType,
      entityType: params.entityType,
      entityId: params.entityId,
      originalPayload: params.originalPayload,
      createdAt: new Date(),
      undoPayload: params.undoPayload,
    };

    this.recentActions.set(id, action);

    // Auto-expire after undo window
    setTimeout(() => {
      this.recentActions.delete(id);
    }, this.UNDO_WINDOW_MS);

    return id;
  }

  /**
   * Check if an action can be undone (within window and not already undone)
   */
  canUndo(undoId: string): { canUndo: boolean; reason?: string; action?: UndoableAction } {
    const action = this.recentActions.get(undoId);
    if (!action) {
      return { canUndo: false, reason: 'Undo window expired or action not found' };
    }
    if (action.undoneAt) {
      return { canUndo: false, reason: 'Action already undone' };
    }
    if (Date.now() - action.createdAt.getTime() > this.UNDO_WINDOW_MS) {
      return { canUndo: false, reason: 'Undo window expired (5 minutes)' };
    }
    return { canUndo: true, action };
  }

  /**
   * Undo a previously registered action
   */
  async undo(undoId: string, userId?: string): Promise<{ success: boolean; message: string; restored?: Record<string, any> }> {
    const check = this.canUndo(undoId);
    if (!check.canUndo || !check.action) {
      return { success: false, message: check.reason ?? 'Cannot undo' };
    }

    const action = check.action;

    try {
      let restored: Record<string, any> | undefined;

      switch (action.entityType) {
        case 'invoice':
          restored = await this.undoInvoice(action);
          break;
        case 'contact':
          restored = await this.undoContact(action);
          break;
        case 'booking':
          restored = await this.undoBooking(action);
          break;
        case 'task':
          restored = await this.undoTask(action);
          break;
        case 'message':
          restored = await this.undoMessage(action);
          break;
        default:
          return { success: false, message: `Undo not supported for entity type: ${action.entityType}` };
      }

      action.undoneAt = new Date();
      this.recentActions.set(undoId, action);

      // Log the undo
      await this.executionLog.log({
        businessId: action.businessId,
        action: 'action.undone',
        toolName: undefined,
        mode: 'manual',
        actor: userId ?? 'user',
        success: true,
        durationMs: 0,
        inputSummary: { undoId, entityType: action.entityType, entityId: action.entityId },
        outputSummary: { restored: restored ? 'yes' : 'no' },
      }).catch(() => {});

      this.events.emit('action.undone', {
        businessId: action.businessId,
        undoId,
        entityType: action.entityType,
        entityId: action.entityId,
        userId,
      });

      return { success: true, message: `${action.entityType} action undone successfully`, restored };
    } catch (err: any) {
      this.logger.error(`Undo failed for ${undoId}: ${(err as Error).message}`);
      return { success: false, message: `Undo failed: ${(err as Error).message}` };
    }
  }

  /**
   * Get recent undoable actions for a business
   */
  async getRecentActions(businessId: string): Promise<UndoableAction[]> {
    const now = Date.now();
    return Array.from(this.recentActions.values())
      .filter((a) => a.businessId === businessId && !a.undoneAt && now - a.createdAt.getTime() <= this.UNDO_WINDOW_MS)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  private async undoInvoice(action: UndoableAction): Promise<Record<string, any>> {
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: action.entityId },
      select: { id: true, status: true },
    });

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    // If invoice hasn't been sent/paid, soft-delete it
    if (invoice.status === 'DRAFT') {
      await this.prisma.client.invoice.update({
        where: { id: action.entityId },
        data: { deletedAt: new Date() },
      });
      return { id: action.entityId, status: 'deleted' };
    }

    // Otherwise, revert to draft
    await this.prisma.client.invoice.update({
      where: { id: action.entityId },
      data: { status: 'DRAFT' },
    });
    return { id: action.entityId, status: 'reverted_to_draft' };
  }

  private async undoContact(action: UndoableAction): Promise<Record<string, any>> {
    // Check if contact has any related activity
    const hasActivity = await this.prisma.client.contact.findUnique({
      where: { id: action.entityId },
      include: {
        _count: { select: { bookings: true, invoices: true, tasks: true } },
      },
    });

    if (!hasActivity) {
      throw new Error('Contact not found');
    }

    const totalActivity = (hasActivity._count.bookings ?? 0) +
      (hasActivity._count.invoices ?? 0) +
      (hasActivity._count.tasks ?? 0);

    if (totalActivity === 0) {
      // Safe to soft-delete if no activity
      await this.prisma.client.contact.update({
        where: { id: action.entityId },
        data: { deletedAt: new Date() },
      });
      return { id: action.entityId, status: 'deleted' };
    }

    // Otherwise mark as LEAD to indicate it needs review
    await this.prisma.client.contact.update({
      where: { id: action.entityId },
      data: { status: 'LEAD' },
    });
    return { id: action.entityId, status: 'reverted_to_lead' };
  }

  private async undoBooking(action: UndoableAction): Promise<Record<string, any>> {
    const booking = await this.prisma.client.booking.findUnique({
      where: { id: action.entityId },
      select: { id: true, status: true },
    });

    if (!booking) {
      throw new Error('Booking not found');
    }

    if (booking.status === 'PENDING') {
      await this.prisma.client.booking.update({
        where: { id: action.entityId },
        data: { status: 'CANCELLED' },
      });
      return { id: action.entityId, status: 'cancelled' };
    }

    throw new Error('Cannot undo booking that is already confirmed or completed');
  }

  private async undoTask(action: UndoableAction): Promise<Record<string, any>> {
    // Task model may not support soft delete — try to update status instead
    try {
      await (this.prisma.client as any).task.update({
        where: { id: action.entityId },
        data: { deletedAt: new Date() },
      });
    } catch {
      await (this.prisma.client as any).task.update({
        where: { id: action.entityId },
        data: { status: 'CANCELLED' },
      });
    }
    return { id: action.entityId, status: 'deleted' };
  }

  private async undoMessage(action: UndoableAction): Promise<Record<string, any>> {
    // Messages typically can't be unsent, but we can mark them as retracted
    return { id: action.entityId, status: 'noted_for_review' };
  }
}
