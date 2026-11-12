import { Injectable, Logger, Inject, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AiExecutionLogService } from './ai-execution-log.service';
import { CommerceService } from '../commerce/commerce.service';
import { CrmService } from '../crm/crm.service';
import { contactWhereWithId } from '../crm/crm.helpers';
import { resolveCrmAccess, visibilityClause, type CrmAccess } from '../crm/crm-permissions.helper';
import { BookingsService } from '../bookings/bookings.service';
import { LEVEL_RANK, defaultScopesForRole, rankOf, type CanonicalModule } from '../../core/authority/module-vocabulary';

/**
 * V1-42b-UNDO-TENANT-SCOPE (V1-42 review SEC-V42-1): the module whose WRITE
 * scope an undo needs, keyed by the entity type that selects the undo writer
 * below (the action dispatcher registers each tool result as one of these,
 * action-dispatcher.service.ts inferEntityType). Every tool that registers an
 * invoice, the payment one (commerce_mark_invoice_paid) included, is undone
 * by CommerceService.undoInvoice: revenue.
 *
 * Deny by default: a type that is not listed here is refused to everyone.
 * Two registrable types are deliberately left out (pinned by the census in
 * test/undo-tenant-scope.integration.test.ts):
 *   task     undoTask writes the generic Task table by id, while every tool
 *            that registers a task creates a row of another table (ContactTask,
 *            ProjectTask, CallTask, ...) owned by different modules;
 *   message  undoMessage writes nothing a module scope could guard.
 */
export const UNDO_WRITE_SCOPE: Readonly<Record<string, CanonicalModule>> = Object.freeze({
  invoice: 'revenue',
  contact: 'crm',
  booking: 'bookings',
});

/** The module an undo of `entityType` needs write access to, or null (refused). */
export function undoWriteScopeFor(entityType: string): CanonicalModule | null {
  return Object.prototype.hasOwnProperty.call(UNDO_WRITE_SCOPE, entityType) ? UNDO_WRITE_SCOPE[entityType] : null;
}

/**
 * One answer for an unknown, expired-and-collected, and another tenant's undo
 * id, and for the undo of a contact the actor cannot see (SEC-V42B-1).
 */
const UNDO_NOT_FOUND = 'Undo window expired or action not found';

/**
 * The actor's membership and CRM access, read once per request: undo() checks
 * one record, the undo listing checks every record of the window with them.
 */
