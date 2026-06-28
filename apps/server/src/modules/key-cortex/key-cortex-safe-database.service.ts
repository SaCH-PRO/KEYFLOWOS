/**
 * KEY Cortex Safe Database Service (Phase 3 Skeleton)
 *
 * Authority-granted, read/write wrappers around Prisma that unblock
 * QUERY_DATABASE and UPDATE_RECORD safely. Every query is tenant-scoped,
 * model/field allow-listed, and audited through the canonical event bus.
 */

import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { KeyCortexEventBusService } from './key-cortex-event-bus.service';
import { KeyCortexToolContext, KeyCortexToolResult } from './key-cortex-tool-registry.service';

export interface SafeQueryInput {
  model: string;
  select?: string[];
  where?: Record<string, unknown>;
  orderBy?: Record<string, 'asc' | 'desc'>;
  take?: number;
  skip?: number;
}

export interface SafeUpdateInput {
  model: string;
  id: string;
  data: Record<string, unknown>;
}

const READABLE_MODELS = new Set([
  'Contact',
  'Account',
  'Deal',
  'Invoice',
  'Quote',
  'Product',
  'Service',
  'Booking',
  'Project',
  'ProjectTask',
  'StaffMember',
  'Expense',
  'SocialPost',
  'EmailCampaign',
  'Site',
  'CalendarEvent',
  'CommandItem',
  'TaskAssignment',
  'CortexSession',
  'KeyCommand',
]);

const UPDATABLE_MODELS = new Set([
  'Contact',
  'Account',
  'Deal',
  'Project',
  'ProjectTask',
  'Booking',
  'Invoice',
  'CommandItem',
]);

// Fields that can never be updated through the safe wrapper.
const PROHIBITED_UPDATE_FIELDS = new Set([
  'id',
  'businessId',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'password',
  'secret',
  'token',
  'apiKey',
]);

// Fields explicitly allowed per model. Empty set means model is not updatable.
const ALLOWED_UPDATE_FIELDS: Record<string, Set<string>> = {
  Contact: new Set(['firstName', 'lastName', 'email', 'phone', 'status', 'tags', 'notes', 'assignedTo']),
  Account: new Set(['name', 'status', 'industry', 'website', 'notes']),
  Deal: new Set(['name', 'stage', 'value', 'status', 'expectedCloseDate', 'notes']),
  Project: new Set(['name', 'status', 'priority', 'dueDate', 'description']),
  ProjectTask: new Set(['title', 'status', 'priority', 'dueDate', 'description']),
  Booking: new Set(['status', 'notes', 'startTime', 'endTime']),
  Invoice: new Set(['status', 'notes', 'dueDate']),
  CommandItem: new Set(['status', 'priority', 'dueAt', 'snoozedUntil', 'completedAt', 'dismissedAt']),
};

const MAX_QUERY_LIMIT = 100;

@Injectable()
export class KeyCortexSafeDatabaseService {
  private readonly logger = new Logger(KeyCortexSafeDatabaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: KeyCortexEventBusService,
  ) {}

  // ========================================================================
  // Safe read
  // ========================================================================

  async safeQuery(ctx: KeyCortexToolContext, input: SafeQueryInput): Promise<KeyCortexToolResult> {
    const startedAt = Date.now();
    const model = this.normalizeModel(input.model);

    if (!READABLE_MODELS.has(model)) {
      return this.errorResult(`Model "${model}" is not queryable through the safe database wrapper.`);
    }

    const take = Math.min(input.take ?? 25, MAX_QUERY_LIMIT);
    const where = this.enforceTenantScope(ctx.businessId, input.where ?? {});

    try {
      const delegate = (this.prisma.client as any)[this.camelCase(model)];
      if (!delegate || typeof delegate.findMany !== 'function') {
        return this.errorResult(`Prisma delegate for "${model}" not found.`);
      }

      const select = this.buildSelect(input.select);
      const args: any = { where, take, skip: input.skip ?? 0 };
      if (select) args.select = select;
      if (input.orderBy) args.orderBy = input.orderBy;

      const rows = await delegate.findMany(args);

      this.audit(ctx, 'cortex.query_database', model, true, { count: rows.length }, Date.now() - startedAt);

      return {
        success: true,
        data: { model, count: rows.length, rows },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[safeQuery] ${model}: ${message}`);
      this.audit(ctx, 'cortex.query_database', model, false, { error: message }, Date.now() - startedAt);
      return this.errorResult(`Query failed: ${message}`);
    }
  }

  // ========================================================================
  // Safe write
  // ========================================================================

  async safeUpdate(ctx: KeyCortexToolContext, input: SafeUpdateInput): Promise<KeyCortexToolResult> {
    const startedAt = Date.now();
    const model = this.normalizeModel(input.model);

    if (!UPDATABLE_MODELS.has(model)) {
      return this.errorResult(`Model "${model}" is not updatable through the safe database wrapper.`);
    }

    const allowed = ALLOWED_UPDATE_FIELDS[model];
    if (!allowed) {
      return this.errorResult(`Model "${model}" has no allowed update fields configured.`);
    }

    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input.data)) {
      if (PROHIBITED_UPDATE_FIELDS.has(key)) {
        return this.errorResult(`Field "${key}" cannot be updated through the safe wrapper.`);
      }
      if (!allowed.has(key)) {
        return this.errorResult(`Field "${key}" is not allowed on model "${model}".`);
      }
      data[key] = value;
    }

    if (Object.keys(data).length === 0) {
      return this.errorResult('No valid fields provided for update.');
    }

    try {
      const delegate = (this.prisma.client as any)[this.camelCase(model)];
      if (!delegate || typeof delegate.update !== 'function') {
        return this.errorResult(`Prisma delegate for "${model}" not found.`);
      }

      const existing = await delegate.findFirst({
        where: { id: input.id, businessId: ctx.businessId },
        select: { id: true },
      });
      if (!existing) {
        return this.errorResult(`Record ${input.id} not found in ${model} for this business.`);
      }

      const updated = await delegate.update({
        where: { id: input.id },
        data,
      });

      this.audit(ctx, 'cortex.update_record', model, true, { id: input.id, fields: Object.keys(data) }, Date.now() - startedAt);

      return {
        success: true,
        data: { model, id: input.id, updated },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[safeUpdate] ${model}: ${message}`);
      this.audit(ctx, 'cortex.update_record', model, false, { error: message }, Date.now() - startedAt);
      return this.errorResult(`Update failed: ${message}`);
    }
  }

