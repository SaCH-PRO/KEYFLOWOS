import { Injectable, NotFoundException } from '@nestjs/common';
import { FlowSignalImportance, FlowSignalStatus, FlowType } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { getRoleDefinition, getAllRoleDefinitions } from './flow-role-subscriptions.config';
import type { FlowSignalDto, RoleFlowQueue } from './flow-signal.types';

export interface RoleQueueSummary {
  roleKey: string;
  label: string;
  flowTypes: FlowType[];
  total: number;
  summary: {
    critical: number;
    high: number;
    actionRequired: number;
  };
}

@Injectable()
export class RoleFlowService {
  constructor(private readonly prisma: PrismaService) {}

  async getRoleQueue(
    businessId: string,
    roleKey: string,
    options?: { includeItems?: boolean; itemLimit?: number },
  ): Promise<RoleFlowQueue> {
    const definition = getRoleDefinition(roleKey);
    if (!definition) {
      throw new NotFoundException(`Flow role ${roleKey} not found`);
    }

    const allFlowTypes = Array.from(new Set(definition.subscriptions.map((s) => s.flowType)));
    const includeItems = options?.includeItems ?? true;
    const itemLimit = options?.itemLimit ?? 100;
    const allItems: FlowSignalDto[] = [];

    for (const subscription of definition.subscriptions) {
      const rows = await this.prisma.client.flowSignal.findMany({
        where: {
          businessId,
          flows: { has: subscription.flowType },
          status: { in: ['RECORDED', 'ACTION_REQUIRED'] as FlowSignalStatus[] },
          ...(subscription.typeFilter && {
            type: { startsWith: subscription.typeFilter.replace('%', '') },
          }),
          ...(subscription.sourceFilter && { source: subscription.sourceFilter }),
          ...(subscription.moduleFilter && { module: subscription.moduleFilter }),
          ...(subscription.importanceFilter && {
            importance: { in: subscription.importanceFilter.split(',') as FlowSignalImportance[] },
          }),
        },
        orderBy: { occurredAt: 'desc' },
        take: 200,
      });

      if (includeItems) {
        allItems.push(...rows.map((row) => this.toDto(row)));
      } else {
        // Only count one representative row per signal id; a row may match
        // multiple subscriptions but counts once per role.
        allItems.push(...rows.map((row) => this.toDto(row)));
      }
    }

    // Deduplicate by signal id and re-sort by occurredAt.
    const deduped = Array.from(new Map(allItems.map((item) => [item.id, item])).values()).sort(
      (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    );

    return {
      roleKey,
      flowTypes: allFlowTypes,
      total: deduped.length,
      items: includeItems ? deduped.slice(0, itemLimit) : [],
      summary: {
        critical: deduped.filter((i) => i.importance === 'CRITICAL').length,
        high: deduped.filter((i) => i.importance === 'HIGH').length,
        actionRequired: deduped.filter((i) => i.status === 'ACTION_REQUIRED').length,
      },
    };
  }

  async getAllRoleQueues(businessId: string): Promise<RoleQueueSummary[]> {
    const definitions = getAllRoleDefinitions();
    const results = await Promise.all(
      definitions.map(async (definition) => {
        const queue = await this.getRoleQueue(businessId, definition.key, {
          includeItems: false,
          itemLimit: 0,
        });
        return {
          roleKey: definition.key,
          label: definition.label,
          flowTypes: queue.flowTypes,
          total: queue.total,
          summary: queue.summary,
        };
      }),
    );

    // Sort by total descending, then by label.
    return results.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return a.label.localeCompare(b.label);
    });
  }

  private toDto(row: {
    id: string;
    businessId: string;
    userId: string | null;
    flows: FlowType[];
    source: string;
    type: string;
    module: string | null;
    entityType: string | null;
    entityId: string | null;
    title: string;
    summary: string | null;
    description: string | null;
    occurredAt: Date;
    startsAt: Date | null;
    endsAt: Date | null;
    reminderAt: Date | null;
    status: FlowSignalStatus;
    importance: FlowSignalImportance;
    visibility: string;
    ownerRoleHint: string | null;
    payload: unknown;
    signals: unknown;
    tags: string[];
    createdAt: Date;
    updatedAt: Date;
  }): FlowSignalDto {
    return {
      id: row.id,
      businessId: row.businessId,
      userId: row.userId,
      flows: row.flows,
      source: row.source,
      type: row.type,
      module: row.module,
      entityType: row.entityType,
      entityId: row.entityId,
      title: row.title,
      summary: row.summary,
      description: row.description,
      occurredAt: row.occurredAt,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      reminderAt: row.reminderAt,
      status: row.status,
      importance: row.importance,
      visibility: row.visibility,
      ownerRoleHint: row.ownerRoleHint,
      payload: (row.payload as Record<string, unknown>) ?? {},
      signals: (row.signals as Record<string, unknown>) ?? {},
      tags: row.tags,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
