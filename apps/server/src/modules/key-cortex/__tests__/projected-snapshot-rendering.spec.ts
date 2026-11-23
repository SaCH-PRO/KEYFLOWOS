/**
 * FU-PROPOSAL-REVENUE-SIGHT review repair (correctness MAJOR-1): the KEY prompt builders and the trust explanation
 * render the snapshot a reader without revenue read is handed (snapshotForViewer omits pendingInvoices and the money
 * metrics). They say nothing about a withheld figure, rather than "undefined".
 */
import { describe, it, expect } from 'vitest';
import { KeyCortexContextService, snapshotForViewer } from '../key-cortex-context.service';
import { KeyCortexPersonalityService } from '../key-cortex-personality.service';
import { TrustExplanationService } from '../trust-explanation.service';

const full = {
  businessId: 'biz_1', genomeDna: { finance: 40, operations: 70 }, genomeStage: 'growth', executiveReadiness: 55,
  recentTasks: ['Call Kerry'], recentEvents: [], keyMetrics: { totalRevenue: 98765, openTasks: 3 }, activeProjects: [],
  pendingInvoices: 7, unreadMessages: 2, teamStatus: 'ok', timestamp: new Date(),
} as any;
const projected = snapshotForViewer(full, false);

describe('the projected snapshot renders without "undefined"', () => {
  it('formatContextForPrompt', () => {
    const text = new KeyCortexContextService({} as any, {} as any).formatContextForPrompt(projected);
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('7 ');
  });
  it('the personality business context block', () => {
    const text = new KeyCortexPersonalityService().buildSystemPrompt('jarvis' as any, projected);
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('finance: 40');
  });
  it('the trust explanation of inaction on an invoice', () => {
    const svc = new TrustExplanationService() as any;
    const text: string = svc.explainInaction('CREATE_INVOICE', projected);
    expect(text).not.toContain('undefined');
  });
  it('control: the full snapshot still renders its counts', () => {
    expect(new KeyCortexContextService({} as any, {} as any).formatContextForPrompt(full)).toContain('7');
  });
});
