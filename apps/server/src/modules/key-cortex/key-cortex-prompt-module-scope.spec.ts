/**
 * W1F-PERCEPTION-MODULE-SCOPE (V1-70; review SEC-W11FPS-3; D-71/D-146, D-57): the business-wide event stores
 * (business_events, cognitive_events) are projected by the reader's module levels in every prompt's memory read
 * (readersOwnPromptMemory: the /ai flow chat's perception block and POST /cortex/chat's buildMemoryContext; the
 * pipeline's chatMemoryFragments).
 *
 * An event names its module by its type, its subject (business_events) or its source (cognitive_events): money
 * (expense.*, bill.*, receipt.*, budget.* at expenses; payment.*, invoice.*, quote.*, refund.*, revenue_action.*,
 * the Books and the bank at revenue), and the other modules REST guards (crm, bookings, projects, operations,
 * storefront, content, automations, team). The reader sees it only with read on each module it names, read as
 * ModuleScopeGuard reads a membership (memberModuleLevel: an explicit map, an array included, else the role's
 * defaults). No reader (no member, a membership check that failed) has no module. An event that names no module, and a
 * GOVERNANCE_DECISION proposal (business-wide, by the packet's instruction), stays for every reader.
 *
 * Real-DB proof over the HTTP routes: test/perception-module-scope.integration.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readersOwnPromptMemory } from './key-cortex-prompt-context.service';

type Fragment = { id: string; sourceType: string; title: string; entityType?: string | null; metadata?: Record<string, unknown> };

const MEMBERSHIPS: Record<string, { role: string; permissionScopes: unknown }> = {
  blind: {
    role: 'STAFF',
    permissionScopes: { crm: 'read', bookings: 'read', projects: 'read', operations: 'read', storefront: 'read', content: 'read', automations: 'read', expenses: 'none', revenue: 'none' },
  },
  revenueOnly: { role: 'STAFF', permissionScopes: { crm: 'read', revenue: 'read', expenses: 'none' } },
  staff: { role: 'STAFF', permissionScopes: null },
  owner: { role: 'OWNER', permissionScopes: null },
  /** ModuleScopeGuard reads a stored array as an explicit map in which every module is none (SEC-P195-2). */
  arrayMap: { role: 'ADMIN', permissionScopes: [] },
};

const prisma = {
  client: {
    membership: {
      findUnique: vi.fn(async ({ where }: { where: { userId_businessId: { userId: string; businessId: string } } }) =>
        where.userId_businessId.businessId === 'biz_1' ? MEMBERSHIPS[where.userId_businessId.userId] ?? null : null,
      ),
    },
    cognitionMemory: { findMany: vi.fn(async () => []) },
  },
};

const be = (id: string, title: string, entityType: string | null = null): Fragment => ({ id, sourceType: 'business_event', title, entityType });
const ce = (id: string, title: string, source?: string): Fragment => ({ id, sourceType: 'cognitive_event', title, metadata: source ? { sourceType: source } : undefined });

