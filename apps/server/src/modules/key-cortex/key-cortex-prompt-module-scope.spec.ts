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
 *
 * Review repair (SEC-W1FPMS-1, COR-W1FPMS-1): a record that names no module no longer fails open. It needs read on
 * every module an event can name (only GOVERNANCE_DECISION stays business-wide), the families the bridge forwards
 * that named nothing are classified by the data they carry (a document, a file or an ingestion item carries the
 * figures read off an invoice or a receipt: revenue and expenses; a vendor: expenses; a claim: revenue), and a task
 * is filed by its own type (a ContactTask at crm, a ProjectTask at projects, an autopilot task at automations), not
 * by the bare word. The census at the end walks every family EventEmitterFlowBridgeService forwards and every type
 * the KEY bus is handed by its publishers, as they land in both stores.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eventModulesOf, isPersonalKeyRecord, moduleSightOf, readersOwnPromptMemory } from './key-cortex-prompt-context.service';
import { EventEmitterFlowBridgeService } from './event-emitter-flow-bridge.service';

type Fragment = {
  id: string;
  sourceType: string;
  title: string;
  entityType?: string | null;
  metadata?: Record<string, unknown>;
  content?: string;
};

const MEMBERSHIPS: Record<string, { role: string; permissionScopes: unknown }> = {
  blind: {
    role: 'STAFF',
    permissionScopes: { crm: 'read', bookings: 'read', projects: 'read', operations: 'read', storefront: 'read', content: 'read', automations: 'read', expenses: 'none', revenue: 'none' },
  },
  revenueOnly: { role: 'STAFF', permissionScopes: { crm: 'read', revenue: 'read', expenses: 'none' } },
  /**
   * Review SEC-W1FPMS-1 (mutation gap): reads expenses but not revenue, so a document's extraction (revenue and
   * expenses) is told apart from an expense-only record.
   */
  expensesOnly: { role: 'STAFF', permissionScopes: { crm: 'read', expenses: 'read', revenue: 'none' } },
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

/**
 * A business_events row as UnifiedMemoryRetrievalService hands it over: title the event type, entityType the subject,
 * metadata.after the payload the bus wrote (KeyCortexEventBusService.persistAudit).
 */
const be = (id: string, title: string, entityType: string | null = null, after?: Record<string, unknown>): Fragment => ({
  id,
  sourceType: 'business_event',
  title,
  entityType,
  ...(after ? { metadata: { after } } : {}),
});
/**
 * A cognitive_events row as UnifiedMemoryRetrievalService hands it over: metadata.sourceType the bus source, content
 * `${eventType}: ${JSON.stringify(payload)}`.
 * FU-KEY-MEMORY-MONEY-SIGHT (COR-W1FPMS-1 follow-up): and metadata.payload the row's payload, which the projection reads
 * (it no longer parses the rendered content).
 */
const ce = (id: string, title: string, source?: string, payload?: Record<string, unknown>): Fragment => ({
  id,
  sourceType: 'cognitive_event',
  title,
  metadata: source || payload ? { ...(source ? { sourceType: source } : {}), ...(payload ? { payload } : {}) } : undefined,
  ...(payload ? { content: `${title}: ${JSON.stringify(payload)}` } : {}),
});

/** Every module a business-wide event can name: a record that names none of them needs read on all of them. */
const ALL = ['revenue', 'expenses', 'crm', 'bookings', 'projects', 'operations', 'storefront', 'content', 'automations', 'team'];
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

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
  // Review SEC-W1FPMS-1: the families that named no module and carry money. A document's extraction, a Drive file and
  // its ingestion item carry the figures read off an invoice or a receipt (DocumentIntelligenceService.extractFromDocument
  // emits the whole result; ConnectorIntelligenceService re-emits it): revenue and expenses. A vendor is expenses (D-146),
  // a medical claim and its coding revenue (D-57).
  [be('be_doc', 'document.extracted', 'Document'), ['revenue', 'expenses']],
  [ce('ce_doc', 'document.extracted', 'documents'), ['revenue', 'expenses']],
  [be('be_file', 'file.uploaded', 'Document'), ['revenue', 'expenses']],
  [ce('ce_file', 'file.uploaded', 'documents'), ['revenue', 'expenses']],
  [be('be_ingest', 'ingestion.item.received', 'Ingestion'), ['revenue', 'expenses']],
  [ce('ce_ingest', 'ingestion.item.received', 'ingestion'), ['revenue', 'expenses']],
  [be('be_vendor', 'vendor.created', 'Vendor'), ['expenses']],
  [ce('ce_vendor', 'vendor.created', 'vendors'), ['expenses']],
  [be('be_claim', 'claim.submitted', 'Claim'), ['revenue']],
  [ce('ce_claim', 'claim.submitted', 'medical'), ['revenue']],
  [ce('ce_coding', 'coding.completed', 'medical'), ['revenue']],
  // ...and the other families that named no module, by the module their data belongs to.
  [be('be_user', 'user.invited', 'User'), ['team']],
  [be('be_onboarding', 'onboarding.started', 'Onboarding'), ['team']],
  [be('be_application', 'application.received', 'Application'), ['team']],
  [ce('ce_media', 'media.uploaded', 'media'), ['content']],
  [be('be_social', 'social.engagement_received', 'KEY_CORTEX_EVENT'), ['content']],
  [be('be_legal', 'legal.notice', 'Legal'), ['operations']],
  [be('be_shift', 'shift.started', 'Shift'), ['operations']],
  [ce('ce_restaurant', 'restaurant.table_turned', 'restaurant'), ['operations']],
  [be('be_dispatch', 'dispatch.assigned', 'Dispatch'), ['operations']],
  [ce('ce_field', 'field_service.completed', 'field_service'), ['operations']],
  [be('be_delivery', 'delivery.opened', 'Delivery'), ['operations']],
  [be('be_checkin', 'check_in.completed', 'CheckIn'), ['bookings']],
  [ce('ce_checkin', 'check_in.completed', 'front_desk'), ['bookings']],
  [be('be_sentiment', 'proactive.negative_sentiment', 'KeyInboxMessage'), ['operations']],
  [ce('ce_sentiment', 'proactive.negative_sentiment', 'proactive_watcher'), ['operations']],
  // A call log is the CRM's (its source is 'call_tasks'): the word 'tasks' does not file it under projects too.
  [ce('ce_call', 'call_log.created', 'call_tasks'), ['crm']],
  // Review COR-W1FPMS-1: a task is filed by its own type, as the bridge stores it ('autopilot.' is stripped: an autopilot
  // task is 'task.created', subject Task, source task_assignments, its payload the delegation loop's).
  [be('be_ctask', 'task.assigned', 'Task', { taskType: 'ContactTask', taskId: 'ct_1' }), ['crm']],
  [ce('ce_ctask', 'task.assigned', 'task_assignments', { taskType: 'ContactTask', taskId: 'ct_1' }), ['crm']],
  [be('be_ptask', 'task.assigned', 'Task', { taskType: 'ProjectTask', taskId: 'pt_1' }), ['projects']],
  [ce('ce_ptask', 'task.unassigned', 'task_assignments', { taskType: 'ProjectTask', taskId: 'pt_1' }), ['projects']],
  [be('be_autopilot', 'task.created', 'Task', { taskId: 'at_1', category: 'LEAD_REACTIVATION', loopType: 'lead_reactivation' }), ['automations']],
  [ce('ce_autopilot', 'task.auto_executed', 'task_assignments', { taskId: 'at_1', category: 'PAYMENT_RECOVERY', action: 'email_sent' }), ['automations']],
  // A transfer names no task type (it can move any): it needs every module a task can be filed under.
  [be('be_transfer', 'task.transferred', 'Task', { fromType: 'User', toType: 'User', count: 2 }), ['crm', 'projects', 'automations']],
  // Business-wide: a proposal (kept business-wide by the packet's instruction).
  [be('be_governance', 'GOVERNANCE_DECISION', 'key_action_proposal'), []],
  [ce('ce_governance', 'GOVERNANCE_DECISION', 'ai'), []],
  // Fails closed (SEC-W1FPMS-1): a record that names no module needs read on every module an event can name.
  [be('be_insight', 'insight.generated', 'KEY_CORTEX_EVENT'), ALL],
  [be('be_unknown', 'v70c.unheard_of', 'KEY_CORTEX_EVENT'), ALL],
  [ce('ce_unknown', 'v70c.unheard_of', 'v70c_mystery'), ALL],
  [be('be_signal', 'signal.detected', 'KEY_CORTEX_EVENT'), ALL],
];

