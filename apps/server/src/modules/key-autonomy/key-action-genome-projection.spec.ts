/**
 * FU-KEY-ACTION-GENOME-PROJECTION round 2 (correctness MINOR-1): the classifier's branches the integration test does
 * not reach. Prisma is a stand-in here; the integration test (key-action-genome-projection) runs them on the database.
 */
import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import {
  isFinancialGenomeEvolution,
  isGenomeEvolutionEvent,
  readableGenomeEvolutionEvents,
  requireBridgeRevenue,
} from './key-action-genome-projection';

const BIZ = 'biz_1';
const opsRow = { id: 'evo_ops', section: 'operations', reason: 'Bookings are handled through WhatsApp', proposedPatch: { coreWorkflows: ['appointment-booking'] }, evidence: [] };
const opsEvent = {
  entityType: 'genome_evolution_proposal', entityId: 'evo_ops', type: 'genome_evolution.proposal_rejected',
  title: 'Genome evolution proposal rejected', summary: 'operations proposal rejected: Bookings are handled through WhatsApp',
  payload: { proposalId: 'evo_ops', section: 'operations', status: 'REJECTED', proposedPatch: { coreWorkflows: ['appointment-booking'] } },
};
const prismaWith = (findMany: (...a: any[]) => any) => ({ client: { genomeEvolutionProposal: { findMany: vi.fn(findMany) } } }) as any;

describe('isFinancialGenomeEvolution', () => {
  it('withholds the financial and sales sections, an unknown or missing section, and no row', () => {
    for (const section of ['financial', 'sales', 'Finance', 'treasury', '', undefined, 42]) {
      expect(isFinancialGenomeEvolution({ ...opsRow, section }), String(section)).toBe(true);
    }
    expect(isFinancialGenomeEvolution(null)).toBe(true);
  });

  it('withholds a non-money section whose reason, patch or evidence alone states money', () => {
    expect(isFinancialGenomeEvolution({ ...opsRow, reason: 'Overtime cost TTD 912 last week' })).toBe(true);
    expect(isFinancialGenomeEvolution({ ...opsRow, proposedPatch: { revenueModel: 'retainer' } })).toBe(true);
    expect(isFinancialGenomeEvolution({ ...opsRow, evidence: ['Invoices of TTD 4,500 are overdue'] })).toBe(true);
  });

  it('round 4 (security A1): withholds a patch that holds a bare figure (a blueprint money field, a target)', () => {
    for (const proposedPatch of [{ monthlyTarget: 50000 }, { avgTicket: 350 }, { ninetyDayGoals: ['Hit 120k this quarter'] }, { goals: [{ target: 12.5 }] }]) {
      expect(isFinancialGenomeEvolution({ ...opsRow, section: 'growth', proposedPatch }), JSON.stringify(proposedPatch)).toBe(true);
    }
  });

  it('round 5 (security MAJOR-1): withholds a reason that holds a bare figure', () => {
    for (const reason of ['Hit 120k this quarter', 'Average ticket rose to 350', 'Takings were 9,800 last week', 'Turnover reached 2.4m']) {
      expect(isFinancialGenomeEvolution({ ...opsRow, section: 'growth', reason }), reason).toBe(true);
    }
  });

  it('round 4: serves the rows the genome-evolution generator writes (its evidence counts events)', () => {
    for (const [section, proposedPatch, reason] of [
      ['marketing', { channels: ['WhatsApp'] }, 'WhatsApp appears to be a meaningful acquisition source.'],
      ['operations', { coreWorkflows: ['appointment-booking'] }, 'Rising booking volume suggests operations workflows are material.'],
      ['risk', { operationalRisks: ['Asset expiry reminders detected'] }, 'Expiring assets indicate active risk management needs.'],
    ] as const) {
      expect(isFinancialGenomeEvolution({ section, proposedPatch, reason, evidence: ['5 booking events detected.'] }), section).toBe(false);
    }
  });

  it('serves a neutral row of each listed non-money section (case and spaces folded)', () => {
    for (const section of ['founder', 'vision', 'business', 'market', 'legal', 'operations', 'marketing', 'growth', 'technology', 'risk', ' Operations ']) {
      expect(isFinancialGenomeEvolution({ ...opsRow, section }), section).toBe(false);
    }
  });
});

