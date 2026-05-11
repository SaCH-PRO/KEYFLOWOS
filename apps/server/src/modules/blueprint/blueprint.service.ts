import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';

// ---
// KEY-1 BusinessBlueprint service.
//
// One row per business. Sections are stored as JSON on the row (not
// separate sub-tables) so the shape can iterate while we settle the
// ontology. Operators edit identity / operatingModel / goals /
// constraints / brand / customerModel / financials. The `intelligence`
// section is AI-written only.
//
// `getBlueprintContext` is the public hook other modules (KEY orchestrator,
// storefront builder, contact intel, procurement) call when they need a
// concise textual summary of the business to inject into prompts.
// ---

export type BlueprintSectionKey =
  | 'identity'
  | 'operatingModel'
  | 'goals'
  | 'constraints'
  | 'brand'
  | 'customerModel'
  | 'financials';

export interface BlueprintIdentity {
  name?: string;
  tagline?: string;
  missionStatement?: string;
  visionStatement?: string;
  story?: string;
  archetype?: string;
  industry?: string;
  foundedAt?: string;
  country?: string;
  languagesServed?: string[];
}

export interface BlueprintOperatingModel {
  revenueModel?: string;
  deliveryMethod?: string;
  fulfillmentStyle?: string;
  teamSize?: string;
  timeCommitment?: string;
  capacity?: { mode?: string; slotsPerWeek?: number | null };
  weeklyHours?: number | null;
  pricingModel?: string;
  paymentTerms?: string;
  leadTime?: string;
}

export interface BlueprintGoals {
  primaryGoal?: string;
  northStarMetric?: string;
  horizonMonths?: number | null;
  revenueTarget?: number | null;
  newCustomersTarget?: number | null;
  focusAreas?: string[];
}

export interface BlueprintConstraints {
  budgetCeiling?: number | null;
  timeAvailable?: string;
  regulatoryFlags?: string[];
  geographic?: string[];
  doNotDoList?: string[];
  complianceNotes?: string;
}

export interface BlueprintBrand {
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  voice?: string;
  tone?: string;
  keywords?: string[];
  positioningStatement?: string;
  doNotSay?: string[];
  referenceBrands?: string[];
}

export interface BlueprintCustomerModel {
  targetSegments?: string[];
  demographics?: string;
  painPoints?: string[];
  buyingTriggers?: string[];
  acquisitionChannels?: string[];
  lifetimeValueTtd?: number | null;
  repeatRatePct?: number | null;
  referralPropensity?: string;
}

export interface BlueprintFinancials {
  priceRange?: { low?: number | null; high?: number | null };
  avgMargin?: number | null;
  costStructure?: string[];
  runwayMonths?: number | null;
  cashPositionTier?: string;
  processorMix?: string[];
}

export interface BlueprintIntelligence {
  lastInferenceAt?: string | null;
  eventCount?: number;
  inferredPatterns?: Array<{ key: string; value: string; confidence?: number }>;
  aiSummary?: string;
  confidence?: number;
  provenance?: Array<{ source: string; lastSyncAt: string }>;
}

export interface BlueprintRecord {
  id: string;
  businessId: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface BlueprintPatch {
  identity?: Partial<BlueprintIdentity>;
  operatingModel?: Partial<BlueprintOperatingModel>;
  goals?: Partial<BlueprintGoals>;
  constraints?: Partial<BlueprintConstraints>;
  brand?: Partial<BlueprintBrand>;
  customerModel?: Partial<BlueprintCustomerModel>;
  financials?: Partial<BlueprintFinancials>;
  // intelligence is intentionally not patchable from the operator UI.
}

export interface SetupStep {
  id: string;
  label: string;
  blueprintSection: BlueprintSectionKey | 'intelligence';
  weight: number;
  done: boolean;
  hint?: string;
}

// Weighted completeness — keeps section weights explicit and testable.
const SECTION_WEIGHTS: Record<BlueprintSectionKey, number> = {
  identity: 25,
  operatingModel: 20,
  goals: 15,
  customerModel: 15,
  brand: 10,
  financials: 10,
  constraints: 5,
};

// Per-section "what counts as filled" rules. We use simple presence/length
// checks so the score moves predictably as the operator fills the form.
const SECTION_FIELDS: Record<BlueprintSectionKey, string[]> = {
  identity: ['name', 'archetype', 'industry', 'tagline', 'missionStatement'],
  operatingModel: ['revenueModel', 'deliveryMethod', 'teamSize', 'timeCommitment', 'pricingModel'],
  goals: ['primaryGoal', 'northStarMetric', 'horizonMonths', 'revenueTarget'],
  customerModel: ['targetSegments', 'painPoints', 'acquisitionChannels', 'demographics'],
  brand: ['primaryColor', 'voice', 'positioningStatement', 'keywords'],
  financials: ['priceRange', 'avgMargin', 'cashPositionTier'],
  constraints: ['budgetCeiling', 'timeAvailable', 'doNotDoList'],
};

function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some(isFilled);
  return Boolean(value);
}

