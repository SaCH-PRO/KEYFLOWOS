import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexExpertiseLensService } from './key-cortex-expertise-lens.service';
import type { PrismaService } from '../../core/prisma/prisma.service';

function makeService(jobRoleNames: string[] = []) {
  const findMany = vi.fn().mockResolvedValue(jobRoleNames.map((name) => ({ name })));
  const prisma = { client: { jobRole: { findMany } } } as unknown as PrismaService;
  return { service: new KeyCortexExpertiseLensService(prisma), findMany };
}

describe('KeyCortexExpertiseLensService', () => {
  let service: KeyCortexExpertiseLensService;

  beforeEach(() => {
    service = makeService().service;
  });

  describe('discipline selection', () => {
    // One representative task per discipline. These are the contract: if
    // selection changes, these are what should be re-argued.
    const cases: Array<[string, string]> = [
      ['reconcile the supplier invoices against the ledger for March', 'finance'],
      ['which deals in the pipeline are stalled before close', 'sales'],
      ['the newsletter campaign open rate dropped', 'marketing'],
      ['build the shift roster around the stock delivery', 'operations'],
      ['run payroll and handle the leave request backlog', 'people'],
      ['what are our GDPR consent obligations for this contract', 'legal'],
      ['a customer complaint escalated past the SLA', 'support'],
      ['should we expand into a second location or deepen here', 'strategy'],
      ['the connector integration throws an API error on deploy', 'technical'],
    ];

    for (const [task, expected] of cases) {
      it(`routes "${task.slice(0, 40)}..." to ${expected}`, async () => {
        const sel = await service.select(task);
        expect(sel.lens.key).toBe(expected);
        expect(sel.confidence).toBeGreaterThan(0.2);
      });
    }

    it('falls back to generalist when nothing matches, with low confidence', async () => {
      const sel = await service.select('hello there');
      expect(sel.lens.key).toBe('generalist');
      expect(sel.confidence).toBeLessThanOrEqual(0.2);
      expect(sel.rationale).toContain('no discipline signals');
    });

    it('falls back to generalist on empty input rather than throwing', async () => {
      for (const empty of ['', '   ', undefined as unknown as string]) {
        const sel = await service.select(empty);
        expect(sel.lens.key).toBe('generalist');
      }
    });

    it('prefers the discipline with the stronger signal when several appear', async () => {
      // "customer" is a weak sales signal; reconciliation/ledger are strong finance ones.
      const sel = await service.select('reconcile the customer ledger and invoice totals');
      expect(sel.lens.key).toBe('finance');
    });

    it('is deterministic — the same task always yields the same lens', async () => {
      const task = 'why did the invoice reconciliation fail for March';
      const runs = await Promise.all([1, 2, 3].map(() => service.select(task)));
      const keys = new Set(runs.map((r) => r.lens.key));
      expect(keys.size).toBe(1);
    });
  });

  describe('output format', () => {
    it('uses the task shape over the lens default when the task signals one', async () => {
      // strategy defaults to `options`, but "why did" is diagnostic
      const sel = await service.select('why did our market position weaken against the competitor');
      expect(sel.format).toBe('findings');
    });

    it('falls back to the lens default when the task gives no shape signal', async () => {
      const sel = await service.select('the ledger and payable balances for the quarter');
      expect(sel.lens.key).toBe('finance');
      expect(sel.format).toBe('table'); // finance default
    });

    it('maps each format to a distinct instruction in the prompt framing', async () => {
      const seen = new Set<string>();
      for (const task of [
        'reconcile the ledger line by line',
        'should we expand or consolidate',
        'how do i onboard a new staff member',
        'why did the deploy fail',
        'tell me about the business',
      ]) {
        const sel = await service.select(task);
        const framing = service.buildPromptFraming(sel);
        expect(framing).toContain('Present the answer as:');
        seen.add(framing.split('Present the answer as:')[1].trim());
      }
      expect(seen.size).toBeGreaterThan(1);
    });
  });

  describe('prompt framing', () => {
    it('includes the discipline framing and its standard checks', async () => {
      const sel = await service.select('reconcile the ledger');
      const framing = service.buildPromptFraming(sel);
      expect(framing).toContain('finance professional');
      expect(framing).toContain('reconcile');
    });
  });

  describe('business vocabulary', () => {
    it("labels the lens with the business's own JobRole name when one matches", async () => {
      const { service: svc } = makeService(['Head of Operations', 'Barista']);
      const sel = await svc.select('build the shift roster', 'biz_1');
      expect(sel.lens.key).toBe('operations');
      expect(sel.matchedJobRole).toBe('Head of Operations');
      expect(sel.lens.label).toBe('Head of Operations');
    });

    it('keeps the default label when no JobRole matches', async () => {
      const { service: svc } = makeService(['Barista', 'Cleaner']);
      const sel = await svc.select('build the shift roster', 'biz_1');
      expect(sel.matchedJobRole).toBeUndefined();
      expect(sel.lens.label).toBe('Operations');
    });

    it('does not query JobRole at all when no businessId is given', async () => {
      const { service: svc, findMany } = makeService(['Head of Operations']);
      await svc.select('build the shift roster');
      expect(findMany).not.toHaveBeenCalled();
    });

    it('caches JobRole lookups per business', async () => {
      const { service: svc, findMany } = makeService(['Head of Operations']);
      await svc.select('build the shift roster', 'biz_1');
      await svc.select('check stock levels', 'biz_1');
      expect(findMany).toHaveBeenCalledTimes(1);
    });

    it('still returns a lens when the JobRole lookup fails — labelling is cosmetic', async () => {
      const prisma = {
        client: { jobRole: { findMany: vi.fn().mockRejectedValue(new Error('db down')) } },
      } as unknown as PrismaService;
      const svc = new KeyCortexExpertiseLensService(prisma);
      const sel = await svc.select('reconcile the ledger', 'biz_1');
      expect(sel.lens.key).toBe('finance');
      expect(sel.matchedJobRole).toBeUndefined();
    });
  });

  describe('access boundary', () => {
    // The lens is framing only. These guard the decision recorded in
    // docs/design/key-cortex-role-aware-cognition.md §4.
    it('selection does not depend on tenant data — same task, same lens across businesses', async () => {
      const a = makeService(['Head of Finance']).service;
      const b = makeService([]).service;
      const task = 'reconcile the supplier invoices';
      const selA = await a.select(task, 'biz_a');
      const selB = await b.select(task, 'biz_b');
      expect(selA.lens.key).toBe(selB.lens.key);
      expect(selA.format).toBe(selB.format);
    });

    it('exposes no permission, scope or approval-tier field on its output', async () => {
      const sel = await service.select('reconcile the ledger');
      const serialised = JSON.stringify(sel).toLowerCase();
      for (const forbidden of ['permission', 'scope', 'approvaltier', 'role:', 'grant', 'allow']) {
        expect(serialised).not.toContain(forbidden);
      }
    });

    it('prompt framing never instructs the model to bypass or widen access', async () => {
      for (const task of ['reconcile the ledger', 'run payroll', 'review the contract']) {
        const framing = service.buildPromptFraming(await service.select(task));
        const lower = framing.toLowerCase();
        for (const forbidden of ['ignore permission', 'bypass', 'as an admin', 'full access', 'override']) {
          expect(lower).not.toContain(forbidden);
        }
      }
    });
  });
});