/** What each reader may read, by the memberships above (ModuleScopeGuard's reading). */
const READS: Record<string, (module: string) => boolean> = {
  blind: (x) => ['crm', 'bookings', 'projects', 'operations', 'storefront', 'content', 'automations'].includes(x),
  revenueOnly: (x) => ['crm', 'revenue'].includes(x),
  expensesOnly: (x) => ['crm', 'expenses'].includes(x),
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
    // FU-KEY-MEMORY-MONEY-SIGHT (SEC-W1FPMS-3): a genome record that carries no money is not projected; a money one
    // (FINANCE_GENOME, CROSS_DOMAIN, the customer-sales snapshot) needs revenue read (the describe block at the end).
    const others: Fragment[] = [
      { id: 'mem', sourceType: 'ai_memory', title: 'fact' },
      {
        id: 'genome',
        sourceType: 'genome_memory_event',
        title: 'Operations snapshot computed',
        metadata: { genomeRow: { sourceType: 'OPERATIONS_GENOME', eventType: 'OPERATIONS_SNAPSHOT_COMPUTED', domain: 'OPERATIONS', section: 'OPERATIONS' } },
      },
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
    // Review SEC-W1FPMS-1: only a GOVERNANCE_DECISION record is business-wide now; a record that names no module needs
    // read on every module (insight.generated moved to the fail-closed rows above).
    const fragments = [be('gov', 'GOVERNANCE_DECISION', 'key_action_proposal'), ce('gov_ce', 'GOVERNANCE_DECISION', 'ai'), { id: 'mem', sourceType: 'ai_memory', title: 'fact' }];
    const kept = await readersOwnPromptMemory(prisma as any, 'biz_1', 'blind', fragments as any, 1000);
    expect(kept.map((f) => f.id)).toEqual(['gov', 'gov_ce', 'mem']);
    expect(prisma.client.membership.findUnique).not.toHaveBeenCalled();
  });

  it('the window is cut after the projection, so a refused event does not take a line of it', async () => {
    const fragments = [be('a', 'expense.created', 'Expense'), be('b', 'payment.received'), { id: 'mem', sourceType: 'ai_memory', title: 'fact' }];
    const kept = await readersOwnPromptMemory(prisma as any, 'biz_1', 'blind', fragments as any, 1);
    expect(kept.map((f) => f.id)).toEqual(['mem']);
  });
});

