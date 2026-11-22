/**
 * FU-PROPOSAL-REVENUE-SIGHT (owner ruling D-238; D-226, D-227, D-234): a KEY proposal record reaches a reader without
 * revenue read only when the underlying proposal is classified non-financial, by its action type, module, tool and
 * title; anything unknown or inadequately classified fails closed.
 */
import { describe, it, expect, vi } from 'vitest';
import { financialProposalWithProvenance, financialProposalsWithProvenance, isFinancialProposal, isMoneyMemoryEvent, PROPOSAL_CLASSIFY_SELECT, proposalViewForReader } from './genome-finance-scope';

describe('isFinancialProposal (D-238)', () => {
  it.each([
    ['an invoice action', { actionType: 'CREATE_INVOICE', title: 'Invoice Acme' }],
    ['a receivable', { actionType: 'COLLECT_RECEIVABLE', title: 'Collect from Acme' }],
    ['a quote follow-up (a priced offer)', { actionType: 'FOLLOW_UP_QUOTE', title: 'Follow up the quote' }],
    ['a tax filing', { actionType: 'FILE_TAX', title: 'File VAT' }],
    ['an expense categorisation', { actionType: 'CATEGORIZE_EXPENSE', title: 'Categorise' }],
    ['a tool in the commerce module', { actionType: 'EXECUTE_TOOL', module: 'commerce', toolName: 'commerce.create_invoice', title: 'Run it' }],
    ['a tool whose KEY authority needs revenue read', { actionType: 'EXECUTE_TOOL', module: 'temporal_flow', toolName: 'temporal_flow.list_events', title: 'List events' }],
    ['a non-financial action whose title carries a figure', { actionType: 'CREATE_TASK', title: 'Chase the $4,000 invoice' }],
    ['a non-financial action whose title names revenue', { actionType: 'CREATE_TASK', title: 'Review revenue drop' }],
    ['an approval request titled with a money figure (the Pro Auto monitor)', { actionType: 'REQUEST_APPROVAL', title: '$12,345 outstanding across 7 invoices' }],
    ['a task titled with a currency code amount', { actionType: 'CREATE_TASK', title: 'Pay TTD 500 to the courier' }],
  ])('%s is financial', (_l, p) => expect(isFinancialProposal(p)).toBe(true));

  it.each([
    ['a task', { actionType: 'CREATE_TASK', title: 'Call Kerry back' }],
    ['a booking confirmation', { actionType: 'CONFIRM_BOOKING', title: 'Confirm Saturday' }],
    ['a calendar event', { actionType: 'CREATE_EVENT', title: 'Team standup' }],
    ['a crm tool', { actionType: 'EXECUTE_TOOL', module: 'crm', toolName: 'crm.create_contact', title: 'Add contact' }],
    ['a timeline write (KEY authority: ai write only)', { actionType: 'EXECUTE_TOOL', module: 'temporal_flow', toolName: 'temporal_flow.create_event', title: 'Log the call' }],
  ])('%s is not', (_l, p) => expect(isFinancialProposal(p)).toBe(false));

  it.each([
    ['no proposal at all', null],
    ['a tool run with no module or tool', { actionType: 'EXECUTE_TOOL', title: 'Run' }],
    ['an unknown action type', { actionType: 'FROBNICATE', title: 'Frobnicate' }],
    ['no action type', { title: 'Something' }],
    ['a tool the KEY authority map does not know, in a module that is not listed', { actionType: 'EXECUTE_TOOL', module: 'mystery', toolName: 'mystery.run', title: 'x' }],
  ])('%s fails closed (D-227, D-234)', (_l, p) => expect(isFinancialProposal(p as any)).toBe(true));
});

describe('a KEY_ACTION_PROPOSAL outcome event (D-238 replaces the provisional exemption)', () => {
  const ev = (metadata: unknown, title = 'Action executed: Call Kerry back') => ({
    sourceType: 'KEY_ACTION_PROPOSAL', eventType: 'ACTION_EXECUTED', domain: null, section: null, title, metadata,
  });
  it('is money when its proposal is financial, or when it carries no classification', () => {
    expect(isMoneyMemoryEvent(ev({ actionType: 'CREATE_INVOICE' }, 'Action executed: Invoice Acme'))).toBe(true);
    expect(isMoneyMemoryEvent(ev({ actionType: 'EXECUTE_TOOL' }))).toBe(true);
    expect(isMoneyMemoryEvent(ev({}))).toBe(true);
    expect(isMoneyMemoryEvent(ev(undefined))).toBe(true);
    expect(isMoneyMemoryEvent(ev({ actionType: 'CREATE_TASK' }, 'Action executed: Chase the $4,000 invoice'))).toBe(true);
  });
  it('is not money when its proposal is classified non-financial', () => {
    expect(isMoneyMemoryEvent(ev({ actionType: 'CREATE_TASK' }))).toBe(false);
    expect(isMoneyMemoryEvent(ev({ actionType: 'EXECUTE_TOOL', module: 'crm', toolName: 'crm.create_contact' }))).toBe(false);
  });
});

