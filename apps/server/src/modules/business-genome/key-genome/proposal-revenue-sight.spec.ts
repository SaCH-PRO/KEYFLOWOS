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
  it('a reader without revenue read gets id and status only, and nothing else', () => {
    // Round 7 (security m2, correctness minor 2): a financial proposal's failure reason is withheld whatever it says, as
    // execution status withholds it; the vocabulary cannot be complete ("Customer was charged twice").
    expect(proposalViewForReader(money, false)).toEqual({ id: 'kap_1', status: 'FAILED' });
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

describe('round-6 review repairs (security MAJOR-1, MAJOR-2, minors; correctness minors)', () => {
  it.each([
    ['a booking total', { actionType: 'CONFIRM_BOOKING', module: 'bookings', title: 'Confirm: booking total 1200' }],
    ['a booking total in the parameters', { actionType: 'CONFIRM_BOOKING', module: 'bookings', title: 'Confirm the booking', payload: { bookingTotal: 900 } }],
    ['a booking rate stored as a string', { actionType: 'CONFIRM_BOOKING', module: 'bookings', title: 'Confirm the booking', payload: { bookingRate: '150' } }],
    ['the booking rate per session', { actionType: 'REBOOK', module: 'bookings', title: 'The booking rate is 150 per session' }],
    ['a total due', { actionType: 'CREATE_TASK', module: 'crm', title: 'Total due 900 by Friday' }],
    ['the total was', { actionType: 'CREATE_TASK', module: 'crm', title: 'The total was 1200' }],
    ['the total came to', { actionType: 'CREATE_TASK', module: 'crm', title: 'The total came to 1200' }],
    ['rates will rise', { actionType: 'CREATE_TASK', module: 'crm', title: 'Rates will rise 10% in March' }],
    ['a rate card', { actionType: 'CREATE_TASK', module: 'crm', title: 'Send the rate card to Ana' }],
    ['bill the client', { actionType: 'CREATE_TASK', module: 'crm', title: 'Bill the client 900' }],
    ['settle up', { actionType: 'CREATE_TASK', module: 'crm', title: 'Settle up 900 with the supplier' }],
    ['wire to the vendor', { actionType: 'CREATE_TASK', module: 'crm', title: 'Wire 900 to the vendor' }],
    ['a loan', { actionType: 'CREATE_TASK', module: 'crm', title: 'Ask about a loan of 5000' }],
    ['a retainer', { actionType: 'CREATE_TASK', module: 'crm', title: 'Retainer 900 for April' }],
    ['a tip', { actionType: 'CREATE_TASK', module: 'crm', title: 'Add a tip of 50' }],
    ['earnings', { actionType: 'CREATE_TASK', module: 'crm', title: 'Earnings 900 this week' }],
    ['income', { actionType: 'CREATE_TASK', module: 'crm', title: 'Income up 20%' }],
    ['spent on ads', { actionType: 'CREATE_TASK', module: 'crm', title: 'Spent 900 on ads' }],
    ['insufficient funds', { actionType: 'CREATE_TASK', module: 'crm', title: 'Insufficient funds on the account' }],
    ['a declined card', { actionType: 'CREATE_TASK', module: 'crm', title: 'Card declined for Ana' }],
    ['a 25-letter run starting with c', { actionType: 'CREATE_TASK', title: 'Plan', summary: 'creditcardpaymentsoverdue' }],
  ])('%s is financial', (_l, p) => expect(isFinancialProposal(p as any)).toBe(true));

  it.each([
    ['an open rate target', { actionType: 'CREATE_TASK', title: 'Improve open rate by 5%' }],
    ['a no-show rate', { actionType: 'CREATE_TASK', title: 'No-show rate: 12%', payload: { noShowRate: 0.12 } }],
    ['a booking reminder', { actionType: 'CONFIRM_BOOKING', module: 'bookings', title: 'Confirm pending booking' }],
  ])('%s is not', (_l, p) => expect(isFinancialProposal(p as any)).toBe(false));
});

describe('round-7 review repairs (correctness MAJOR-1, minor 1; security m1, m3)', () => {
  it.each([
    ['a person called Bill next to a date in JSON', { actionType: 'CREATE_TASK', module: 'crm', title: 'Call Bill', payload: { title: 'Call Bill', dueDate: '2026-11-25' } }],
    ['a contact named Bill with a phone', { actionType: 'CREATE_TASK', module: 'crm', title: 'Follow up', payload: { name: 'Bill', phone: '868-555-0101' } }],
    ['posting tips with a start time', { actionType: 'CREATE_EVENT', module: 'content', title: 'Share posting tips', payload: { title: 'Share posting tips', startTime: '2026-11-25T09:00:00Z' } }],
    ['a list count result', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', payload: { items: [], totalCount: 12 } }],
    ['a time-off approval', { actionType: 'REQUEST_APPROVAL', title: 'Time off Friday', affectedEntities: { requestType: 'time_off' } }],
    // A KEY approval request with no request type (not the approvals module's shadow) stays as D-226 pins it.
    ['a KEY approval request with no request type', { actionType: 'REQUEST_APPROVAL', title: 'Call the supplier about the delivery slot' }],
  ])('%s is not', (_l, p) => expect(isFinancialProposal(p as any)).toBe(false));

  it.each([
    ['a purchase order approval with a plain title', { actionType: 'REQUEST_APPROVAL', title: 'Office chairs', summary: '6 chairs', affectedEntities: { requestType: 'po' } }],
    ['a general approval', { actionType: 'REQUEST_APPROVAL', title: 'Sign off', affectedEntities: { requestType: 'general' } }],
    ['a customer charged a figure', { actionType: 'CREATE_TASK', module: 'crm', title: 'Customer charged 900 twice' }],
    ['a figure outstanding', { actionType: 'CREATE_TASK', module: 'crm', title: 'Chase the 900 outstanding' }],
    ['a total due in JSON prose', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', payload: { note: 'total due 900' } }],
  ])('%s is financial', (_l, p) => expect(isFinancialProposal(p as any)).toBe(true));

  it('a failure reason about a rate limit or retries does not make a non-financial proposal\'s reason money', () => {
    const task = { id: 'kap_t', status: 'FAILED', title: 'Call Kerry back', actionType: 'CREATE_TASK', module: 'crm' };
    for (const reason of ['Rate limited: retry after 30s', 'Transfer failed after 3 retries', 'Failed: total 0 rows updated']) {
      expect(proposalViewForReader({ ...task, failureReason: reason }, false)).toMatchObject({ failureReason: reason });
    }
  });
});

describe('round-8 review repairs (security BLOCKING-1, MAJOR-1; correctness B1, M1, m4) — D-238 ambiguous fails closed', () => {
  it.each([
    ['a rate per hour', { actionType: 'CREATE_TASK', module: 'crm', title: 'Rate 150 per hour' }],
    ['a rate an hour', { actionType: 'CREATE_TASK', module: 'crm', title: 'Rates 150 an hour' }],
    ['a rate per hour in JSON', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', payload: { rate: '150 per hour' } }],
    ['bill per hour', { actionType: 'CREATE_TASK', module: 'crm', title: 'Bill the client 150 per hour' }],
    ['a retainer a month', { actionType: 'CREATE_TASK', module: 'crm', title: 'Retainer 900 a month' }],
    ['tips per guest', { actionType: 'CREATE_TASK', module: 'crm', title: 'Tips 50 per guest' }],
    ['spent on leads', { actionType: 'CREATE_TASK', module: 'crm', title: 'Spent 900 on leads' }],
    ['spent this month', { actionType: 'CREATE_TASK', module: 'crm', title: 'Spent 900 this month' }],
    ['wire to members', { actionType: 'CREATE_TASK', module: 'crm', title: 'Wire 900 to members' }],
    ['a total per booking', { actionType: 'CREATE_TASK', module: 'crm', title: 'Total 1200 per booking' }],
    ['charged last week', { actionType: 'CREATE_TASK', module: 'crm', title: 'Charged 900 last week' }],
    ['a total per month in JSON', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', payload: { total: '900 per month' } }],
    ['a rate range', { actionType: 'CREATE_TASK', module: 'crm', title: 'Rate 100-150' }],
    ['a total range in JSON', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', payload: { total: '1200-1500' } }],
    ['a bill range with a slash', { actionType: 'CREATE_TASK', module: 'crm', title: 'Bill 1200/1500' }],
    ['spent a range on ads', { actionType: 'CREATE_TASK', module: 'crm', title: 'Spent 100-200 on ads' }],
    ['a human-workflow approval with no request type', { actionType: 'REQUEST_APPROVAL', sourceType: 'HUMAN_WORKFLOW', title: 'Sign off', affectedEntities: { steps: [] } }],
    // Accepted over-hiding (D-238: wording that cannot be told from money fails closed; the structural follow-up
    // FU-PROPOSAL-MONEY-TAG makes the writers tag money at creation).
    ['spent hours (fails closed)', { actionType: 'CREATE_TASK', module: 'crm', title: 'Spent 3 hours on outreach' }],
    ['transfer files (fails closed)', { actionType: 'CREATE_TASK', module: 'crm', title: 'Transfer the 2 files to Ana' }],
    ['tips for posts (fails closed)', { actionType: 'CREATE_TASK', module: 'content', title: 'Tips for the 3 posts' }],
    ['settle tickets (fails closed)', { actionType: 'CREATE_TASK', module: 'crm', title: 'Settle the 2 open tickets' }],
    ['wire up forms (fails closed)', { actionType: 'CREATE_TASK', module: 'crm', title: 'Wire up the 3 forms' }],
    ['a total of tasks (fails closed)', { actionType: 'CREATE_TASK', module: 'crm', title: 'Total of 4 tasks this week' }],
    ['meeting Bill at a time (fails closed)', { actionType: 'CREATE_EVENT', module: 'calendar', title: 'Meeting with Bill at 10am' }],
  ])('%s is financial', (_l, p) => expect(isFinancialProposal(p as any)).toBe(true));

  it.each([
    ['an ISO date beside Bill in prose', { actionType: 'CREATE_TASK', module: 'crm', title: 'Call Bill on 2026-11-25' }],
    ['a slash date beside a bill', { actionType: 'CREATE_TASK', module: 'crm', title: 'Call Bill 25/11/2026' }],
    ['a phone beside Bill', { actionType: 'CREATE_TASK', module: 'crm', title: 'Call Bill 868-555-0101' }],
    ['rate-limited', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', summary: 'Rate-limited after 5 requests' }],
  ])('%s is not', (_l, p) => expect(isFinancialProposal(p as any)).toBe(false));

  it('the classifier is linear on a long digit run and a large number array (correctness M1: no quadratic rescan)', () => {
    const digits = '9'.repeat(100_000);
    const ids = JSON.stringify({ ids2: Array.from({ length: 20_000 }, (_v, i) => i) });
    const t0 = Date.now();
    isFinancialProposal({ actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', summary: digits } as any);
    isFinancialProposal({ actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', payload: JSON.parse(ids) } as any);
    // Round 9 (correctness minor 1): a long whitespace run after a figure, too. A generous bound (minor 4): the quadratic
    // case took seconds.
    isFinancialProposal({ actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', summary: '9' + ' '.repeat(50_000) } as any);
    isFinancialProposal({ actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', summary: ('9' + ' '.repeat(20_000)).repeat(5) } as any);
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});

describe('round-9 review repairs (security MAJOR-1, MAJOR-2, minor 2; correctness minor 2)', () => {
  it.each([
    ['a totalDue key', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', payload: { totalDue: 900 } }],
    ['a totalValue key', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', payload: { totalValue: 1200 } }],
    ['a ratePerHour key', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', payload: { ratePerHour: 150 } }],
    ['a retainerMonthly key', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', payload: { retainerMonthly: 900 } }],
    ['a total_due key', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', payload: { total_due: 900 } }],
    ['a rate_per_hour key', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', payload: { rate_per_hour: 150 } }],
    ['spent_on_ads', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', payload: { spent_on_ads: 900 } }],
    ['total_due in prose', { actionType: 'CREATE_TASK', module: 'crm', title: 'total_due: 900' }],
    ['a retainer after a date', { actionType: 'CREATE_TASK', module: 'crm', title: 'Retainer from 2026-12-01 is 900' }],
    ['a rate after a slash date', { actionType: 'CREATE_TASK', module: 'crm', title: 'Rate on 25/11/2026 is 150' }],
    ['a total after a date', { actionType: 'CREATE_TASK', module: 'crm', title: 'Total for 2026-11-25: 1200' }],
    ['spent between two dates', { actionType: 'CREATE_TASK', module: 'crm', title: 'Spent 2026-11-01 to 2026-11-30: 4000' }],
    ['a slash date that runs on into a figure', { actionType: 'CREATE_TASK', module: 'crm', title: 'Rate 1/12/150' }],
    ['a figure a comma touches, outstanding', { actionType: 'CREATE_TASK', module: 'crm', title: 'Chase them,900 outstanding' }],
    ['a figure a comma touches, with a currency code', { actionType: 'CREATE_TASK', module: 'crm', title: 'Items:a,900 usd' }],
  ])('%s is financial', (_l, p) => expect(isFinancialProposal(p as any)).toBe(true));

  it.each([
    ['a totalCount key', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', payload: { items: [], totalCount: 12 } }],
    ['Bill beside a JSON date', { actionType: 'CREATE_TASK', module: 'crm', title: 'Call Bill', payload: { title: 'Call Bill', dueDate: '2026-11-25' } }],
  ])('%s is not', (_l, p) => expect(isFinancialProposal(p as any)).toBe(false));
});

describe('round-10 review repairs (both reviews: quadratic regressions; security M3, M4; correctness m1, m2)', () => {
  it('stays linear on every adversarial shape the reviews timed (dotted digit runs, money-word key chains, long words)', () => {
    const inputs = ['9..'.repeat(33_000), '9.,'.repeat(33_000), 'total_'.repeat(17_000), 'rate_'.repeat(20_000), 'bill_'.repeat(20_000), 'Total_Due_'.repeat(10_000), 'rate ' + 'a'.repeat(100_000), 'spent_'.repeat(17_000)];
    const t0 = Date.now();
    for (const summary of inputs) isFinancialProposal({ actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', summary } as any);
    expect(Date.now() - t0).toBeLessThan(1500);
  });

  it.each([
    ['a count word inside the key', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', payload: { total_items_value: 900 } }],
    ['totalItemsDue', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', payload: { totalItemsDue: 900 } }],
    ['rate_records', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', payload: { rate_records_value: 150 } }],
    ['total due equals', { actionType: 'CREATE_TASK', module: 'crm', title: 'total due = 900' }],
    ['markdown bold', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', summary: '**Total due:** 900' }],
    ['markdown bold figure', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', summary: 'Total due: **900**' }],
    ['a newline before the figure', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', summary: 'Total due:\n900' }],
    ['an em dash', { actionType: 'CREATE_TASK', module: 'crm', title: 'Total — 900' }],
    ['an arrow', { actionType: 'CREATE_TASK', module: 'crm', title: 'total due => 900' }],
    ['a spaced JSON key', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', payload: { 'Total Due': 900 } }],
    ['a dashed JSON key', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', payload: { 'total-due': 900 } }],
    ['a doubled underscore', { actionType: 'CREATE_TASK', module: 'crm', title: 'total__due:900' }],
  ])('%s is financial', (_l, p) => expect(isFinancialProposal(p as any)).toBe(true));

  it.each([
    ['a rate_limit key', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', payload: { rate_limit: 100, rateLimit: 100 } }],
    ['count and duration totals', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', payload: { totalContacts: 5, totalBookings: 3, totalHours: 2, totalDurationMs: 900, timeSpentMinutes: 30, tipsShown: 2 } }],
    ['a totalCount key', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', payload: { items: [], totalCount: 12, total_items: 3 } }],
  ])('%s is not', (_l, p) => expect(isFinancialProposal(p as any)).toBe(false));
});

describe('round-11 review repairs (both reviews: long keys, ellipsis; security M2, m1)', () => {
  it('stays linear on whitespace after a colon or equals sign (security M2: 17 s before)', () => {
    const inputs = ['total:' + ' '.repeat(100_000) + 'x', 'rate=' + ' '.repeat(100_000) + 'x', 'Total due:' + ' '.repeat(100_000) + 'x', 'total"=' + ' '.repeat(100_000) + 'x'];
    const t0 = Date.now();
    for (const summary of inputs) isFinancialProposal({ actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', summary } as any);
    expect(Date.now() - t0).toBeLessThan(1500);
  });

  it.each([
    ['a five-segment snake key', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', payload: { total_due_for_the_main_client: 900 } }],
    ['a six-segment camel key', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', payload: { totalDueForTheCurrentMonth: 900 } }],
    ['a long spent key', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', payload: { spent_on_ads_last_thirty_days: 900 } }],
    ['a key past any bound (fails closed)', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', payload: { rate_for_a_b_c_d_e_f_g_h_i_j: 150 } }],
    ['an ellipsis before an outstanding figure', { actionType: 'CREATE_TASK', module: 'crm', title: 'Chase...900 outstanding' }],
    ['an ellipsis before a currency code', { actionType: 'CREATE_TASK', module: 'crm', title: 'Note...900 TTD' }],
    ['doubled commas before a currency code', { actionType: 'CREATE_TASK', module: 'crm', title: 'Note,,900 usd' }],
    ['a rate per hour key', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', payload: { rateHour: 150, rate_minute: 2 } }],
  ])('%s is financial', (_l, p) => expect(isFinancialProposal(p as any)).toBe(true));
});