/**
 * Review SEC-W1FPMS-1 (census): every record the business-wide event stores can hold, as it lands there, names a module
 * (or is a person's KEY record, which no prompt takes, or a GOVERNANCE_DECISION record, which stays business-wide). A
 * record that names no module needs read on every module an event can name, so a type nobody classified fails closed;
 * the families listed in FULL_SIGHT_FAMILIES carry what no one module governs and are classified so on purpose. A new
 * bridge family or bus type that classifies as nothing fails this census until it is given a module.
 */
describe('W1F-PERCEPTION-MODULE-SCOPE review (SEC-W1FPMS-1): census of what the business-wide event stores hold', () => {
  /** Families whose records may carry any module's data: they need read on every module (an owner's or an admin's sight). */
  const FULL_SIGHT_FAMILIES = new Set(['signal', 'risk', 'reminder', 'deadline', 'board', 'resolution']);
  const familyOf = (type: string) => type.split('.')[0];

  /** The two rows one bus event lands as (KeyCortexEventBusService.persistAudit and persistCognitive), as read back. */
  function rowsOf(event: { source: string; type: string; payload?: Record<string, unknown>; metadata?: { entityType?: string } }): Fragment[] {
    const payload = event.payload ?? {};
    return [
      be(`be:${event.type}`, event.type, event.metadata?.entityType ?? 'KEY_CORTEX_EVENT', payload),
      ce(`ce:${event.type}`, event.type, event.source, payload),
    ];
  }

  function expectClassified(fragment: Fragment, label: string) {
    if (isPersonalKeyRecord(fragment as any) || fragment.title === 'GOVERNANCE_DECISION') return;
    const modules = eventModulesOf(fragment as any);
    expect(modules.length, `${label}: ${fragment.sourceType} ${fragment.title} (${fragment.entityType ?? fragment.metadata?.sourceType ?? '-'}) names no module and is business-wide (fails open)`).toBeGreaterThan(0);
    if (sameSet(modules, ALL)) {
      expect(FULL_SIGHT_FAMILIES.has(familyOf(fragment.title)), `${label}: ${fragment.sourceType} ${fragment.title} (${fragment.entityType ?? fragment.metadata?.sourceType ?? '-'}) is classified by nothing (it only fails closed); give it the module its data belongs to`).toBe(true);
    }
  }

  it('a type nobody classified fails closed: in either store it needs read on every module an event can name', () => {
    for (const fragment of [
      be('u1', 'v70c.unheard_of', 'KEY_CORTEX_EVENT'),
      ce('u2', 'v70c.unheard_of', 'v70c_mystery'),
      be('u3', 'v70c_unheard', null),
      ce('u4', 'v70c_unheard'),
    ]) {
      expect([...eventModulesOf(fragment as any)].sort(), `${fragment.sourceType} ${fragment.title}`).toEqual([...ALL].sort());
    }
  });

  it('every family EventEmitterFlowBridgeService forwards lands, in both stores, as a record that names a module', async () => {
    const events = new EventEmitter2({ wildcard: false });
    const published: Array<{ source: string; type: string; payload?: Record<string, unknown>; metadata?: { entityType?: string } }> = [];
    const bridge = new EventEmitterFlowBridgeService(events, { publish: async (e: any) => { published.push(e); return e; } } as any);
    bridge.onModuleInit();
    const patterns = (bridge as unknown as { patterns: RegExp[] }).patterns;
    expect(patterns.length).toBeGreaterThan(50);
    let walked = 0;
    for (const pattern of patterns) {
      const prefix = pattern.source.replace(/^\^/, '').replace(/\\\./g, '.');
      // business_event.created republishes BusinessEventService rows under their own type: pinned in the next case.
      if (prefix === 'business_event.created') continue;
      const name = prefix.endsWith('.') ? `${prefix}v70c_sample` : `${prefix}.v70c_sample`;
      published.length = 0;
      events.emit(name, { businessId: 'biz_1', id: 'v70c_entity' });
      await new Promise((r) => setImmediate(r));
      expect(published, `${name} is forwarded`).toHaveLength(1);
      if (published[0].type === 'v70c_sample') {
        // The bridge strips this module prefix (normalizeEventName: 'helpdesk.', 'bookings.', ...), so the stored type is
        // what follows it; with nothing that names a module after it, the record fails closed (every module).
        for (const fragment of rowsOf(published[0])) expect([...eventModulesOf(fragment as any)].sort(), `bridge ${name}`).toEqual([...ALL].sort());
        walked += 1;
        continue;
      }
      for (const fragment of rowsOf(published[0])) expectClassified(fragment, `bridge ${name}`);
      walked += 1;
    }
    expect(walked).toBe(patterns.length - 1);
  });

  it("business_event.created copies: a BusinessEventService type is classified by its type and subject, and a type nobody classified fails closed", async () => {
    const events = new EventEmitter2({ wildcard: false });
    const published: any[] = [];
    new EventEmitterFlowBridgeService(events, { publish: async (e: any) => { published.push(e); return e; } } as any).onModuleInit();
    for (const [input, expected] of [
      [{ eventType: 'invoice.overdue', subjectType: 'invoice', source: 'worker' }, ['revenue']],
      [{ eventType: 'evidence.submitted', subjectType: 'evidence', source: 'web' }, ALL],
      [{ eventType: 'key_inbox.message_received', subjectType: 'KeyInboxMessage', source: 'whatsapp' }, ['operations']],
    ] as const) {
      published.length = 0;
      events.emit('business_event.created', { businessId: 'biz_1', subjectId: 's_1', actorType: 'system', actorId: 'x', action: 'A', ...input });
      await new Promise((r) => setImmediate(r));
      expect(published).toHaveLength(1);
      for (const fragment of rowsOf(published[0])) {
        expect([...eventModulesOf(fragment as any)].sort(), `${fragment.sourceType} ${input.eventType}`).toEqual([...expected].sort());
      }
    }
  });

  it('every type the KEY bus is handed by its publishers (watchers, organs, lifecycle, registry, actions, safe database) is a person\'s KEY record or lands as a record that names a module', () => {
    const root = path.resolve(__dirname);
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) files.push(full);
      }
    };
    walk(root);
    const sites: Array<{ file: string; type: string; source: string; entityType?: string }> = [];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      const organId = /readonly organId = '([^']+)'/.exec(text)?.[1];
      const call = /\b(?:bus|eventBus)\.(?:publish|emit)\(\{/g;
      for (let m = call.exec(text); m; m = call.exec(text)) {
        const rest = text.slice(m.index + m[0].length);
        const next = rest.search(/\b(?:bus|eventBus)\.(?:publish|emit)\(/);
        const block = next >= 0 ? rest.slice(0, next) : rest.slice(0, 1500);
        const typeMatch = /\btype(?::\s*([^\n]+)|\s*,)/.exec(block);
        const typeLine = typeMatch ? (typeMatch[1] ?? 'type,') : '';
        const sourceLine = /\bsource:\s*([^,\n]+)/.exec(block)?.[1] ?? '';
        const source = /'([^']+)'/.exec(sourceLine)?.[1] ?? (sourceLine.includes('this.organId') ? organId : undefined) ?? `dynamic:${sourceLine.trim()}`;
        const entityType = /\bentityType:\s*'([^']+)'/.exec(block)?.[1];
        const literals = [...typeLine.matchAll(/'([^']+)'|`([^`]+)`/g)].map((x) => (x[1] ?? x[2]).replace(/\$\{[^}]+\}/g, 'v70c_status'));
        // The bridge (normalized.type) and the organ base class (a `type` parameter) are walked in the cases above:
        // the bridge by its patterns, and no organ calls the base class's publish.
        if (!literals.length) {
          expect(/normalized\.type|^type,?$/.test(typeLine.trim()), `${path.relative(root, file)}: an unclassifiable bus type ${typeLine.trim()}`).toBe(true);
          continue;
        }
        for (const type of literals) sites.push({ file: path.relative(root, file), type, source, entityType });
      }
    }
    // The census found the publishers it is about (a regression in the scan is not a pass).
    for (const expected of ['proactive.invoice_overdue', 'proactive.booking_no_show', 'proactive.negative_sentiment', 'message.received', 'signal.detected', 'risk.detected', 'order.created', 'lead.submitted', 'cortex.turn_started', 'tool.executed', 'cortex.action_executed', 'action.v70c_status']) {
      expect(sites.map((s) => s.type), expected).toContain(expected);
    }
    for (const site of sites) {
      for (const fragment of rowsOf({ source: site.source, type: site.type, metadata: { entityType: site.entityType } })) {
        expectClassified(fragment, `${site.file} ${site.type}`);
      }
    }
    // An organ's protected publish(type, ...) is called by no organ (its types would be walked here otherwise).
    for (const file of files.filter((f) => f.includes(`${path.sep}organs${path.sep}`))) {
      expect(/\bthis\.publish\(/.test(fs.readFileSync(file, 'utf8')), path.relative(root, file)).toBe(false);
    }
  });
});

