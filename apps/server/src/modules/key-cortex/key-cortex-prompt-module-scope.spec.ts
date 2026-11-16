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
import { eventModulesOf, isPersonalKeyRecord, readersOwnPromptMemory } from './key-cortex-prompt-context.service';
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
 */
const ce = (id: string, title: string, source?: string, payload?: Record<string, unknown>): Fragment => ({
  id,
  sourceType: 'cognitive_event',
  title,
  metadata: source ? { sourceType: source } : undefined,
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
