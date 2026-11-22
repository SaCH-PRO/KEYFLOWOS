/**
 * FU-PROPOSAL-REVENUE-SIGHT (owner ruling D-238; D-226, D-227, D-234): a KEY proposal record reaches a reader without
 * revenue read only when the underlying proposal is classified non-financial, by its action type, module, tool and
 * title; anything unknown or inadequately classified fails closed.
 */
import { describe, it, expect } from 'vitest';
import { isFinancialProposal, isMoneyMemoryEvent } from './genome-finance-scope';

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
