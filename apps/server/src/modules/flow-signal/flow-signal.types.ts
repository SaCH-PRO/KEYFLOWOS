import type { FlowSignalImportance, FlowSignalStatus, FlowType } from '@prisma/client';

export type { FlowSignalImportance, FlowSignalStatus, FlowType } from '@prisma/client';

export interface FlowSignalInput {
  businessId: string;
  userId?: string;
  flows?: FlowType[];
  source: string;
  type: string;
  module?: string;
  entityType?: string;
  entityId?: string;
  title: string;
  summary?: string;
  description?: string;
  occurredAt?: Date;
  startsAt?: Date;
  endsAt?: Date;
  reminderAt?: Date;
  importance?: FlowSignalImportance;
  visibility?: string;
  ownerRoleHint?: string;
  payload?: Record<string, unknown>;
  signals?: Record<string, unknown>;
  tags?: string[];
}

export interface FlowSignalQuery {
  flows?: FlowType | FlowType[];
  source?: string;
  type?: string;
  module?: string;
  status?: FlowSignalStatus | FlowSignalStatus[];
  importance?: FlowSignalImportance | FlowSignalImportance[];
  ownerRoleHint?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface FlowSignalListResult {
  items: FlowSignalDto[];
  total: number;
}

export interface FlowSignalDto {
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
  payload: Record<string, unknown>;
  signals: Record<string, unknown>;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface RoleFlowQueue {
  roleKey: string;
  flowTypes: FlowType[];
  total: number;
  items: FlowSignalDto[];
  summary: {
    critical: number;
    high: number;
    actionRequired: number;
  };
}

export interface FlowIntersection {
  signalId: string;
  title: string;
  flows: FlowType[];
  reason: string;
  relatedSignals: FlowSignalDto[];
}
