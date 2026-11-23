import { describe, it, expect } from 'vitest';
import { isFinancialProposal, proposalTextStatesMoney } from './genome-finance-scope';

/**
 * FU-KEY-GENOME-READS-RESIDUAL (D-235): the reading budget charges a field for everything the vocabulary reads, its
 * stripped readings included, so two fields whose kept (worded) cuid runs double their readings share one budget. A
 * field charged only its raw readings would let both be read field by field.
 */
describe('the reading budget across fields with worded cuid runs', () => {
  const task = (extra: object) => ({ actionType: 'CREATE_TASK', module: 'crm', title: 'Follow up', ...extra });
  // A backslash path gives several raw readings; the kept cuid-shaped run ("paying" is read as a money word in it)
  // doubles them with its stripped reading. Nothing in the text states money.
  const field = (n: number) => `C:\\new\\reports c900000000000000000paying attention ${'call back '.repeat(Math.ceil(n / 10))}`.slice(0, n);
  // Four raw readings, eight charged: one field costs ~168,000 of the 300,000; two cost ~336,000. Charged only their raw
  // readings (~84,000 each), both would be read.
  const text = field(21_000);

  it('control: one such field states no money and is read within the budget', () => {
    expect(proposalTextStatesMoney(text)).toBe(false);
    expect(isFinancialProposal(task({ summary: text }))).toBe(false);
    expect(isFinancialProposal(task({ description: text }))).toBe(false);
  });

  it('two fields with worded cuid runs are financial: together their readings run the budget out', () => {
    expect(isFinancialProposal(task({ summary: text, description: text }))).toBe(true);
  });
});
