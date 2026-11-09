/**
 * The onboarding state cache has to be bounded, and evicting has to be safe.
 *
 * `stateCache` was a plain Map with exactly one eviction path: a user hitting
 * reset. Every business that ever opened onboarding left an entry behind, each
 * holding the full message transcript, in a process that runs for weeks.
 * Nothing swept it and nothing capped it.
 *
 * It was reported as "state durability: in-memory Map, refresh restarts the
 * interview". That part is not right, and the difference is the whole reason
 * this is cheap to fix: getState REBUILDS from the persisted blueprint on a
 * miss — completedSections and currentSection are derived from saved data, so
 * progress survives. Only the transcript is cache-resident, and the caller
 * passes that in.
 *
 * So the tests that matter are: it forgets, and forgetting costs nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import {
  BlueprintOnboardingService,
  GENOME_INTAKE_SECTIONS,
  GENOME_STATUS_VOCABULARY,
  ONBOARDING_SECTION_FOCUS,
  ONBOARDING_SECTION_ORDER,
  normalizeGenomeStatus,
} from './blueprint-onboarding.service';
import { keyDisabledRefusal } from './model-gateway.service';
import type { BlueprintData, BlueprintPatch, BlueprintSectionKey } from '../blueprint/blueprint.types';

/**
 * PR196-GENOME (OK-8A-1): the fixture is a blueprint with sections that exist.
 * It used to name `offering`, which is not a BlueprintData section.
 */
function emptyBlueprint(): BlueprintData {
  return {
    schemaVersion: 1,
    identity: {},
    operatingModel: {},
    goals: {},
    constraints: {},
    brand: {},
    customerModel: {},
    financials: {},
    intelligence: {},
    workflowModel: {},
    aiPreferences: {},
    confidenceScores: {},
    completeness: 0,
    updatedAt: '2026-11-09T00:00:00.000Z',
  };
}

function makeService() {
  const getBlueprint = vi.fn(async () => emptyBlueprint() as never);
  const svc = new BlueprintOnboardingService(
    { getBlueprint } as never,
    {} as never,
    {} as never,
  );
  return { svc, getBlueprint };
}

