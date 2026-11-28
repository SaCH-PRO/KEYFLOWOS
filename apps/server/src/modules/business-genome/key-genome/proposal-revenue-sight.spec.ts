/**
 * FU-PROPOSAL-REVENUE-SIGHT (owner ruling D-238; D-226, D-227, D-234): a KEY proposal record reaches a reader without
 * revenue read only when the underlying proposal is classified non-financial, by its action type, module, tool and
 * title; anything unknown or inadequately classified fails closed.
 */
import { describe, it, expect, vi } from 'vitest';
import { financialProposalWithProvenance, financialProposalsWithProvenance, isFinancialProposal, isMoneyLabel, isMoneyMemoryEvent, PROPOSAL_CLASSIFY_SELECT, proposalTextStatesMoney, proposalViewForReader } from './genome-finance-scope';

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
    // A failure reason that states no money stays (round 13: the authority's own refusals, D-140 / D-119, are pinned in
    // the action answers by owner-role-key; round 7 had dropped it). One that states money is withheld.
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
    ['a UUID in free text', { actionType: 'CREATE_TASK', title: 'Call back', summary: 'contact 9cad2f1e-1cad-4fee-8cad-0123456789ab' }],
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

  it('a non-financial proposal keeps a failure reason about a rate limit; one the vocabulary reads as money is blanked (Codex P1 on #218; round 8: ambiguous wording fails closed)', () => {
    const task = { id: 'kap_t', status: 'FAILED', title: 'Call Kerry back', actionType: 'CREATE_TASK', module: 'crm' };
    expect(proposalViewForReader({ ...task, failureReason: 'Rate limited: retry after 30s' }, false)).toMatchObject({ failureReason: 'Rate limited: retry after 30s' });
    for (const reason of ['Transfer failed after 3 retries', 'Failed: total 0 rows updated', 'card declined for $40']) {
      const out = proposalViewForReader({ ...task, failureReason: reason }, false) as any;
      expect(out.failureReason, reason).toBeNull();
      expect(out.title, reason).toBe('Call Kerry back');
    }
  });
});

// The timing cases run the regexes themselves: isFinancialProposal fails closed on content over 50,000 characters
// (round 12) without reading it, so it would not exercise them.
const timeRegexes = (text: string) => { proposalTextStatesMoney(text); isMoneyLabel(text); };

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
    timeRegexes(digits);
    timeRegexes(ids);
    // Round 9 (correctness minor 1): a long whitespace run after a figure, too. A generous bound (minor 4): the quadratic
    // case took seconds.
    timeRegexes('9' + ' '.repeat(50_000));
    timeRegexes(('9' + ' '.repeat(20_000)).repeat(5));
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
    for (const summary of inputs) timeRegexes(summary);
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
    for (const summary of inputs) timeRegexes(summary);
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

