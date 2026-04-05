export interface GuidanceStepStatusDto {
  step: string;
  completed: boolean;
}

export interface GuidanceCompletionResponseDto {
  status: string;
  currentStep: string | null;
  steps: GuidanceStepStatusDto[];
  completedCount: number;
  totalSteps: number;
  completionPercent: number;
}

export interface FounderProfileResponseDto {
  id: string;
  guidanceProfileId: string;
  yearsExperience: number | null;
  technicalSkills: string[];
  leadershipStyle: string | null;
  previousExits: number | null;
  educationLevel: string | null;
  motivations: string[];
  weeklyHoursAvailable: number | null;
  coFounders: number | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BusinessIdentityResponseDto {
  id: string;
  guidanceProfileId: string;
  missionStatement: string | null;
  visionStatement: string | null;
  coreValues: string[];
  targetMarket: string | null;
  uniqueSellingPoint: string | null;
  brandPersonality: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GuidanceProfileResponseDto {
  id: string;
  businessId: string;
  status: string;
  currentStep: string | null;
  completedSteps: string[];
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  identity: BusinessIdentityResponseDto | null;
  founder: FounderProfileResponseDto | null;
  offer: Record<string, unknown> | null;
  customer: Record<string, unknown> | null;
  revenue: Record<string, unknown> | null;
  finance: Record<string, unknown> | null;
  operations: Record<string, unknown> | null;
  compliance: Record<string, unknown> | null;
  growth: Record<string, unknown> | null;
  goals: Record<string, unknown> | null;
}

export interface AssessmentResultResponseDto {
  id: string;
  guidanceProfileId: string;
  overallScore: number | null;
  categoryScores: Record<string, unknown> | null;
  strengths: string[];
  weaknesses: string[];
  risks: string[];
  opportunities: string[];
  metrics: Record<string, unknown> | null;
  flags: string[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssessmentResponseDto {
  assessment: AssessmentResultResponseDto | null;
  profileStatus: string;
}

export interface RecommendationResponseDto {
  id: string;
  guidanceProfileId: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  impact: string;
  effort: string;
  status: string;
  actionUrl: string | null;
  completedAt: Date | null;
  dismissedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoadmapItemResponseDto {
  id: string;
  guidanceProfileId: string;
  title: string;
  description: string;
  category: string;
  sequenceOrder: number;
  estimatedDays: number | null;
  status: string;
  dependsOn: string[];
  startDate: Date | null;
  dueDate: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DashboardResponseDto {
  status: string;
  latestAssessment: AssessmentResultResponseDto | null;
  topRecommendations: RecommendationResponseDto[];
  nextRoadmapItems: RoadmapItemResponseDto[];
  progressHistory: ProgressSnapshotResponseDto[];
}

export interface ProgressSnapshotResponseDto {
  id: string;
  guidanceProfileId: string;
  overallScore: number | null;
  categoryScores: Record<string, unknown> | null;
  completedRecommendations: number;
  totalRecommendations: number;
  completedRoadmapItems: number;
  totalRoadmapItems: number;
  snapshotDate: Date;
  createdAt: Date;
}

export interface StatusCountDto {
  status: string;
  count: number;
}

export interface ProgressResponseDto {
  snapshots: ProgressSnapshotResponseDto[];
  recommendationsByStatus: StatusCountDto[];
  roadmapByStatus: StatusCountDto[];
}
