import { Injectable, Logger, Optional } from '@nestjs/common';
import { AiMemoryService, MemoryEntry, MemorySource } from '../ai/ai-memory.service';
import { SemanticMemoryService } from '../ai/semantic-memory.service';
import {
  classifyAiMemoryWrite,
  isMemoryRowDataClass,
  unionModuleScopes,
} from '../ai/memory-classification';
import { CortexMemory, MemoryType } from './cortex-genome-contracts';
import { MemoryWriteOptions, MemoryDocumentExtractionOptions } from './unified-memory-writer.types';

const CORTEX_SOURCE_TO_MEMORY_SOURCE: Record<
  CortexMemory['source'],
  MemorySource
> = {
  explicit: 'user',
  inferred: 'inferred',
  genome: 'pattern_analysis',
  conversation: 'feedback_loop',
};

const MEMORY_SOURCE_TO_CORTEX_SOURCE: Record<
  MemorySource,
  CortexMemory['source']
> = {
  user: 'explicit',
  inferred: 'inferred',
  approval_signal: 'explicit',
  pattern_analysis: 'genome',
  feedback_loop: 'conversation',
  role_engine: 'inferred',
};

function normalizeSource(
  source: CortexMemory['source'] | MemorySource | 'key_document_service' | undefined,
): MemorySource {
  if (source === 'key_document_service') return 'role_engine';
  if (source && source in CORTEX_SOURCE_TO_MEMORY_SOURCE) {
    return CORTEX_SOURCE_TO_MEMORY_SOURCE[source as CortexMemory['source']];
  }
  return (source as MemorySource) ?? 'inferred';
}

@Injectable()
export class UnifiedMemoryWriterService {
  private readonly logger = new Logger(UnifiedMemoryWriterService.name);

  constructor(
    private readonly aiMemory: AiMemoryService,
    @Optional() private readonly semanticMemory?: SemanticMemoryService,
  ) {}

  async store(
    businessId: string,
    type: MemoryType,
    key: string,
    value: string,
    opts?: MemoryWriteOptions,
  ): Promise<CortexMemory> {
    const normalizedSource = normalizeSource(opts?.source);
    const classified = classifyAiMemoryWrite({
      category: type,
      key,
      value,
      source: normalizedSource,
      userId: opts?.userId ?? null,
      explicitDataClass: opts?.dataClass ?? null,
      explicitModuleScope: opts?.moduleScope ?? null,
    });

    const entry = await this.aiMemory.upsert(businessId, {
      category: type as any,
      key,
      value,
      confidence: opts?.confidence ?? 0.8,
      source: normalizedSource,
      expiresAt: opts?.expiresAt ?? null,
      dataClass: classified.dataClass,
      moduleScope: classified.moduleScope,
    });

    if (opts?.indexSemantic && this.semanticMemory) {
      try {
        await this.semanticMemory.store({
          businessId,
          content: value,
          sourceType: 'memory',
          sourceId: entry.id,
          metadata: { type, key, source: opts?.source ?? 'inferred' },
          dataClass: isMemoryRowDataClass(entry.dataClass)
            ? entry.dataClass
            : classified.dataClass,
          moduleScope: unionModuleScopes(entry.moduleScope, classified.moduleScope),
        });
      } catch (err: any) {
        this.logger.warn(
          `Semantic indexing failed for ${type}:${key}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return this.mapEntry(businessId, entry);
  }

  async storePreference(
    businessId: string,
    userId: string,
    key: string,
    value: string,
    opts?: Omit<MemoryWriteOptions, 'userId'>,
  ): Promise<CortexMemory> {
    return this.store(businessId, 'user_preference', key, value, {
      userId,
      confidence: 1.0,
      source: 'explicit',
      ...opts,
    });
  }

  async storeBusinessFact(
    businessId: string,
    key: string,
    value: string,
    opts?: MemoryWriteOptions,
  ): Promise<CortexMemory> {
    return this.store(businessId, 'business_fact', key, value, {
      confidence: 0.9,
      source: 'genome',
      ...opts,
    });
  }

  async storeLesson(
    businessId: string,
    key: string,
    value: string,
    opts?: MemoryWriteOptions,
  ): Promise<CortexMemory> {
    return this.store(businessId, 'past_decision', key, value, {
      confidence: 0.85,
      source: 'inferred',
      ...opts,
    });
  }

  async storeDocumentExtraction(
    businessId: string,
    documentId: string,
    value: string,
    opts?: MemoryDocumentExtractionOptions,
  ): Promise<CortexMemory> {
    return this.store(businessId, 'document_extraction', documentId, value, {
      confidence: 1.0,
      source: opts?.source ?? 'role_engine',
      ...opts,
      dataClass: opts?.dataClass ?? 'REVENUE',
      moduleScope: unionModuleScopes(['revenue'], opts?.moduleScope),
    });
  }

  async remove(
    businessId: string,
    type: MemoryType,
    key: string,
  ): Promise<boolean> {
    return this.aiMemory.remove(businessId, type as any, key);
  }

  mapEntry(businessId: string, entry: MemoryEntry): CortexMemory {
    return {
      id: entry.id,
      businessId,
      userId: undefined,
      type: entry.category as MemoryType,
      key: entry.key,
      value: entry.value,
      confidence: entry.confidence,
      source:
        MEMORY_SOURCE_TO_CORTEX_SOURCE[(entry.source as MemorySource) ?? 'inferred'],
      accessCount: 1,
      lastAccessedAt: entry.updatedAt ?? entry.createdAt,
      createdAt: entry.createdAt,
    };
  }
}