describe('review repairs (security MAJOR-3, correctness MINOR-3)', () => {
  it.each([
    ['an approval request whose request type is an expense reimbursement', { actionType: 'REQUEST_APPROVAL', title: 'Reimburse John', affectedEntities: { requestType: 'expense_reimbursement' } }],
    ['an approval request whose summary states money', { actionType: 'REQUEST_APPROVAL', title: 'Approve this', summary: 'Refund the deposit to the client' }],
    ['a bookings tool whose parameters carry a price', { actionType: 'EXECUTE_TOOL', module: 'bookings', toolName: 'bookings.add_service', title: 'Add a service', payload: { params: { name: 'Haircut', price: 20 } } }],
    ['a promo code (a discount)', { actionType: 'EXECUTE_TOOL', toolName: 'storelink.create_promo_code', title: 'Create a code' }],
    ['a product-health read of the store', { actionType: 'EXECUTE_TOOL', toolName: 'storelink.get_product_health', title: 'Check products' }],
    ['a rationale naming a payout', { actionType: 'CREATE_TASK', title: 'Ping Ana', rationale: 'Her payout failed' }],
    ['a trailing currency amount', { actionType: 'CREATE_TASK', title: 'Send 500 USD to the supplier' }],
  ])('%s is financial', (_l, p) => expect(isFinancialProposal(p as any)).toBe(true));

  it.each([
    'Buy costume', 'Apricot recipe', 'Cashier training', 'Suspend the old page', 'Data collection form', 'Fix CI pipeline',
  ])('the ordinary title %j does not make a task financial', (title) => {
    expect(isFinancialProposal({ actionType: 'CREATE_TASK', title } as any)).toBe(false);
  });
});

describe('round-3 review repairs (security M2, correctness MAJOR-2, minors)', () => {
  it.each([
    ['a bare amount in the parameters', { actionType: 'CREATE_TASK', title: 'Do it', payload: { amount: 500 } }],
    ['a total in the parameters', { actionType: 'CREATE_TASK', title: 'Do it', payload: { total: 1200 } }],
    ['a balance owed', { actionType: 'CREATE_TASK', title: 'Ask about the balance owed' }],
    ['a paid figure', { actionType: 'CREATE_TASK', title: 'Confirm Ana paid 4000' }],
    ['a rate', { actionType: 'CREATE_TASK', title: 'Raise the hourly rate to 150' }],
    ['an owed figure', { actionType: 'CREATE_TASK', title: 'Chase the 4,000 owed' }],
    ['a camelCase cost key', { actionType: 'CREATE_TASK', title: 'Plan', payload: { estimatedCost: 10 } }],
    ['a camelCase price key', { actionType: 'CREATE_TASK', title: 'Plan', payload: { unitPrice: 10 } }],
    ['a camelCase spend title', { actionType: 'CREATE_TASK', title: 'Review adSpend' }],
    ['money in the evidence', { actionType: 'CREATE_TASK', title: 'Plan', evidence: [{ note: 'revenue fell 30%' }] }],
    ['a genome-bridged proposal in the BUSINESS_MODEL domain', { actionType: 'CREATE_TASK', title: 'Plan', payload: { domain: 'BUSINESS_MODEL' } }],
  ])('%s is financial', (_l, p) => expect(isFinancialProposal(p as any)).toBe(true));

  it.each([
    ['a blog promotion', { actionType: 'CREATE_TASK', title: 'Promote the blog post' }],
    ['a staff promotion', { actionType: 'CREATE_TASK', title: 'Plan the staff promotion party' }],
    ['ids in the parameters', { actionType: 'CREATE_TASK', title: 'Call back', payload: { contactId: '9cad2f1e-1usd-4fee-8cad-0123456789ab', taskId: 'cmwr8rbji00097dkwjitjsgzl' } }],
  ])('%s is not', (_l, p) => expect(isFinancialProposal(p as any)).toBe(false));

  it('a promo code is still money', () => {
    expect(isFinancialProposal({ actionType: 'CREATE_TASK', title: 'Create a promo code for spring' } as any)).toBe(true);
  });
});

