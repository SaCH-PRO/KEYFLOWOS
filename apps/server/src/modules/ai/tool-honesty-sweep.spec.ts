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

  it('checks the delivery result rather than discarding it', () => {
    // This used to assert ORDERING by string position — that
    // `getTransactionalEmail` appeared before `status: 'SENT'` in the source.
    // It passed against code that awaited send(), threw the result away, and
    // flipped the invoice to SENT on every failure path, because
    // TransactionalEmailService reports failure by RETURN VALUE and never
    // throws. Source order is not control flow.
    //
    // invoice-send-delivery.spec.ts is the real guard: it runs the handler with
    // a FAILED delivery and asserts nothing is flipped, nothing is logged, and
    // the caller is told. This one only checks the result is bound at all.
    const start = orchestrator.indexOf("case 'commerce_send_invoice':");
    const body = orchestrator.slice(start, start + 4000);

    expect(body).toMatch(/const delivery = await this\.getTransactionalEmail\(\)\.send\(/);
    expect(body).toMatch(/delivery\.status === 'FAILED'/);
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
    //
    // Second narrowing, 2026-08-07: the verb alone is not enough either.
    // payments_refund_charge says "this sends money OUT of the business" and
    // reaches a payment gateway, not a mail service — correctly, since money is
    // not a message. The rule is about outbound CONTACT, so the verb now has to
    // land on something a person receives.
    const OUTBOUND_MEDIUM = /\b(email|e-mail|message|sms|whatsapp|campaign|notification|reply|post|newsletter|reminder)\b/i;
    const senders = FLOW_TOOLS.filter(
      (t) =>
        t.family === 'execute' &&
        /\b(sends?|notif\w+)\b/i.test(t.description) &&
        OUTBOUND_MEDIUM.test(t.description),
    );

    expect(senders.length, 'expected some outbound tools to exist').toBeGreaterThan(0);

    // getKeyInbox was added when integration/2026-07-consolidation brought the
    // omnichannel inbox. inbox_reply_thread calls getKeyInbox().addReply(...,
    // { mode: 'send' }), and addReply delegates to replySender.sendReply — a
    // real outbound path for WhatsApp/email/SMS. The tool was honest; this list
    // simply predated the service.
    const MAIL_PATHS = /getTransactionalEmail|emailService|messageSender|sendCampaign|publishToChannels|getEmailMarketing|getKeyInbox|approval/i;

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

  it('no handler awaits a service and then reports its own arguments back', () => {
    // Seven handlers shared one shape, and the spec above did not look for it:
    //
    //   await this.getContentRequest().uploadDeliverables(id, fileIds, ...);
    //   return { requestId: args.requestId, uploaded: args.fileIds.length };
    //
    // The write happens. The report is fabricated from the inputs. `uploaded` is
    // the count KEY ASKED FOR, never the count that persisted. Worse variants
    // returned hardcoded values — evidence_verify returned `verified: true`
    // without reading the result, and content_submit_for_review returned
    // 'INTERNAL_REVIEW' while the domain writes 'internal_review', so feeding
    // the returned status back into content_transition_status threw.
    //
    // This is the same failure as a tool claiming to send an email it never
    // sent, one level quieter: the action is real and only the account of it is
    // invented. That is harder to notice, because nothing downstream breaks
    // until someone acts on the answer.
    //
    // The rule: if a handler drops the result of a service call, its return
    // cannot be built purely from `args` and literals — it has nothing to
    // describe what actually happened.
    const src = orchestrator.slice(orchestrator.indexOf('executeToolAction'));

    /**
     * Void writes. A delete that did not throw deleted; there is no richer
     * truth to report. Every entry must name why the call has no meaningful
     * return, and a handler whose service later starts returning something has
     * to leave this list.
     */
    const VOID_WRITES: Record<string, string> = {
      save_onboarding_step: 'saveStep returns void — saved unless it threw',
      crm_delete_contact: 'soft delete returns nothing meaningful',
      commerce_delete_invoice: 'delete returns nothing meaningful',
      projects_delete_task: 'delete returns nothing meaningful',
      payments_revoke_link: 'PaymentsOpsService.revokePaymentLink returns void and throws on failure',
    };

    const offenders: string[] = [];

    for (const match of src.matchAll(/case '([a-z0-9_]+)': \{/g)) {
      const name = match[1];
      if (VOID_WRITES[name]) continue;

      // Brace-match the case body. A fixed-size window bleeds into the next
      // case and reports handlers that are fine.
      let depth = 0;
      let end = match.end ?? src.length;
      for (let i = (match.index ?? 0) + match[0].length - 1; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) {
          end = i + 1;
          break;
        }
      }
      const body = src.slice((match.index ?? 0), end);

      // A service or prisma call whose result is never bound to anything.
      if (!/^\s+await this\.(get[A-Z]\w*\(\)|prisma)/m.test(body)) continue;

      const returns = [...body.matchAll(/return \{([\s\S]*?)\};/g)];
      if (!returns.length) continue;

      const last = returns[returns.length - 1][1];
      const values = [...last.matchAll(/:\s*([A-Za-z_$][\w.$]*)/g)].map((m) => m[1]);
      const fromLocals = values.filter(
        (v) => !v.startsWith('args.') && !['true', 'false', 'null', 'undefined'].includes(v),
      );

      if (!fromLocals.length) {
        offenders.push(`${name} -> {${last.trim().replace(/\s+/g, ' ').slice(0, 60)}}`);
      }
    }

    expect(
      offenders,
      'these discard what the service returned and answer with their own inputs — ' +
        'capture the result and report it, or add a VOID_WRITES entry saying why there is nothing to report',
    ).toEqual([]);
  });
});
