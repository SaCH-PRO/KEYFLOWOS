/**
 * Tools that reported success for work that never happened.
 *
 * Five were verified against the code, one at a time, and they are not a
 * coincidence — they are one defect wearing five costumes: the record of the
 * action is written by a different piece of code than the action, and only the
 * record is checked.
 *
 *   commerce_send_invoice        "Send an invoice to the customer via email" —
 *                                flipped status to SENT, wrote an activity log
 *                                reading "Invoice INV-001 sent to Ada", and
 *                                called no email service at all.
 *   schedule_action              "Schedule a future action to execute at a
 *                                specific time" — wrote one ActivityLog row
 *                                with status 'scheduled'. Nothing anywhere
 *                                reads it back. Friday never came.
 *   automations_create_playbook  Created an Automation with `actionData: []`,
 *                                hardcoded, with no actions parameter on the
 *                                tool. Enabled, visible in the UI, firing on
 *                                its trigger and doing nothing, forever.
 *   store_list_products          Advertised "with pricing and stock" and
 *                                selected no stock field.
 *   bulkUpdateInvoices           `updated` was honest, but every failure was
 *                                swallowed, so ten-of-ten failures returned
 *                                { updated: 0 } and no reason.
 *
 * The same family as markCampaignSent emitting recipientCount: 0, and social
 * publishPost marking POSTED with no connected account. Both already fixed.
 *
 * Trust is the whole product. A JARVIS that says "done" when nothing happened
 * is worse than one that says "I can't".
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FLOW_TOOLS, getToolByName } from './flow-tool-registry';
import { FlowService } from '../flow/flow.service';

const orchestrator = readFileSync(join(__dirname, 'flow-orchestrator.service.ts'), 'utf8');

describe('a tool that promises an email sends one', () => {
  it('commerce_send_invoice reaches a mail service', () => {
    const start = orchestrator.indexOf("case 'commerce_send_invoice':");
    const body = orchestrator.slice(start, start + 2400);

    expect(body, 'the handler never calls a mail service').toMatch(/getTransactionalEmail\(\)\.send\(/);
  });

  it('sends BEFORE marking the invoice SENT', () => {
    // Ordering is the assertion. If the status flip came first, a delivery
    // failure would leave the invoice recorded as sent with nothing sent —
    // exactly the state this is fixing, reached by a different route.
    const start = orchestrator.indexOf("case 'commerce_send_invoice':");
    const body = orchestrator.slice(start, start + 2400);

    expect(body.indexOf('getTransactionalEmail')).toBeLessThan(body.indexOf("status: 'SENT'"));
  });

  it('tells the caller where it went', () => {
    const start = orchestrator.indexOf("case 'commerce_send_invoice':");
    const body = orchestrator.slice(start, start + 4000);

    expect(body).toMatch(/emailedTo/);
  });
});

describe('a tool that cannot keep its promise is removed, not left advertised', () => {
  it('schedule_action is gone', () => {
    // It claimed future execution and nothing executed it. create_task already
    // covers the real need — a real ContactTask with a dueDate, which humans
    // and the autopilot loops actually read — so the honest fix was deletion,
    // not a second inert implementation.
    expect(getToolByName('schedule_action')).toBeUndefined();
  });

  it('and its handler is gone with it', () => {
    expect(orchestrator).not.toMatch(/case 'schedule_action':/);
  });

  it('create_task still covers the use case it was replacing', () => {
    const createTask = getToolByName('create_task');

    expect(createTask).toBeDefined();
    expect(Object.keys(createTask!.parameters.properties)).toContain('dueDate');
  });
});

describe('an automation that cannot act is not presented as live', () => {
  function makeFlow() {
    const created: any[] = [];
    const service = Object.assign(Object.create(FlowService.prototype), {
      prisma: {
        client: {
          automation: {
            create: vi.fn(async ({ data }: any) => {
              created.push(data);
              return { id: 'auto_1', ...data };
            }),
          },
        },
      },
    });
    return { service, created };
  }

  it('stores the actions it was given', async () => {
    const { service, created } = makeFlow();

    await service.createAutomation({
      businessId: 'biz_1',
      name: 'Tag new leads',
      trigger: 'contact_created',
      actions: [{ type: 'add_tag', tag: 'new-lead' }],
    });

    expect(created[0].actionData).toEqual([{ type: 'add_tag', tag: 'new-lead' }]);
  });

  it('enables it, because it can actually do something', async () => {
    const { service, created } = makeFlow();

    await service.createAutomation({
      businessId: 'biz_1',
      name: 'Tag new leads',
      trigger: 'contact_created',
      actions: [{ type: 'add_tag', tag: 'new-lead' }],
    });

    expect(created[0].enabled).toBe(true);
  });

  it('creates it DISABLED when there are no actions', async () => {
    // The defect: actionData was hardcoded to [] and enabled to true, so the
    // owner saw a live playbook in the list that could never do anything.
    const { service, created } = makeFlow();

    await service.createAutomation({ businessId: 'biz_1', name: 'Empty', trigger: 'contact_created' });

    expect(created[0].actionData).toEqual([]);
    expect(created[0].enabled).toBe(false);
  });

  it('the tool requires actions rather than quietly defaulting them', () => {
    const tool = getToolByName('automations_create_playbook')!;

    expect(tool.parameters.required).toContain('actions');
    expect(Object.keys(tool.parameters.properties)).toContain('actions');
  });
});

describe('descriptions do not promise fields the query never selects', () => {
  it('store_list_products no longer claims to return stock', () => {
    const tool = getToolByName('store_list_products')!;
    const start = orchestrator.indexOf("case 'store_list_products':");
    const handler = orchestrator.slice(start, start + 900);

    const promisesStock = /\bstock\b/i.test(tool.description) && !/does NOT include stock/i.test(tool.description);
    const returnsStock = /stock|quantity|inventory/i.test(handler);

    expect(
      promisesStock && !returnsStock,
      'the description promises stock the select does not return',
    ).toBe(false);
  });
});

describe('bulk operations report what failed', () => {
  it('surfaces failures rather than logging them and moving on', () => {
    const commerce = readFileSync(join(__dirname, '..', 'commerce', 'commerce.service.ts'), 'utf8');
    const start = commerce.indexOf('async bulkUpdateInvoices');
    const body = commerce.slice(start, start + 2200);

    expect(body).toMatch(/failed\.push\(/);
    expect(body).toMatch(/failedCount/);
  });
});

describe('the class of defect, not just the instances', () => {
  it('no tool description claims to send, email or notify without a mail path', () => {
    // The durable version. A tool whose description promises outbound contact
    // must reach something that can perform it — the next one written from a
    // description rather than from the code fails here.
    // "send"/"notify" as a VERB, on tools that claim to EXECUTE. Matching the
    // word "email" anywhere caught crm_search_contacts, whose description
    // merely names email as a searchable field — a false positive that would
    // have made this test noise, and noisy tests get deleted rather than fixed.
    const senders = FLOW_TOOLS.filter(
      (t) => t.family === 'execute' && /\b(sends?|notif\w+)\b/i.test(t.description),
    );

    expect(senders.length, 'expected some outbound tools to exist').toBeGreaterThan(0);

    const MAIL_PATHS = /getTransactionalEmail|emailService|messageSender|sendCampaign|publishToChannels|getEmailMarketing|approval/i;

    for (const tool of senders) {
      const start = orchestrator.indexOf(`case '${tool.name}':`);
      if (start === -1) continue; // bridged tools dispatch elsewhere
      const body = orchestrator.slice(start, start + 2600);

      expect(
        MAIL_PATHS.test(body),
        `${tool.name} says it sends something but its handler reaches no send path`,
      ).toBe(true);
    }
  });
});