interface UndoActorLookups {
  membership?: Promise<{ role: string; permissionScopes: unknown } | null>;
  crmAccess?: Promise<CrmAccess>;
}

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
  /**
   * SEC-V42B-2: undo ids whose writer is running. undo() checks canUndo and
   * claims the id in one synchronous step, before the writer's first await, so
   * a concurrent request for the same id is refused instead of running the
   * writer again (a second CommerceService.undoInvoice would see the DRAFT the
   * first wrote and soft-delete it). Released when the writer returns or throws.
   * The records live in this process's memory, so this claim covers them.
   */
  private readonly undoing = new Set<string>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(AiExecutionLogService) private readonly executionLog: AiExecutionLogService,
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
  ) {}

  private getCommerce() {
    return this.moduleRef.get(CommerceService, { strict: false });
  }
  private getCrm() {
    return this.moduleRef.get(CrmService, { strict: false });
  }
  private getBookings() {
    return this.moduleRef.get(BookingsService, { strict: false });
  }

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
    if (this.undoing.has(undoId)) {
      return { canUndo: false, reason: 'Undo already in progress' };
    }
    if (Date.now() - action.createdAt.getTime() > this.UNDO_WINDOW_MS) {
      return { canUndo: false, reason: 'Undo window expired (5 minutes)' };
    }
    return { canUndo: true, action };
  }

  /**
   * Undo a previously registered action.
   *
   * V1-42b-UNDO-TENANT-SCOPE (V1-42 review SEC-V42-1). Both undo routes
   * (agent.controller.ts undoAction, ai.controller.ts undoPlanStep) pass the
   * tenant BusinessGuard admitted and req.user's id; the undo id comes from the
   * client. In this order, before anything is written:
   *   1. the record is resolved only inside `guardedBusinessId`: another
   *      business's id answers the same 404 as an unknown one;
   *   2. the actor must be a member of the record's business holding WRITE on
   *      the module of what is undone (UNDO_WRITE_SCOPE; ModuleScopeGuard's
   *      rule: the explicit scope map, else the role defaults). A platform
   *      SUPER_ADMIN who is not a member is refused (D-46), and an entity type
   *      with no mapping is refused to everyone;
   *   3. then the record's own state (already undone, in progress, window
   *      passed), checked and claimed in one synchronous step (SEC-V42B-2).
   * Without `guardedBusinessId` (a caller outside a route) step 2 still binds
   * the actor to the record's business.
   */
  async undo(
    undoId: string,
    actorId: string | undefined,
    guardedBusinessId?: string,
  ): Promise<{ success: boolean; message: string; restored?: Record<string, any> }> {
    const record = this.recentActions.get(undoId);
    if (!record || (guardedBusinessId !== undefined && record.businessId !== guardedBusinessId)) {
      throw new NotFoundException(UNDO_NOT_FOUND);
    }
    const userId = await this.assertActorMayUndo(record, actorId);

    // Check and claim with no await in between (SEC-V42B-2).
    const check = this.canUndo(undoId);
    if (!check.canUndo || !check.action) {
      return { success: false, message: check.reason ?? 'Cannot undo' };
    }
    this.undoing.add(undoId);

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
        actor: userId,
        userId,
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
    } finally {
      this.undoing.delete(undoId);
    }
  }

  /**
   * The actor must hold WRITE on the module of what is undone, in the business
   * the record belongs to (step 2 of undo()), and, for a contact, pass the CRM
   * row rules (assertContactRowRules). Throws 403, or 404 for a contact the
   * actor cannot see; never writes. Returns the actor, who is the one the undo
   * is logged and announced for.
   */
  private async assertActorMayUndo(
    action: UndoableAction,
    actorId: string | undefined,
    lookups: UndoActorLookups = {},
  ): Promise<string> {
    if (!actorId) throw new ForbiddenException('Authentication required');
    const module = undoWriteScopeFor(action.entityType);
    if (!module) {
      throw new ForbiddenException(`Undo is not permitted for ${action.entityType} actions`);
    }
    lookups.membership ??= this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId: actorId, businessId: action.businessId } },
      select: { role: true, permissionScopes: true },
    });
    const membership = await lookups.membership;
    if (!membership) throw new ForbiddenException('Not a member of this business');
    const scopes: Record<string, string> =
      membership.permissionScopes && typeof membership.permissionScopes === 'object'
        ? (membership.permissionScopes as Record<string, string>)
        : defaultScopesForRole(membership.role);
    const level = scopes[module] || 'none';
    if (rankOf(level) < LEVEL_RANK.write) {
      throw new ForbiddenException(`Insufficient permissions: ${module} requires write access (you have ${level})`);
    }
    if (action.entityType === 'contact') {
      lookups.crmAccess ??= resolveCrmAccess(this.prisma, action.businessId, actorId);
      await this.assertContactRowRules(action, actorId, await lookups.crmAccess);
    }
    return actorId;
  }

  /**
   * SEC-V42B-1 / CR-V42b-1: crm:write is the module level; the contact row
   * rules are those of the CRM doors, through the same resolveCrmAccess and
   * visibilityClause. CrmService.undoContact (which takes no actor) decides at
   * write time, from the contact's activity, whether it soft-deletes the
   * contact or reverts it to LEAD, so the actor must pass both doors' rules:
   *   DELETE contacts/:contactId (softDeleteContact): crm_delete 'none' 403;
   *     outside the visibility clause 404; my book (crm_view 'owned') and not
   *     the owner 404; crm_delete 'owned' and not the owner 403;
   *   PATCH contacts/:contactId (assertCanEditContact): crm_edit 'none' 403;
   *     crm_edit 'owned' and neither the owner nor shared with 403.
   * The refusals that depend on no record come first. A contact the actor
   * cannot see answers the 404 of an unknown undo id. OWNER and SUPER_ADMIN
   * (members: a non-member was refused above) reach every contact.
   */
  private async assertContactRowRules(action: UndoableAction, actorId: string, access: CrmAccess): Promise<void> {
    if (access.isOwner || access.isSuperAdmin) return;
    if (access.deleteScope === 'none') throw new ForbiddenException('You do not have permission to delete contacts');
    if (access.editScope === 'none') throw new ForbiddenException('You do not have permission to edit contacts');
    const where: Prisma.ContactWhereInput = { ...contactWhereWithId(action.businessId, action.entityId) };
    const visClause = visibilityClause(access, actorId);
    if (visClause) where.AND = [visClause as Prisma.ContactWhereInput];
    const contact = await this.prisma.client.contact.findFirst({
      where,
      select: { ownerId: true, shares: { where: { userId: actorId }, select: { id: true } } },
    });
    if (!contact) throw new NotFoundException(UNDO_NOT_FOUND);
    const owns = contact.ownerId === actorId;
    if (!access.viewAll && !owns) throw new NotFoundException(UNDO_NOT_FOUND);
    if (access.deleteScope === 'owned' && !owns) throw new ForbiddenException('You can only delete contacts you own');
    if (access.editScope === 'owned' && !owns && contact.shares.length === 0) {
      throw new ForbiddenException('You can only edit contacts you own');
    }
  }

  /**
   * SEC-V42B-3: the undoable actions of `businessId` that `actorId` may undo,
   * by the rule undo() applies (assertActorMayUndo). A record of a module the
   * actor holds below write, a contact they cannot see or may not both delete
   * and edit, and an entity type refused to everyone are left out.
   */
  async getUndoableActionsFor(businessId: string, actorId: string): Promise<UndoableAction[]> {
    const lookups: UndoActorLookups = {};
    const permitted: UndoableAction[] = [];
    for (const action of await this.getRecentActions(businessId)) {
      try {
        await this.assertActorMayUndo(action, actorId, lookups);
        permitted.push(action);
      } catch (err) {
        if (!(err instanceof HttpException)) throw err;
      }
    }
    return permitted;
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
    const result = await this.getCommerce().undoInvoice(action.entityId, action.businessId);
    return { id: result.id, status: result.status };
  }

  private async undoContact(action: UndoableAction): Promise<Record<string, any>> {
    const result = await this.getCrm().undoContact({
      businessId: action.businessId,
      contactId: action.entityId,
    });
    return { id: result.id, status: result.status };
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
      await this.getBookings().updateBookingStatus(action.businessId, action.entityId, 'CANCELLED');
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
