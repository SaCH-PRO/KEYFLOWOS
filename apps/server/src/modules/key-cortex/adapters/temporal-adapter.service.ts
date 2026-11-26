import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConnectorCommand, ConnectorResult } from '../key-cortex-connector.types';
import { connectorOk, connectorFail } from '../key-cortex-connector.utils';
import { TemporalFlowMemoryService } from '../../temporal-flow/temporal-flow-memory.service';
import { TemporalFlowService, type TemporalFlowReader } from '../../temporal-flow/temporal-flow.service';
import {
  classifyTemporalMemoryWrite,
  isMemoryRowDataClass,
  mergeMemoryClassifications,
  type MemoryRowDataClass,
} from '../../ai/memory-classification';

const KEY_ERROR = 'Memory key must be a non-empty string';

/** MEM-TEMPORAL-SCOPE: a memory key from a command is used only as a non-empty string (never an operator object). */
function requireKey(key: unknown): string {
  if (typeof key !== 'string' || key.length === 0) throw new BadRequestException(KEY_ERROR);
  return key;
}

/** MEM-TEMPORAL-SCOPE: consolidation keys are a list of non-empty strings (never a string spread into characters). */
function requireKeys(keys: unknown): string[] {
  if (!Array.isArray(keys) || !keys.every((k) => typeof k === 'string' && k.length > 0)) {
    throw new BadRequestException('Memory keys must be a list of non-empty strings');
  }
  return keys as string[];
}

/** Only string tags: a string is not spread into characters, a missing list adds none. */
function stringTags(tags: unknown): string[] {
  return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string') : [];
}

/**
 * MEM-TEMPORAL-MEMORY-ROUTES-SIGHT (D-257, D-234, D-100): who a KEY temporal command reads for. A command's reads carry
 * `actor` (the command's userId, or null when it names none: nobody, so nothing a module owns); a method called with no
 * `actor` key at all (KEY's context assembly) reads as before and is that caller's to project.
 */