describe('the onboarding state cache is bounded', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('serves a repeat read from cache, without re-reading the blueprint', async () => {
    const { svc, getBlueprint } = makeService();
    await svc.getState('biz_1');
    await svc.getState('biz_1');
    expect(getBlueprint, 'the cache should still be a cache').toHaveBeenCalledTimes(1);
  });

  it('forgets an entry once it goes stale, and rebuilds it', async () => {
    const { svc, getBlueprint } = makeService();
    await svc.getState('biz_1');

    vi.advanceTimersByTime(61 * 60_000);
    await svc.getState('biz_1');

    expect(getBlueprint, 'an expired entry is a miss, not stale data').toHaveBeenCalledTimes(2);
  });

  it('does not grow without limit', async () => {
    // The actual defect: one entry per business, forever, each holding a
    // transcript, in a process that runs for weeks.
    const { svc } = makeService();
    for (let i = 0; i < 700; i++) await svc.getState(`biz_${i}`);

    const size = (svc as unknown as { stateCache: Map<string, unknown> }).stateCache.size;
    expect(size, 'the cache must be capped').toBeLessThanOrEqual(500);
  });

  it('keeps the most recent entries when it evicts', async () => {
    const { svc } = makeService();
    for (let i = 0; i < 700; i++) await svc.getState(`biz_${i}`);

    const cache = (svc as unknown as { stateCache: Map<string, unknown> }).stateCache;
    expect(cache.has('biz_699'), 'the newest write must survive').toBe(true);
    expect(cache.has('biz_0'), 'the oldest must be the one dropped').toBe(false);
  });

  it('rebuilds progress from the blueprint after eviction — nothing is lost', async () => {
    // Why eviction is safe at all: the state is derived, not stored.
    const { svc, getBlueprint } = makeService();
    const first = await svc.getState('biz_1');

    (svc as unknown as { stateCache: Map<string, unknown> }).stateCache.clear();
    const rebuilt = await svc.getState('biz_1');

    expect(getBlueprint).toHaveBeenCalledTimes(2);
    expect(rebuilt.completedSections).toEqual(first.completedSections);
    expect(rebuilt.currentSection).toEqual(first.currentSection);
  });

  it('a refreshed entry is not treated as old', async () => {
    // delete-before-set: without it, re-reading a business keeps its original
    // insertion position and it gets evicted while still in active use.
    const { svc } = makeService();
    for (let i = 0; i < 499; i++) await svc.getState(`biz_${i}`);
    await svc.getState('biz_0');            // touch the oldest
    for (let i = 500; i < 520; i++) await svc.getState(`biz_${i}`);

    const cache = (svc as unknown as { stateCache: Map<string, unknown> }).stateCache;
    expect(cache.has('biz_0'), 'a recently used entry must not be evicted first').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PR196-GENOME: the interview covers the ten genome sections on real fields,
// counts false and 0 as answers, normalizes what the model writes, keeps a
// server-side history bounded by the cache, and answers the R0-P 503.
// ---------------------------------------------------------------------------

const TYPES_FILE = join(__dirname, '../blueprint/blueprint.types.ts');

/**
 * The real shape of a blueprint, read from blueprint.types.ts (the source of
 * truth for every business_blueprints JSON column): BlueprintData's section
 * properties, and for each the property names of its interface. A section or
 * field the interview tracks, or a fixture here names, must be in it. The
 * PR #196 spec got this wrong (sections offering, customer, operations,
 * growth, finance, and legalProfile.entityType, do not exist; OK-8A-1), and a
 * spec file is not type-checked (tsconfig excludes *.spec.ts), so the check
 * is made here.
 */
function realBlueprintShape(): Map<string, Set<string>> {
  const sf = ts.createSourceFile(TYPES_FILE, readFileSync(TYPES_FILE, 'utf8'), ts.ScriptTarget.Latest, true);
  const interfaces = new Map<string, ts.InterfaceDeclaration>();
  sf.forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node)) interfaces.set(node.name.text, node);
  });
  const members = (decl: ts.InterfaceDeclaration) =>
    decl.members.filter(ts.isPropertySignature).map((m) => (m.name as ts.Identifier).text);
  const data = interfaces.get('BlueprintData');
  if (!data) throw new Error('BlueprintData not found in blueprint.types.ts');
  const shape = new Map<string, Set<string>>();
  for (const member of data.members) {
    if (!ts.isPropertySignature(member) || !member.type || !ts.isTypeReferenceNode(member.type)) continue;
    const section = interfaces.get(member.type.typeName.getText(sf));
    if (section) shape.set((member.name as ts.Identifier).text, new Set(members(section)));
  }
  return shape;
}

/** Every section and field a fixture names exists on BlueprintData. */
function expectRealFixture(fixture: Partial<BlueprintData>) {
  const shape = realBlueprintShape();
  for (const [section, value] of Object.entries(fixture)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    expect(shape.has(section), `fixture section ${section} must be a BlueprintData section`).toBe(true);
    for (const field of Object.keys(value)) {
      expect(shape.get(section)!.has(field), `fixture field ${section}.${field} must exist`).toBe(true);
    }
  }
}

/** A blueprint that answers the tracked fields of the ten genome sections. */
function tenSectionsAnswered(): Partial<BlueprintData> {
  return {
    identity: { name: 'Coral Studio', archetype: 'service', industry: 'design', tagline: 'Islands, drawn', oneLiner: 'Brand design for island businesses', mission: 'Make local brands look world class' },
    operatingModel: { revenueModel: 'project fees', deliveryMode: 'remote', serviceArea: 'Trinidad and Tobago', channels: ['referrals'], teamSize: '2' },
    customerModel: { idealCustomer: 'Owner-run restaurants', segments: ['hospitality'], painPoints: ['dated branding'] },
    workflowModel: { primaryWorkflow: 'enquiry, proposal, deposit, delivery' },
    goals: { northStar: 'Ten retained clients', ninetyDayGoals: ['Launch a portfolio site'], twelveMonthGoals: ['Hire a designer'], priorities: ['Retainers'] },
    financials: { currency: 'TTD', pricingModel: 'fixed project', avgTicket: 0, monthlyTarget: 25000 },
    legalProfile: { country: 'TT', recommendedEntityType: 'SOLE_TRADER', regulatedIndustry: false },
    registrationProfile: { businessNameStatus: 'DONE', companiesRegistryStatus: 'NOT_APPLICABLE', birStatus: 'IN_PROGRESS', nisEmployerStatus: 'NOT_APPLICABLE', vatStatus: 'NOT_APPLICABLE' },
    taxProfile: { country: 'TT', taxIdStatus: 'IN_PROGRESS', payrollExpected: false },
    ownershipProfile: { hasPartners: false, owners: [] },
  };
}