/** Each fragment, and the modules a reader needs read on to see it ([] = business-wide). */
const TABLE: Array<[Fragment, string[]]> = [
  // Money at expenses (D-146).
  [be('be_expense', 'expense.created', 'Expense'), ['expenses']],
  [ce('ce_expense', 'expense.created', 'expenses'), ['expenses']],
  [be('be_bill', 'bill.created', 'KEY_CORTEX_EVENT'), ['expenses']],
  [be('be_receipt', 'receipt.uploaded', 'Receipt'), ['expenses']],
  [be('be_budget', 'budget.threshold_reached', 'Budget'), ['expenses']],
  [ce('ce_budget', 'budget.threshold_reached', 'budget'), ['expenses']],
  // Money at revenue (D-57).
  [be('be_payment', 'payment.received', 'KEY_CORTEX_EVENT'), ['revenue']],
  [ce('ce_payment', 'payment.received', 'payment'), ['revenue']],
  [be('be_invoice', 'invoice.paid', 'Invoice'), ['revenue']],
  [be('be_invoice_us', 'invoice_paid', 'invoice'), ['revenue']],
  [be('be_watch', 'proactive.invoice_overdue', 'Invoice'), ['revenue']],
  [ce('ce_watch', 'proactive.invoice_overdue', 'proactive_watcher'), ['revenue']],
  [be('be_ra', 'revenue_action.created', 'RevenueAction'), ['revenue']],
  [be('be_recurring', 'recurring_invoice.generated', 'RecurringInvoice'), ['revenue']],
  [be('be_quote', 'quote.accepted', 'Quote'), ['revenue']],
  [be('be_refund', 'refund.issued', 'KEY_CORTEX_EVENT'), ['revenue']],
  [be('be_deposit', 'deposit.received', 'KEY_CORTEX_EVENT'), ['revenue']],
  [be('be_txn', 'transaction.imported', 'KEY_CORTEX_EVENT'), ['revenue']],
  [be('be_bank', 'bank.synced', 'KEY_CORTEX_EVENT'), ['revenue']],
  [be('be_recon', 'reconciliation.completed', 'KEY_CORTEX_EVENT'), ['revenue']],
  // A ledger row names its subject: an upper-case event type of an invoice or a payment is still money.
  [be('be_ledger_pay', 'payment.record', 'payment'), ['revenue']],
  [be('be_ledger_inv', 'ENTITY_UPDATED', 'invoice'), ['revenue']],
  // A cognitive event names its source: commerce's own event is money even when its type names nothing.
  [ce('ce_commerce', 'stats.refreshed', 'commerce'), ['revenue']],
  // The other modules REST guards.
  [be('be_contact', 'contact.created', 'Contact'), ['crm']],
  [ce('ce_deal', 'deal.won', 'crm'), ['crm']],
  [be('be_booking', 'booking.created', 'Booking'), ['bookings']],
  [be('be_project', 'project.created', 'Project'), ['projects']],
  [be('be_ticket', 'supportTicket.created', 'SupportTicket'), ['operations']],
  [ce('ce_inbox', 'message.received', 'key_inbox'), ['operations']],
  [be('be_order', 'order.created', 'MarketplaceOrder'), ['storefront']],
  [be('be_campaign', 'campaign.sent', 'Campaign'), ['content']],
  [be('be_employee', 'employee.hired', 'Employee'), ['team']],
  [be('be_autopilot', 'autopilot.task.created', 'Task'), ['automations', 'projects']],
  // Business-wide: names no module, or a proposal (kept business-wide).
  [be('be_governance', 'GOVERNANCE_DECISION', 'key_action_proposal'), []],
  [ce('ce_governance', 'GOVERNANCE_DECISION', 'ai'), []],
  [be('be_insight', 'insight.generated', 'KEY_CORTEX_EVENT'), []],
  [ce('ce_sentiment', 'proactive.negative_sentiment', 'proactive_watcher'), []],
];

/** What each reader may read, by the memberships above (ModuleScopeGuard's reading). */
const READS: Record<string, (module: string) => boolean> = {
  blind: (x) => ['crm', 'bookings', 'projects', 'operations', 'storefront', 'content', 'automations'].includes(x),
  revenueOnly: (x) => ['crm', 'revenue'].includes(x),
  // STAFF role defaults: read on everything but settings, team, ai and connect.
  staff: (x) => !['settings', 'team', 'ai', 'connect'].includes(x),
  owner: () => true,
  arrayMap: () => false,
};

async function keptFor(reader: string | null): Promise<Set<string>> {
  const fragments = TABLE.map(([f]) => f);
  const kept = await readersOwnPromptMemory(prisma as any, 'biz_1', reader, fragments as any, 1000);
  return new Set(kept.map((f) => f.id));
}

