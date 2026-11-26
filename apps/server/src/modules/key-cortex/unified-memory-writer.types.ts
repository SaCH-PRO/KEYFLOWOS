import { CortexMemory, MemoryType } from './cortex-genome-contracts';
import { MemorySource } from '../ai/ai-memory.service';
import type { MemoryRowDataClass } from '../ai/memory-classification';

export interface MemoryWriteInput {
  businessId: string;
  type: MemoryType;
  key: string;
  value: string;
}

export interface MemoryWriteOptions {
  userId?: string;
  confidence?: number;
  source?: CortexMemory['source'] | MemorySource | 'key_document_service';
  expiresAt?: Date | null;
  indexSemantic?: boolean;
  dataClass?: MemoryRowDataClass;
  moduleScope?: string[];
}

export interface MemoryDocumentExtractionOptions {
  userId?: string;
  confidence?: number;
  source?: MemorySource | 'key_document_service';
  expiresAt?: Date | null;
  indexSemantic?: boolean;
  dataClass?: MemoryRowDataClass;
  moduleScope?: string[];
}