/** The onboarding service over an in-memory blueprint and a scripted model reply. */
function makeChatService(initial: Partial<BlueprintData>, reply: string | Error = 'Great.') {
  let current: BlueprintData = { ...emptyBlueprint(), ...initial };
  const getBlueprint = vi.fn(async () => current);
  const updateBlueprint = vi.fn(async (_businessId: string, patch: BlueprintPatch) => {
    const next: Record<string, unknown> = { ...current };
    for (const [section, fields] of Object.entries(patch)) {
      const before = (current as unknown as Record<string, Record<string, unknown> | undefined>)[section] ?? {};
      next[section] = { ...before, ...(fields as Record<string, unknown>) };
    }
    current = next as unknown as BlueprintData;
    return current;
  });
  const checkThreePillarMinimum = vi.fn(() => false);
  const trackAndComplete = vi.fn(async (..._args: unknown[]) => {
    if (reply instanceof Error) throw reply;
    return { content: reply };
  });
  const svc = new BlueprintOnboardingService(
    { getBlueprint, updateBlueprint, checkThreePillarMinimum } as never,
    {} as never,
    { trackAndComplete } as never,
  );
  return { svc, getBlueprint, updateBlueprint, trackAndComplete };
}

function extractReply(text: string, items: unknown[]): string {
  return `${text}\n\n\`\`\`extract\n${JSON.stringify(items)}\n\`\`\``;
}

const TEN = ['identity', 'offering', 'customer', 'operations', 'growth', 'finance', 'legalProfile', 'registrationProfile', 'taxProfile', 'ownershipProfile'];

function mappedSection(name: string): BlueprintSectionKey {
  return (GENOME_INTAKE_SECTIONS as unknown as Record<string, BlueprintSectionKey>)[name];
}

