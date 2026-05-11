/**
 * Canonical Business Blueprint section types.
 *
 * These types are the source of truth for the shape of every JSON column on
 * the `BusinessBlueprint` Prisma model. They are imported by both the Nest
 * service/controller (server-side) and mirrored in the web app
 * (`apps/web/src/lib/blueprint-types.ts`) so the editor page has compile-time
 * field-name guarantees.
 *
 * IMPORTANT: every field is optional. The blueprint is a *living* document
 * that fills in over time as the operator answers onboarding questions and
 * the system infers signals from events. A missing field must always be
 * tolerated — completeness is computed separately in the service.
 */

export type BlueprintSectionKey =
  | 'identity'
  | 'operatingModel'
  | 'goals'
  | 'constraints'
  | 'brand'
  | 'customerModel'
  | 'financials'
  | 'intelligence';

export interface BlueprintIdentity {
  name?: string;
  archetype?: string;
  industry?: string;
  tagline?: string;
  oneLiner?: string;
  mission?: string;
  country?: string;
}

export interface BlueprintOperatingModel {
  revenueModel?: string;
  deliveryMode?: string;
  serviceArea?: string;
  channels?: string[];
  teamSize?: string;
  capacity?: string;
}

export interface BlueprintGoals {
  northStar?: string;
  ninetyDayGoals?: string[];
  twelveMonthGoals?: string[];
}

export interface BlueprintConstraints {
  budgetRange?: string;
  timeCommitment?: string;
  riskTolerance?: string;
  dealbreakers?: string[];
}

export interface BlueprintBrand {
  voice?: string;
  tone?: string;
  primaryColor?: string;
  secondaryColor?: string;
  logoUrl?: string;
  valueProps?: string[];
}

export interface BlueprintCustomerModel {
  idealCustomer?: string;
  segments?: string[];
  painPoints?: string[];
  jobsToBeDone?: string[];
}

export interface BlueprintFinancials {
  currency?: string;
  pricingModel?: string;
  avgTicket?: number;
  monthlyTarget?: number;
  costStructure?: string;
}

export interface BlueprintIntelligence {
  topProductCategories?: string[];
  topChannels?: string[];
  recentMomentumScore?: number;
  inferredAt?: string;
}

export interface BlueprintData {
  schemaVersion: number;
  identity: BlueprintIdentity;
  operatingModel: BlueprintOperatingModel;
  goals: BlueprintGoals;
  constraints: BlueprintConstraints;
  brand: BlueprintBrand;
  customerModel: BlueprintCustomerModel;
  financials: BlueprintFinancials;
  intelligence: BlueprintIntelligence;
  completeness: number;
  updatedAt: string;
}

/**
 * Patch shape accepted by `BlueprintService.updateBlueprint`. Each section is
 * shallow-merged. Pass `null` for a field to clear it; `undefined` is treated
 * as "leave as-is".
 */
export interface BlueprintPatch {
  identity?: Partial<BlueprintIdentity>;
  operatingModel?: Partial<BlueprintOperatingModel>;
  goals?: Partial<BlueprintGoals>;
  constraints?: Partial<BlueprintConstraints>;
  brand?: Partial<BlueprintBrand>;
  customerModel?: Partial<BlueprintCustomerModel>;
  financials?: Partial<BlueprintFinancials>;
  intelligence?: Partial<BlueprintIntelligence>;
}

export interface RecommendedSetupStep {
  id: string;
  section: BlueprintSectionKey;
  title: string;
  reason: string;
  href?: string;
}
