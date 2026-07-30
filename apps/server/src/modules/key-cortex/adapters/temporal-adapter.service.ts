import { Injectable, NotFoundException } from '@nestjs/common';
import { ConnectorCommand, ConnectorResult } from '../key-cortex-connector.types';
import { connectorOk, connectorFail } from '../key-cortex-connector.utils';
import { TemporalFlowMemoryService } from '../../temporal-flow/temporal-flow-memory.service';
import { TemporalFlowService } from '../../temporal-flow/temporal-flow.service';
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
  constructor(
    private readonly temporal: TemporalFlowMemoryService,
    private readonly flow: TemporalFlowService,
  ) {}

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
    const deleted = await this.temporal.deleteMemory(input.businessId, input.memoryId);
    return { deleted, memoryId: input.memoryId };
  }

  async updateMemory(input: {
    businessId: string;
    memoryId: string;
    value?: Record<string, unknown>;
    importance?: string;
  }) {
    const confidence = input.importance === 'high' ? 0.9 : input.importance === 'low' ? 0.3 : undefined;
    return this.temporal.updateMemory(input.memoryId, {
      content: input.value ? JSON.stringify(input.value) : undefined,
      confidence,
    });
  }

  async tagMemory(input: {
    businessId: string;
    memoryId: string;
    tags: string[];
  }) {
    const memory = await this.temporal.findMany(input.businessId, { entityId: input.memoryId });
    const existing = memory[0];
    if (!existing) {
      throw new NotFoundException('Memory not found');
    }
    const existingTags = Array.isArray(existing.sourceEventIds) ? existing.sourceEventIds : [];
    return this.temporal.updateMemory(input.memoryId, {
      sourceEventIds: Array.from(new Set([...existingTags, ...input.tags])),
      metadata: {
        ...(existing.metadata as Record<string, unknown> | undefined),
        tags: Array.from(new Set([...existingTags, ...input.tags])),
      },
    });
  }

  async consolidateMemories(input: {
    businessId: string;
    keys: string[];
    summaryKey: string;
  }) {
    const contents: string[] = [];
    for (const key of input.keys) {
      const found = await this.recallMemory({ businessId: input.businessId, key });
      if (found && (found as { content?: string }).content) {
        contents.push(String((found as { content: string }).content));
      }
    }
    const merged = contents.length
      ? `Consolidated memories:\n${contents.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
      : 'No memories found to consolidate.';
    return this.storeMemory({
      businessId: input.businessId,
      key: input.summaryKey,
      value: { consolidatedFrom: input.keys, count: contents.length, summary: merged },
      importance: 'medium',
    });
  }

  async searchMemories(input: { businessId: string; query: string; limit?: number }) {
    return this.temporal.searchMemory(input.businessId, input.query, input.limit ?? 10);
  }

  async getTimeline(input: { businessId: string; from?: string; to?: string; limit?: number }) {
    if (input.from && input.to) {
      return this.flow.calendarRange(input.businessId, input.from, input.to);
    }
    return this.flow.list(input.businessId, { limit: input.limit ?? 50 });
  }

  async getMemoryStats(input: { businessId: string }) {
    return this.temporal.getStats(input.businessId);
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
        const deletion = await this.deleteMemory({
          businessId: command.businessId,
          memoryId: command.parameters.memoryId as string,
        });
        return connectorOk(command, start, deletion);
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
      case 'search_memories': {
        const found = await this.searchMemories({
          businessId: command.businessId,
          query: command.parameters.query as string,
          limit: (command.parameters.limit as number) || 10,
        });
        return connectorOk(command, start, found);
      }
      case 'get_timeline': {
        const timeline = await this.getTimeline({
          businessId: command.businessId,
          from: command.parameters.from as string,
          to: command.parameters.to as string,
          limit: (command.parameters.limit as number) || 50,
        });
        return connectorOk(command, start, timeline);
      }
      case 'get_memory_stats': {
        const stats = await this.getMemoryStats({ businessId: command.businessId });
        return connectorOk(command, start, stats);
      }
      case 'get_recent_memories': {
        const recent = await this.getRecentMemories({
          businessId: command.businessId,
          limit: (command.parameters.limit as number) || 10,
        });
        return connectorOk(command, start, recent);
      }
      default:
        return connectorFail(command, start, `Unknown temporal action: ${command.action}`);
    }
  }
}