/**
 * FU-KEY-MEMORY-MONEY-SIGHT (V1-71; review SEC-W1FPMS-3; D-128, D-100): the genome's money memory events reach no KEY
 * prompt of a reader without revenue read. GenomeMemoryEvent rows are read business-wide by UnifiedMemoryRetrievalService,
 * and FinanceGenomeService writes FINANCE_SNAPSHOT_COMPUTED (the health score and the overall risk), the cross-domain
 * services CROSS_DOMAIN rows (the composite that averages the finance health score) and the customer-sales snapshot its
 * revenue quality: the genome's REST routes withhold exactly these from such a reader (isMoneyMemoryEvent). The fragment
 * now carries the row's own sourceType, eventType, domain and section (metadata.genomeRow), so the prompt's projection
 * applies the same rule; a genome fragment that carries no row is read as money (fail closed).
 */
describe('FU-KEY-MEMORY-MONEY-SIGHT (SEC-W1FPMS-3): a genome money memory event renders only at revenue read', () => {
  beforeEach(() => {
    prisma.client.membership.findUnique.mockClear();
  });

  type GenomeRow = { sourceType: string; eventType: string; domain: string | null; section: string | null };
  /** A genome_memory_events row as UnifiedMemoryRetrievalService hands it over: title and summary, the row's columns in metadata.genomeRow. */
  const ge = (id: string, title: string, row: GenomeRow | null, own: Record<string, unknown> = {}): Fragment => ({
    id,
    sourceType: 'genome_memory_event',
    title,
    content: `${title}: summary`,
    metadata: row ? { ...own, genomeRow: row } : own,
  });

  /** Each genome fragment, and whether it is money (needs revenue read). */
  const GENOME: Array<[Fragment, boolean]> = [
    [ge('g_fin', 'Finance snapshot computed', { sourceType: 'FINANCE_GENOME', eventType: 'FINANCE_SNAPSHOT_COMPUTED', domain: 'FINANCIAL', section: 'FINANCIAL' }), true],
    [ge('g_fin_signal', 'Signal accepted', { sourceType: 'GENOME_SIGNAL', eventType: 'SIGNAL_ACCEPTED', domain: 'finance', section: 'FINANCIAL' }), true],
    [ge('g_cross', 'Cross-domain snapshot computed', { sourceType: 'CROSS_DOMAIN_GENOME', eventType: 'CROSS_DOMAIN_SNAPSHOT_COMPUTED', domain: 'CROSS_DOMAIN', section: 'CROSS_DOMAIN' }), true],
    [ge('g_cross_domain', 'Recommendations ranked', { sourceType: 'GENOME_RECOMMENDATION', eventType: 'CROSS_DOMAIN_RECOMMENDATIONS_RANKED', domain: 'CROSS_DOMAIN', section: null }), true],
    [ge('g_sales_snapshot', 'Customer/sales snapshot computed', { sourceType: 'CUSTOMER_SALES_GENOME', eventType: 'CUSTOMER_SALES_SNAPSHOT_COMPUTED', domain: 'SALES', section: 'SALES' }), true],
    // A writer's own metadata cannot pass a money row off as another: the row's columns are what is read.
    [ge('g_fin_disguised', 'Finance snapshot computed', { sourceType: 'FINANCE_GENOME', eventType: 'FINANCE_SNAPSHOT_COMPUTED', domain: 'FINANCIAL', section: 'FINANCIAL' }, { sourceType: 'OPERATIONS_GENOME', domain: 'OPERATIONS' }), true],
    // Fail closed: a genome fragment that carries no row.
    [ge('g_rowless', 'Finance snapshot computed', null), true],
    // Not money: these stay business-wide.
    [ge('g_sales_signal', 'Customer/sales signals generated', { sourceType: 'CUSTOMER_SALES_GENOME', eventType: 'CUSTOMER_SALES_SIGNAL_GENERATED', domain: 'SALES', section: 'SALES' }), false],
    [ge('g_ops', 'Operations snapshot computed', { sourceType: 'OPERATIONS_GENOME', eventType: 'OPERATIONS_SNAPSHOT_COMPUTED', domain: 'OPERATIONS', section: 'OPERATIONS' }), false],
    [ge('g_ops_disguised', 'Operations snapshot computed', { sourceType: 'OPERATIONS_GENOME', eventType: 'OPERATIONS_SNAPSHOT_COMPUTED', domain: 'OPERATIONS', section: 'OPERATIONS' }, { sourceType: 'FINANCE_GENOME' }), false],
  ];

  const keptGenome = async (reader: string | null, sight?: (module: string) => boolean) =>
    new Set((await readersOwnPromptMemory(prisma as any, 'biz_1', reader, GENOME.map(([f]) => f) as any, 1000, undefined, undefined, sight as any)).map((f) => f.id));

  for (const reader of Object.keys(READS)) {
    it(`${reader}: a genome money memory event renders only with revenue read; the genome's other records render`, async () => {
      const kept = await keptGenome(reader);
      for (const [fragment, money] of GENOME) {
        expect(kept.has(fragment.id), `${reader}: ${fragment.id} (${money ? 'money' : 'not money'})`).toBe(!money || READS[reader]('revenue'));
      }
    });
  }

  it('no reader, and a reader who is no member, sees no genome money memory event', async () => {
    for (const reader of [null, 'stranger']) {
      const kept = await keptGenome(reader);
      for (const [fragment, money] of GENOME) expect(kept.has(fragment.id), `${String(reader)}: ${fragment.id}`).toBe(!money);
    }
  });

  it("a staff position's turn sees a genome money memory event only when its position's modules hold revenue", async () => {
    const without = await keptGenome(null, moduleSightOf(['crm', 'expenses', 'operations']));
    const withRevenue = await keptGenome(null, moduleSightOf(['crm', 'revenue']));
    for (const [fragment, money] of GENOME) {
      expect(without.has(fragment.id), `no revenue: ${fragment.id}`).toBe(!money);
      expect(withRevenue.has(fragment.id), `revenue: ${fragment.id}`).toBe(true);
    }
  });

  it('a genome money memory event reads the membership once, as a module-named event does', async () => {
    await readersOwnPromptMemory(prisma as any, 'biz_1', 'blind', [GENOME[0][0], { id: 'mem', sourceType: 'ai_memory', title: 'fact' }] as any, 1000);
    expect(prisma.client.membership.findUnique).toHaveBeenCalledTimes(1);
  });

  it('the window is cut after the projection: a withheld genome money event does not take a line of it', async () => {
    const kept = await readersOwnPromptMemory(prisma as any, 'biz_1', 'blind', [GENOME[0][0], GENOME[7][0]] as any, 1);
    expect(kept.map((f) => f.id)).toEqual(['g_sales_signal']);
  });
});