describe('round-12 review repairs (both reviews: mark runs, figure-free long prose; security M2)', () => {
  it('stays linear on long runs of dots and commas (both reviews: 4-9 s before)', () => {
    const inputs = ['.'.repeat(100_000), '9' + '.'.repeat(100_000) + 'x', '.'.repeat(100_000) + '9', '9' + ','.repeat(100_000) + 'x', '$' + '.,'.repeat(50_000)];
    const t0 = Date.now();
    for (const summary of inputs) timeRegexes(summary);
    expect(Date.now() - t0).toBeLessThan(1500);
  });

  it.each([
    ['a long money-word sentence with no figure', { actionType: 'CREATE_TASK', module: 'crm', title: 'Transfer the files to the new shared drive for the design team today' }],
    ['another', { actionType: 'CREATE_TASK', module: 'crm', title: 'Total of the tasks for the team this week is done and reviewed' }],
    ['Bill and a long agenda', { actionType: 'CREATE_TASK', module: 'crm', title: 'Call Bill about the agenda for the kickoff meeting with the team on monday' }],
  ])('%s is not', (_l, p) => expect(isFinancialProposal(p as any)).toBe(false));

  it.each([
    ['digits in a key', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', payload: { total_due_2026: 900, total_q4: 900 } }],
    ['a versioned rate key', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', payload: { rate_v2: 150 } }],
    ['a figure nested in an object', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', payload: { total: { value: 900 } } }],
    ['a figure nested in an array', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', payload: { total: [900] } }],
    ['a nested month map', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', payload: { total_due: { jan: 900 } } }],
    ['an oversized content (fails closed)', { actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', summary: 'call back '.repeat(6_000) }],
  ])('%s is financial', (_l, p) => expect(isFinancialProposal(p as any)).toBe(true));
});

describe('Codex P1s on #218: lifecycle fields and compensation vocabulary', () => {
  it.each([
    ['an execution result that carries money', { actionType: 'CREATE_TASK', module: 'crm', title: 'Call back', executionResult: { amount: 12345 } }],
    ['a rejection reason that names a balance', { actionType: 'CREATE_TASK', module: 'crm', title: 'Call back', rejectionReason: 'the balance owed is too high' }],
    ['a commission', { actionType: 'CREATE_TASK', module: 'crm', title: "Set Ana's commission to 12%" }],
    ['compensation', { actionType: 'CREATE_TASK', module: 'crm', title: 'Review the compensation plan for the team' }],
    ['a bonus', { actionType: 'CREATE_TASK', module: 'crm', title: 'Pay out the Q4 bonus' }],
  ])('RED-BEFORE: %s is financial', (_l, p) => expect(isFinancialProposal(p as any)).toBe(true));

  it('the classify select reads the lifecycle fields', () => {
    for (const key of ['executionResult', 'rejectionReason', 'failureReason']) expect(PROPOSAL_CLASSIFY_SELECT, key).toHaveProperty(key, true);
    // failureReason is read so it can be redacted field by field (it is not classified as content).
  });
});

describe('review of the Codex fixes on #218: compensation words and the failure reason copies', () => {
  const task = (title: string) => ({ actionType: 'CREATE_TASK', module: 'crm', title });
  it.each(['Decommission the old tablet', 'Decommission unused tools', 'Thermal overcompensation check'])('RED-BEFORE (correctness m1): "%s" is not financial (the compensation words are letter-bounded)', (title) => {
    expect(isFinancialProposal(task(title))).toBe(false);
    expect(isMoneyLabel(title)).toBe(false);
  });
  it.each(['Compensate the customer for the delay', 'Raise Ana\'s incentive to 12%', 'Approve the stipend for interns'])('RED-BEFORE (security m4): "%s" is financial', (title) => {
    expect(isFinancialProposal(task(title))).toBe(true);
  });
  it.each(["Set Ana's commission to 12%", 'Review the compensation plan', 'Review the bonus plan', 'Announce the bonuses'])('control: "%s" is financial', (title) => {
    expect(isFinancialProposal(task(title))).toBe(true);
  });
  it('RED-BEFORE (security m1): the copy of a money-stating failure reason in outcomeEvidence.reason is blanked with it', () => {
    const row = { id: 'kap_t', status: 'FAILED', title: 'Open a ticket', actionType: 'CREATE_TASK', module: 'crm', failureReason: 'the balance owed is 900', outcomeEvidence: { status: 'FAILED', reason: 'the balance owed is 900' } };
    const out = proposalViewForReader(row, false) as any;
    expect(out.failureReason).toBeNull();
    expect(out.outcomeEvidence).toEqual({ status: 'FAILED', reason: null });
    expect(JSON.stringify(out)).not.toContain('900');
  });
  it('control: an outcome evidence reason that states no money is kept, and a revenue reader gets the row itself', () => {
    const row = { id: 'kap_t', status: 'FAILED', title: 'Open a ticket', actionType: 'CREATE_TASK', module: 'crm', failureReason: 'Rate limited: retry after 30s', outcomeEvidence: { status: 'FAILED', reason: 'Rate limited: retry after 30s' } };
    expect(proposalViewForReader(row, false)).toBe(row);
    const money = { ...row, failureReason: 'the balance owed is 900', outcomeEvidence: { status: 'FAILED', reason: 'the balance owed is 900' } };
    expect(proposalViewForReader(money, true)).toBe(money);
  });
});

describe('confirmation review of the #218 repairs: the compensation words fail closed', () => {
  const task = (extra: object) => ({ actionType: 'CREATE_TASK', module: 'crm', title: 'Plan', ...extra });
  it.each([
    ['an acronym-prefixed key', { payload: { HRCompensation: 'tier B' } }],
    ['a concatenated key', { payload: { updatecommission: true } }],
    ['a VIP commission tier', { payload: { VIPCommissionTier: 'gold' } }],
    ['undercompensated staff', { title: 'Undercompensated staff' }],
    ['a subcommission', { title: 'Split the subcommission' }],
    ['incentivise', { title: 'Incentivise staff' }],
    ['incentivize', { title: 'Incentivize the team' }],
  ])('RED-BEFORE (m2/m4): %s is financial', (_l, extra) => expect(isFinancialProposal(task(extra) as any)).toBe(true));
  it.each(['Decommission the old tablet', 'Decommissioning plan', 'Thermal overcompensation check'])('control: "%s" stays non-financial', (title) => expect(isFinancialProposal(task({ title }) as any)).toBe(false));
  it('RED-BEFORE (m6): outcome evidence that states money anywhere is reduced to its status', () => {
    const row = { id: 'kap_t', status: 'FAILED', title: 'Open a ticket', actionType: 'CREATE_TASK', module: 'crm', outcomeEvidence: { status: 'FAILED', message: 'the balance owed is 900', detail: { text: 'card declined' } } };
    const out = proposalViewForReader(row, false) as any;
    expect(out.outcomeEvidence).toEqual({ status: 'FAILED', reason: null });
    expect(out.title).toBe('Open a ticket');
  });
  it('control: outcome evidence naming only the entity is kept', () => {
    const row = { id: 'kap_t', status: 'EXECUTED', title: 'Open a ticket', actionType: 'CREATE_TASK', module: 'crm', outcomeEvidence: { status: 'EXECUTED', entityType: 'helpdesk_ticket', entityId: 'tkt_1' } };
    expect(proposalViewForReader(row, false)).toBe(row);
  });
});

describe('third review of the #218 repairs: structured text is read as the proposal content is', () => {
  const task = { id: 'kap_t', status: 'FAILED', title: 'Open a ticket', actionType: 'CREATE_TASK', module: 'crm' };
  it.each(['Could not record the note:\nfee waived for this client', 'Step 2 failed:\tbalance is 900', 'Tool said:\nowed since March', 'Total\n900', 'x\r\n500 usd'])(
    'RED-BEFORE (security m1): a line break or tab before the money word does not hide it in the evidence copy (%j)',
    (msg) => {
      const out = proposalViewForReader({ ...task, failureReason: msg, outcomeEvidence: { v: 1, status: 'FAILED', reason: msg, entity: null } }, false) as any;
      expect(out.failureReason).toBeNull();
      expect(out.outcomeEvidence).toEqual({ status: 'FAILED', reason: null });
    },
  );
  it.each(['Line one\nfee waived', 'a\nbalance 900', 'done\ttotal due 40'])('RED-BEFORE (security m1): a multi-line parameter that states money makes the proposal financial (%j)', (note) => {
    expect(isFinancialProposal({ actionType: 'CREATE_TASK', module: 'crm', title: 'Follow up', payload: { note } })).toBe(true);
  });
  it('RED-BEFORE (correctness m1): ids and fingerprints in real success evidence are not read as money', () => {
    for (const [fingerprint, entityId, claimKey] of [
      ['a1b208cac7457d9e00112233445566778899aabbccddeeff0011223344556677', 'cmzcku666tax29xx90fuyj0uu', '0001fee2-9cad-4fee-8cac-0123456789ab'],
      ['00FEE11CAC22FEE33CAC44FEE55CAC66FEE77CAC88FEE99CAC00FEE11CAC22FEE3', 'c9fee1tax2arr3ltv4cac5fee', '9cac7457-1fee-4cad-8fee-2cac3cac4fee'],
    ]) {
      const row = { ...task, status: 'EXECUTED', outcomeEvidence: { v: 1, status: 'SUCCEEDED', fingerprint, claimKey, entity: { entityType: 'helpdesk_ticket', entityId }, principalChain: [{ userId: entityId }] } };
      expect(proposalViewForReader(row, false), fingerprint).toBe(row);
    }
  });
  it('RED-BEFORE (m2/m6): an evidence status that is not a short money-free string is not kept', () => {
    for (const status of [{ amount: 900 }, 'Paid $500 commission', 'x'.repeat(200)]) {
      const out = proposalViewForReader({ ...task, outcomeEvidence: { status, reason: 'invoice overdue' } }, false) as any;
      expect(out.outcomeEvidence, JSON.stringify(status).slice(0, 40)).toEqual({ reason: null });
    }
  });
});

describe('fourth review of the #218 repairs: the structured reader fails closed', () => {
  const task = (extra: object) => ({ actionType: 'CREATE_TASK', module: 'crm', title: 'Follow up', ...extra });
  const circular: any = { note: 'plain' };
  circular.self = circular;
  it.each([
    ['a BigInt', { note: 'plain', big: 1n }],
    ['a cycle', circular],
    ['a throwing toJSON', { toJSON() { throw new Error('no'); } }],
  ])('RED-BEFORE (m1): a parameter that cannot be read (%s) makes the proposal financial', (_l, payload) => {
    expect(isFinancialProposal(task({ payload }) as any)).toBe(true);
    expect(isFinancialProposal(task({ executionResult: payload }) as any)).toBe(true);
  });
  it.each([
    ['a squashed phrase', { summary: 'totaldue900usdforacmeinvoice2026paidlate' }],
    ['a squashed file name', { payload: { file: 'acmeinvoice2026novemberfinalsignedcopy.pdf' } }],
    ['an email local part', { payload: { to: 'invoice4500overdueacmeholdingsltd2026@x.io' } }],
    ['a squashed key', { payload: { invoice4471overdueforacmeholdingslimited2026: true } }],
    ['a figure glued into a run', { summary: `Total due 900${'a'.repeat(30)}` }],
  ])('RED-BEFORE (m2): %s holding a money word is read, not stripped as an id', (_l, extra) => expect(isFinancialProposal(task(extra) as any)).toBe(true));
  it('control (m2): a hex digest, in either case, and a cuid are still not read as money', () => {
    for (const hash of ['a1b208cac7457d9e00112233445566778899aabbccddeeff0011223344556677', 'A1B208CAC7457D9E00112233445566778899AABBCCDDEEFF0011223344556677', 'sha256:08cac74570fee11223344556677889900aabbccddeeff00112233445566fee1'])
      expect(isFinancialProposal(task({ payload: { fingerprint: hash, ref: 'cmzcku666tax29xx90fuyj0uu' } }) as any), hash).toBe(false);
  });
  it.each([
    ['text under an id-named key', { payload: { noteId: 'balance owed 900' } }],
    ['texts under an ids key', { payload: { noteIds: ['fee 500', 'refund 4000'] } }],
    ['a worded id', { payload: { entityId: 'invoice-900-usd' } }],
    ['an object under an ids key', { payload: { lineIds: [{ amount: 900, note: 'invoice' }] } }],
  ])('RED-BEFORE (m3/m4): %s is read', (_l, extra) => expect(isFinancialProposal(task(extra) as any)).toBe(true));
  it('RED-BEFORE (m3): money under an id-named key of the outcome evidence reduces it to its status', () => {
    const row = { id: 'kap_t', status: 'FAILED', title: 'Open a ticket', actionType: 'CREATE_TASK', module: 'crm', outcomeEvidence: { status: 'FAILED', noteId: 'balance owed 900' } };
    expect((proposalViewForReader(row, false) as any).outcomeEvidence).toEqual({ status: 'FAILED', reason: null });
  });
  it('control (m3/m4): real ids under id-named keys are not read, whatever letters and digits they hold', () => {
    for (const payload of [{ contactId: 'cmzcku666tax29xx90fuyj0uu' }, { id: 'x1usd9cad2zz' }, { taskIds: ['tsk_1', 'kap_2x9cad'] }, { ownerId: '9cac7457-1fee-4tax-8arr-2ltv3cac4fee' }])
      expect(isFinancialProposal(task({ payload }) as any), JSON.stringify(payload)).toBe(false);
  });
  it.each([
    ['a control character in a key', { payload: { 'x\ncost': 5 } }],
    ['a tab in a key', { payload: { 'a\tfee': 'yes' } }],
    ['a literal backslash-n in text', { summary: 'see\\ncost 900' }],
    ['JSON inside a JSON value', { executionResult: { output: JSON.stringify({ note: 'Summary\ncost 900' }) } }],
    ['a lone surrogate before the word', { payload: { note: 'x\uD83Dfee waived' } }],
    ['a zero-width space inside a word', { summary: 'in\u200bvoice 900' }],
    ['a soft hyphen inside a word', { summary: 'in\u00advoice 900' }],
    ['fullwidth digits', { summary: 'total due \uFF19\uFF10\uFF10' }],
  ])('RED-BEFORE (m5-m7): %s does not hide the money', (_l, extra) => expect(isFinancialProposal(task(extra) as any)).toBe(true));
  it('control: ordinary multi-line notes, paths and addresses stay non-financial', () => {
    for (const note of ['Line one\nLine two', 'C:\\new\\folder\\readme.txt', '12 Main Street\nPort of Spain', 'Call back\tafter 3pm'])
      expect(isFinancialProposal(task({ payload: { note } }) as any), note).toBe(false);
  });
});

describe('fifth review of the #218 repairs: ambiguous escapes and invisible characters are read both ways, in linear time', () => {
  const task = (extra: object) => ({ actionType: 'CREATE_TASK', module: 'crm', title: 'Follow up', ...extra });
  it.each([
    ['a figure after a backslash', { summary: 'x\\total due 900' }],
    ['a lower-case path', { payload: { note: 'c:\\clients\\tax\\2026' } }],
    ['a UNC path', { payload: { file: '\\\\server\\finance\\budget.xlsx' } }],
    ['a path in a summary', { summary: 'see d:\\shared\\refunds\\november' }],
    ['a report path', { summary: 'open c:\\reports\\revenue.xlsx' }],
    ['a path in a result', { executionResult: { path: 'c:\\acme\\billing\\run.log' } }],
    ['a path in the title', { title: 'Review c:\\docs\\fees' }],
  ])('RED-BEFORE (M2a): %s keeps the first letter of its money word', (_l, extra) => expect(isFinancialProposal(task(extra) as any)).toBe(true));
  it.each(['Collect the fee\u200Bfrom Ana', 'tax\u200Bdue Friday', 'Total\u200B900 owed\u200Bby Ana', 'cost\uFEFFsheet'])('RED-BEFORE (M2b): an invisible character used as the separator does not glue the money word away (%j)', (summary) => {
    expect(isFinancialProposal(task({ summary }))).toBe(true);
    expect(isFinancialProposal(task({ payload: { note: summary } }) as any)).toBe(true);
  });
  it('control: the escapes and invisible characters fixed in the fourth round stay read', () => {
    for (const extra of [{ summary: 'see\\ncost 900' }, { payload: { 'x\ncost': 5 } }, { summary: 'in\u200bvoice 900' }, { payload: { note: 'x\uD83Dfee waived' } }]) expect(isFinancialProposal(task(extra) as any), JSON.stringify(extra)).toBe(true);
  });
  it('RED-BEFORE (M1): runs of backslashes are read in linear time, in every field and at any length', () => {
    const cases: Array<[string, () => unknown]> = [
      ['summary 49k', () => isFinancialProposal(task({ summary: '\\'.repeat(49_000) }))],
      ['payload 24k', () => isFinancialProposal(task({ payload: { note: '\\'.repeat(24_000) } }) as any)],
      ['evidence 24k', () => proposalViewForReader({ id: 'k', ...task({ outcomeEvidence: { status: 'FAILED', reason: '\\'.repeat(24_000) } }) }, false)],
      ['failure reason 100k', () => proposalTextStatesMoney('\\'.repeat(100_000))],
      ['mixed 49k', () => isFinancialProposal(task({ summary: '\\\\x'.repeat(16_000) }))],
      ['zero-width 49k', () => isFinancialProposal(task({ summary: '\u200b'.repeat(49_000) }))],
    ];
    for (const [label, run] of cases) {
      const started = performance.now();
      run();
      expect(performance.now() - started, label).toBeLessThan(400);
    }
  });
  it('RED-BEFORE (M1): content over the cap fails closed before it is normalised', () => {
    const started = performance.now();
    expect(isFinancialProposal(task({ summary: '\\'.repeat(200_000) }))).toBe(true);
    expect(performance.now() - started).toBeLessThan(400);
    expect(isFinancialProposal(task({ summary: 'a'.repeat(50_001) }))).toBe(true);
  });
  it.each(['total due \uFF19\uFF10\uFF10', 'in\u200bvoice 900'])('RED-BEFORE (m3): a failure reason is read as the content is (%j)', (reason) => {
    expect(proposalTextStatesMoney(reason)).toBe(true);
    expect((proposalViewForReader({ id: 'k', status: 'FAILED', ...task({ failureReason: reason }) }, false) as any).failureReason).toBeNull();
  });
  it('RED-BEFORE (m3): a failure reason quoting an id is kept, as the same text in the evidence is', () => {
    const reason = 'Ticket cmzcku666tax29xx90fuyj0uu not found';
    expect(proposalTextStatesMoney(reason)).toBe(false);
    const row = { id: 'k', status: 'FAILED', ...task({ failureReason: reason, outcomeEvidence: { status: 'FAILED', reason } }) };
    expect(proposalViewForReader(row, false)).toBe(row);
  });
  it('control: ordinary paths, notes and multilingual text stay non-financial', () => {
    for (const note of ['C:\\new\\folder\\readme.txt', 'Line one\nLine two', 'Llamar a Jos\u00e9 ma\u00f1ana', '\u0915\u094d\u200d\u0937 call back', '\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67 family booking'])
      expect(isFinancialProposal(task({ payload: { note }, summary: note }) as any), note).toBe(false);
  });
});

describe('sixth review of the #218 repairs: readings are only ever added', () => {
  const task = (extra: object) => ({ actionType: 'CREATE_TASK', module: 'crm', title: 'Follow up', ...extra });
  const blind = (extra: object) => proposalViewForReader({ id: 'k', status: 'FAILED', ...task(extra) }, false) as any;
  it.each(['Net income\u1D43 12,400', 'Fees\u1D43: see note', 'Outstanding BALANCE\u2122 is high', 'VAT\u2116 123456', 'TAX\u2116 99', 'RENT\u33A1', 'Costs\u00AA', 'Tax\u24D8'])(
    'RED-BEFORE (m1): the text as written is read as well as its folded form (%j)',
    (text) => {
      expect(isFinancialProposal(task({ summary: text }))).toBe(true);
      expect(isFinancialProposal(task({ title: text }))).toBe(true);
      expect(isFinancialProposal(task({ payload: { note: text } }) as any)).toBe(true);
    },
  );
  it.each(['SALE\u2122 failed', 'VAT\u2116 123456'])('RED-BEFORE (m1): a failure reason as written is read (%j)', (reason) => {
    expect(proposalTextStatesMoney(reason)).toBe(true);
    expect(blind({ failureReason: reason }).failureReason).toBeNull();
  });
  it.each(['december-2026-cost-fees-transactions', 'commissionpayout2026total', 'see 00000000-0000-0000-0000-usd900000000'])('RED-BEFORE (m3): a phrase shaped like an id is read, in a title and in a failure reason (%j)', (text) => {
    expect(isFinancialProposal(task({ title: text }))).toBe(true);
    expect(proposalTextStatesMoney(text)).toBe(true);
  });
  it('control (m3): a real cuid and a real UUID are still not read as money, in a title, a failure reason and a parameter', () => {
    for (const id of ['cmzcku666tax29xx90fuyj0uu', '9cac7457-1fee-4cad-8fee-2cac3cac4fee']) {
      expect(isFinancialProposal(task({ title: `Ticket ${id}` })), id).toBe(false);
      expect(proposalTextStatesMoney(`Ticket ${id} not found`), id).toBe(false);
      expect(isFinancialProposal(task({ payload: { ref: id } }) as any), id).toBe(false);
    }
  });
  it.each(['c:\\pay\\attention', 'c:\\response\\rate 5'])('RED-BEFORE (m4): the text as written, backslashes kept, is one of the readings (%j)', (summary) => expect(isFinancialProposal(task({ summary }))).toBe(true));
  it.each([
    ['a figure key in nested JSON', { payload: { body: '{"total":900}' } }],
    ['a rate in a nested result', { executionResult: { output: JSON.stringify({ rate: 150 }) } }],
    ['an escaped currency sign', { summary: 'That is \\u20ac50' }],
    ['an escaped pound sign', { payload: { note: 'That is \\u00a3900' } }],
  ])('RED-BEFORE (m5): %s is read', (_l, extra) => expect(isFinancialProposal(task(extra) as any)).toBe(true));
  it('RED-BEFORE (m2): text that grows past the cap when folded, and long ambiguous text, fail closed quickly', () => {
    const grows = '\uFDFA'.repeat(49_000);
    // Seventh review (correctness m1): the case is now text built to multiply readings past the budget; a long text with
    // one joiner and one backslash is ordinary and is read (see the seventh-review cases).
    const ambiguous = `\u200b\\n\\u0041\uFF19${'a'.repeat(30_000)}`;
    for (const [label, text] of [['grows', grows], ['ambiguous', ambiguous]] as const) {
      const started = performance.now();
      expect(proposalTextStatesMoney(text), label).toBe(true);
      expect(isFinancialProposal(task({ summary: text })), label).toBe(true);
      expect(blind({ failureReason: text, outcomeEvidence: { status: 'FAILED', reason: text } }).failureReason, label).toBeNull();
      expect(performance.now() - started, label).toBeLessThan(400);
    }
  });
  it('the reader is linear on every field, with invisible characters and backslashes together', () => {
    const shapes = ['\\'.repeat(19_000), '\u200b\\'.repeat(9_000), `\u200b\\${'x '.repeat(9_000)}`, '\\u00'.repeat(4_000), '\uFF19\\'.repeat(9_000)];
    for (const shape of shapes) {
      for (const extra of [{ title: shape }, { summary: shape }, { payload: { note: shape } }, { payload: { [shape.slice(0, 5_000)]: 1 } }, { executionResult: { out: shape } }, { rejectionReason: shape }]) {
        const started = performance.now();
        isFinancialProposal(task(extra) as any);
        expect(performance.now() - started, Object.keys(extra)[0]).toBeLessThan(400);
      }
      const started = performance.now();
      blind({ failureReason: shape, outcomeEvidence: { status: 'FAILED', reason: shape } });
      expect(performance.now() - started, 'view').toBeLessThan(600);
    }
  });
  it('control: ordinary text with one invisible character or one path stays non-financial, and nothing returned is normalised', () => {
    for (const note of ['Call\u200bback Tuesday', 'C:\\new\\folder\\readme.txt', '\uFF23\uFF41\uFF4C\uFF4C back', 'Caf\u00e9 visit']) expect(isFinancialProposal(task({ summary: note, payload: { note } }) as any), note).toBe(false);
    const row = { id: 'k', status: 'FAILED', ...task({ failureReason: 'Rate\u200blimited: retry\\later' }) };
    expect(proposalViewForReader(row, false)).toBe(row);
  });
});

/**
 * Measure the best (minimum) wall-clock latency across several back-to-back runs after a warm-up.
 * Taking the minimum filters one-off GC pauses and shared-runner OS scheduler stalls while still
 * reflecting the true algorithmic cost of `fn` on the current CPU (P272, D-297).
 */
const minElapsedBudgetMs = (fn: () => void, samples = 3): number => {
  fn(); // warm-up
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < samples; i++) {
    const started = performance.now();
    fn();
    const elapsed = performance.now() - started;
    if (elapsed < best) best = elapsed;
  }
  return best;
};

/**
 * Same-run baseline: one in-budget id-dense field (18 deduplicated raw readings = 149,865 chars,
 * ~1/2 of READING_BUDGET = 300,000). Relative ceilings scale with runner speed so busy shared CI
 * runners do not flake while real budget regressions and post-scan mutants remain caught on fast
 * and slow CPUs alike.
 */
let sharedBudgetBaselineMs: number | null = null;
const budgetBaselineFieldMs = (): number => {
  if (sharedBudgetBaselineMs === null) {
    const run = 'c9qqqqq9wwwww9xxxxx9kkkkk ';
    const oneField = `\n\\qA\u200b\u2122 ${run.repeat(Math.ceil(8337 / run.length))}`.slice(0, 8337).replace(/\S*$/, '').trimEnd();
    const row = { actionType: 'CREATE_TASK', module: 'crm', title: 'Follow up', summary: oneField };
    sharedBudgetBaselineMs = Math.max(1, minElapsedBudgetMs(() => {
      expect(isFinancialProposal(row as any)).toBe(false);
    }, 3));
    expect(sharedBudgetBaselineMs, 'baseline single field').toBeLessThan(2_000);
  }
  return sharedBudgetBaselineMs;
};

const budgetCeilingMs = (floorMs: number, baselineMultiplier: number): number =>
  Math.max(floorMs, budgetBaselineFieldMs() * baselineMultiplier);

describe('seventh review of the #218 repairs: a reading budget, not a length cap; the remaining readings', () => {
  const task = (extra: object) => ({ actionType: 'CREATE_TASK', module: 'crm', title: 'Follow up', ...extra });
  const blind = (extra: object) => proposalViewForReader({ id: 'k', status: 'FAILED', ...task(extra) }, false) as any;
  const prose = (n: number) => 'Please call the client back about the garden plan. '.repeat(Math.ceil(n / 51)).slice(0, n);
  it.each([
    ['one quoted word in a long payload body', { payload: { body: `${prose(40_000)} She said "ok" twice.` } }],
    ['one Windows path in a long description', { description: `${prose(40_000)} See C:\\Users\\ana\\plan.docx` }],
    ['one emoji joiner in a long summary', { summary: `${prose(40_000)} \ud83d\udc68\u200d\ud83d\udc69 family` }],
    ['one no-break space in a long summary', { summary: `${prose(40_000)} 10\u00a0am` }],
    ['a long contact list with a quoted nickname', { executionResult: { contacts: Array.from({ length: 600 }, (_, i) => ({ name: i === 7 ? 'Ana "AJ" Perez' : `Person ${i}`, city: 'Port of Spain' })) } }],
  ])('RED-BEFORE (correctness m1): long ordinary content with %s is read, not refused for its length', (_l, extra) => {
    expect(isFinancialProposal(task(extra) as any)).toBe(false);
  });
  it('RED-BEFORE (security MINOR-1): one maximal crafted proposal costs a bounded amount, in the classifier and in the view', () => {
    const crafted = (n: number) => `\u200b\\\uFF19 ${'rate '.repeat(Math.floor(n / 5))}`.slice(0, n);
    const row = task({ title: crafted(4_000), summary: crafted(15_000), description: crafted(15_000), payload: { note: crafted(15_000) }, failureReason: crafted(49_000), outcomeEvidence: { status: 'FAILED', reason: crafted(40_000) } });
    const classifierMs = minElapsedBudgetMs(() => {
      expect(isFinancialProposal(row as any)).toBe(true);
    });
    expect(classifierMs, 'classifier').toBeLessThan(budgetCeilingMs(150, 5));
    const plain = task({ title: 'Call back', failureReason: crafted(49_000), outcomeEvidence: { status: 'FAILED', reason: crafted(40_000) } });
    const viewMs = minElapsedBudgetMs(() => {
      const out = proposalViewForReader({ id: 'k', status: 'FAILED', ...plain }, false) as any;
      expect(out.failureReason).toBeNull();
    });
    expect(viewMs, 'view').toBeLessThan(budgetCeilingMs(250, 6));
  });
  it.each(['Chase the 900\\noutstanding', 'Total due\\n900', '0\\routstanding'])('control (security MINOR-2; already read before the two new readings): %j', (summary) => {
    expect(isFinancialProposal(task({ summary }))).toBe(true);
    expect(proposalTextStatesMoney(summary)).toBe(true);
  });
  it.each(['\\u000bill\\n40', '\\u0074otal due\\n900', 'see \\u0066ee\\n40'])('RED-BEFORE (security MINOR-2): an escape read as a space keeps the other backslashes as written, and a decoded text reads its escapes as spaces (%j)', (summary) => {
    expect(isFinancialProposal(task({ summary }))).toBe(true);
    expect(proposalTextStatesMoney(summary)).toBe(true);
  });
  it.each(['customerowes900dollars111', 'cbalance900unpaid1200usd9', 'c9unpaid90000000000000000', 'c9owing900000000000000000'])('RED-BEFORE (security MINOR-3, correctness m2): a cuid-shaped run is kept when the proposal vocabulary reads a word in it (%s)', (token) => {
    expect(token).toHaveLength(25);
    expect(isFinancialProposal(task({ title: token }))).toBe(true);
    expect(isFinancialProposal(task({ summary: `see ${token}` }))).toBe(true);
    expect(blind({ failureReason: `failed: ${token}` }).failureReason).toBeNull();
  });
  it('control: a real cuid is still not read, and the fourth- and fifth-round cases stay read', () => {
    expect(isFinancialProposal(task({ title: 'Ticket cmzcku666tax29xx90fuyj0uu' }))).toBe(false);
    for (const summary of ['see\\ncost 900', 'c:\\clients\\tax\\2026', 'tax\u200Bdue Friday', 'Fees\u1D43: see note']) expect(isFinancialProposal(task({ summary })), summary).toBe(true);
  });
});

describe('eighth review of the #218 repairs: the budget is shared, and a kept id run is an added reading', () => {
  const task = (extra: object) => ({ actionType: 'CREATE_TASK', module: 'crm', title: 'Follow up', ...extra });
  const prose = (n: number) => 'Please call the client back about the garden plan. '.repeat(Math.ceil(n / 51)).slice(0, n);
  // Nine readings each: a zero-width space and a backslash before ordinary prose.
  const big = (n: number) => `\u200b\\ ${prose(n)}`.slice(0, n);
  it('the classifier budget is one for the whole proposal (correctness m2): one such field is read, two together fail closed', () => {
    expect(isFinancialProposal(task({ summary: big(20_000) }))).toBe(false);
    expect(isFinancialProposal(task({ description: big(20_000) }))).toBe(false);
    expect(isFinancialProposal(task({ summary: big(20_000), description: big(20_000) }))).toBe(true);
  });
  it('the view budget is one for the failure reason and the evidence together (correctness m2)', () => {
    const one = { id: 'k', status: 'FAILED', ...task({ failureReason: big(20_000) }) };
    expect(proposalViewForReader(one, false)).toBe(one);
    const both = { ...one, outcomeEvidence: { status: 'FAILED', reason: big(20_000) } };
    const out = proposalViewForReader(both, false) as any;
    expect(out.outcomeEvidence).toEqual({ status: 'FAILED', reason: null });
  });
  it('each call has its own budget (no shared default)', () => {
    for (let i = 0; i < 12; i++) expect(proposalTextStatesMoney(big(30_000)), String(i)).toBe(false);
  });
  it.each(['Total c900000000000000000paying attention 900', 'wire c900000000000000000paying heed 500', 'Total c900000000000000000paying a visit 900'])(
    'RED-BEFORE (security MINOR-1): a cuid-shaped run that is kept is also read as stripped, so it cannot stand between a money word and its figure (%j)',
    (text) => {
      expect(isFinancialProposal(task({ summary: text }))).toBe(true);
      expect(isFinancialProposal(task({ payload: { note: text } }) as any)).toBe(true);
      expect(proposalTextStatesMoney(text)).toBe(true);
    },
  );
});

describe('final confirmation review of the #218 repairs: the stripped readings are charged to the budget', () => {
  const task = (extra: object) => ({ actionType: 'CREATE_TASK', module: 'crm', title: 'Follow up', ...extra });
  it('RED-BEFORE (MINOR-2): a kept id run in budget-filling text does not double what is read; it fails closed', () => {
    // Raw readings (~196k chars) fit the budget; reading the kept id run both ways doubles to ~392k (> 300k).
    // Deterministic pin (P272): identical non-money prose fails closed ONLY when stripped readings are charged.
    const nonMoney = `C:\\new\\reports c900000000000000000paying attention ${'call back '.repeat(4_890)}`.slice(0, 49_000);
    expect(proposalTextStatesMoney(nonMoney)).toBe(true);
    const text = `C:\\new\\reports c900000000000000000paying attention ${'rate '.repeat(9_780)}`.slice(0, 49_000);
    const elapsed = minElapsedBudgetMs(() => {
      expect(proposalTextStatesMoney(text)).toBe(true);
    });
    expect(elapsed).toBeLessThan(budgetCeilingMs(60, 2.5));
  });
  it('control: the same text with a real id is read within the budget, and a short text with a kept id run is still read both ways', () => {
    const real = `C:\\new\\reports cmzcku666tax29xx90fuyj0uu ${'call back '.repeat(4_800)}`.slice(0, 49_000);
    expect(proposalTextStatesMoney(real)).toBe(false);
    expect(isFinancialProposal(task({ summary: 'Total c900000000000000000paying attention 900' }))).toBe(true);
  });
});

describe('review of the budget charge: over-budget text fails closed before the id pass, as it did', () => {
  const task = (extra: object) => ({ actionType: 'CREATE_TASK', module: 'crm', title: 'Follow up', ...extra });
  // 18 deduplicated raw readings (~898k chars) of cuid-shaped runs that hold no money word: over the budget on the raw readings alone.
  const crafted = `\n\\qA\u200b\u2122 ${'c9qqqqq9wwwww9xxxxx9kkkkk '.repeat(1_920)}`.slice(0, 49_890);
  it('RED-BEFORE (MAJOR-1): the classifier refuses it without running the id pass over every reading', () => {
    const elapsed = minElapsedBudgetMs(() => {
      expect(isFinancialProposal(task({ summary: crafted }))).toBe(true);
    });
    // Raw-budget refusal skips withoutIdTokens entirely (~0.05x baseline vs ~6x if all 18 raw readings ran through the id pass).
    expect(elapsed).toBeLessThan(budgetCeilingMs(60, 3));
  });
  it('RED-BEFORE (MAJOR-1): the view redacts it, in the reason and the evidence too, within the bound', () => {
    const row = { id: 'k', status: 'FAILED', ...task({ summary: crafted, failureReason: crafted, outcomeEvidence: { status: 'FAILED', reason: crafted.slice(0, 40_000) } }) };
    const elapsed = minElapsedBudgetMs(() => {
      expect(proposalViewForReader(row, false)).toEqual({ id: 'k', status: 'FAILED' });
    });
    expect(elapsed).toBeLessThan(budgetCeilingMs(120, 5));
  });
  it('text over the budget on its raw readings is refused even when stripping its ids would bring it under (MINOR-1)', () => {
    // Ends on a whole id (cut mid-id, the fragment alone stated money and the case passed for that reason).
    const idDense = `\n\\qA\u200b\u2122 ${'9cac7457-1fee-4cad-8fee-2cac3cac4fee '.repeat(1_348)}`.trimEnd();
    expect(idDense.length).toBeLessThan(50_000);
    expect(proposalTextStatesMoney(idDense)).toBe(true);
    expect(isFinancialProposal(task({ summary: idDense }))).toBe(true);
  });
});

describe('review of the budget repair: what one field costs is what its raw readings cost, across fields', () => {
  const run = 'c9qqqqq9wwwww9xxxxx9kkkkk ';
  const field = (n: number) => `\n\\qA\u200b\u2122 ${run.repeat(Math.ceil(n / run.length))}`.slice(0, n).replace(/\S*$/, '').trimEnd();
  const lengths = [8337, 7684, 7083, 6508, 5980, 5500, 5068, 3830];
  const [title, summary, description, rationale, expectedBenefit, risks, evidence, note] = lengths.map(field);
  const row = { id: 'k', status: 'PENDING', actionType: 'CREATE_TASK', module: 'crm', title, summary, description, rationale, expectedBenefit, risks, evidence: [{ note: evidence }], payload: { note } };
  it('RED-BEFORE (MAJOR-1): crafted id-dense text split across eight fields is refused, not read field by field', () => {
    // Deterministic refusal (zero money words across all 8 fields) + runner-calibrated cost bound
    // (2 fields = 288,030 raw chars before field 3 exhausts READING_BUDGET = 300,000; ~1.9x baseline vs ~6.3x for all 8 fields).
    const elapsed = minElapsedBudgetMs(() => {
      expect(isFinancialProposal(row as any)).toBe(true);
    });
    expect(elapsed, 'classifier').toBeLessThan(budgetCeilingMs(200, 4.5));
  });
  it('RED-BEFORE (MAJOR-1): and the view redacts it within the bound', () => {
    const elapsed = minElapsedBudgetMs(() => {
      expect(proposalViewForReader(row as any, false)).toEqual({ id: 'k', status: 'PENDING' });
    });
    expect(elapsed, 'view').toBeLessThan(budgetCeilingMs(250, 5));
  });
  it('control: an ordinary proposal with real ids in several fields is read and stays non-financial', () => {
    const real = (n: number) => `Booking cmzcku666tax29xx90fuyj0uu moved. ${'Please call the client back. '.repeat(Math.ceil(n / 29))}`.slice(0, n);
    expect(isFinancialProposal({ actionType: 'CREATE_TASK', module: 'crm', title: 'Follow up', summary: real(9_000), description: real(9_000), rationale: real(9_000), payload: { note: real(9_000) } } as any)).toBe(false);
  });
});
