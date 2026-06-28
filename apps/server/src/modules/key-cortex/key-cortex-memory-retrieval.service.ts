import { Injectable } from '@nestjs/common';
import { UnifiedMemoryRetrievalService } from './unified-memory-retrieval.service';
import type { MemoryFragment, MemoryRetrievalOptions } from './unified-memory.types';

/**
 * KeyCortexMemoryRetrievalService — roadmap-named facade over the unified
 * memory retrieval layer.
 *
 * Phase C exposes this service to the rest of the cortex so that the public
 * contract can evolve independently from the underlying storage implementation.
 */
@Injectable()
export class KeyCortexMemoryRetrievalService {
  constructor(
    private readonly unifiedMemory: UnifiedMemoryRetrievalService,
  ) {}

  async retrieveContext(
    businessId: string,
    options: MemoryRetrievalOptions = {},
  ): Promise<MemoryFragment[]> {
    return this.unifiedMemory.retrieveContext(businessId, options);
  }

  async retrieveEpisodicContext(
    businessId: string,
    options: Omit<MemoryRetrievalOptions, 'includeEpisodic'> = {},
  ): Promise<MemoryFragment[]> {
    return this.unifiedMemory.retrieveEpisodicContext(businessId, options);
  }
}
