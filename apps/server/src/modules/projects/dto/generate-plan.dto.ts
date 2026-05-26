export interface GeneratePlanDto {
  userIdea: string;
  goalId?: string;
  options?: {
    estimatedBudget?: number;
    estimatedDurationDays?: number;
    preferredModules?: string[];
  };
}

export interface UpdatePlanEventDto {
  title?: string;
  description?: string;
  executionContext?: 'IN_APP' | 'OUT_APP';
  autoExecute?: boolean;
  estimatedHours?: number;
  estimatedStart?: string;
  estimatedEnd?: string;
  dependsOn?: string[];
  requiredRoles?: string[];
  estimatedCost?: number;
}

export interface ReorderEventsDto {
  updates: { eventId: string; sortOrder: number }[];
}

export interface AnalyzeImpactDto {
  eventId: string;
  newSortOrder: number;
}