function emptySection(): Record<string, unknown> {
  return {};
}

function asJson<T>(raw: Prisma.JsonValue | null | undefined, fallback: T): T {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as unknown as T;
  return fallback;
}

@Injectable()
export class BlueprintService {
  private readonly logger = new Logger(BlueprintService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // ---
  // Read / upsert
  // ---

  async getBlueprint(businessId: string): Promise<BlueprintRecord> {
    const existing = await this.prisma.client.businessBlueprint.findUnique({
      where: { businessId },
    });
    if (existing) return this.toRecord(existing);

    // First time — seed from existing Business profile so the form arrives
    // pre-populated. Use `upsert` (not `findUnique` + `create`) so two
    // parallel reads from the same first page-load (e.g. blueprint page
    // requesting `/blueprint` and `/setup-steps` concurrently) don't race
    // and 500 on the unique-key collision.
    const seeded = await this.inferFromBusinessProfile(businessId);
    const row = await this.prisma.client.businessBlueprint.upsert({
      where: { businessId },
      create: {
        businessId,
        identity: seeded.identity as Prisma.InputJsonValue,
        operatingModel: seeded.operatingModel as Prisma.InputJsonValue,
        brand: seeded.brand as Prisma.InputJsonValue,
        completeness: this.calculateCompleteness(seeded),
      },
      update: {}, // Race winner already created — leave its data alone.
    });
    return this.toRecord(row);
  }

  async updateBlueprint(businessId: string, patch: BlueprintPatch): Promise<BlueprintRecord> {
    const current = await this.getBlueprint(businessId);
    const merged: Partial<Record<BlueprintSectionKey, Record<string, unknown>>> = {};

    const sections: BlueprintSectionKey[] = [
      'identity',
      'operatingModel',
      'goals',
      'constraints',
      'brand',
      'customerModel',
      'financials',
    ];

    for (const section of sections) {
      const incoming = patch[section];
      if (!incoming) continue;
      const base = {
        ...((current as unknown as Record<string, Record<string, unknown>>)[section] || emptySection()),
      };
      // Treat `null` as an explicit "clear this field" sentinel so the
      // editor can remove a value the operator typed earlier. Plain
      // omission (undefined) still leaves existing values untouched.
      for (const [key, value] of Object.entries(incoming as Record<string, unknown>)) {
        if (value === null) {
          delete base[key];
        } else if (value !== undefined) {
          base[key] = value;
        }
      }
      merged[section] = base;
    }

    const next: BlueprintRecord = { ...current };
    for (const section of sections) {
      if (merged[section]) {
        (next as unknown as Record<string, Record<string, unknown>>)[section] = merged[section]!;
      }
    }

    const completeness = this.calculateCompleteness(next);

    const data: Prisma.BusinessBlueprintUpdateInput = {
      completeness,
    };
    for (const section of sections) {
      if (merged[section]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (data as any)[section] = merged[section] as Prisma.InputJsonValue;
      }
    }

    const row = await this.prisma.client.businessBlueprint.update({
      where: { businessId },
      data,
    });

    return this.toRecord(row);
  }

  // ---
  // Onboarding wiring — called by onboarding-concierge.service after
  // each successful intake step. Maps the concierge's free-form answers
  // to blueprint sections.
  // ---

  async inferFromOnboarding(
    businessId: string,
    answers: {
      businessIntent?: string | null;
      archetype?: string | null;
      industry?: string | null;
      country?: string | null;
      revenueModel?: string | null;
      teamSize?: string | null;
      timeCommitment?: string | null;
      budgetRange?: string | null;
      primaryGoal?: string | null;
    },
  ): Promise<BlueprintRecord> {
    const patch: BlueprintPatch = {
      identity: {
        ...(answers.archetype ? { archetype: answers.archetype } : {}),
        ...(answers.industry ? { industry: answers.industry } : {}),
        ...(answers.country ? { country: answers.country } : {}),
        ...(answers.businessIntent ? { story: answers.businessIntent } : {}),
      },
      operatingModel: {
        ...(answers.revenueModel ? { revenueModel: answers.revenueModel } : {}),
        ...(answers.teamSize ? { teamSize: answers.teamSize } : {}),
        ...(answers.timeCommitment ? { timeCommitment: answers.timeCommitment } : {}),
      },
      goals: {
        ...(answers.primaryGoal ? { primaryGoal: answers.primaryGoal } : {}),
      },
      constraints: {
        ...(answers.budgetRange ? { timeAvailable: answers.budgetRange } : {}),
      },
    };

    return this.updateBlueprint(businessId, patch);
  }

  // ---
  // Stub for the timeline ledger integration. KEY-2 will replace this with
  // a real implementation that walks the BusinessEvent timeline and writes
  // patterns into `intelligence`. For now it just bumps the eventCount and
  // timestamp so the UI can show "last refreshed".
  // ---

  async inferFromEvents(businessId: string): Promise<BlueprintRecord> {
    const current = await this.getBlueprint(businessId);
    const intelligence: BlueprintIntelligence = {
      ...current.intelligence,
      lastInferenceAt: new Date().toISOString(),
      eventCount: current.intelligence.eventCount ?? 0,
      inferredPatterns: current.intelligence.inferredPatterns ?? [],
      provenance: [
        ...(current.intelligence.provenance ?? []).filter((p) => p.source !== 'timeline.stub'),
        { source: 'timeline.stub', lastSyncAt: new Date().toISOString() },
      ],
    };
    const row = await this.prisma.client.businessBlueprint.update({
      where: { businessId },
      data: { intelligence: intelligence as Prisma.InputJsonValue },
    });
    return this.toRecord(row);
  }

  // ---
  // Recommended setup steps — surfaces incomplete sections back to the
  // operator. Used by the /blueprint page and the Cockpit widget.
  // ---

  async getRecommendedSetupSteps(businessId: string): Promise<SetupStep[]> {
    const bp = await this.getBlueprint(businessId);
    const steps: SetupStep[] = [];

    const sections: BlueprintSectionKey[] = [
      'identity',
      'operatingModel',
      'goals',
      'customerModel',
      'brand',
      'financials',
      'constraints',
    ];

    for (const section of sections) {
      const fields = SECTION_FIELDS[section];
      const sectionData = (bp as unknown as Record<string, Record<string, unknown>>)[section] ?? {};
      const filled = fields.filter((f) => isFilled(sectionData[f])).length;
      const done = filled >= fields.length;
      const hint = done
        ? undefined
        : `Fill ${fields.length - filled} more field${fields.length - filled === 1 ? '' : 's'} (${fields
            .filter((f) => !isFilled(sectionData[f]))
            .slice(0, 3)
            .join(', ')})`;
      steps.push({
        id: `blueprint.${section}`,
        label: this.sectionLabel(section),
        blueprintSection: section,
        weight: SECTION_WEIGHTS[section],
        done,
        hint,
      });
    }

    return steps.sort((a, b) => Number(a.done) - Number(b.done) || b.weight - a.weight);
  }

  // ---
  // Public hook consumed by KEY orchestrator + storefront builder + AI
  // prompt builders. Returns a compact, human-readable string ready to
  // drop into a system prompt. KEY-6 will extend this.
  // ---

  async getBlueprintContext(businessId: string): Promise<string> {
    const bp = await this.getBlueprint(businessId);
    const lines: string[] = [];
    lines.push(`# Business Blueprint (completeness ${bp.completeness}%)`);

    const id = bp.identity;
    if (id.name || id.archetype || id.industry) {
      lines.push(
        `Identity: ${id.name ?? '—'} • ${id.archetype ?? 'unknown archetype'} • ${id.industry ?? 'unknown industry'}` +
          (id.country ? ` • ${id.country}` : ''),
      );
    }
    if (id.missionStatement) lines.push(`Mission: ${id.missionStatement}`);
    if (id.tagline) lines.push(`Tagline: ${id.tagline}`);

    const op = bp.operatingModel;
    if (op.revenueModel || op.deliveryMethod || op.teamSize) {
      lines.push(
        `Operating model: ${op.revenueModel ?? 'unknown revenue model'} • ${op.deliveryMethod ?? 'unknown delivery'} • ${op.teamSize ?? 'unknown team size'}`,
      );
    }
    if (op.pricingModel) lines.push(`Pricing: ${op.pricingModel}`);

    const g = bp.goals;
    if (g.primaryGoal) lines.push(`Primary goal: ${g.primaryGoal}`);
    if (g.northStarMetric) lines.push(`North star: ${g.northStarMetric}`);
    if (g.revenueTarget != null) lines.push(`Revenue target: TTD ${g.revenueTarget}`);

    const cm = bp.customerModel;
    if (cm.targetSegments?.length) lines.push(`Target segments: ${cm.targetSegments.join(', ')}`);
    if (cm.painPoints?.length) lines.push(`Customer pain points: ${cm.painPoints.join(', ')}`);
    if (cm.acquisitionChannels?.length)
      lines.push(`Acquisition channels: ${cm.acquisitionChannels.join(', ')}`);

    const br = bp.brand;
    if (br.voice || br.positioningStatement) {
      lines.push(`Brand voice: ${br.voice ?? 'unspecified'}`);
      if (br.positioningStatement) lines.push(`Positioning: ${br.positioningStatement}`);
    }

    const c = bp.constraints;
    if (c.budgetCeiling != null) lines.push(`Budget ceiling: TTD ${c.budgetCeiling}`);
    if (c.doNotDoList?.length) lines.push(`Do-not-do: ${c.doNotDoList.join(', ')}`);

    if (bp.intelligence.aiSummary) {
      lines.push('---');
      lines.push(`AI summary: ${bp.intelligence.aiSummary}`);
    }

    return lines.join('\n');
  }

  // ---
  // Backfill helper — used by `scripts/backfill-blueprints.ts` and by
  // first-read seeding in `getBlueprint`. Idempotent.
  // ---

  async backfillForBusiness(businessId: string): Promise<BlueprintRecord> {
    const seeded = await this.inferFromBusinessProfile(businessId);
    const completeness = this.calculateCompleteness(seeded);

    const row = await this.prisma.client.businessBlueprint.upsert({
      where: { businessId },
      create: {
        businessId,
        identity: seeded.identity as Prisma.InputJsonValue,
        operatingModel: seeded.operatingModel as Prisma.InputJsonValue,
        brand: seeded.brand as Prisma.InputJsonValue,
        completeness,
      },
      update: {
        // Don't clobber operator-confirmed sections — only fill empty ones.
        identity: seeded.identity as Prisma.InputJsonValue,
        operatingModel: seeded.operatingModel as Prisma.InputJsonValue,
        brand: seeded.brand as Prisma.InputJsonValue,
        completeness,
      },
    });

    return this.toRecord(row);
  }

  // ---
  // Internals
  // ---

  private async inferFromBusinessProfile(businessId: string): Promise<{
    identity: BlueprintIdentity;
    operatingModel: BlueprintOperatingModel;
    brand: BlueprintBrand;
  }> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: {
        name: true,
        tagline: true,
        description: true,
        archetype: true,
        industry: true,
        country: true,
        primaryColor: true,
        secondaryColor: true,
        revenueModel: true,
        teamSize: true,
        timeCommitment: true,
        positioningStatement: true,
      },
    });

    if (!business) throw new NotFoundException(`Business ${businessId} not found`);

    return {
      identity: {
        ...(business.name ? { name: business.name } : {}),
        ...(business.tagline ? { tagline: business.tagline } : {}),
        ...(business.description ? { story: business.description } : {}),
        ...(business.archetype ? { archetype: business.archetype } : {}),
        ...(business.industry ? { industry: business.industry } : {}),
        ...(business.country ? { country: business.country } : {}),
      },
      operatingModel: {
        ...(business.revenueModel ? { revenueModel: business.revenueModel } : {}),
        ...(business.teamSize ? { teamSize: business.teamSize } : {}),
        ...(business.timeCommitment ? { timeCommitment: business.timeCommitment } : {}),
      },
      brand: {
        ...(business.primaryColor ? { primaryColor: business.primaryColor } : {}),
        ...(business.secondaryColor ? { secondaryColor: business.secondaryColor } : {}),
        ...(business.positioningStatement ? { positioningStatement: business.positioningStatement } : {}),
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private calculateCompleteness(bp: any): number {
    let score = 0;
    let weight = 0;
    for (const key of Object.keys(SECTION_WEIGHTS) as BlueprintSectionKey[]) {
      const sectionWeight = SECTION_WEIGHTS[key];
      weight += sectionWeight;
      const fields = SECTION_FIELDS[key];
      const sectionData: Record<string, unknown> = bp[key] ?? {};
      const filled = fields.filter((f) => isFilled(sectionData[f])).length;
      score += sectionWeight * (filled / fields.length);
    }
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  private sectionLabel(key: BlueprintSectionKey): string {
    switch (key) {
      case 'identity':
        return 'Identity & story';
      case 'operatingModel':
        return 'Operating model';
      case 'goals':
        return 'Goals & targets';
      case 'constraints':
        return 'Constraints & boundaries';
      case 'brand':
        return 'Brand & voice';
      case 'customerModel':
        return 'Customer model';
      case 'financials':
        return 'Financial shape';
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toRecord(row: any): BlueprintRecord {
    return {
      id: row.id,
      businessId: row.businessId,
      schemaVersion: row.schemaVersion,
      identity: asJson<BlueprintIdentity>(row.identity, {}),
      operatingModel: asJson<BlueprintOperatingModel>(row.operatingModel, {}),
      goals: asJson<BlueprintGoals>(row.goals, {}),
      constraints: asJson<BlueprintConstraints>(row.constraints, {}),
      brand: asJson<BlueprintBrand>(row.brand, {}),
      customerModel: asJson<BlueprintCustomerModel>(row.customerModel, {}),
      financials: asJson<BlueprintFinancials>(row.financials, {}),
      intelligence: asJson<BlueprintIntelligence>(row.intelligence, {}),
      completeness: row.completeness,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