/**
 * FU-KEY-MEMORY-MONEY-SIGHT (V1-71; review COR-W1FPMS-1 follow-up): a cognitive event's payload is read from the payload
 * UnifiedMemoryRetrievalService carries in the fragment (metadata.payload), never parsed back out of its rendered content.
 */
describe('FU-KEY-MEMORY-MONEY-SIGHT (COR-W1FPMS-1 follow-up): a task record is classified by the payload its fragment carries', () => {
  it('the carried payload decides, whatever the rendered content says', () => {
    const fragment = {
      id: 'ce_task',
      sourceType: 'cognitive_event',
      title: 'task.assigned',
      metadata: { sourceType: 'task_assignments', payload: { taskType: 'ProjectTask', taskId: 'pt_1' } },
      content: `task.assigned: ${JSON.stringify({ taskType: 'ContactTask', taskId: 'pt_1' })}`,
    };
    expect(eventModulesOf(fragment as any)).toEqual(['projects']);
  });

  it('a fragment that carries no payload is not parsed from its text: it needs every module a task can be filed under', () => {
    const fragment = {
      id: 'ce_task_text',
      sourceType: 'cognitive_event',
      title: 'task.assigned',
      metadata: { sourceType: 'task_assignments' },
      content: `task.assigned: ${JSON.stringify({ taskType: 'ContactTask', taskId: 'ct_1' })}`,
    };
    expect([...eventModulesOf(fragment as any)].sort()).toEqual(['automations', 'crm', 'projects']);
  });
});