describe('isGenomeEvolutionEvent', () => {
  it('matches by entity type or by a genome_evolution.* type', () => {
    expect(isGenomeEvolutionEvent({ entityType: 'genome_evolution_proposal', type: 'x' })).toBe(true);
    expect(isGenomeEvolutionEvent({ entityType: 'other', type: 'genome_evolution.proposal_edited' })).toBe(true);
    expect(isGenomeEvolutionEvent({ entityType: 'key_action_proposal', type: 'key.action.create_task' })).toBe(false);
  });
});

describe('readableGenomeEvolutionEvents', () => {
  it('reads the proposals in the business only, in one query, and serves a neutral row', async () => {
    const prisma = prismaWith(async () => [opsRow]);
    expect(await readableGenomeEvolutionEvents(prisma, BIZ, [opsEvent])).toEqual([true]);
    expect(prisma.client.genomeEvolutionProposal.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.client.genomeEvolutionProposal.findMany.mock.calls[0][0].where).toEqual({ businessId: BIZ, id: { in: ['evo_ops'] } });
  });

  it('withholds every row when the read fails', async () => {
    const prisma = prismaWith(async () => { throw new Error('db down'); });
    expect(await readableGenomeEvolutionEvents(prisma, BIZ, [opsEvent, opsEvent])).toEqual([false, false]);
  });

  it('withholds a row with no proposal id, or matched only by its type with no proposal behind it', async () => {
    const prisma = prismaWith(async () => [opsRow]);
    const typed = { ...opsEvent, entityType: 'manual', entityId: 'evo_missing' };
    expect(await readableGenomeEvolutionEvents(prisma, BIZ, [{ ...opsEvent, entityId: null }, typed])).toEqual([false, false]);
  });

  it("withholds a row whose own text, payload section, patch or signals state money though its proposal is neutral", async () => {
    const prisma = prismaWith(async () => [opsRow]);
    const variants = [
      // Round 5: a bare figure in the row's own summary or description.
      { ...opsEvent, summary: 'operations proposal rejected: Hit 120k this quarter' },
      { ...opsEvent, description: 'Takings were 9,800 last week' },
      { ...opsEvent, summary: 'operations proposal rejected: Overtime cost TTD 912' },
      { ...opsEvent, title: 'Net margin proposal rejected' },
      { ...opsEvent, payload: { ...opsEvent.payload, section: 'financial' } },
      { ...opsEvent, payload: { ...opsEvent.payload, proposedPatch: { pricingModel: 'retainer' } } },
      { ...opsEvent, signals: { revenueImpact: 'TTD 4,500' } },
    ];
    expect(await readableGenomeEvolutionEvents(prisma, BIZ, variants)).toEqual(variants.map(() => false));
  });
});

describe('requireBridgeRevenue', () => {
  const reader = { id: 'u1', role: 'USER' };
  it('throws when the recommendation read fails (fail closed)', async () => {
    const prisma = { client: { genomeRecommendation: { findFirst: vi.fn(async () => { throw new Error('db down'); }) } } } as any;
    await expect(requireBridgeRevenue(prisma, BIZ, 'rec_1', reader, 'read')).rejects.toThrow('db down');
  });

  it('leaves an unknown recommendation to the bridge service, and a non-financial one ungated', async () => {
    const missing = { client: { genomeRecommendation: { findFirst: vi.fn(async () => null) }, membership: { findUnique: vi.fn() } } } as any;
    await expect(requireBridgeRevenue(missing, BIZ, 'rec_x', reader, 'write')).resolves.toBeUndefined();
    expect(missing.client.membership.findUnique).not.toHaveBeenCalled();
    const ops = { client: { genomeRecommendation: { findFirst: vi.fn(async () => ({ domain: 'OPERATIONS', title: 'Confirm appointments', diagnosis: 'Three are unconfirmed.' })) }, membership: { findUnique: vi.fn() } } } as any;
    await expect(requireBridgeRevenue(ops, BIZ, 'rec_o', reader, 'write')).resolves.toBeUndefined();
  });

  it('refuses a FINANCIAL recommendation to a reader with no membership, or no reader at all', async () => {
    const fin = { client: { genomeRecommendation: { findFirst: vi.fn(async () => ({ domain: 'FINANCIAL', title: 'Tighten cadence', diagnosis: 'x' })) }, membership: { findUnique: vi.fn(async () => null) } } } as any;
    await expect(requireBridgeRevenue(fin, BIZ, 'rec_f', reader, 'read')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(requireBridgeRevenue(fin, BIZ, 'rec_f', undefined, 'read')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
