import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { JOURNEY_TEMPLATES, getJourneyTemplate } from './journey-templates';
import { FLOW_TOOLS } from './flow-tool-registry';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { JourneyOrchestratorService } from './journey-orchestrator.service';

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

const SPARSE_PAYLOAD: Record<string, any> = {
  businessId: 'biz_journey_sparse',
  contactId: 'cnt_journey_sparse',
  bookingId: 'bkg_journey_sparse',
  serviceName: '',
  status: 'LEAD',
  quoteId: 'qt_journey_sparse',
  invoiceId: 'inv_journey_sparse',
  orderId: 'ord_journey_sparse',
};

const SAMPLE_PREVIOUS: Record<string, any>[] = [
  { body: 'Please settle your invoice at your earliest convenience.', toolName: 'fetch_schedule_health', result: { utilizationPct: 40 } },
];

describe('FU-JOURNEY-TEMPLATES-SCHEMA: every JOURNEY_TEMPLATES step matches its FLOW_TOOLS schema', () => {
  const toolByName = new Map(FLOW_TOOLS.map((t) => [t.name, t]));
  const validator = makeValidator();

  it('every template step references a real FLOW_TOOLS tool and passes FlowOrchestratorService.validateToolInput on populated and sparse payloads', () => {
    const failures: string[] = [];

    for (const [labelSet, payload, prev] of [
      ['populated', SAMPLE_PAYLOAD, SAMPLE_PREVIOUS],
      ['sparse', SPARSE_PAYLOAD, []],
    ] as const) {
      for (const template of JOURNEY_TEMPLATES) {
        expect(template.steps.length, `${template.key} must have steps`).toBeGreaterThan(0);
        template.steps.forEach((step, idx) => {
          const label = `${labelSet}:${template.key}[${idx}] (${step.toolName})`;
          if (!toolByName.has(step.toolName)) {
            failures.push(`${label}: unknown toolName not in FLOW_TOOLS`);
            return;
          }
          const args = step.inputMapping(payload, [...prev]);
          try {
            validator.validateToolInput(step.toolName, { ...args });
          } catch (err) {
            failures.push(`${label}: ${(err as Error).message}`);
          }
        });
      }
    }

    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('reads prev[0]?.body (not stale .draft), uses utilizationPct, handles empty serviceName, and maps urgency boundaries cleanly', () => {
    const overdue = getJourneyTemplate('invoice-overdue')!;
    expect(overdue.steps[0].inputMapping({ invoiceId: 'inv_1' }, [])).toEqual({ invoiceId: 'inv_1', urgency: 'gentle' });
    expect(overdue.steps[0].inputMapping({ invoiceId: 'inv_1', daysOverdue: 13 }, [])).toEqual({ invoiceId: 'inv_1', urgency: 'gentle' });
    expect(overdue.steps[0].inputMapping({ invoiceId: 'inv_1', daysOverdue: 14 }, [])).toEqual({ invoiceId: 'inv_1', urgency: 'firm' });
    expect(overdue.steps[0].inputMapping({ invoiceId: 'inv_1', daysOverdue: 30 }, [])).toEqual({ invoiceId: 'inv_1', urgency: 'firm' });
    expect(overdue.steps[0].inputMapping({ invoiceId: 'inv_1', daysOverdue: 31 }, [])).toEqual({ invoiceId: 'inv_1', urgency: 'final' });

    expect(overdue.steps[1].inputMapping(SAMPLE_PAYLOAD, [{ body: 'Draft body from reminder' }]).body).toBe('Draft body from reminder');
    expect(overdue.steps[1].inputMapping(SAMPLE_PAYLOAD, [{ body: '' }]).body).toContain('overdue');

    const stale = getJourneyTemplate('stale-quote')!;
    expect(stale.steps[1].inputMapping(SAMPLE_PAYLOAD, [{ body: 'Draft body from followup' }]).body).toBe('Draft body from followup');
    expect(stale.steps[1].inputMapping(SAMPLE_PAYLOAD, [{ body: '' }]).body).toContain('quote');

    const postBooking = getJourneyTemplate('post-booking')!;
    expect(postBooking.steps[0].inputMapping({ contactId: 'c1', bookingId: 'b1', serviceName: '' }, []).items[0].description).toBe('Service');

    const weekly = getJourneyTemplate('weekly-hygiene')!;
    expect(weekly.steps[3].condition?.({}, [{ toolName: 'fetch_schedule_health', result: { utilizationPct: 85 } }])).toBe(false);
    expect(weekly.steps[3].condition?.({}, [{ toolName: 'fetch_schedule_health', result: { utilizationPct: 50 } }])).toBe(true);
  });

  it('executeJourney stamps authoritative businessId onto payload so empty or spoofed trigger payloads stay valid and tenant-bound', async () => {
    const createdSteps: Array<{ toolName: string; inputPayload: Record<string, any> }> = [];
    const prisma = {
      client: {
        autopilotSettings: { findUnique: vi.fn().mockResolvedValue(null) },
        journeyInstance: { create: vi.fn().mockResolvedValue({ id: 'ji_1' }) },
        aiPlan: { update: vi.fn().mockResolvedValue({}) },
        aiPlanStep: {
          create: vi.fn().mockImplementation(async ({ data }: { data: { toolName: string; inputPayload: Record<string, any> } }) => {
            createdSteps.push({ toolName: data.toolName, inputPayload: data.inputPayload });
            return { id: `step_${createdSteps.length}`, order: createdSteps.length };
          }),
        },
      },
    };
    const svc = new JourneyOrchestratorService(
      prisma as never,
      { emit: vi.fn() } as never,
      { createPlan: vi.fn().mockResolvedValue({ id: 'plan_1' }) } as never,
      { getToolTier: vi.fn().mockReturnValue(2) } as never,
      {} as never,
      {} as never,
    );

    const weekly = getJourneyTemplate('weekly-hygiene')!;

    // 1. Trigger with empty payload `{}` (as POST businesses/:businessId/journeys/weekly-hygiene/trigger)
    createdSteps.length = 0;
    await svc.executeJourney('biz_real', weekly, {});
    const briefStepEmpty = createdSteps.find((s) => s.toolName === 'generate_content_brief')!;
    expect(briefStepEmpty.inputPayload.businessId).toBe('biz_real');
    expect(() => validator.validateToolInput('generate_content_brief', { ...briefStepEmpty.inputPayload })).not.toThrow();

    // 2. Trigger with spoofed `{ businessId: 'biz_evil' }` — authoritative businessId wins
    createdSteps.length = 0;
    await svc.executeJourney('biz_real', weekly, { businessId: 'biz_evil' });
    const briefStepSpoof = createdSteps.find((s) => s.toolName === 'generate_content_brief')!;
    expect(briefStepSpoof.inputPayload.businessId).toBe('biz_real');
  });

  it('negative control: validateToolInput rejects undeclared legacy keys with BadRequestException naming the bad field', () => {
    expect(() =>
      validator.validateToolInput('crm_update_contact', { id: 'cnt_1', status: 'CLIENT' }),
    ).toThrow(BadRequestException);
    expect(() =>
      validator.validateToolInput('crm_update_contact', { id: 'cnt_1', status: 'CLIENT' }),
    ).toThrow(/Field "id" is not a parameter/);
    expect(() =>
      validator.validateToolInput('crm_add_note', { contactId: 'cnt_1', content: 'legacy key' }),
    ).toThrow(/Field "content" is not a parameter/);
    expect(() =>
      validator.validateToolInput('commerce_create_invoice', {
        contactId: 'cnt_1',
        items: [{ description: 'Service', amount: 100 }],
      }),
    ).toThrow(/Field "items\[0\]\.amount" is not a parameter/);
  });
});
