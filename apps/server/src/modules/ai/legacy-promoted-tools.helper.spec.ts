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
      // Missing actor with contactId fails closed (P160 R1 MAJOR-2)
      await expect(
        orchestrator.executeToolAction('biz_1', 'command_create_item', { title: 'Test', contactId: 'c_foreign' }),
      ).rejects.toThrow(/authenticated member context/i);

      // Authenticated OWNER with missing/foreign contactId throws Contact not found
      await expect(
        orchestrator.executeToolAction(
          'biz_1',
          'command_create_item',
          { title: 'Test', contactId: 'c_foreign' },
          { principalUserId: 'u_1' },
        ),
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

  describe('7. P160 R1 security & correctness regression pins (MAJOR-1/2/3 + MINOR-1/2/3)', () => {
    it('fails closed on missing actor for crm_recommend_follow_ups and crm_create_reminder, and binds PLAN_QUEUE plan.userId', async () => {
      const contactFindMany = vi.fn().mockResolvedValue([]);
      const contactFindFirst = vi.fn().mockResolvedValue(null);
      const prisma = {
        client: {
          aiPlan: { findFirst: vi.fn().mockResolvedValue({ userId: 'u_staff_owned' }) },
          user: { findUnique: vi.fn().mockResolvedValue({ id: 'u_staff_owned', role: 'USER' }) },
          membership: {
            findUnique: vi.fn().mockResolvedValue({
              role: 'STAFF',
              permissionScopes: { crm: 'write', crm_view: 'owned', operations: 'write' },
            }),
          },
          contact: { findMany: contactFindMany, findFirst: contactFindFirst },
        },
      } as any;
      const orchestrator = Object.assign(Object.create(FlowOrchestratorService.prototype), {
        prisma,
        governance: { getToolTier: () => 1 },
        executionLog: { logToolExecution: async () => 'log' },
        businessGraph: { invalidateCache() {} },
        attributeExecutionLog: async () => undefined,
        moduleRef: { get: () => undefined },
      });

      await expect(
        orchestrator.executeToolAction('biz_1', 'crm_recommend_follow_ups', {}),
      ).rejects.toThrow(/authenticated member context/i);
      await expect(
        orchestrator.executeToolAction('biz_1', 'crm_create_reminder', { title: 'Call', contactId: 'c_1' }),
      ).rejects.toThrow(/authenticated member context/i);

      // PLAN_QUEUE resolves aiPlan.userId and applies that member's D-37 visibility clause
      await orchestrator.executeToolAction(
        'biz_1',
        'crm_recommend_follow_ups',
        {},
        { surface: 'PLAN_QUEUE', planId: 'plan_1' },
      );
      expect(contactFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            businessId: 'biz_1',
            AND: [expect.objectContaining({ OR: expect.any(Array) })],
          }),
        }),
      );
    });

    it('command_create_item with contactId enforces crm:read for STAFF crm:none and D-140 scoped OWNER before querying Contact', async () => {
      const contactFindFirst = vi.fn();
      const makeOrchestrator = (membership: { role: string; permissionScopes: Record<string, string> | null }) =>
        Object.assign(Object.create(FlowOrchestratorService.prototype), {
          prisma: {
            client: {
              user: { findUnique: vi.fn().mockResolvedValue({ id: 'u_actor', role: 'USER' }) },
              membership: { findUnique: vi.fn().mockResolvedValue(membership) },
              contact: { findFirst: contactFindFirst },
            },
          },
          governance: { getToolTier: () => 1 },
          executionLog: { logToolExecution: async () => 'log' },
          businessGraph: { invalidateCache() {} },
          attributeExecutionLog: async () => undefined,
          moduleRef: { get: () => undefined },
        });

      const staffNoCrm = makeOrchestrator({ role: 'STAFF', permissionScopes: { operations: 'write', crm: 'none' } });
      await expect(
        staffNoCrm.executeToolAction(
          'biz_1',
          'command_create_item',
          { title: 'Ping', contactId: 'c_1' },
          { principalUserId: 'u_actor' },
        ),
      ).rejects.toThrow(/crm:read/i);

      const d140OwnerNoCrm = makeOrchestrator({ role: 'OWNER', permissionScopes: { operations: 'write', crm: 'none' } });
      await expect(
        d140OwnerNoCrm.executeToolAction(
          'biz_1',
          'command_create_item',
          { title: 'Ping', contactId: 'c_1' },
          { principalUserId: 'u_actor' },
        ),
      ).rejects.toThrow(/crm:read/i);
      expect(contactFindFirst).not.toHaveBeenCalled();
    });

    it('RoleEngineService reaches command_create_item; JobRolePolicyService blocks STAFF_BRIDGE wildcard bypasses; graphActionRequirement deduplicates scopes and marks visibility-bound tools', async () => {
      const { RoleEngineService } = await import('./role-engine.service');
      const { EXTRA_SCOPED_GOVERNED_TOOLS, JobRolePolicyService } = await import('../structure/job-role-policy.service');
      const { graphActionBoundByContactVisibility, graphActionRequirement } = await import('./graph-actions.controller');

      const roleEngine = new RoleEngineService();
      expect(roleEngine.isToolAllowed('general', 'command_create_item')).toBe(true);

      // Every promoted Prisma-backed tool is in EXTRA_SCOPED_GOVERNED_TOOLS so family wildcards cannot grant it
      for (const tool of [
        'finance_list_overdue_invoices',
        'finance_create_invoice_reminder_draft',
        'commerce_summarize_revenue',
        'crm_recommend_follow_ups',
        'crm_create_reminder',
      ]) {
        expect(EXTRA_SCOPED_GOVERNED_TOOLS.has(tool), tool).toBe(true);
      }

      const policy = new JobRolePolicyService({ client: {} } as any);
      const crmReadEnv = policy.envelopeForJobRole({ id: 'r1', name: 'CRM Read', permissions: { crm: 'read', crm_view: 'owned' } as any });
      expect(policy.isToolAllowed(crmReadEnv, 'crm_create_reminder')).toBe(false);
      expect(policy.isToolAllowed(crmReadEnv, 'crm_recommend_follow_ups')).toBe(false);
      const legacyFinanceEnv = policy.envelopeForJobRole({ id: 'r2', name: 'Legacy Fin', permissions: { finance: 'read', commerce: 'read', sales: 'read' } as any });
      expect(policy.isToolAllowed(legacyFinanceEnv, 'finance_list_overdue_invoices')).toBe(false);
      expect(policy.isToolAllowed(legacyFinanceEnv, 'commerce_summarize_revenue')).toBe(false);

      // Deduplicated scopes + visibility-bound flags on crm_create_reminder and command_create_item
      const revReq = graphActionRequirement('finance_list_overdue_invoices');
      expect(revReq && 'scopes' in revReq ? revReq.scopes : []).toEqual([{ module: 'revenue', minLevel: 'read' }]);
      expect(graphActionBoundByContactVisibility('crm_create_reminder')).toBe(true);
      expect(graphActionBoundByContactVisibility('command_create_item')).toBe(true);
      const remReq = graphActionRequirement('crm_create_reminder');
      expect(remReq && 'ownerOnlyWithoutPrincipal' in remReq && Boolean(remReq.ownerOnlyWithoutPrincipal)).toBe(true);
    });
  });
});
