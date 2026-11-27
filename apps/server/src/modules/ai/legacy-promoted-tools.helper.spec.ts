/**
 * P160 (RR-LEGACY-FALLBACK-REMOVE): focused unit tests for each of the 6
 * v1-kept legacy tools promoted to canonical FLOW_TOOLS:
 *   1. finance_list_overdue_invoices (listSentOverdueInvoices)
 *   2. finance_create_invoice_reminder_draft (createSentOverdueInvoiceReminderDraft)
 *   3. commerce_summarize_revenue (summarizePaidRevenue)
 *   4. crm_recommend_follow_ups (recommendStaleFollowUps)
 *   5. crm_create_reminder (createReminderTask)
 *   6. command_create_item (FlowOrchestratorService handler)
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createReminderTask,
  createSentOverdueInvoiceReminderDraft,
  listSentOverdueInvoices,
  recommendStaleFollowUps,
  summarizePaidRevenue,
} from './legacy-promoted-tools.helper';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { CommandService } from '../command/command.service';

describe('P160 promoted canonical tool specs (all 6 tools)', () => {
  describe('1. finance_list_overdue_invoices (listSentOverdueInvoices)', () => {
    it('rejects invalid/non-positive/boolean limits and returns empty summary for blank businessId', async () => {
      const prisma = { client: {} } as any;
      for (const bad of [0, -5, Infinity, NaN, 'abc', true]) {
        await expect(listSentOverdueInvoices(prisma, 'biz_1', bad)).rejects.toThrow(/limit/i);
      }
      await expect(listSentOverdueInvoices(prisma, '')).resolves.toEqual({
        invoices: [],
        total: 0,
        currency: 'TTD',
        totalsByCurrency: {},
      });
    });
  });

  describe('2. finance_create_invoice_reminder_draft (createSentOverdueInvoiceReminderDraft)', () => {
    it('requires invoiceId, allowlists tone (rejecting prototype keys), and refuses PENDING invoices', async () => {
      const prisma = {
        client: {
          invoice: {
            findFirst: vi.fn().mockResolvedValue({
              id: 'inv_pending',
              invoiceNumber: 'INV-1',
              status: 'PENDING',
              total: 500,
              currency: 'TTD',
              dueDate: new Date(Date.now() - 10 * 86400000),
              contact: null,
              payments: [],
            }),
          },
        },
      } as any;

      await expect(createSentOverdueInvoiceReminderDraft(prisma, 'biz_1', '')).rejects.toThrow(/invoiceId/i);
      for (const badTone of ['toString', 'constructor', '__proto__', 'harsh']) {
        await expect(
          createSentOverdueInvoiceReminderDraft(prisma, 'biz_1', 'inv_pending', badTone),
        ).rejects.toThrow(/tone/i);
      }
      await expect(
        createSentOverdueInvoiceReminderDraft(prisma, 'biz_1', 'inv_pending', 'friendly'),
      ).rejects.toThrow(/status PENDING/);
    });
  });

  describe('3. commerce_summarize_revenue (summarizePaidRevenue)', () => {
    it('aggregates PAID non-deleted invoices scoped to businessId with currency fallback', async () => {
      const prisma = {
        client: {
          invoice: {
            aggregate: vi.fn().mockResolvedValue({ _sum: { total: 4250 } }),
            count: vi.fn().mockResolvedValue(3),
            findFirst: vi.fn().mockResolvedValue({ currency: 'USD' }),
          },
        },
      } as any;

      const res = await summarizePaidRevenue(prisma, 'biz_1');
      expect(res).toEqual({ totalRevenue: 4250, paidInvoiceCount: 3, currency: 'USD' });
      expect(prisma.client.invoice.aggregate).toHaveBeenCalledWith({
        where: { businessId: 'biz_1', deletedAt: null, status: 'PAID' },
        _sum: { total: true },
      });
    });
  });

  describe('4. crm_recommend_follow_ups (recommendStaleFollowUps)', () => {
    it('applies caller CRM visibility clause, deterministic id tie-breaker, and validates inputs', async () => {
      const staleDate = new Date(Date.now() - 25 * 86400000);
      const findMany = vi.fn().mockResolvedValue([
        {
          id: 'c_1',
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.test',
          status: 'ACTIVE',
          lastInteractionAt: staleDate,
        },
      ]);
      const prisma = { client: { contact: { findMany } } } as any;
      const visClause = { OR: [{ visibility: { in: ['TEAM', 'SHARED'] } }, { ownerId: 'user_1' }] };

      const res = await recommendStaleFollowUps(prisma, 'biz_1', 14, 5, visClause as any);
      expect(res.count).toBe(1);
      expect(res.contacts[0]).toMatchObject({ id: 'c_1', name: 'Ada Lovelace', email: 'ada@example.test' });
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            businessId: 'biz_1',
            deletedAt: null,
            AND: [visClause],
          }),
          orderBy: [{ lastInteractionAt: 'asc' }, { id: 'asc' }],
          take: 5,
        }),
      );

      await expect(recommendStaleFollowUps(prisma, 'biz_1', -1, 5)).rejects.toThrow(/daysStale/i);
      await expect(recommendStaleFollowUps(prisma, 'biz_1', 14, 0)).rejects.toThrow(/limit/i);
    });
  });

  describe('5. crm_create_reminder (createReminderTask)', () => {
    it('requires title and contactId, validates dueDate, and refuses invisible/foreign contactId', async () => {
      const contactFindFirst = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'c_own' });
      const taskCreate = vi.fn().mockResolvedValue({ id: 'task_1' });
      const prisma = {
        client: {
          contact: { findFirst: contactFindFirst },
          contactTask: { create: taskCreate },
        },
      } as any;

      await expect(createReminderTask(prisma, 'biz_1', '   ', 'c_own')).rejects.toThrow(/title is required/i);
      await expect(createReminderTask(prisma, 'biz_1', 'Review ledger')).rejects.toThrow(/contactId is required/i);
      await expect(createReminderTask(prisma, 'biz_1', 'Call back', 'c_own', 'not-a-date')).rejects.toThrow(/dueDate/i);

      // Foreign/hidden contactId refused before creating ContactTask
      const visClause = { ownerId: 'user_1' };
      await expect(
        createReminderTask(prisma, 'biz_1', 'Call private', 'c_hidden', undefined, visClause as any),
      ).rejects.toThrow(/Contact not found/i);
      expect(contactFindFirst).toHaveBeenCalledWith({
        where: { id: 'c_hidden', businessId: 'biz_1', deletedAt: null, AND: [visClause] },
        select: { id: true },
      });

      // Visible own-tenant contactId succeeds
      await expect(
        createReminderTask(prisma, 'biz_1', 'Call visible', 'c_own', '2026-12-01T10:00:00.000Z', visClause as any),
      ).resolves.toEqual({ reminderId: 'task_1' });
    });
  });

  describe('6. command_create_item (FlowOrchestratorService handler)', () => {
    it('validates title/category/dueAt/contact visibility and delegates to CommandService.create', async () => {
      const commandCreate = vi.fn().mockResolvedValue({ id: 'ci_1' });
      const contactFindFirst = vi.fn().mockResolvedValue(null);
      const prisma = {
        client: {
          contact: { findFirst: contactFindFirst },
          membership: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER', permissionScopes: null }) },
          user: { findUnique: vi.fn().mockResolvedValue({ id: 'u_1', role: 'USER' }) },
        },
      } as any;
      const orchestrator = Object.assign(Object.create(FlowOrchestratorService.prototype), {
        prisma,
        governance: { getToolTier: () => 1 },
        executionLog: { logToolExecution: async () => 'log' },
        businessGraph: { invalidateCache() {} },
        attributeExecutionLog: async () => undefined,
        moduleRef: { get: (tok: unknown) => (tok === CommandService ? { create: commandCreate } : undefined) },
      });

      await expect(orchestrator.executeToolAction('biz_1', 'command_create_item', {})).rejects.toThrow(/title/i);
      await expect(
        orchestrator.executeToolAction('biz_1', 'command_create_item', { title: 'Test', category: 'BOGUS' }),
      ).rejects.toThrow(/category/i);
      await expect(
        orchestrator.executeToolAction('biz_1', 'command_create_item', { title: 'Test', dueAt: 'not-a-date' }),
      ).rejects.toThrow(/dueAt/i);
      await expect(
        orchestrator.executeToolAction('biz_1', 'command_create_item', { title: 'Test', contactId: 'c_foreign' }),
      ).rejects.toThrow(/Contact not found/i);

      const created = await orchestrator.executeToolAction('biz_1', 'command_create_item', {
        title: 'Chase overdue invoice',
        category: 'MONEY',
        description: 'Follow up with Nadia',
      });
      expect(created).toEqual({ commandItemId: 'ci_1' });
      expect(commandCreate).toHaveBeenCalledWith(
        'biz_1',
        expect.objectContaining({
          title: 'Chase overdue invoice',
          category: 'MONEY',
          description: 'Follow up with Nadia',
          actionType: 'KEY_CREATED',
          sourceModule: 'KEY_AI',
        }),
      );
    });
  });
});
