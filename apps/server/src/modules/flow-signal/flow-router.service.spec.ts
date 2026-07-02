import { describe, it, expect } from 'vitest';
import { FlowRouterService } from './flow-router.service';
import { FlowType } from '@prisma/client';

describe('FlowRouterService', () => {
  const router = new FlowRouterService();

  it('routes invoice.overdue into financial, temporal, and people flows', () => {
    const input = {
      businessId: 'biz_1',
      source: 'proactive_watcher',
      type: 'invoice.overdue',
      module: 'finance',
      entityType: 'Invoice',
      entityId: 'inv_1',
      title: 'Invoice overdue',
    };

    const routed = router.route(input);

    expect(routed.flows).toContain(FlowType.FINANCIAL);
    expect(routed.flows).toContain(FlowType.TEMPORAL);
    expect(routed.flows).toContain(FlowType.PEOPLE);
    expect(routed.ownerRoleHint).toBe('ACCOUNTS_RECEIVABLE_CLERK');
  });

  it('routes lead.created into people flow only', () => {
    const input = {
      businessId: 'biz_1',
      source: 'web_form',
      type: 'lead.created',
      entityType: 'Lead',
      entityId: 'lead_1',
      title: 'New lead',
    };

    const routed = router.route(input);

    expect(routed.flows).toContain(FlowType.PEOPLE);
    expect(routed.flows).not.toContain(FlowType.FINANCIAL);
    expect(routed.flows).not.toContain(FlowType.TEMPORAL);
  });

  it('preserves explicitly provided flows', () => {
    const input = {
      businessId: 'biz_1',
      source: 'app',
      type: 'custom.signal',
      title: 'Custom',
      flows: [FlowType.FINANCIAL],
    };

    const routed = router.route(input);

    expect(routed.flows).toContain(FlowType.FINANCIAL);
  });
});
