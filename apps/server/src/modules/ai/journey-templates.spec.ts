import { describe, it, expect } from 'vitest';
import { JOURNEY_TEMPLATES } from './journey-templates';
import { FLOW_TOOLS } from './flow-tool-registry';
import { FlowOrchestratorService } from './flow-orchestrator.service';

function makeValidator(): {
  validateToolInput: (toolName: string, args: Record<string, any>) => void;
} {
  return Object.create(FlowOrchestratorService.prototype) as {
    validateToolInput: (toolName: string, args: Record<string, any>) => void;
  };
}

const SAMPLE_PAYLOAD: Record<string, any> = {
  businessId: 'biz_journey_test',
  contactId: 'cnt_journey_test',
  contactName: 'Ada Lovelace',
  bookingId: 'bkg_journey_test',
  serviceName: 'Strategy Consultation',
  amount: 250,
  status: 'LEAD',
  quoteId: 'qt_journey_test',
  invoiceId: 'inv_journey_test',
  invoiceNumber: 'INV-1001',
  daysOverdue: 35,
  daysStale: 10,
  channel: 'email',
  orderId: 'ord_journey_test',
  orderNumber: 'ORD-500',
  total: 120,
  date: '2026-11-30',
};

const SAMPLE_PREVIOUS: Record<string, any>[] = [
  { draft: 'Please settle your invoice at your earliest convenience.', toolName: 'fetch_schedule_health', result: { utilization: 40 } },
];

describe('FU-JOURNEY-TEMPLATES-SCHEMA: every JOURNEY_TEMPLATES step matches its FLOW_TOOLS schema', () => {
  const toolByName = new Map(FLOW_TOOLS.map((t) => [t.name, t]));
  const validator = makeValidator();

  it('every template step references a real FLOW_TOOLS tool and passes FlowOrchestratorService.validateToolInput', () => {
    const failures: string[] = [];

    for (const template of JOURNEY_TEMPLATES) {
      expect(template.steps.length, `${template.key} must have steps`).toBeGreaterThan(0);
      template.steps.forEach((step, idx) => {
        const label = `${template.key}[${idx}] (${step.toolName})`;
        if (!toolByName.has(step.toolName)) {
          failures.push(`${label}: unknown toolName not in FLOW_TOOLS`);
          return;
        }
        const args = step.inputMapping(SAMPLE_PAYLOAD, SAMPLE_PREVIOUS);
        try {
          validator.validateToolInput(step.toolName, { ...args });
        } catch (err) {
          failures.push(`${label}: ${(err as Error).message}`);
        }
      });
    }

    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('negative control: validateToolInput rejects undeclared legacy keys like crm_update_contact.id and crm_add_note.content', () => {
    expect(() =>
      validator.validateToolInput('crm_update_contact', { id: 'cnt_1', status: 'CLIENT' }),
    ).toThrow();
    expect(() =>
      validator.validateToolInput('crm_add_note', { contactId: 'cnt_1', content: 'legacy key' }),
    ).toThrow();
    expect(() =>
      validator.validateToolInput('commerce_create_invoice', {
        contactId: 'cnt_1',
        items: [{ description: 'Service', amount: 100 }],
      }),
    ).toThrow();
  });
});
