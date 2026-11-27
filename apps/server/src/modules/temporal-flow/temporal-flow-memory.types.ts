import type {
  MemoryRowDataClass,
  TemporalEventProvenance,
} from '../ai/memory-classification';

export type TemporalFlowMemoryEntityType = 'contact' | 'thread' | 'channel' | 'business';

export type TemporalFlowMemoryType = 'summary' | 'pattern' | 'insight' | 'recommendation';

export interface CreateTemporalFlowMemoryInput {
  businessId: string;
  entityType: TemporalFlowMemoryEntityType;
  entityId?: string | null;
  type: TemporalFlowMemoryType;
  content: string;
  sourceEventIds?: string[];
  sourceEvents?: TemporalEventProvenance[];
  sourceModule: string;
  metadata?: Record<string, unknown>;
  confidence?: number;
  dataClass?: MemoryRowDataClass;
  moduleScope?: string[];
}

export interface TemporalFlowMemoryQuery {
  entityType?: TemporalFlowMemoryEntityType;
  entityId?: string;
  type?: TemporalFlowMemoryType;
  limit?: number;
}

export interface TemporalFlowMemoryData {
  id: string;
  businessId: string;
  entityType: string;
  entityId: string | null;
  type: string;
  content: string;
  sourceEventIds: string[];
  sourceModule: string;
  metadata: unknown;
  confidence: number;
  dataClass?: string | null;
  moduleScope?: string[];
  createdAt: Date;
  updatedAt: Date;
}