type ActorInput = { actor?: TemporalFlowReader };
const actorOf = (userId: unknown): TemporalFlowReader => (typeof userId === 'string' && userId ? { id: userId } : null);
const projected = (input: ActorInput) => Object.prototype.hasOwnProperty.call(input, 'actor');

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
    dataClass?: MemoryRowDataClass;
    moduleScope?: string[];
  }) {
    const key = requireKey(input.key);
    const tags = stringTags(input.tags);
    return this.temporal.createMemory({
      businessId: input.businessId,
      entityType: 'business',
      entityId: key,
      type: 'insight',
      content: JSON.stringify(input.value),
      sourceModule: 'key_cortex',
      sourceEventIds: tags,
      metadata: { ttlDays: input.ttlDays, importance: input.importance, key },
      confidence: input.importance === 'high' ? 0.9 : input.importance === 'low' ? 0.3 : 0.5,
      dataClass: input.dataClass,
      moduleScope: input.moduleScope,
    });
  }

  async recallMemory(input: { businessId: string; key: string } & ActorInput) {
    const memories = await this.temporal.findByEntity(
      input.businessId,
      'business',
      requireKey(input.key),
    );
    // MEM-TEMPORAL-MEMORY-ROUTES-SIGHT: the first memory of the key the actor may see.
    if (!projected(input)) return memories[0] ?? null;
    const sight = await this.flow.memorySight(input.businessId, input.actor);
    return (await this.flow.visibleMemories(input.businessId, memories, sight))[0] ?? null;
  }

  /**
   * MEM-TEMPORAL-MEMORY-ROUTES-SIGHT: under an actor, the memory as the actor's sight admits it (the row that was
   * checked), or a NotFoundException exactly as for a missing (or foreign) memory. undefined when the call has no actor.
   */
  private async visibleRowFor(input: { businessId: string; memoryId: string } & ActorInput) {
    if (!projected(input)) return undefined;
    const sight = await this.flow.memorySight(input.businessId, input.actor);
    const row = await this.flow.visibleMemoryById(input.businessId, input.memoryId, sight);
    if (!row) throw new NotFoundException('Memory not found');
    return row;
  }

  /** Delta A1: a conditional write that matched nothing (the row changed since the check) answers as a missing memory. */
  private written<T>(row: T | null): T {
    if (!row) throw new NotFoundException('Memory not found');
    return row;
  }

  async deleteMemory(input: { businessId: string; memoryId: string } & ActorInput) {
    // MEM-TEMPORAL-MEMORY-ROUTES-SIGHT (review round 1, delta A2): a memory the actor may not see is not deleted, and
    // answers as a missing (or foreign) one does; nor is one rewritten since the check (the delete is conditional on it).
    if (projected(input)) {
      const sight = await this.flow.memorySight(input.businessId, input.actor);
      const row = await this.flow.visibleMemoryById(input.businessId, input.memoryId, sight);
      const deleted = row ? await this.flow.deleteMemoryIfUnchanged(input.businessId, row) : false;
      return { deleted, memoryId: input.memoryId };
    }
    const deleted = await this.temporal.deleteMemory(input.businessId, input.memoryId);
    return { deleted, memoryId: input.memoryId };
  }

  async updateMemory(input: {
    businessId: string;
    memoryId: string;
    value?: Record<string, unknown>;
    importance?: string;
  } & ActorInput) {
    const confidence = input.importance === 'high' ? 0.9 : input.importance === 'low' ? 0.3 : undefined;
    const nextContent = input.value ? JSON.stringify(input.value) : undefined;
    // MEM-TEMPORAL-MEMORY-ROUTES-SIGHT (delta A1): under an actor, written only onto the row that was checked, and the row
    // handed back is the one written (a row rewritten since the check is neither written nor handed back).
    const checked = await this.visibleRowFor(input);
    if (checked) {
      const existingEventIds = Array.isArray(checked.sourceEventIds) ? checked.sourceEventIds : [];
      const isOpaque = checked.entityType === 'business' || checked.sourceModule === 'key_cortex';
      const resolved =
        !isOpaque && existingEventIds.length > 0 && typeof this.temporal.resolveSourceEvents === 'function'
          ? await this.temporal.resolveSourceEvents(input.businessId, existingEventIds)
          : { sourceEvents: [], hasMissingSourceEvents: false };
      const classified = mergeMemoryClassifications([
        {
          dataClass: isMemoryRowDataClass((checked as { dataClass?: unknown }).dataClass)
            ? ((checked as { dataClass?: MemoryRowDataClass }).dataClass ?? null)
            : null,
          moduleScope: (checked as { moduleScope?: string[] }).moduleScope ?? null,
        },
        classifyTemporalMemoryWrite({
          entityType: checked.entityType,
          entityId: checked.entityId,
          type: checked.type,
          sourceModule: checked.sourceModule,
          content: nextContent ?? checked.content,
          sourceEvents: resolved.sourceEvents,
          sourceEventIds: existingEventIds,
          hasMissingSourceEvents: resolved.hasMissingSourceEvents,
        }),
      ]);
      return this.written(
        await this.flow.updateMemoryIfUnchanged(input.businessId, checked, {
          content: nextContent,
          confidence,
          dataClass: classified.dataClass,
          moduleScope: classified.moduleScope,
        }),
      );
    }
    return this.temporal.updateMemory(input.businessId, input.memoryId, {
      content: nextContent,
      confidence,
    });
  }

  async tagMemory(input: {
    businessId: string;
    memoryId: string;
    tags: string[];
  } & ActorInput) {
    // MEM-TEMPORAL-SCOPE: the memory is looked up and updated by the same id, within the caller's business.
    // MEM-TEMPORAL-MEMORY-ROUTES-SIGHT (delta A1): under an actor, the row the actor's sight admitted is the one tagged,
    // only while unchanged, and the row handed back is the one written.
    const checked = await this.visibleRowFor(input);
    const existing = checked ?? (await this.temporal.findById(input.businessId, input.memoryId));
    if (!existing) {
      throw new NotFoundException('Memory not found');
    }
    const existingTags = Array.isArray(existing.sourceEventIds) ? existing.sourceEventIds : [];
    const added = stringTags(input.tags);
    const tags = Array.from(new Set([...existingTags, ...added]));
    const basePatch = {
      sourceEventIds: tags,
      metadata: {
        ...(existing.metadata as Record<string, unknown> | undefined),
        tags,
      },
    };
    if (checked) {
      const isOpaque = existing.entityType === 'business' || existing.sourceModule === 'key_cortex';
      const resolved =
        !isOpaque && existingTags.length > 0 && typeof this.temporal.resolveSourceEvents === 'function'
          ? await this.temporal.resolveSourceEvents(input.businessId, existingTags)
          : { sourceEvents: [], hasMissingSourceEvents: false };
      const classified = mergeMemoryClassifications([
        {
          dataClass: isMemoryRowDataClass((existing as { dataClass?: unknown }).dataClass)
            ? ((existing as { dataClass?: MemoryRowDataClass }).dataClass ?? null)
            : null,
          moduleScope: (existing as { moduleScope?: string[] }).moduleScope ?? null,
        },
        classifyTemporalMemoryWrite({
          entityType: existing.entityType,
          entityId: existing.entityId,
          type: existing.type,
          sourceModule: existing.sourceModule,
          content: existing.content,
          sourceEvents: resolved.sourceEvents,
          sourceEventIds: tags,
          hasMissingSourceEvents: resolved.hasMissingSourceEvents,
          tags: added,
        }),
      ]);
      return this.written(
        await this.flow.updateMemoryIfUnchanged(input.businessId, checked, {
          ...basePatch,
          dataClass: classified.dataClass,
          moduleScope: classified.moduleScope,
        }),
      );
    }
    return this.temporal.updateMemory(input.businessId, input.memoryId, basePatch);
  }

  async consolidateMemories(input: {
    businessId: string;
    keys: string[];
    summaryKey: string;
  } & ActorInput) {
    // Every key, the summary key included, is checked before any read or write.
    const keys = requireKeys(input.keys);
    requireKey(input.summaryKey);
    const contents: string[] = [];
    const sourceClassifications: Array<{ dataClass: MemoryRowDataClass; moduleScope: string[] }> = [];
    for (const key of keys) {
      // MEM-TEMPORAL-MEMORY-ROUTES-SIGHT: only memories the actor may see are merged (the merge is handed back).
      const found = await this.recallMemory({ businessId: input.businessId, key, ...(projected(input) ? { actor: input.actor } : {}) });
      if (found && (found as { content?: string }).content) {
        contents.push(String((found as { content: string }).content));
        const row = found as {
          entityType?: string;
          entityId?: string | null;
          type?: string;
          sourceModule?: string;
          content: string;
          sourceEventIds?: string[];
          dataClass?: string | null;
          moduleScope?: string[];
        };
        if (isMemoryRowDataClass(row.dataClass)) {
          sourceClassifications.push({
            dataClass: row.dataClass,
            moduleScope: Array.isArray(row.moduleScope) ? row.moduleScope : [],
          });
        } else {
          sourceClassifications.push(
            classifyTemporalMemoryWrite({
              entityType: row.entityType ?? 'business',
              entityId: row.entityId ?? key,
              type: row.type ?? 'insight',
              sourceModule: row.sourceModule ?? 'key_cortex',
              content: row.content,
              sourceEventIds: row.sourceEventIds ?? [],
            }),
          );
        }
      }
    }
    const merged = contents.length
      ? `Consolidated memories:\n${contents.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
      : 'No memories found to consolidate.';
    const inherited = sourceClassifications.length
      ? mergeMemoryClassifications(sourceClassifications)
      : undefined;
    return this.storeMemory({
      businessId: input.businessId,
      key: input.summaryKey,
      value: { consolidatedFrom: keys, count: contents.length, summary: merged },
      importance: 'medium',
      dataClass: inherited?.dataClass,
      moduleScope: inherited?.moduleScope,
    });
  }

  async searchMemories(input: { businessId: string; query: string; limit?: number } & ActorInput) {
    if (!projected(input)) return this.temporal.searchMemory(input.businessId, input.query, input.limit ?? 10);
    // MEM-TEMPORAL-MEMORY-ROUTES-SIGHT: the actor's hits only, filtered before the limit.
    const sight = await this.flow.memorySight(input.businessId, input.actor);
    return this.flow.searchVisibleMemory(input.businessId, input.query, input.limit ?? 10, sight);
  }

  async getTimeline(input: { businessId: string; from?: string; to?: string; limit?: number; actorId?: string }) {
    // D-238 (round 3, security M4): the timeline is read for the command's actor (no actor is no reader), so a financial
    // KEY proposal's events are withheld from an actor without revenue read.
    const reader = input.actorId ? { id: input.actorId } : null;
    // MEM-TEMPORAL-MEMORY-ROUTES-SIGHT (FU-TEMPORAL-FLOW-INBOX-SCOPE's rule, D-100): only the events of the modules the
    // actor may read, in the query before its limit (no actor: none a module owns).
    const readerFilter = await this.flow.readerFilter(input.businessId, reader);
    if (input.from && input.to) {
      return this.flow.calendarRange(input.businessId, input.from, input.to, reader, readerFilter);
    }
    return this.flow.list(input.businessId, { limit: input.limit ?? 50 }, reader, readerFilter);
  }

  async getMemoryStats(input: { businessId: string }) {
    return this.temporal.getStats(input.businessId);
  }

  async getRecentMemories(input: { businessId: string; limit?: number } & ActorInput) {
    if (!projected(input)) return this.temporal.findMany(input.businessId, { limit: input.limit ?? 10 });
    // MEM-TEMPORAL-MEMORY-ROUTES-SIGHT: the actor's memories only, filtered before the limit.
    const sight = await this.flow.memorySight(input.businessId, input.actor);
    return this.flow.listMemory(input.businessId, { limit: input.limit ?? 10 }, sight);
  }

  /**
   * MEM-TEMPORAL-MEMORY-ROUTES-SIGHT (D-257, D-234): every read a command makes, and the row tag_memory and update_memory
   * hand back, is the command's actor's (actorOf: no userId is nobody).
   */
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
          actor: actorOf(command.userId),
          key: command.parameters.key as string,
        });
        return connectorOk(command, start, memory);
      }
      case 'delete_memory': {
        const deletion = await this.deleteMemory({
          businessId: command.businessId,
          actor: actorOf(command.userId),
          memoryId: command.parameters.memoryId as string,
        });
        return connectorOk(command, start, deletion);
      }
      case 'update_memory': {
        const updated = await this.updateMemory({
          businessId: command.businessId,
          actor: actorOf(command.userId),
          memoryId: command.parameters.memoryId as string,
          value: command.parameters.value as Record<string, unknown>,
          importance: command.parameters.importance as string,
        });
        return connectorOk(command, start, updated);
      }
      case 'tag_memory': {
        const tagged = await this.tagMemory({
          businessId: command.businessId,
          actor: actorOf(command.userId),
          memoryId: command.parameters.memoryId as string,
          tags: command.parameters.tags as string[],
        });
        return connectorOk(command, start, tagged);
      }
      case 'consolidate_memories': {
        const consolidated = await this.consolidateMemories({
          businessId: command.businessId,
          actor: actorOf(command.userId),
          keys: command.parameters.keys as string[],
          summaryKey: command.parameters.summaryKey as string,
        });
        return connectorOk(command, start, consolidated);
      }
      case 'search_memories': {
        const found = await this.searchMemories({
          businessId: command.businessId,
          actor: actorOf(command.userId),
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
          actorId: command.userId,
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
          actor: actorOf(command.userId),
          limit: (command.parameters.limit as number) || 10,
        });
        return connectorOk(command, start, recent);
      }
      default:
        return connectorFail(command, start, `Unknown temporal action: ${command.action}`);
    }
  }
}