describe('PR196-GENOME: the interview covers the ten genome sections', () => {
  it('G1 maps each of the ten genome sections to an interview section with real fields', () => {
    expect(Object.keys(GENOME_INTAKE_SECTIONS ?? {}).sort()).toEqual([...TEN].sort());
    const shape = realBlueprintShape();
    for (const name of TEN) {
      const section = mappedSection(name);
      expect(ONBOARDING_SECTION_ORDER, `${name} -> ${section} must be asked`).toContain(section);
      const fields = ONBOARDING_SECTION_FOCUS[section]?.fields ?? [];
      expect(fields.length, `${section} must track fields`).toBeGreaterThan(0);
    }
    // Every section and field the interview tracks exists (the OK-8A-1 class).
    for (const section of ONBOARDING_SECTION_ORDER) {
      expect(shape.has(section), `${section} must be a BlueprintData section`).toBe(true);
      for (const field of ONBOARDING_SECTION_FOCUS[section]?.fields ?? []) {
        expect(shape.get(section)!.has(field), `${section}.${field} must exist`).toBe(true);
      }
    }
  });

  it('G2 a blueprint answering the ten sections on real fields completes all ten', async () => {
    const fixture = tenSectionsAnswered();
    expectRealFixture(fixture);
    const { svc } = makeChatService(fixture);
    const state = await svc.getState('biz_ten');
    const mapped = TEN.map(mappedSection);
    for (const section of mapped) expect(state.completedSections, `${section} must be complete`).toContain(section);
    // The interview moves on to a section outside the ten (founder, market, ...).
    expect(state.currentSection).not.toBeNull();
    expect(mapped).not.toContain(state.currentSection);
  });

  it('G3 a false or 0 answer counts as answered (OK-8A-2)', async () => {
    const fixture: Partial<BlueprintData> = {
      // A solo founder: no partners, so no owners list is owed.
      ownershipProfile: { hasPartners: false, owners: [] },
      // Two of three tracked fields, one of them false.
      legalProfile: { country: 'TT', regulatedIndustry: false },
      taxProfile: { taxIdStatus: 'NOT_STARTED', payrollExpected: false },
      // Three of four tracked fields, one of them 0.
      financials: { currency: 'TTD', pricingModel: 'free consultation first', avgTicket: 0 },
    };
    expectRealFixture(fixture);
    const { svc } = makeChatService(fixture);
    const state = await svc.getState('biz_false');
    for (const section of ['ownershipProfile', 'legalProfile', 'taxProfile', 'financials']) {
      expect(state.completedSections, `${section} must be complete`).toContain(section);
    }
  });

  it('G3b a business with partners still owes the owners list', async () => {
    const fixture: Partial<BlueprintData> = { ownershipProfile: { hasPartners: true, owners: [] } };
    const { svc } = makeChatService(fixture);
    const state = await svc.getState('biz_partners');
    expect(ONBOARDING_SECTION_ORDER).toContain('ownershipProfile');
    expect(state.completedSections).not.toContain('ownershipProfile');
  });

  it('G4 statuses, entity types and yes/no answers from the model are normalized before they are written (OK-8A-4)', async () => {
    const reply = extractReply('Thanks, noted.', [
      { section: 'registrationProfile', field: 'birStatus', value: 'not registered yet', confidence: 0.9 },
      { section: 'registrationProfile', field: 'vatStatus', value: 'Registered last year', confidence: 0.9 },
      { section: 'registrationProfile', field: 'companiesRegistryStatus', value: 'pending with the registry', confidence: 0.9 },
      { section: 'registrationProfile', field: 'nisEmployerStatus', value: 'n/a, no staff', confidence: 0.9 },
      { section: 'taxProfile', field: 'taxIdStatus', value: 'banana', confidence: 0.6 },
      { section: 'legalProfile', field: 'recommendedEntityType', value: 'LLC', confidence: 0.9 },
      { section: 'legalProfile', field: 'regulatedIndustry', value: 'no', confidence: 0.9 },
      { section: 'ownershipProfile', field: 'hasPartners', value: 'No, just me', confidence: 0.9 },
      { section: 'ownershipProfile', field: 'owners', value: ['Alex Moreno'], confidence: 0.9 },
    ]);
    const { svc, updateBlueprint } = makeChatService({}, reply);
    await svc.chat('biz_norm', 'We are not registered with BIR yet.');

    expect(updateBlueprint).toHaveBeenCalledTimes(1);
    const patch = updateBlueprint.mock.calls[0][1] as unknown as Record<string, Record<string, unknown>>;
    expect(patch.registrationProfile).toEqual({
      birStatus: 'NOT_STARTED',
      vatStatus: 'DONE',
      companiesRegistryStatus: 'IN_PROGRESS',
      nisEmployerStatus: 'NOT_APPLICABLE',
    });
    expect(patch.taxProfile).toEqual({ taxIdStatus: 'UNKNOWN' });
    expect(patch.legalProfile).toEqual({ recommendedEntityType: 'LIMITED_COMPANY', regulatedIndustry: false });
    expect(patch.ownershipProfile).toEqual({ hasPartners: false, owners: [{ name: 'Alex Moreno' }] });
  });

  it('G4b every status the normalizer returns is in the vocabulary, and free text never reads as done', () => {
    expect([...(GENOME_STATUS_VOCABULARY ?? [])].sort()).toEqual(['DONE', 'IN_PROGRESS', 'NOT_APPLICABLE', 'NOT_STARTED', 'UNKNOWN']);
    const cases: Array<[unknown, string]> = [
      ['DONE', 'DONE'],
      ['in progress', 'IN_PROGRESS'],
      ['not registered yet', 'NOT_STARTED'],
      ["haven't started", 'NOT_STARTED'],
      ['I don’t have one', 'NOT_STARTED'],
      ['not required', 'NOT_APPLICABLE'],
      ['applied last week', 'IN_PROGRESS'],
      ['yes, registered', 'DONE'],
      ['maybe', 'UNKNOWN'],
      [42, 'UNKNOWN'],
      [null, 'UNKNOWN'],
    ];
    for (const [input, expected] of cases) expect(normalizeGenomeStatus?.(input), String(input)).toBe(expected);
  });

  it('G5 the prompt gives the model the status, entity type and yes/no vocabularies', async () => {
    const { svc, trackAndComplete } = makeChatService({}, 'Hello.');
    await svc.chat('biz_prompt', 'Hi');
    const request = trackAndComplete.mock.calls[0][3] as { messages: Array<{ role: string; content: string }> };
    const system = request.messages.find((m) => m.role === 'system')!.content;
    expect(system).toContain('NOT_STARTED, IN_PROGRESS, DONE, NOT_APPLICABLE, UNKNOWN');
    expect(system).toContain('SOLE_TRADER, PARTNERSHIP, LIMITED_COMPANY, NONPROFIT, UNKNOWN');
    expect(system).toMatch(/hasPartners[^\n]*true or false/);
    for (const section of ['legalProfile', 'registrationProfile', 'taxProfile', 'ownershipProfile']) {
      expect(system).toContain(`- ${section}:`);
    }
  });

  it('G6 a turn that completes the current section moves the focus on (the interview advances in one sitting)', async () => {
    const reply = extractReply('Lovely.', [
      { section: 'identity', field: 'name', value: 'Coral Studio', confidence: 1 },
      { section: 'identity', field: 'industry', value: 'design', confidence: 1 },
      { section: 'identity', field: 'oneLiner', value: 'Brand design for island businesses', confidence: 1 },
      { section: 'identity', field: 'archetype', value: 'service', confidence: 1 },
    ]);
    const { svc } = makeChatService({}, reply);
    const before = await svc.getState('biz_adv');
    expect(before.currentSection).toBe('identity');
    const result = await svc.chat('biz_adv', 'Coral Studio, a design studio for island brands.');
    expect(result.nextSection).not.toBe('identity');
    const after = await svc.getState('biz_adv');
    expect(after.completedSections).toContain('identity');
  });

  it('G7 AI unavailable answers the R0-P 503 and leaves no fallback or dangling turn in the transcript', async () => {
    const { svc } = makeChatService({}, keyDisabledRefusal());
    await svc.getState('biz_off', [{ role: 'assistant', content: 'Welcome back.' }]);
    let thrown: unknown;
    try {
      await svc.chat('biz_off', 'We sell pastries.');
    } catch (err) {
      thrown = err;
    }
    expect(thrown, 'the 503 must reach the caller').toBeDefined();
    expect((thrown as { getStatus?: () => number }).getStatus?.()).toBe(503);
    expect((thrown as { getResponse: () => Record<string, unknown> }).getResponse()).toMatchObject({ code: 'provider_not_configured', service: 'ai' });
    const history = await svc.getHistory('biz_off');
    expect(history.messages).toEqual([{ role: 'assistant', content: 'Welcome back.' }]);
  });
});