/**
 * FU-KEY-MEMORY-MONEY-SIGHT (V1-71; review SEC-W1FPMS-4; D-73, D-93): a GOVERNANCE_DECISION proposal stays business-wide,
 * but a turn with no member reader (a contact-only position on the staff bridge, a SUPER_ADMIN who is no member) sees only
 * the proposal's action, status and risk level: never its title (the Pro Auto monitor writes '$12,345 outstanding across
 * 7 invoices'), a rejection reason, an approver or any other figure. The records as the three stores hold them: the
 * approval orchestrator's ledger row (KeyCortexAuditService: action column, after { status, riskLevel }, the title in
 * its metadata), its bridged business_events copy (after: the whole ledger input) and its cognitive_events copy
 * (payload: the whole ledger input); and the genome's record of a proposal's outcome (OutcomeLearningService: title
 * 'Action executed: <the proposal's title>').
 */
describe('FU-KEY-MEMORY-MONEY-SIGHT (SEC-W1FPMS-4): a memberless turn sees a proposal\'s action, status and risk level only', () => {
  const TITLE = '$12,345 outstanding across 7 invoices';
  const ledgerInput = (action: string, after: Record<string, unknown>, metadata: Record<string, unknown>) => ({
    businessId: 'biz_1',
    eventType: 'GOVERNANCE_DECISION',
    subjectType: 'key_action_proposal',
    subjectId: 'kap_1',
    actorType: action === 'propose' ? 'ai' : 'human',
    actorId: action === 'propose' ? 'key_ai' : 'owner',
    action,
    source: action === 'propose' ? 'ai' : 'web',
    approvalId: 'kap_1',
    metadata,
    after,
  });
  /** The three records one GOVERNANCE_DECISION ledger row lands as, as UnifiedMemoryRetrievalService hands them over. */
  const recordsOf = (tag: string, action: string, after: Record<string, unknown>, metadata: Record<string, unknown>): Fragment[] => {
    const input = ledgerInput(action, after, metadata);
    return [
      {
        id: `${tag}_ledger`,
        sourceType: 'business_event',
        title: 'GOVERNANCE_DECISION',
        entityType: 'key_action_proposal',
        content: `${input.actorType} ${action} key_action_proposal: ${JSON.stringify(after)}`,
        metadata: { after, metadata, actorType: input.actorType, action },
      },
      {
        id: `${tag}_bridged`,
        sourceType: 'business_event',
        title: 'GOVERNANCE_DECISION',
        entityType: 'Key_action_proposal',
        content: `${input.source} PUBLISHED Key_action_proposal: ${JSON.stringify(input)}`,
        metadata: { after: input, metadata: { importance: 'normal' }, actorType: input.source, action: 'PUBLISHED' },
      },
      {
        id: `${tag}_cognitive`,
        sourceType: 'cognitive_event',
        title: 'GOVERNANCE_DECISION',
        content: `GOVERNANCE_DECISION: ${JSON.stringify(input)}`,
        metadata: { sourceType: input.source, payload: input },
      },
    ];
  };
  const PROPOSE = recordsOf('p', 'propose', { status: 'PENDING', riskLevel: 'MEDIUM' }, { toolName: 'draft_payment_reminder', module: 'revenue', title: TITLE });
  const APPROVE = recordsOf('a', 'approve', { status: 'APPROVED', approvedBy: 'v71o_owner_id' }, {});
  const REJECT = recordsOf('r', 'reject', { status: 'REJECTED', rejectedBy: 'v71o_owner_id', rejectionReason: 'not now: $9,876 is due first' }, { reason: 'not now: $9,876 is due first' });
  const OUTCOME: Fragment = {
    id: 'g_outcome',
    sourceType: 'genome_memory_event',
    title: `Action executed: ${TITLE}`,
    content: 'KEY action EXECUTE_TOOL was executed.',
    metadata: { actionType: 'EXECUTE_TOOL', executionResult: { success: true, amount: 12345 }, genomeRow: { sourceType: 'KEY_ACTION_PROPOSAL', eventType: 'ACTION_EXECUTED', domain: null, section: null } },
  };
  const ALL_RECORDS = [...PROPOSE, ...APPROVE, ...REJECT, OUTCOME];
  const FIGURES = ['12,345', '12345', 'outstanding', '9,876', 'not now', 'v71o_owner_id', 'draft_payment_reminder'];

  // A turn with no member reader reaches readersOwnPromptMemory with reader null: its callers resolve the reader by
  // membership first (promptMemoryReader, the pipeline's episodicMemoryReader), so a SUPER_ADMIN who is no member, a
  // removed member and a contact-only position all arrive as null (the real-DB suite drives each through its route).
  for (const reader of [null] as const) {
    it('no reader (a memberless turn): every proposal record renders as its action, status and risk level, and nothing else', async () => {
      const kept = await readersOwnPromptMemory(prisma as any, 'biz_1', reader, ALL_RECORDS as any, 1000);
      expect(kept.map((f) => f.id)).toEqual(ALL_RECORDS.map((f) => f.id));
      const byId = new Map(kept.map((f) => [f.id, f]));
      for (const tag of ['p_ledger', 'p_bridged', 'p_cognitive']) expect(byId.get(tag)!.content, tag).toBe('proposal propose, status PENDING, risk MEDIUM');
      for (const tag of ['a_ledger', 'a_bridged', 'a_cognitive']) expect(byId.get(tag)!.content, tag).toBe('proposal approve, status APPROVED');
      for (const tag of ['r_ledger', 'r_bridged', 'r_cognitive']) expect(byId.get(tag)!.content, tag).toBe('proposal reject, status REJECTED');
      expect(byId.get('g_outcome')!.title).toBe('ACTION_EXECUTED');
      expect(byId.get('g_outcome')!.content).toBe('proposal ACTION_EXECUTED');
      for (const fragment of kept) {
        expect(fragment.title === 'GOVERNANCE_DECISION' || fragment.id === 'g_outcome', fragment.id).toBe(true);
        const whole = JSON.stringify(fragment);
        for (const figure of FIGURES) expect(whole, `${fragment.id}: ${figure}`).not.toContain(figure);
      }
    });
  }

  it("a staff position's turn with no member reader (a contact-only position) sees the same, whatever modules its position holds", async () => {
    const kept = await readersOwnPromptMemory(prisma as any, 'biz_1', null, PROPOSE as any, 1000, undefined, undefined, moduleSightOf(['crm', 'operations', 'revenue']));
    expect(kept.map((f) => f.content)).toEqual(Array(3).fill('proposal propose, status PENDING, risk MEDIUM'));
    for (const figure of FIGURES) expect(JSON.stringify(kept), figure).not.toContain(figure);
  });

  it('a value that is not one plain word (a status or risk that carries a figure) is not rendered', async () => {
    const odd = recordsOf('o', 'propose', { status: '$12,345 due', riskLevel: 'HIGH' }, { title: TITLE });
    const kept = await readersOwnPromptMemory(prisma as any, 'biz_1', null, odd as any, 1000);
    expect(kept.map((f) => f.content)).toEqual(Array(3).fill('proposal propose, risk HIGH'));
  });

  for (const reader of ['blind', 'owner', 'staff']) {
    it(`${reader} (a member): the proposal records render whole, title included (proposals stay business-wide)`, async () => {
      const kept = await readersOwnPromptMemory(prisma as any, 'biz_1', reader, ALL_RECORDS as any, 1000);
      expect(kept).toEqual(ALL_RECORDS);
      expect(kept.find((f) => f.id === 'p_cognitive')!.content).toContain(TITLE);
      expect(kept.find((f) => f.id === 'g_outcome')!.title).toContain(TITLE);
    });
  }
});