describe('proposalViewForReader (D-238: an action on a proposal the reader may not see answers a safely redacted view)', () => {
  const money = { id: 'kap_1', status: 'FAILED', title: '$12,345 outstanding', summary: 'x', riskLevel: 'HIGH', failureReason: 'Refused: not mapped', executionResult: { amount: 12345 }, actionType: 'EXECUTE_TOOL', module: 'commerce' };
  it('a revenue reader gets the proposal whole', () => expect(proposalViewForReader(money, true)).toBe(money));
  it('a reader without revenue read gets id, status and a failure reason that states no money, and nothing else', () => {
    expect(proposalViewForReader(money, false)).toEqual({ id: 'kap_1', status: 'FAILED', failureReason: 'Refused: not mapped' });
    expect(proposalViewForReader({ ...money, failureReason: 'balance $12,345 too low' }, false)).toEqual({ id: 'kap_1', status: 'FAILED' });
  });
  it('a non-financial proposal is unchanged for any reader', () => {
    const task = { id: 'kap_2', status: 'APPROVED', title: 'Call Kerry back', actionType: 'CREATE_TASK', module: 'crm' };
    expect(proposalViewForReader(task, false)).toBe(task);
  });
});

describe('financialProposalWithProvenance (D-238: a proposal bridged from a genome recommendation is classified by it)', () => {
  const prismaWith = (rec: unknown) => ({ client: { genomeRecommendation: { findFirst: vi.fn(async () => rec) } } }) as any;
  it('a proposal whose recommendation is financial, or cannot be read, is financial', async () => {
    const row = { actionType: 'CREATE_TASK', title: 'Plan', payload: { recommendationId: 'rec_1' } };
    expect(await financialProposalWithProvenance(prismaWith({ domain: 'FINANCIAL', title: 'Raise prices' }), 'biz_1', row)).toBe(true);
    expect(await financialProposalWithProvenance(prismaWith(null), 'biz_1', row)).toBe(true);
    expect(await financialProposalWithProvenance(prismaWith({ domain: 'OPERATIONS', title: 'Write the SOPs' }), 'biz_1', row)).toBe(false);
  });
  it('the recommendation is read in this business only', async () => {
    const prisma = prismaWith({ domain: 'OPERATIONS', title: 'SOPs' });
    await financialProposalWithProvenance(prisma, 'biz_1', { actionType: 'CREATE_TASK', title: 'Plan', payload: { recommendationId: 'rec_1' } });
    expect(prisma.client.genomeRecommendation.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'rec_1', businessId: 'biz_1' });
  });
});