describe('PR196-GENOME: the server-side history', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('H1 returns the transcript of the business asked for, and only that one', async () => {
    const { svc } = makeChatService({}, 'Tell me about your customers.');
    await svc.chat('biz_A', 'We are a design studio in Port of Spain.');

    const mine = await svc.getHistory('biz_A');
    expect(mine.messages.map((m) => m.content)).toEqual([
      'We are a design studio in Port of Spain.',
      'Tell me about your customers.',
    ]);

    const other = await svc.getHistory('biz_B');
    expect(other.messages).toEqual([]);
    expect(JSON.stringify(other)).not.toContain('Port of Spain');
  });

  it('H2 reading the history writes no cache entry (a GET has no side effect)', async () => {
    const { svc } = makeChatService({});
    await svc.getHistory('biz_read');
    const cache = (svc as unknown as { stateCache: Map<string, unknown> }).stateCache;
    expect(cache.has('biz_read')).toBe(false);
  });

  it('H3 the transcript is bounded by the cache TTL; progress is rebuilt from the blueprint (OK-8B-4)', async () => {
    const { svc } = makeChatService(tenSectionsAnswered(), 'Noted.');
    await svc.chat('biz_ttl', 'Hello again.');
    expect((await svc.getHistory('biz_ttl')).messages).toHaveLength(2);

    vi.advanceTimersByTime(61 * 60_000);
    const later = await svc.getHistory('biz_ttl');
    expect(later.messages, 'the transcript is not kept past the TTL').toEqual([]);
    expect(later.completedSections).toContain('legalProfile');
    expect(later.completedSections).toContain('ownershipProfile');
  });
});