describe('W1F-PERCEPTION-MODULE-SCOPE: readersOwnPromptMemory projects the business-wide event stores by the reader\'s module levels', () => {
  beforeEach(() => {
    prisma.client.membership.findUnique.mockClear();
  });

  for (const reader of Object.keys(READS)) {
    it(`${reader}: an event renders only with read on every module it names; business-wide events always render`, async () => {
      const kept = await keptFor(reader);
      for (const [fragment, modules] of TABLE) {
        const visible = modules.every((x) => READS[reader](x));
        expect(kept.has(fragment.id), `${reader}: ${fragment.sourceType} ${fragment.title} (${fragment.entityType ?? fragment.metadata?.sourceType ?? '-'}) needs [${modules.join(', ')}]`).toBe(visible);
      }
    });
  }

  it('no reader (no member) has no module: only the business-wide events render, and no membership is read for nobody', async () => {
    const kept = await keptFor(null);
    for (const [fragment, modules] of TABLE) expect(kept.has(fragment.id), fragment.id).toBe(modules.length === 0);
    expect(prisma.client.membership.findUnique).not.toHaveBeenCalled();
  });

  it('a reader with no membership in the business (a SUPER_ADMIN, a removed member) has no module', async () => {
    const kept = await keptFor('stranger');
    for (const [fragment, modules] of TABLE) expect(kept.has(fragment.id), fragment.id).toBe(modules.length === 0);
  });

  it('a membership read that fails reads as no module (fail closed), and does not fail the prompt', async () => {
    prisma.client.membership.findUnique.mockRejectedValueOnce(new Error('connection reset'));
    const warn = vi.fn();
    const kept = await readersOwnPromptMemory(prisma as any, 'biz_1', 'owner', TABLE.map(([f]) => f) as any, 1000, { warn });
    expect(kept.map((f) => f.id).sort()).toEqual(TABLE.filter(([, modules]) => modules.length === 0).map(([f]) => f.id).sort());
    expect(warn).toHaveBeenCalled();
  });

  it('the projection reads one membership per prompt, of the reader in this business', async () => {
    await keptFor('blind');
    expect(prisma.client.membership.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.client.membership.findUnique.mock.calls[0][0]).toMatchObject({ where: { userId_businessId: { userId: 'blind', businessId: 'biz_1' } } });
  });

  it('the stores that are not events (ai_memory, genome, temporal flow, episodic rows) are not projected by module', async () => {
    const others: Fragment[] = [
      { id: 'mem', sourceType: 'ai_memory', title: 'fact' },
      { id: 'genome', sourceType: 'genome_memory_event', title: 'FINANCE_SNAPSHOT_COMPUTED' },
      { id: 'temporal', sourceType: 'temporal_flow_memory', title: 'invoice' },
      { id: 'exec', sourceType: 'ai_execution_log', title: 'invoice.create' },
      { id: 'action', sourceType: 'cortex_action_log', title: 'payment.record' },
    ];
    const kept = await readersOwnPromptMemory(prisma as any, 'biz_1', 'blind', others as any, 1000);
    expect(kept.map((f) => f.id)).toEqual(['mem', 'genome', 'temporal', 'exec', 'action']);
  });

  it('a GOVERNANCE_DECISION record stays business-wide even when its subject or source names a module (the packet keeps proposals business-wide)', async () => {
    const fragments = [be('gov_subject', 'GOVERNANCE_DECISION', 'invoice'), ce('gov_source', 'GOVERNANCE_DECISION', 'commerce')];
    for (const reader of [null, 'blind', 'arrayMap']) {
      const kept = await readersOwnPromptMemory(prisma as any, 'biz_1', reader, fragments as any, 1000);
      expect(kept.map((f) => f.id), String(reader)).toEqual(['gov_subject', 'gov_source']);
    }
  });

  it('no membership is read when no event names a module', async () => {
    const fragments = [be('gov', 'GOVERNANCE_DECISION', 'key_action_proposal'), be('insight', 'insight.generated', 'KEY_CORTEX_EVENT'), { id: 'mem', sourceType: 'ai_memory', title: 'fact' }];
    const kept = await readersOwnPromptMemory(prisma as any, 'biz_1', 'blind', fragments as any, 1000);
    expect(kept.map((f) => f.id)).toEqual(['gov', 'insight', 'mem']);
    expect(prisma.client.membership.findUnique).not.toHaveBeenCalled();
  });

  it('the window is cut after the projection, so a refused event does not take a line of it', async () => {
    const fragments = [be('a', 'expense.created', 'Expense'), be('b', 'payment.received'), { id: 'mem', sourceType: 'ai_memory', title: 'fact' }];
    const kept = await readersOwnPromptMemory(prisma as any, 'biz_1', 'blind', fragments as any, 1);
    expect(kept.map((f) => f.id)).toEqual(['mem']);
  });
});