  // ========================================================================
  // Tool definitions for canonical registry
  // ========================================================================

  getQueryToolDefinition(): any {
    return {
      name: 'cortex.query_database',
      module: 'key_cortex',
      description:
        'Read-only query against a safe allow-list of business-domain models. ' +
        'Results are scoped to the current business and capped at 100 rows.',
      parameters: {
        type: 'object' as const,
        properties: {
          model: { type: 'string' as const, enum: Array.from(READABLE_MODELS) },
          select: { type: 'array' as const, items: { type: 'string' as const }, description: 'Optional field list to return.' },
          where: { type: 'object' as const, description: 'Prisma-style where clause (businessId is injected automatically).' },
          orderBy: { type: 'object' as const, description: 'Prisma-style orderBy, e.g. { createdAt: "desc" }.' },
          take: { type: 'integer' as const, minimum: 1, maximum: MAX_QUERY_LIMIT },
          skip: { type: 'integer' as const, minimum: 0 },
        },
        required: ['model'],
      },
      riskTier: 2 as const,
      requiresApproval: false,
      handler: (ctx: KeyCortexToolContext, input: Record<string, unknown>) =>
        this.safeQuery(ctx, input as unknown as SafeQueryInput),
    };
  }

  getUpdateToolDefinition(): any {
    return {
      name: 'cortex.update_record',
      module: 'key_cortex',
      description:
        'Update a single record in a safe allow-list of models. ' +
        'Only explicitly allowed fields can be changed and id/businessId/createdAt are protected.',
      parameters: {
        type: 'object' as const,
        properties: {
          model: { type: 'string' as const, enum: Array.from(UPDATABLE_MODELS) },
          id: { type: 'string' as const },
          data: { type: 'object' as const, description: 'Object containing only allowed fields for the model.' },
        },
        required: ['model', 'id', 'data'],
      },
      riskTier: 3 as const,
      requiresApproval: true,
      handler: (ctx: KeyCortexToolContext, input: Record<string, unknown>) =>
        this.safeUpdate(ctx, input as unknown as SafeUpdateInput),
    };
  }

  // ========================================================================
  // Private helpers
  // ========================================================================

  private normalizeModel(name: string): string {
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  private camelCase(name: string): string {
    return name.charAt(0).toLowerCase() + name.slice(1);
  }

  private enforceTenantScope(businessId: string, where: Record<string, unknown>): Record<string, unknown> {
    return { ...where, businessId };
  }

  private buildSelect(select?: string[]): Record<string, boolean> | undefined {
    if (!select || select.length === 0) return undefined;
    const out: Record<string, boolean> = {};
    for (const field of select) {
      out[field] = true;
    }
    return out;
  }

  private errorResult(error: string): KeyCortexToolResult {
    return { success: false, error };
  }

  private audit(
    ctx: KeyCortexToolContext,
    toolName: string,
    model: string,
    success: boolean,
    payload: Record<string, unknown>,
    durationMs: number,
  ): void {
    this.eventBus.emit({
      source: 'key_cortex',
      type: success ? 'cortex.action_executed' : 'cortex.action_failed',
      businessId: ctx.businessId,
      userId: ctx.userId ?? undefined,
      payload: {
        toolName,
        model,
        success,
        durationMs,
        ...payload,
      },
      metadata: {
        correlationId: (ctx as any).correlationId,
        sessionId: (ctx as any).sessionId,
        entityType: 'AiExecutionLog',
        importance: success ? 'normal' : 'high',
      },
    });
  }
}
