import { BadRequestException, HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { BlueprintService } from '../blueprint/blueprint.service';
import { ModelGatewayService, GatewayMessage } from './model-gateway.service';
import { AiUsageService } from './ai-usage.service';
import {
  BlueprintData,
  BlueprintOwner,
  BlueprintPatch,
  BlueprintSectionKey,
  DnaSectionKey,
} from '../blueprint/blueprint.types';
import { normalizeRecommendedEntityType } from '../blueprint/entity-type.helpers';

export interface OnboardingMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface OnboardingExtraction {
  section: BlueprintSectionKey;
  field: string;
  value: unknown;
  confidence: number;
}

export interface BlueprintOnboardingState {
  messages: OnboardingMessage[];
  completedSections: BlueprintSectionKey[];
  currentSection: BlueprintSectionKey | null;
  currentQuestion: string | null;
}

interface OnboardingChatResult {
  reply: string;
  blueprint: BlueprintData;
  completeness: number;
  threePillarMinimumMet: boolean;
  confidenceScores: Record<string, number>;
  extracted: OnboardingExtraction[];
  nextSection: BlueprintSectionKey | null;
}

/**
 * PR196-GENOME: what GET .../onboarding-history answers. The transcript is the
 * CALLER's own interview with KEY in that business, as the server cache holds
 * it (bounded: STATE_TTL_MS after the last turn, STATE_MAX_ENTRIES
 * conversations, STATE_MAX_MESSAGES messages each); progress is derived from
 * the saved blueprint, so it survives when the transcript has expired.
 */
export interface OnboardingHistory {
  messages: OnboardingMessage[];
  completedSections: BlueprintSectionKey[];
  nextSection: BlueprintSectionKey | null;
  completeness: number;
}

const SECTION_ORDER: BlueprintSectionKey[] = [
  'identity',
  'founderProfile',
  'operatingModel',
  'marketProfile',
  'constraints',
  'goals',
  'brand',
  'customerModel',
  'financials',
  'legalProfile',
  'registrationProfile',
  'taxProfile',
  'ownershipProfile',
  'workflowModel',
  'aiPreferences',
];
// Note: 'intelligence' is intentionally excluded from onboarding; it is inferred from events.

/** The sections the interview asks, in order (read-only view for tests and callers). */
export const ONBOARDING_SECTION_ORDER: readonly BlueprintSectionKey[] = SECTION_ORDER;

/**
 * PR196-GENOME: the ten Business Genome sections the intake must cover, each
 * on the real blueprint section that holds it. PR #196 named the first six
 * (identity, offering, customer, operations, growth, finance) as if they were
 * blueprint sections; they are not (OK-8A-1, OK-8A-5), so each is mapped onto
 * the section the interview already asks for it. The four profiles are their
 * own sections.
 */
export const GENOME_INTAKE_SECTIONS = {
  identity: 'identity',
  offering: 'operatingModel',
  customer: 'customerModel',
  operations: 'workflowModel',
  growth: 'goals',
  finance: 'financials',
  legalProfile: 'legalProfile',
  registrationProfile: 'registrationProfile',
  taxProfile: 'taxProfile',
  ownershipProfile: 'ownershipProfile',
} as const satisfies Record<string, BlueprintSectionKey>;

/**
 * PR196-GENOME (OK-8A-4): the one vocabulary a registration or tax status takes
 * when the interview writes it (the compliance item statuses the onboarding
 * cards offer, plus UNKNOWN). Readiness readers treat anything outside their
 * incomplete list as done (onboarding-concierge isRegistrationStepCompleteForReadiness),
 * so a free-text status ('not registered yet') must never be stored raw.
 */
export const GENOME_STATUS_VOCABULARY = ['NOT_STARTED', 'IN_PROGRESS', 'DONE', 'NOT_APPLICABLE', 'UNKNOWN'] as const;
export type GenomeStatus = (typeof GENOME_STATUS_VOCABULARY)[number];

/** Status fields: every value written is one of GENOME_STATUS_VOCABULARY. */
const STATUS_FIELDS: Partial<Record<BlueprintSectionKey, readonly string[]>> = {
  registrationProfile: ['businessNameStatus', 'companiesRegistryStatus', 'birStatus', 'nisEmployerStatus', 'vatStatus', 'businessBankStatus'],
  taxProfile: ['taxIdStatus'],
};

/** Yes/no fields: written as a boolean, or not written at all. */
const BOOLEAN_FIELDS: Partial<Record<BlueprintSectionKey, readonly string[]>> = {
  legalProfile: ['hasPhysicalLocation', 'regulatedIndustry'],
  registrationProfile: ['hasEmployees'],
  taxProfile: ['vatThresholdWatch', 'payrollExpected', 'contractorPaymentsExpected'],
  ownershipProfile: ['hasPartners', 'needsShareholderAgreement'],
};

/**
 * A tracked field that counts as answered by another answer: a solo founder
 * (hasPartners false) owes no owners list (OK-8A-2), so ownershipProfile is
 * complete once hasPartners is answered false.
 */
const ANSWERED_BY: Partial<Record<BlueprintSectionKey, Record<string, (data: Record<string, unknown>) => boolean>>> = {
  ownershipProfile: { owners: (data) => data.hasPartners === false },
};

/** Words that say the founder does not know: nothing is recorded for them. */
const STATUS_UNCERTAIN = /(not sure|unsure|uncertain|not certain|n't know|do not know|don't know|no idea|can't remember|cannot remember|can't recall)/;
const STATUS_NOT_APPLICABLE = /(\bn\/a\b|not applicable|not needed|not required|no need|does ?n[o']t apply|\bexempt\b)/;
/** A status word, as the thing a negation can deny ("not registered", "haven't applied"). */
const STATUS_WORD = String.raw`(?:registered|register|registration|started|start|done|complete|completed|applied|apply|application|submitted|submit|filed|file|obtained|approved|finished|have|got|gotten)\b`;
/**
 * A negation that denies a status word: the negator, at most a few filler
 * words ("not yet", "haven't even", "never been"), then the status word. Only
 * these phrases are read as negating the status; a "no" elsewhere ("registered
 * in 2023, no issues") negates something else (CR-2).
 */
const NEGATED_STATUS = new RegExp(
  String.raw`(?:\bnot\b|\bnever\b|\bcannot\b|n't\b|\byet to\b|\bno longer\b)(?:\s+(?:yet|even|been|ever|really|already|got|be|we|i|it|to))*\s+${STATUS_WORD}|\bno\s+${STATUS_WORD}`,
  'g',
);
const STATUS_NEGATIVE = /(\bno\b|\bnot\b|\bnever\b|\bnone\b|\bnope\b|\bcannot\b|n't\b|\byet to\b)/;
const STATUS_IN_PROGRESS = /(in progress|in process|\bpending\b|\bapplied\b|\bsubmitted\b|\bprocessing\b|\bstarted\b|\bunderway\b|\bwaiting\b)/;
const STATUS_DONE = /(\bdone\b|\bcomplete(d)?\b|\bregistered\b|\byes\b|\bobtained\b|\bapproved\b|\bhave (it|one)\b|\bfinished\b)/;

/**
 * Map a status the model wrote onto GENOME_STATUS_VOCABULARY. Free text never
 * reads as done unless it says so with nothing against it: a status word that
 * is negated ('not registered yet', "haven't started") is NOT_STARTED; signals
 * that disagree ('registered in 2023, no issues', 'applied and approved'),
 * uncertainty ('not sure') and anything unrecognised are UNKNOWN, which the
 * interview never writes (normalizeExtractedValue) and every readiness reader
 * treats as incomplete.
 */
export function normalizeGenomeStatus(value: unknown): GenomeStatus {
  if (typeof value !== 'string') return 'UNKNOWN';
  const canonical = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if ((GENOME_STATUS_VOCABULARY as readonly string[]).includes(canonical)) return canonical as GenomeStatus;
  const text = value.trim().toLowerCase().replace(/[‘’]/g, "'");
  if (STATUS_UNCERTAIN.test(text)) return 'UNKNOWN';
  if (STATUS_NOT_APPLICABLE.test(text)) return 'NOT_APPLICABLE';
  // Read what is left once the negated status phrases are taken out.
  const rest = text.replace(NEGATED_STATUS, ' ');
  const negated = rest !== text || STATUS_NEGATIVE.test(rest);
  const inProgress = STATUS_IN_PROGRESS.test(rest);
  const done = STATUS_DONE.test(rest);
  if (inProgress && !done) return 'IN_PROGRESS';
  if (done && !inProgress && !negated) return 'DONE';
  if (!done && !inProgress && negated) return 'NOT_STARTED';
  return 'UNKNOWN';
}

function normalizeYesNo(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const text = value.trim().toLowerCase();
  if (/^(no|false|nope|none|not)\b/.test(text)) return false;
  if (/^(yes|true|yep|yeah)\b/.test(text)) return true;
  return undefined;
}

function normalizeOwners(value: unknown): BlueprintOwner[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const owners: BlueprintOwner[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      owners.push({ name: item.trim() });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const owner: BlueprintOwner = {};
    if (typeof raw.name === 'string' && raw.name.trim()) owner.name = raw.name.trim();
    if (typeof raw.role === 'string' && raw.role.trim()) owner.role = raw.role.trim();
    const pct = typeof raw.sharePct === 'number' ? raw.sharePct : typeof raw.sharePct === 'string' ? Number(raw.sharePct.replace('%', '')) : NaN;
    if (Number.isFinite(pct) && pct >= 0 && pct <= 100) owner.sharePct = pct;
    if (Object.keys(owner).length > 0) owners.push(owner);
  }
  // Nothing usable is nothing to write, not an empty list over saved owners.
  return owners.length > 0 ? owners : undefined;
}

/** A field whose value is a vocabulary in which UNKNOWN means "not answered". */
function isVocabularyField(section: BlueprintSectionKey, field: string): boolean {
  return Boolean(STATUS_FIELDS[section]?.includes(field)) || (section === 'legalProfile' && field === 'recommendedEntityType');
}

/**
 * PR196-GENOME (OK-8A-4): the value the interview writes for one extracted
 * field, or undefined to write nothing. Statuses take the vocabulary, the
 * entity type goes through the Genesis helper (normalizeRecommendedEntityType),
 * yes/no fields become booleans, owners become BlueprintOwner rows. Every other
 * field is written as extracted, as before.
 *
 * A value that cannot be mapped is not written (CR-2): updateBlueprint merges
 * field by field, so writing UNKNOWN (or an empty owners list) would replace
 * what the onboarding cards or Genesis already saved (DONE, LIMITED_COMPANY)
 * with no information at all.
 */
function normalizeExtractedValue(section: BlueprintSectionKey, field: string, value: unknown): unknown {
  if (STATUS_FIELDS[section]?.includes(field)) {
    const status = normalizeGenomeStatus(value);
    return status === 'UNKNOWN' ? undefined : status;
  }
  if (BOOLEAN_FIELDS[section]?.includes(field)) return normalizeYesNo(value);
  if (section === 'legalProfile' && field === 'recommendedEntityType') {
    const entityType = normalizeRecommendedEntityType(value);
    return entityType === 'UNKNOWN' ? undefined : entityType;
  }
  if (section === 'ownershipProfile' && field === 'owners') return normalizeOwners(value);
  return value;
}

/** A transcript entry as the interview stores it: a role it knows and text. */
function isTranscriptEntry(value: unknown): value is OnboardingMessage {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (entry.role === 'user' || entry.role === 'assistant') && typeof entry.content === 'string';
}

const SECTION_FOCUS: Partial<Record<BlueprintSectionKey, { label: string; goal: string; fields: string[] }>> = {
  identity: {
    label: 'Business Identity',
    goal: 'what the business is, who it serves, and what it stands for',
    fields: ['name', 'archetype', 'industry', 'tagline', 'oneLiner', 'mission'],
  },
  operatingModel: {
    label: 'Operating Model',
    goal: 'how the business makes money and delivers value',
    fields: ['revenueModel', 'deliveryMode', 'serviceArea', 'channels', 'teamSize'],
  },
  constraints: {
    label: 'Constraints',
    goal: 'budget, time, and risk boundaries',
    fields: ['budgetRange', 'timeCommitment', 'riskTolerance'],
  },
  goals: {
    label: 'Goals',
    goal: 'what the founder is working toward and their current priorities',
    fields: ['northStar', 'ninetyDayGoals', 'twelveMonthGoals', 'priorities'],
  },
  brand: {
    label: 'Brand',
    goal: 'how the business sounds and feels',
    fields: ['voice', 'tone', 'valueProps'],
  },
  customerModel: {
    label: 'Customer Model',
    goal: 'who the ideal customer is and what they need',
    fields: ['idealCustomer', 'segments', 'painPoints'],
  },
  financials: {
    label: 'Financials',
    goal: 'pricing, targets, and cost structure',
    fields: ['currency', 'pricingModel', 'avgTicket', 'monthlyTarget'],
  },
  legalProfile: {
    label: 'Legal Profile',
    goal: 'the country the business operates in, its legal structure, and whether the industry is regulated',
    fields: ['country', 'recommendedEntityType', 'regulatedIndustry'],
  },
  registrationProfile: {
    label: 'Registration Profile',
    goal: 'business name, companies registry, BIR, NIS employer and VAT registration status',
    fields: ['businessNameStatus', 'companiesRegistryStatus', 'birStatus', 'nisEmployerStatus', 'vatStatus'],
  },
  taxProfile: {
    label: 'Tax Profile',
    goal: 'the tax country, tax ID status, and whether payroll is expected',
    // taxReadinessScore is a derived score, not something to ask the founder.
    fields: ['country', 'taxIdStatus', 'payrollExpected'],
  },
  ownershipProfile: {
    label: 'Ownership Profile',
    goal: 'whether there are co-founders or partners and how ownership is split',
    fields: ['hasPartners', 'owners'],
  },
  workflowModel: {
    label: 'Workflow Model',
    goal: 'how work moves through the business',
    fields: ['primaryWorkflow'],
  },
  aiPreferences: {
    label: 'AI Preferences',
    goal: 'how KEY should behave, communicate, and report back',
    fields: ['autonomyLevel', 'tone', 'outreachStyle', 'reportingCadence'],
  },
  founderProfile: {
    label: 'Founder Profile',
    goal: 'who is building the business, their background, skills, and availability',
    fields: ['founderName', 'background', 'skills', 'weeklyAvailabilityHours', 'riskTolerance', 'visionStatement'],
  },
  marketProfile: {
    label: 'Market Profile',
    goal: 'where the business competes, the target market, and demand signals',
    fields: ['targetGeography', 'marketCategory', 'marketStage', 'demandSignals', 'trends', 'barriersToEntry'],
  },
  intelligence: {
    label: 'Intelligence',
    goal: 'inferred patterns from business activity',
    fields: [],
  },
};

/** What the interview asks of each section (read-only view for tests and callers). */
export const ONBOARDING_SECTION_FOCUS: Readonly<
  Partial<Record<BlueprintSectionKey, { readonly label: string; readonly goal: string; readonly fields: readonly string[] }>>
> = SECTION_FOCUS;

@Injectable()
export class BlueprintOnboardingService {
  private readonly logger = new Logger(BlueprintOnboardingService.name);
  /**
   * Bounded, because this used to grow forever.
   *
   * `stateCache` was a plain Map with exactly one eviction path: a user
   * explicitly hitting reset. Every business that ever opened onboarding left
   * an entry behind, each holding the full message transcript, in a process
   * that runs for weeks. Nothing swept it and nothing capped it.
   *
   * It was reported as something else — "state durability: in-memory Map,
   * refresh restarts the interview" — and that part is not right. getState
   * REBUILDS from the persisted blueprint on a miss: completedSections and
   * currentSection are derived from saved data, so progress survives a restart.
   * Only the transcript is cache-resident.
   *
   * That rebuild is exactly what makes eviction safe, and it is why this is a
   * cache and not storage. A miss costs one blueprint read.
   *
   * PR196-GENOME review (SEC-GEN-1/3, CR-1): an entry is ONE member's
   * conversation with KEY in one business, keyed by (businessId, userId), and
   * the server is the only author of its transcript. The client's `history`
   * is never read: a member's own words and KEY's replies are the only
   * entries, so no caller can plant a "KEY" line, a non-text entry or another
   * member's words in anybody's transcript. The blueprint the interview fills
   * stays business-level and any-member, as every blueprint route is; the raw
   * typed text is the member's own.
   */
  private static readonly STATE_TTL_MS = 60 * 60_000;
  private static readonly STATE_MAX_ENTRIES = 500;
  /** The most messages one transcript keeps (the oldest go first). */
  private static readonly STATE_MAX_MESSAGES = 200;
  private readonly stateCache = new Map<string, { state: BlueprintOnboardingState; touchedAt: number }>();

  /** The cache key of one member's conversation in one business. */
  private static transcriptKey(businessId: string, userId: string): string {
    return `${businessId}::${userId}`;
  }

  /** A live entry, or nothing — an expired one is a miss, not stale data. */
  private readCache(key: string): BlueprintOnboardingState | undefined {
    const hit = this.stateCache.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.touchedAt > BlueprintOnboardingService.STATE_TTL_MS) {
      this.stateCache.delete(key);
      return undefined;
    }
    // A READ counts as use. Without this the cache evicts by insertion order,
    // so a business part-way through onboarding can be dropped while an idle
    // one written later survives — which is the opposite of what a cap is for.
    this.stateCache.delete(key);
    this.stateCache.set(key, { state: hit.state, touchedAt: hit.touchedAt });
    return hit.state;
  }

  private writeCache(key: string, state: BlueprintOnboardingState): void {
    // Map iterates in insertion order, so the first key is the oldest write.
    // Deleting before setting keeps a refreshed entry from counting as old.
    this.stateCache.delete(key);
    if (this.stateCache.size >= BlueprintOnboardingService.STATE_MAX_ENTRIES) {
      const oldest = this.stateCache.keys().next().value;
      if (oldest !== undefined) this.stateCache.delete(oldest);
    }
    this.stateCache.set(key, { state, touchedAt: Date.now() });
  }

  constructor(
    @Inject(BlueprintService) private readonly blueprint: BlueprintService,
    @Inject(ModelGatewayService) private readonly gateway: ModelGatewayService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
  ) {}

  /**
   * One interview turn of `userId` in `businessId`. The transcript the model
   * sees and the one GET onboarding-history returns are the server's own
   * (getState), never a copy the client sends.
   */
  async chat(businessId: string, userId: string, userMessage: string): Promise<OnboardingChatResult> {
    // The route's DTO checks this; the transcript must hold text whatever the caller.
    if (typeof userMessage !== 'string' || userMessage.length === 0) {
      throw new BadRequestException('message must be text');
    }
    const key = BlueprintOnboardingService.transcriptKey(businessId, userId);
    const blueprint = await this.blueprint.getBlueprint(businessId);
    const state = await this.getState(businessId, userId);

    // This turn's own entry. Turns of the same conversation can overlap (two
    // tabs), so the turn finds its place by this object, never by an index
    // taken before the model call (SEC-GEN-2).
    const turn: OnboardingMessage = { role: 'user', content: userMessage };
    state.messages.push(turn);
    this.boundTranscript(state);

    const systemPrompt = this.buildSystemPrompt(blueprint, state);
    const gatewayMessages: GatewayMessage[] = [
      { role: 'system', content: systemPrompt },
      ...state.messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ];

    try {
      const completion = await this.aiUsage.trackAndComplete(
        businessId,
        undefined,
        'blueprint_onboarding',
        {
          messages: gatewayMessages,
          temperature: 0.7,
          maxTokens: 1200,
        },
      );

      const rawReply = completion.content || "Let's keep building your Business Genome. What else should I know?";
      const { reply, extractions } = this.parseExtractions(rawReply);

      this.answerTurn(state, turn, reply);

      const patch = this.buildPatchFromExtractions(extractions);
      const updatedBlueprint = Object.keys(patch).length > 0
        ? await this.blueprint.updateBlueprint(businessId, patch)
        : blueprint;

      // Progress is re-derived from the saved blueprint every turn, so a section
      // this turn completed is left and the interview moves on in one sitting
      // (it used to advance only after a cache miss rebuilt the state).
      state.completedSections = this.getCompletedSections(updatedBlueprint);
      const nextSection = this.chooseNextSection(updatedBlueprint, state);
      state.currentSection = nextSection;
      state.currentQuestion = nextSection ? this.firstQuestionForSection(nextSection) : null;
      this.writeCache(key, state);

      return {
        reply,
        blueprint: updatedBlueprint,
        completeness: updatedBlueprint.completeness,
        threePillarMinimumMet: this.blueprint.checkThreePillarMinimum(
          (updatedBlueprint.genomeDnaScores ?? {}) as Record<DnaSectionKey, number>,
        ),
        confidenceScores: updatedBlueprint.confidenceScores as Record<string, number>,
        extracted: extractions,
        nextSection,
      };
    } catch (err: any) {
      // R0-07 / R0-P: a structured refusal (AI unavailable or switched off: the
      // 503 provider_not_configured; also the rate-limit 429 and credit 403
      // trackAndComplete raises) reaches the caller as itself, not as a 200
      // carrying a made-up reply. The refused turn leaves the transcript as it
      // was, so the history never shows a message KEY did not answer. Only this
      // turn's own entry is taken out: a turn that finished meanwhile stays.
      if (err instanceof HttpException) {
        const at = state.messages.indexOf(turn);
        if (at >= 0) state.messages.splice(at, 1);
        throw err;
      }
      this.logger.error(`Blueprint onboarding chat failed: ${(err as Error).message}`);
      const fallback = "I'm having trouble thinking that through. Could you tell me a bit more about your business?";
      this.answerTurn(state, turn, fallback);
      return {
        reply: fallback,
        blueprint,
        completeness: blueprint.completeness,
        threePillarMinimumMet: this.blueprint.checkThreePillarMinimum(
          (blueprint.genomeDnaScores ?? {}) as Record<DnaSectionKey, number>,
        ),
        confidenceScores: blueprint.confidenceScores as Record<string, number>,
        extracted: [],
        nextSection: state.currentSection,
      };
    }
  }

  /**
   * KEY's reply goes right after the turn it answers, so overlapping turns
   * still read question, answer, question, answer. A turn no longer in the
   * transcript (bounded away) has its reply appended.
   */
  private answerTurn(state: BlueprintOnboardingState, turn: OnboardingMessage, reply: string): void {
    const at = state.messages.indexOf(turn);
    const entry: OnboardingMessage = { role: 'assistant', content: reply };
    if (at >= 0) state.messages.splice(at + 1, 0, entry);
    else state.messages.push(entry);
    this.boundTranscript(state);
  }

  private boundTranscript(state: BlueprintOnboardingState): void {
    const excess = state.messages.length - BlueprintOnboardingService.STATE_MAX_MESSAGES;
    if (excess > 0) state.messages.splice(0, excess);
  }

  /**
   * The interview state of `userId` in `businessId`: from the cache, or on a
   * miss rebuilt from the saved blueprint with an empty transcript. Nothing a
   * client sends seeds it (SEC-GEN-1, CR-1).
   */
  async getState(businessId: string, userId: string): Promise<BlueprintOnboardingState> {
    const key = BlueprintOnboardingService.transcriptKey(businessId, userId);
    const cached = this.readCache(key);
    if (cached) return cached;

    const blueprint = await this.blueprint.getBlueprint(businessId);
    const completedSections = this.getCompletedSections(blueprint);
    const nextSection = this.chooseNextSection(blueprint, { completedSections, currentSection: null } as BlueprintOnboardingState);

    const state: BlueprintOnboardingState = {
      messages: [],
      completedSections,
      currentSection: nextSection,
      currentQuestion: nextSection ? this.firstQuestionForSection(nextSection) : null,
    };

    this.writeCache(key, state);
    return state;
  }

  /**
   * PR196-GENOME: GET .../onboarding-history. The caller's own transcript in
   * that business as the server holds it, so a reload or another device
   * resumes the interview without the browser keeping a copy (OK-8B-2), with
   * progress derived from the saved blueprint. Another member's typed text is
   * never in it (SEC-GEN-3): each member's conversation is their own entry.
   *
   * The transcript is cache-resident and bounded, and that is stated rather
   * than hidden (OK-8B-4): it is kept STATE_TTL_MS after the last chat turn,
   * for at most STATE_MAX_ENTRIES conversations of STATE_MAX_MESSAGES
   * messages, in this process. Past that the answer is an empty transcript
   * with the progress still right; durable storage would be a new table (a
   * migration and an owner decision).
   *
   * A read has no side effect: on a miss nothing is cached. Only a known role
   * with text is returned, whatever the cache holds (CR-1).
   */
  async getHistory(businessId: string, userId: string): Promise<OnboardingHistory> {
    const cached = this.readCache(BlueprintOnboardingService.transcriptKey(businessId, userId));
    const blueprint = await this.blueprint.getBlueprint(businessId);
    const completedSections = this.getCompletedSections(blueprint);
    const nextSection = this.chooseNextSection(blueprint, {
      completedSections,
      currentSection: cached?.currentSection ?? null,
    });
    return {
      messages: (cached?.messages ?? []).filter(isTranscriptEntry).map((m) => ({ role: m.role, content: m.content })),
      completedSections,
      nextSection,
      completeness: blueprint.completeness ?? 0,
    };
  }

  /** Starts `userId`'s conversation in `businessId` over; nobody else's. */
  reset(businessId: string, userId: string): void {
    this.stateCache.delete(BlueprintOnboardingService.transcriptKey(businessId, userId));
  }

  private buildSystemPrompt(blueprint: BlueprintData, state: BlueprintOnboardingState): string {
    const completed = state.completedSections;
    const remaining = SECTION_ORDER.filter(s => !completed.includes(s));
    const current = state.currentSection || remaining[0] || null;

    const blueprintSummary = [
      `Business: ${blueprint.identity.name || 'unknown'}`,
      blueprint.identity.industry ? `Industry: ${blueprint.identity.industry}` : null,
      blueprint.operatingModel.revenueModel ? `Revenue model: ${blueprint.operatingModel.revenueModel}` : null,
      blueprint.goals.northStar ? `North star: ${blueprint.goals.northStar}` : null,
      blueprint.customerModel.idealCustomer ? `Ideal customer: ${blueprint.customerModel.idealCustomer}` : null,
      `Completeness: ${blueprint.completeness}%`,
    ].filter(Boolean).join('\n');

    return `You are KEY, the AI co-founder inside KeyFlowOS. You are conducting a friendly, focused onboarding interview to build the user's Business Genome — a structured blueprint that lets KEY operate as a digital executive for their business.

CURRENT BUSINESS CONTEXT:
${blueprintSummary}

SECTIONS ALREADY COVERED: ${completed.length > 0 ? completed.map(s => SECTION_FOCUS[s]?.label ?? s).join(', ') : 'None yet'}

SECTIONS STILL TO COVER: ${remaining.length > 0 ? remaining.map(s => SECTION_FOCUS[s]?.label ?? s).join(', ') : 'All core sections covered'}

CURRENT FOCUS SECTION: ${current ? SECTION_FOCUS[current]?.label ?? current : 'None — summarizing'}

GOAL OF CURRENT SECTION: ${current ? SECTION_FOCUS[current]?.goal ?? 'N/A' : 'N/A'}

IMPORTANT INSTRUCTIONS:
1. Be warm, concise, and conversational. Ask ONE clear question at a time.
2. Do not read like a survey. Flow naturally from what the user says.
3. Always acknowledge what the user shared before moving on.
4. If the user shares multiple useful facts in one message, extract them all.
5. When you have enough to fill the current section, celebrate briefly and move to the next section naturally.
6. If the user is vague, ask a gentle follow-up. If they are detailed, move forward.
7. Never ask for sensitive data like passwords, API keys, or bank details.
8. Keep total reply under 3 short paragraphs.

When you extract structured facts, include them in a JSON block at the END of your response:

\`\`\`extract
[
  {"section": "identity", "field": "name", "value": "Acme Consulting", "confidence": 0.95},
  {"section": "operatingModel", "field": "revenueModel", "value": "consulting retainers", "confidence": 0.9}
]
\`\`\`

Valid sections and fields:
${Object.entries(SECTION_FOCUS).map(([key, meta]) => `- ${key}: ${meta.fields.join(', ')}`).join('\n')}

For array fields (e.g., channels, ninetyDayGoals, segments, painPoints, valueProps), return value as a JSON array of strings.
For autonomyLevel, return an integer 1-5 where 1 = always ask first, 5 = act autonomously.
For numeric fields, return a number.
For status fields (${[...(STATUS_FIELDS.registrationProfile ?? []), ...(STATUS_FIELDS.taxProfile ?? [])].join(', ')}), return exactly one of: ${GENOME_STATUS_VOCABULARY.join(', ')}.
For recommendedEntityType, return exactly one of: SOLE_TRADER, PARTNERSHIP, LIMITED_COMPANY, NONPROFIT, UNKNOWN.
UNKNOWN is never saved: if the founder does not know a status or the structure, leave the field out and ask again later.
For yes/no fields (regulatedIndustry, hasPartners, payrollExpected), return true or false.
For owners, return a JSON array of objects: {"name": string, "sharePct": number from 0 to 100, "role": string}.
Confidence: 0.6 for inferred, 0.85 for stated clearly, 1.0 for explicitly confirmed.`;
  }

  private parseExtractions(rawReply: string): { reply: string; extractions: OnboardingExtraction[] } {
    const extractMatch = rawReply.match(/```extract\s*\n([\s\S]*?)\n```/);
    const reply = rawReply.replace(/```extract\s*\n[\s\S]*?\n```/g, '').trim();
    const extractions: OnboardingExtraction[] = [];

    if (extractMatch) {
      try {
        const parsed = JSON.parse(extractMatch[1]) as Array<{
          section?: string;
          field?: string;
          value?: unknown;
          confidence?: number;
        }>;
        for (const item of parsed) {
          if (!item.section || !item.field || item.value === undefined) continue;
          if (!SECTION_ORDER.includes(item.section as BlueprintSectionKey)) continue;
          // OK-8A-4: statuses, the entity type and yes/no answers are written
          // in their vocabulary, never as the model's free text.
          const value = normalizeExtractedValue(item.section as BlueprintSectionKey, item.field, item.value);
          if (value === undefined) continue;
          extractions.push({
            section: item.section as BlueprintSectionKey,
            field: item.field,
            value,
            confidence: typeof item.confidence === 'number' ? Math.min(item.confidence, 1) : 0.8,
          });
        }
      } catch (err: any) {
        this.logger.warn(`Failed to parse onboarding extraction block: ${(err as Error).message}`);
      }
    }

    return { reply, extractions };
  }

  private buildPatchFromExtractions(extractions: OnboardingExtraction[]): BlueprintPatch {
    const patch: BlueprintPatch = {};
    const bySection = new Map<BlueprintSectionKey, Record<string, unknown>>();

    for (const ext of extractions) {
      if (!bySection.has(ext.section)) {
        bySection.set(ext.section, {});
      }
      bySection.get(ext.section)![ext.field] = ext.value;
    }

    for (const [section, fields] of bySection.entries()) {
      (patch as Record<BlueprintSectionKey, Record<string, unknown>>)[section] = fields;
    }

    return patch;
  }

  private getCompletedSections(blueprint: BlueprintData): BlueprintSectionKey[] {
    return SECTION_ORDER.filter(section => {
      const focus = SECTION_FOCUS[section];
      if (!focus) return false;
      return this.answeredFields(blueprint, section) >= Math.ceil(focus.fields.length * 0.6);
    });
  }

  /** How many of a section's tracked fields are answered (ANSWERED_BY included). */
  private answeredFields(blueprint: BlueprintData, section: BlueprintSectionKey): number {
    const focus = SECTION_FOCUS[section];
    if (!focus) return 0;
    const data = ((blueprint as unknown as Record<string, unknown>)[section] ?? {}) as Record<string, unknown>;
    const answeredBy = ANSWERED_BY[section] ?? {};
    return focus.fields.filter(f => this.isAnswered(section, f, data[f]) || answeredBy[f]?.(data) === true).length;
  }

  private chooseNextSection(
    blueprint: BlueprintData,
    state: Pick<BlueprintOnboardingState, 'completedSections' | 'currentSection'>,
  ): BlueprintSectionKey | null {
    const completed = state.completedSections;
    const incomplete = SECTION_ORDER.filter(s => !completed.includes(s));

    if (incomplete.length === 0) return null;

    // Prefer current section if not yet complete
    if (state.currentSection && incomplete.includes(state.currentSection)) {
      return state.currentSection;
    }

    // Choose the least-filled incomplete section
    return incomplete.sort((a, b) => {
      const scoreA = this.sectionFillScore(blueprint, a);
      const scoreB = this.sectionFillScore(blueprint, b);
      return scoreA - scoreB;
    })[0];
  }

  private sectionFillScore(blueprint: BlueprintData, section: BlueprintSectionKey): number {
    const focus = SECTION_FOCUS[section];
    if (!focus || focus.fields.length === 0) return 0;
    return this.answeredFields(blueprint, section) / focus.fields.length;
  }

  private firstQuestionForSection(section: BlueprintSectionKey): string {
    const questions: Partial<Record<BlueprintSectionKey, string | undefined>> = {
      identity: "To get started, what's your business name and what do you do in one sentence?",
      operatingModel: 'How does your business make money today?',
      constraints: "What's your approximate monthly budget for growth tools and marketing?",
      goals: "What's the single most important outcome you want in the next 90 days?",
      brand: 'How would you describe your brand voice — professional, playful, bold, calm?',
      customerModel: 'Who is your ideal customer? Describe them as specifically as you can.',
      financials: "What's your average transaction or project value?",
      workflowModel: 'How do customers typically move from first contact to delivered outcome?',
      aiPreferences: 'On a scale of 1-5, how much should KEY act on its own versus ask you first?',
      legalProfile: 'Which country do you operate in, and is the business a sole trader, a partnership or a company?',
      registrationProfile: 'Where are you with registration: business name, BIR, NIS and VAT?',
      taxProfile: 'Do you have a tax ID yet, and do you expect to run payroll?',
      ownershipProfile: 'Do you run the business alone, or do you have partners? If partners, how is ownership split?',
      intelligence: undefined,
    };
    return questions[section] || "Tell me more about your business.";
  }

  /**
   * A tracked field is answered when it holds a value; for a status or the
   * entity type, UNKNOWN is not an answer (CR-2), as the concierge and
   * readiness readers already treat it, so the interview asks it again rather
   * than calling the section complete.
   */
  private isAnswered(section: BlueprintSectionKey, field: string, value: unknown): boolean {
    if (value === 'UNKNOWN' && isVocabularyField(section, field)) return false;
    return this.isPopulated(value);
  }

  private isPopulated(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    // A yes/no answer is an answer: false (no partners, not regulated, no
    // payroll) counts, as BusinessGenesisService's isPopulated already does.
    // Without this a solo founder could never complete ownershipProfile (OK-8A-2).
    if (typeof value === 'boolean') return true;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'number') return !Number.isNaN(value);
    if (typeof value === 'object') return Object.keys(value as object).length > 0;
    return Boolean(value);
  }
}
