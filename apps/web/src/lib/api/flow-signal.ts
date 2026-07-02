import { apiGet, apiPost } from "@/lib/api";


export interface FlowSignal {
  id: string;
  businessId: string;
  userId?: string;
  flows: string[];
  source: string;
  type: string;
  module?: string;
  entityType?: string;
  entityId?: string;
  title: string;
  summary?: string;
  description?: string;
  occurredAt: string;
  startsAt?: string;
  endsAt?: string;
  reminderAt?: string;
  status: string;
  importance: string;
  visibility: string;
  ownerRoleHint?: string;
  payload?: Record<string, unknown>;
  signals?: Record<string, unknown>;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface FlowSignalList {
  items: FlowSignal[];
  total: number;
}

export interface RoleFlowQueue {
  roleKey: string;
  label: string;
  flowTypes: string[];
  total: number;
  items: FlowSignal[];
  summary: {
    critical: number;
    high: number;
    actionRequired: number;
  };
}

export interface FlowRoleDefinition {
  key: string;
  label: string;
  flowTypes: string[];
  subscriptions: number;
}

export interface RoleQueueSummary {
  roleKey: string;
  label: string;
  flowTypes: string[];
  total: number;
  summary: {
    critical: number;
    high: number;
    actionRequired: number;
  };
}

export function fetchFlowRoles() {
  return apiGet<FlowRoleDefinition[]>("/flow-signals/roles");
}

export function fetchBusinessRoleSummaries(businessId: string) {
  return apiGet<RoleQueueSummary[]>(`/flow-signals/businesses/${businessId}/roles`);
}

export function fetchFlowSignals(
  businessId: string,
  params: { flow?: string; type?: string; status?: string; ownerRoleHint?: string; limit?: number; offset?: number } = {}
) {
  const query = new URLSearchParams();
  if (params.flow) query.set("flow", params.flow);
  if (params.type) query.set("type", params.type);
  if (params.status) query.set("status", params.status);
  if (params.ownerRoleHint) query.set("ownerRoleHint", params.ownerRoleHint);
  if (params.limit != null) query.set("limit", String(params.limit));
  if (params.offset != null) query.set("offset", String(params.offset));
  return apiGet<FlowSignalList>(`/flow-signals/businesses/${businessId}?${query.toString()}`);
}

export function fetchRoleFlowQueue(businessId: string, roleKey: string) {
  return apiGet<RoleFlowQueue>(`/flow-signals/businesses/${businessId}/role/${roleKey}`);
}

export function resolveFlowSignal(businessId: string, signalId: string) {
  return apiPost<FlowSignal>({ path: `/flow-signals/businesses/${businessId}/${signalId}/resolve`, body: {} });
}

export function markFlowSignalActionRequired(businessId: string, signalId: string) {
  return apiPost<FlowSignal>({ path: `/flow-signals/businesses/${businessId}/${signalId}/action-required`, body: {} });
}

export function snoozeFlowSignal(businessId: string, signalId: string, until: string) {
  return apiPost<FlowSignal>({ path: `/flow-signals/businesses/${businessId}/${signalId}/snooze`, body: { until } });
}