describe('round-4 review repairs (correctness minors 3, 4, 5; security minor 3)', () => {
  it.each([
    ['dollars in words', { actionType: 'CREATE_TASK', module: 'crm', title: 'Remind Jane about the 500 dollars' }],
    ['euros', { actionType: 'CREATE_TASK', module: 'crm', title: 'She sent 40 euros' }],
    ['cents', { actionType: 'CREATE_TASK', module: 'crm', title: 'Round off the cents' }],
    ['a rate with a figure', { actionType: 'CREATE_TASK', title: 'Raise the hourly rate to 150' }],
    ['a total with a figure', { actionType: 'CREATE_TASK', title: 'Total: 1,200 for the job' }],
    ['an invoice id key with a neutral title', { actionType: 'CREATE_TASK', title: 'Follow up', payload: { invoiceId: 'cmwr8rbji00097dkwjitjsgzl' } }],
    ['a hyphenated money phrase', { actionType: 'CREATE_TASK', title: 'Plan', summary: 'see overdue-invoices-2026-report' }],
    ['a UUID-wrapped currency inside free text is no amount, but money words still are', { actionType: 'CREATE_TASK', title: 'Plan', summary: 'refund 9cad2f1e-1usd-4fee-8cad-0123456789ab' }],
  ])('%s is financial', (_l, p) => expect(isFinancialProposal(p as any)).toBe(true));

  it.each([
    ['a response rate', { actionType: 'CREATE_TASK', title: 'Lead response rate is low', evidence: [{ note: 'response rate fell' }] }],
    ['a task count total', { actionType: 'CREATE_TASK', title: '3 tasks in total due today' }],
    ['pay a visit', { actionType: 'CREATE_TASK', title: 'Pay a visit to the site' }],
    ['a UUID in free text', { actionType: 'CREATE_TASK', title: 'Call back', summary: 'contact 9cad2f1e-1usd-4fee-8cad-0123456789ab' }],
  ])('%s is not', (_l, p) => expect(isFinancialProposal(p as any)).toBe(false));

  it('the classify select carries every content field the classifier reads', () => {
    for (const key of ['actionType', 'module', 'toolName', 'title', 'summary', 'description', 'rationale', 'expectedBenefit', 'risks', 'evidence', 'payload', 'inputPayload', 'affectedEntities']) {
      expect(PROPOSAL_CLASSIFY_SELECT, key).toHaveProperty(key, true);
    }
  });

  it('financialProposalsWithProvenance reads the recommendations of a list in one query, in this business only', async () => {
    const findMany = vi.fn(async () => [{ id: 'rec_fin', domain: 'FINANCIAL', title: 'Raise prices', diagnosis: '' }, { id: 'rec_ops', domain: 'OPERATIONS', title: 'SOPs', diagnosis: '' }]);
    const prisma = { client: { genomeRecommendation: { findMany, findFirst: vi.fn() } } } as any;
    const rows = [
      { actionType: 'CREATE_TASK', title: 'A', payload: { recommendationId: 'rec_fin' } },
      { actionType: 'CREATE_TASK', title: 'B', payload: { recommendationId: 'rec_ops' } },
      { actionType: 'CREATE_TASK', title: 'C', payload: { recommendationId: 'rec_gone' } },
      { actionType: 'CREATE_TASK', title: 'D' },
      { actionType: 'EXECUTE_TOOL', toolName: 'commerce.create_invoice', title: 'E' },
    ];
    expect(await financialProposalsWithProvenance(prisma, 'biz_1', rows as any)).toEqual([true, false, true, false, true]);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where).toMatchObject({ businessId: 'biz_1', id: { in: ['rec_fin', 'rec_ops', 'rec_gone'] } });
    findMany.mockRejectedValueOnce(new Error('down'));
    expect(await financialProposalsWithProvenance(prisma, 'biz_1', rows.slice(1, 2) as any)).toEqual([true]);
  });
});

describe('round-5 review repairs (security M1, correctness minors 1, 2, 6)', () => {
  it.each([
    ['pay with a figure and no currency', { actionType: 'CREATE_TASK', module: 'crm', title: 'Pay the contractor 800' }],
    ['pay a person', { actionType: 'CREATE_TASK', module: 'crm', title: 'Pay Jane 500 for the shoot' }],
    ['pay rent', { actionType: 'CREATE_TASK', module: 'crm', title: 'Pay rent Friday' }],
    ['a rate figure stored as a string', { actionType: 'CREATE_TASK', title: 'Plan', payload: { rate: '150' } }],
    ['an hourly rate key stored as a string', { actionType: 'CREATE_TASK', title: 'Plan', payload: { hourlyRate: '150' } }],
    ['a total stored as a string', { actionType: 'CREATE_TASK', title: 'Plan', payload: { total: '1,200' } }],
    ['rates raised by a percentage', { actionType: 'CREATE_TASK', title: 'Raise rates by 10%' }],
    ['rates up a percentage', { actionType: 'CREATE_TASK', title: 'Rates up 15% next month' }],
    ['a camelCase money word in a long identifier', { actionType: 'CREATE_TASK', title: 'Plan', summary: 'see unpaidInvoices2026' }],
  ])('%s is financial', (_l, p) => expect(isFinancialProposal(p as any)).toBe(true));

  it.each([
    ['a response rate with a figure', { actionType: 'CREATE_TASK', title: 'Lead response rate: 12%' }],
    ['a show rate target', { actionType: 'CREATE_TASK', title: 'Improve show rate to 90%' }],
    ['a completion rate in the parameters', { actionType: 'CREATE_TASK', title: 'Plan', payload: { completionRate: 80, responseRate: 0.4 } }],
    ['pay attention', { actionType: 'CREATE_TASK', title: 'Pay attention to the onboarding step' }],
    ['a cuid in free text', { actionType: 'CREATE_TASK', title: 'Call back', summary: 'contact cmwr8rbji00097dkwjitjsgzl' }],
  ])('%s is not', (_l, p) => expect(isFinancialProposal(p as any)).toBe(false));
});
