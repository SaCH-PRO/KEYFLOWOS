/**
 * PR196-SYSTEM-EMAIL (9B-D2, present in ours): SystemEmailService is the sink
 * every platform send goes through (sign-up verification, password reset,
 * receipts and alerts the platform owns), and sendTransactional logged the
 * recipient address on every outcome:
 *
 *   success          `Sent transactional email to <to> (id=...)`
 *   confirmed fail   `Resend send failed for <to>: ...`
 *   outcome unknown  `Resend send outcome unknown for <to>: ...`
 *
 * main.ts creates the app with no `logger` option, so Nest's default
 * ConsoleLogger prints every level: each line put a customer's or user's email
 * in the logs, which IA-044 / CF-029 (log_secret_pii_redaction) forbid. The fix
 * is at the sink, so every caller is covered. The logs keep what an operator
 * needs (the outcome, the provider id or error code) without the address, and a
 * provider error text that quotes the address is redacted before it is logged.
 *
 * The mail itself still goes to the recipient: only the logs change. No
 * provider traffic: the Resend client is a stand-in set on the service.
 */
import { BadRequestException, ConsoleLogger, Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SystemEmailService } from './system-email.service';
import { IdentitySignupService } from '../identity/identity-signup.service';
import { AiUsageAlertSchedulerService } from '../ai/ai-usage-alert-scheduler.service';
import { AiOversightService } from '../ai/ai-oversight.service';
import { ApprovalRoutingService } from '../ai/approval-routing.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { FinancialBriefingSchedulerService } from '../commerce/financial-briefing-scheduler.service';
import { AccountantExportEmailService } from '../finance/accountant-export-email.service';
import { FinanceController } from '../finance/finance.controller';
import { GlobalHttpExceptionFilter } from '../../core/filters/http-exception.filter';
import { errorRegistry } from '../../core/observability/error-registry';

const RECIPIENT = 'customer.d82@example.test';

type SendPayload = Record<string, unknown>;

function serviceWith(send: (payload: SendPayload) => Promise<unknown>) {
  const calls: SendPayload[] = [];
  const service = new SystemEmailService();
  Reflect.set(service, 'resend', {
    emails: {
      send: async (payload: SendPayload) => {
        calls.push(payload);
        return send(payload);
      },
    },
  });
  return { service, calls };
}

// W5-SYSTEM-EMAIL-CALLERS (SEC-W4HK-1): the two failures the sink rethrows as
// SystemEmailSendError, each with provider text that quotes the recipient.
const rejectQuotingAddress = async () => ({
  data: null,
  error: { name: 'validation_error', message: `"${RECIPIENT}" is on the suppression list` },
});
const loseQuotingAddress = async () => {
  throw new Error(`socket hang up while sending to ${RECIPIENT}`);
};

/** A Monday-07:00 FinancialBriefingScheduler over stand-ins for one business whose owner is RECIPIENT. */
function briefingSchedulerWith(email: SystemEmailService, businessId: string) {
  const prisma = {
    client: {
      business: {
        findMany: vi.fn(async () => [
          { id: businessId, timezone: 'America/Port_of_Spain', name: 'Briefing Test Biz', ownerId: 'owner_w5sec_briefing' },
        ]),
      },
      notification: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({})) },
      invoice: { aggregate: vi.fn(async () => ({ _sum: { total: 0 }, _count: 0 })) },
      expense: { aggregate: vi.fn(async () => ({ _sum: { amount: 0 } })) },
      financeActionItem: { findMany: vi.fn(async () => []) },
      // W10-OWNER-MEMBERSHIP (D-104, SEC-W10OM-6), trial-Z3 seam: the briefing goes to the owner only while
      // they hold a Membership of the business (businessOwnerRecipient reads user.findFirst with that filter).
      user: {
        findUnique: vi.fn(async () => ({ email: RECIPIENT })),
        findFirst: vi.fn(async () => ({ email: RECIPIENT, name: null })),
      },
    },
  };
  const copilot = {
    generateWeeklyBriefing: vi.fn(async () => ({
      summary: 'A quiet week.',
      lastWeekRevenue: 0,
      lastWeekExpenses: 0,
      lastWeekNet: 0,
      outstandingReceivables: 0,
      cashPosition: 0,
      highlights: [],
      concerns: [],
      recommendation: 'Keep going.',
      outlook: 'Steady.',
    })),
  };
  const scheduler = new FinancialBriefingSchedulerService(prisma as never, copilot as never, email);
  // The sweep only runs at Monday 07:00 local: pin the clock read, not the wall clock.
  Reflect.set(scheduler, 'getLocalTimeInfo', () => ({ hour: 7, dayOfWeek: 1, dateKey: '2026-11-09' }));
  return { scheduler, prisma };
}

/** An AccountantExportEmailService over stand-ins: the business has no saved accountant address. */
function accountantExportWith(email: SystemEmailService, businessId: string) {
  const prisma = {
    client: {
      business: {
        findUnique: vi.fn(async () => ({ id: businessId, name: 'Export Test Biz', currency: 'TTD', accountantEmail: null })),
        update: vi.fn(async () => ({})),
      },
    },
  };
  const exportSvc = {
    build: vi.fn(async () => ({
      filename: 'accountant-export-w5sec.zip',
      buffer: Buffer.from('zip'),
      bytes: 3,
      generatedAt: '2026-11-09T00:00:00.000Z',
    })),
  };
  return new AccountantExportEmailService(prisma as never, exportSvc as never, email);
}

describe('SystemEmailService.sendTransactional logs no recipient address (9B-D2, D-82)', () => {
  const entries: string[] = [];

  beforeEach(() => {
    process.env.RESEND_API_KEY = 're_test_d82_not_a_key';
    process.env.EMAIL_FROM_ADDRESS = 'no-reply@platform.example.test';
    entries.length = 0;
    const record = (...args: unknown[]) => {
      entries.push(args.map((a) => (typeof a === 'string' ? a : a instanceof Error ? `${a.message} ${a.stack ?? ''}` : JSON.stringify(a))).join(' '));
    };
    for (const level of ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation(record as never);
      vi.spyOn(Logger, level).mockImplementation(record as never);
      vi.spyOn(ConsoleLogger.prototype, level).mockImplementation(record as never);
    }
    for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
      vi.spyOn(console, level).mockImplementation(record as never);
    }
  });

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM_ADDRESS;
    delete process.env.AUTH_REQUIRE_EMAIL_VERIFICATION;
    delete process.env.SITE_URL;
    vi.restoreAllMocks();
  });

  function expectNoAddressLogged() {
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry).not.toContain(RECIPIENT);
      expect(entry).not.toContain('customer.d82');
    }
  }

  it('[9B-D2] RED-BEFORE: an accepted send logs its outcome and provider id, not the recipient', async () => {
    const { service } = serviceWith(async () => ({ data: { id: 'resend_ok_1' }, error: null }));

    await expect(service.sendTransactional({ to: RECIPIENT, subject: 'Verify your email', html: '<p>Hi</p>' }))
      .resolves.toEqual({ id: 'resend_ok_1' });

    expectNoAddressLogged();
    expect(entries.some((e) => e.includes('resend_ok_1'))).toBe(true);
  });

  it('[9B-D2] RED-BEFORE: a confirmed provider rejection logs no recipient, even when the provider text quotes it', async () => {
    const { service } = serviceWith(async () => ({
      data: null,
      error: { name: 'validation_error', message: `"${RECIPIENT}" is on the suppression list` },
    }));

    await expect(service.sendTransactional({ to: RECIPIENT, subject: 'Your receipt', html: '<p>Receipt</p>' }))
      .rejects.toMatchObject({ name: 'SystemEmailSendError', outcome: 'FAILED_CONFIRMED', providerCode: 'validation_error' });

    expectNoAddressLogged();
    expect(entries.some((e) => e.includes('validation_error'))).toBe(true);
  });

  it('[9B-D2] RED-BEFORE: an unknown outcome (lost response) logs no recipient, even when the transport error quotes it', async () => {
    const { service } = serviceWith(async () => {
      throw new Error(`socket hang up while sending to ${RECIPIENT}`);
    });

    await expect(service.sendTransactional({ to: RECIPIENT, subject: 'Reset your password', html: '<p>Reset</p>' }))
      .rejects.toMatchObject({ name: 'SystemEmailSendError', outcome: 'OUTCOME_UNKNOWN' });

    expectNoAddressLogged();
  });

  it('[D-82] platform transactional mail still sends: the payload goes to the recipient from the platform sender', async () => {
    const { service, calls } = serviceWith(async () => ({ data: { id: 'resend_ok_2' }, error: null }));

    await service.sendTransactional({ to: RECIPIENT, subject: 'Verify your email', html: '<p>Hi</p>', text: 'Hi' });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      to: RECIPIENT,
      from: 'Keyflow <no-reply@platform.example.test>',
      subject: 'Verify your email',
      html: '<p>Hi</p>',
    });
  });

  // Review finding SEC-W4HK-1 (W4-HOUSEKEEPING): the redaction above holds on
  // the sink's own lines only. The SystemEmailSendError the sink throws still
  // carries the provider text (system-email.service.ts:125 on a confirmed
  // rejection; :144 `Failed to send email: <message>` on an unknown outcome),
  // so a caller that logs err.message, or a 500 line that logs the stack,
  // relogs any address in it. That error's message contract is unchanged: the
  // callers redact (W5-SYSTEM-EMAIL-CALLERS, the negative controls below).
  it('[9B-D2] CHARACTERIZATION (SEC-W4HK-1): the redaction covers the sink\'s own lines only; the error it throws still carries the provider text, address included', async () => {
    const { service: rejecting } = serviceWith(async () => ({
      data: null,
      error: { name: 'validation_error', message: `"${RECIPIENT}" is on the suppression list` },
    }));
    const confirmed = await rejecting
      .sendTransactional({ to: RECIPIENT, subject: 'Verify your email', html: '<p>Hi</p>' })
      .catch((e: unknown) => e);
    expect(confirmed).toMatchObject({ name: 'SystemEmailSendError', outcome: 'FAILED_CONFIRMED', providerCode: 'validation_error' });
    expect((confirmed as Error).message).toContain(RECIPIENT);
    expect((confirmed as Error).stack ?? '').toContain(RECIPIENT);

    const { service: losing } = serviceWith(async () => {
      throw new Error(`socket hang up while sending to ${RECIPIENT}`);
    });
    const unknown = await losing
      .sendTransactional({ to: RECIPIENT, subject: 'Reset your password', html: '<p>Reset</p>' })
      .catch((e: unknown) => e);
    expect(unknown).toMatchObject({
      name: 'SystemEmailSendError',
      outcome: 'OUTCOME_UNKNOWN',
      message: `Failed to send email: socket hang up while sending to ${RECIPIENT}`,
    });

    // The sink's own lines still carry no address: that is what the census closes.
    expectNoAddressLogged();
  });

  // W5-SYSTEM-EMAIL-CALLERS (SEC-W4HK-1, review finding SE-3): the platform
  // sender's callers. Each one drives the real SystemEmailService (stand-in
  // Resend client) so the sink's own redacted line is logged too, and the
  // failure cases use provider text that quotes the recipient. Each caller line
  // keeps a non-identifying id (user, alert, business) and logs no address.
  it('[9B-D2, SEC-W4HK-1] W5-SYSTEM-EMAIL-CALLERS: IdentitySignupService logs no address when a verification send fails, on sign-up (:185) and on resend (:266), and names the user id', async () => {
    process.env.AUTH_REQUIRE_EMAIL_VERIFICATION = 'true';
    process.env.SITE_URL = 'https://app.example.test';
    const userId = 'user_w5sec_signup';
    const supabaseAdmin = {
      isConfigured: () => true,
      describeMissingConfig: () => null,
      createUser: vi.fn(async () => ({ id: userId, email: RECIPIENT })),
      generateSignupLink: vi.fn(async () => 'https://app.example.test/verify?t=fake_link'),
      generateConfirmationLink: vi.fn(async () => 'https://app.example.test/verify?t=fake_link_two'),
      findUserByEmail: vi.fn(async () => ({ id: userId, email: RECIPIENT, email_confirmed_at: null, user_metadata: {} })),
      deleteUser: vi.fn(async () => true),
    };
    const passwordPolicy = { validate: vi.fn(async () => undefined) };

    const { service: rejecting } = serviceWith(rejectQuotingAddress);
    const onSignup = new IdentitySignupService(supabaseAdmin as never, rejecting, passwordPolicy as never);
    const refused = await onSignup.signup({ email: RECIPIENT, password: 'Not-A-Real-Pass-91' }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(BadRequestException);
    expect((refused as BadRequestException).getResponse()).toMatchObject({ code: 'email_send_failed' });
    expect(supabaseAdmin.deleteUser).toHaveBeenCalledWith(userId);

    const { service: losing } = serviceWith(loseQuotingAddress);
    const onResend = new IdentitySignupService(supabaseAdmin as never, losing, passwordPolicy as never);
    await expect(onResend.resendVerification({ email: RECIPIENT })).resolves.toEqual({ ok: true });

    expectNoAddressLogged();
    expect(entries.some((e) => e.includes('sendVerificationEmail failed') && e.includes(userId))).toBe(true);
    expect(entries.some((e) => e.includes('resendVerification send failed') && e.includes(userId))).toBe(true);
  });

  // Review finding SEC-W5SEC-2: the same verification flow logged the address
  // on the Supabase steps before the send (generateSignupLink, the resend
  // lookup, generateConfirmationLink). The failure text here quotes the
  // address too, so the case also proves it is redacted.
  it('[9B-D2, SEC-W4HK-1] W5-SYSTEM-EMAIL-CALLERS (review SEC-W5SEC-2): IdentitySignupService logs no address when a Supabase link or lookup step fails, on sign-up (:169) and on resend (:239, :254), and names the user id where it has one', async () => {
    process.env.AUTH_REQUIRE_EMAIL_VERIFICATION = 'true';
    process.env.SITE_URL = 'https://app.example.test';
    const userId = 'user_w5sec_signup_link';
    const linkDown = async () => {
      throw new Error(`link service down for ${RECIPIENT}`);
    };
    const supabaseAdminWith = (overrides: Record<string, unknown>) => ({
      isConfigured: () => true,
      describeMissingConfig: () => null,
      createUser: vi.fn(async () => ({ id: userId, email: RECIPIENT })),
      generateSignupLink: vi.fn(async () => 'https://app.example.test/verify?t=fake_link'),
      generateConfirmationLink: vi.fn(async () => 'https://app.example.test/verify?t=fake_link_two'),
      findUserByEmail: vi.fn(async () => ({ id: userId, email: RECIPIENT, email_confirmed_at: null, user_metadata: {} })),
      deleteUser: vi.fn(async () => true),
      ...overrides,
    });
    const passwordPolicy = { validate: vi.fn(async () => undefined) };
    const { service: accepting, calls } = serviceWith(async () => ({ data: { id: 'resend_ok_never' }, error: null }));

    // Sign-up: generateSignupLink fails, the half-created user is rolled back.
    const signupAdmin = supabaseAdminWith({ generateSignupLink: vi.fn(linkDown) });
    const onSignup = new IdentitySignupService(signupAdmin as never, accepting, passwordPolicy as never);
    const refused = await onSignup.signup({ email: RECIPIENT, password: 'Not-A-Real-Pass-91' }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(BadRequestException);
    expect((refused as BadRequestException).getResponse()).toMatchObject({ code: 'email_send_failed' });
    expect(signupAdmin.deleteUser).toHaveBeenCalledWith(userId);

    // Resend: the user lookup fails (no user id to name yet).
    const lookupAdmin = supabaseAdminWith({ findUserByEmail: vi.fn(linkDown) });
    const onLookup = new IdentitySignupService(lookupAdmin as never, accepting, passwordPolicy as never);
    await expect(onLookup.resendVerification({ email: RECIPIENT })).resolves.toEqual({ ok: true });

    // Resend: generateConfirmationLink fails.
    const confirmAdmin = supabaseAdminWith({ generateConfirmationLink: vi.fn(linkDown) });
    const onConfirm = new IdentitySignupService(confirmAdmin as never, accepting, passwordPolicy as never);
    await expect(onConfirm.resendVerification({ email: RECIPIENT })).resolves.toEqual({ ok: true });

    expect(calls).toHaveLength(0);
    expectNoAddressLogged();
    expect(entries.some((e) => e.includes('generateSignupLink failed') && e.includes(userId))).toBe(true);
    expect(entries.some((e) => e.includes('resendVerification lookup failed') && e.includes('link service down'))).toBe(true);
    expect(entries.some((e) => e.includes('resendVerification link gen failed') && e.includes(userId))).toBe(true);
  });

  // Review findings SEC-W5SEC-1 / CR-W5SEC-1: a seventh caller of the sink.
  // ApprovalRoutingService.notifyApprover (approval-routing.service.ts:188)
  // returned the SystemEmailSendError message unchanged as `error`, and
  // AiOversightService.routeAndNotify logged it at warn (ai-oversight.service.ts
  // :558 approver, :569 tier-4 owner CC), so provider text that quotes the
  // recipient reached the log. W6-LOG-ADDRESSES-AND-DOCS routes both lines (and
  // the error text notifyApprover hands them) through redactAddresses (since its
  // repair for SEC-W6LOG-1, redactContactDetails: addresses and numbers). The case
  // drives the real routing service and the real sink (stand-in Resend client):
  // a tier-4 item delegated to an approver whose email is refused with text
  // quoting the approver's address, then the owner CC whose response is lost
  // with transport text quoting the owner's address.
  it('[9B-D2, SEC-W4HK-1] W6-LOG-ADDRESSES-AND-DOCS (review SEC-W5SEC-1): AiOversightService.routeAndNotify logs no provider text address when the approver email (ai-oversight.service.ts:558) or the tier-4 owner CC (:569) fails, and names the item id', async () => {
    const itemId = 'appr_w6log_tier4';
    const OWNER = 'customer.d82.owner@example.test';
    let sends = 0;
    const { service: failing, calls } = serviceWith(async (payload) => {
      sends += 1;
      if (sends === 1) {
        return { data: null, error: { name: 'validation_error', message: `"${String(payload.to)}" is on the suppression list` } };
      }
      throw new Error(`socket hang up while sending to ${String(payload.to)}`);
    });
    const prisma = {
      client: {
        delegationRule: {
          findMany: vi.fn(async () => [{ id: 'rule_w6log', scope: 'ALL', maxTier: 4, delegateId: 'asg_w6log_approver' }]),
        },
        orgAssignment: {
          findFirst: vi.fn(async () => ({
            id: 'asg_w6log_approver',
            membershipId: 'mem_w6log_approver',
            userId: 'user_w6log_approver',
            contactName: 'Approver W6',
            contactEmail: RECIPIENT,
            contactPhone: null,
            preferredChannel: 'email',
            jobRole: null,
            membership: null,
          })),
        },
        membership: {
          findFirst: vi.fn(async () => ({ id: 'mem_w6log_owner', userId: 'user_w6log_owner', user: { name: 'Owner W6', email: OWNER, phone: null } })),
        },
        aiApprovalItem: { update: vi.fn(async () => ({})) },
      },
    };
    const moduleRef = {
      get: (token: unknown) => {
        if (token === SystemEmailService) return failing;
        throw new Error('not provided in this spec');
      },
    };
    const routing = new ApprovalRoutingService(prisma as never, moduleRef as never);
    const oversight = new AiOversightService(prisma as never, {} as never, {} as never, {} as never, routing, {} as never);

    await Reflect.get(oversight, 'routeAndNotify').call(
      oversight,
      'biz_w6log_approval',
      { id: itemId, title: 'Void invoice INV-W6', description: null },
      4,
      'commerce',
    );

    // Both mails still went to their recipients; only the logs change.
    expect(calls.map((c) => c.to)).toEqual([RECIPIENT, OWNER]);
    // The route was recorded; no notifiedAt, since neither send went out.
    expect(prisma.client.aiApprovalItem.update).toHaveBeenCalledTimes(1);
    expectNoAddressLogged();
    expect(entries.some((e) => e.includes(`Failed to notify approver for item ${itemId}`) && e.includes('is on the suppression list'))).toBe(true);
    expect(entries.some((e) => e.includes(`Failed to CC owner for tier-4 item ${itemId}`) && e.includes('socket hang up'))).toBe(true);
  });

  // Review finding SEC-W6LOG-1 (9B-D2, IA-044/CF-029): the same two lines take
  // the WhatsApp leg when the approver's preferred channel is WhatsApp, and the
  // tier-4 owner CC takes it whenever the owner has a phone (resolveOwner).
  // WhatsAppService.sendMessage returns the provider's raw response body as
  // `error` on a refusal (sendViaTwilio, sendViaMeta), notifyApprover handed it
  // on unchanged, and both providers' bodies can quote the recipient's number,
  // which redactAddresses does not touch. The case drives the real
  // WhatsAppService (config and history stubbed, fetch a stand-in, no provider
  // traffic), the real ApprovalRoutingService and the real routeAndNotify, for
  // each provider.
  const APPROVER_PHONE = '+18685550142';
  const OWNER_PHONE = '+18685550199';
  function expectNoPhoneLogged() {
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      for (const digits of ['8685550142', '8685550199', '555-0142', '555-0199']) expect(entry).not.toContain(digits);
    }
  }

  it.each([
    {
      provider: 'twilio' as const,
      code: '21211',
      // A stand-in in the shape of Twilio's invalid-To body, which names the To parameter.
      refuse: (url: string, body: string) => {
        expect(url).toContain('api.twilio.com');
        const to = new URLSearchParams(body).get('To') ?? '';
        return { code: 21211, message: `The 'To' number ${to} is not a valid phone number.`, more_info: 'https://www.twilio.com/docs/errors/21211', status: 400 };
      },
      sentTo: (body: string) => new URLSearchParams(body).get('To'),
      expectedTo: [`whatsapp:${APPROVER_PHONE}`, `whatsapp:${OWNER_PHONE}`],
    },
    {
      provider: 'meta' as const,
      code: '131030',
      // A stand-in in the shape of Meta's Graph error body, quoting the number without its '+'.
      refuse: (url: string, body: string) => {
        expect(url).toContain('graph.facebook.com');
        const to = String((JSON.parse(body) as { to: string }).to).replace('+', '');
        return {
          error: {
            message: '(#131030) Recipient phone number not in allowed list',
            type: 'OAuthException',
            code: 131030,
            error_data: { messaging_product: 'whatsapp', details: `Recipient phone number ${to} not in allowed list` },
            fbtrace_id: 'Aw6LogFakeTraceId',
          },
        };
      },
      sentTo: (body: string) => (JSON.parse(body) as { to: string }).to,
      expectedTo: [APPROVER_PHONE, OWNER_PHONE],
    },
  ])('[9B-D2] W6-LOG-ADDRESSES-AND-DOCS repair (review SEC-W6LOG-1): routeAndNotify logs no recipient phone when the approver or the tier-4 owner CC takes the WhatsApp leg and $provider refuses with text quoting the number; both lines name the item id and the provider code', async ({ provider, code, refuse, sentTo, expectedTo }) => {
    const itemId = `appr_w6log_wa_${provider}`;
    const prisma = {
      client: {
        delegationRule: {
          findMany: vi.fn(async () => [{ id: 'rule_w6log_wa', scope: 'ALL', maxTier: 4, delegateId: 'asg_w6log_wa' }]),
        },
        orgAssignment: {
          findFirst: vi.fn(async () => ({
            id: 'asg_w6log_wa',
            membershipId: 'mem_w6log_wa',
            userId: 'user_w6log_wa',
            contactName: 'Approver W6 WhatsApp',
            contactEmail: null,
            contactPhone: APPROVER_PHONE,
            preferredChannel: 'whatsapp',
            jobRole: null,
            membership: null,
          })),
        },
        membership: {
          findFirst: vi.fn(async () => ({ id: 'mem_w6log_wa_owner', userId: 'user_w6log_wa_owner', user: { name: 'Owner W6', email: null, phone: OWNER_PHONE } })),
        },
        aiApprovalItem: { update: vi.fn(async () => ({})) },
      },
    };
    const whatsapp = new WhatsAppService({} as never, {} as never, {} as never, {} as never, {} as never);
    vi.spyOn(whatsapp, 'getConfig').mockResolvedValue(
      provider === 'twilio'
        ? { provider, accountSid: 'AC_w6log_not_a_sid', authToken: 'w6log-not-a-token', fromNumber: '+18685550100' }
        : { provider, phoneNumberId: 'pnid_w6log_not_real', accessToken: 'w6log-not-a-token', fromNumber: '+18685550100' },
    );
    const recorded: Array<{ errorMessage?: string | null }> = [];
    Reflect.set(whatsapp, 'recordMessage', vi.fn(async (_b: string, _p: string, data: { errorMessage?: string | null }) => { recorded.push(data); }));
    const fetchCalls: Array<{ url: string; body: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
      fetchCalls.push({ url, body: init.body });
      return new Response(JSON.stringify(refuse(url, init.body)), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }));
    try {
      const moduleRef = {
        get: (token: unknown) => {
          if (token === WhatsAppService) return whatsapp;
          throw new Error('not provided in this spec');
        },
      };
      const routing = new ApprovalRoutingService(prisma as never, moduleRef as never);
      const oversight = new AiOversightService(prisma as never, {} as never, {} as never, {} as never, routing, {} as never);

      await Reflect.get(oversight, 'routeAndNotify').call(
        oversight,
        'biz_w6log_wa',
        { id: itemId, title: 'Void invoice INV-W6-WA', description: null },
        4,
        'commerce',
      );
    } finally {
      vi.unstubAllGlobals();
    }

    // Both messages still went to their numbers; only the logs change.
    expect(fetchCalls.map((c) => sentTo(c.body))).toEqual(expectedTo);
    // The route was recorded; no notifiedAt, since neither send went out.
    expect(prisma.client.aiApprovalItem.update).toHaveBeenCalledTimes(1);
    // The provider text quoted each number (the stand-in is faithful), so the history row's error still does.
    expect(recorded.map((r) => r.errorMessage ?? '').every((m) => /8685550(142|199)/.test(m))).toBe(true);
    expectNoPhoneLogged();
    expect(entries.some((e) => e.includes(`Failed to notify approver for item ${itemId}`) && e.includes(code))).toBe(true);
    expect(entries.some((e) => e.includes(`Failed to CC owner for tier-4 item ${itemId}`) && e.includes(code))).toBe(true);
  });

  it('[9B-D2] W6-LOG-ADDRESSES-AND-DOCS repair (review SEC-W6LOG-1): notifyApprover returns a WhatsApp provider refusal as its code only, and any other WhatsApp failure text with every phone number and address redacted', async () => {
    const route = {
      approverAssignmentId: 'asg_w6log_wa_direct',
      approverMembershipId: null,
      approverUserId: null,
      displayName: 'Approver W6',
      channel: 'whatsapp' as const,
      contactPhone: APPROVER_PHONE,
      contactEmail: null,
      method: 'delegation_rule' as const,
      reason: 'test',
    };
    const item = { id: 'appr_w6log_wa_direct', title: 'Void invoice INV-W6-WA', description: null, riskTier: 4 };
    const errorFor = async (error: string | undefined) => {
      const sendMessage = vi.fn(async () => ({ success: false, error }));
      const routing = new ApprovalRoutingService({} as never, { get: () => ({ sendMessage }) } as never);
      const result = await routing.notifyApprover('biz_w6log_wa_direct', route, item);
      expect(sendMessage).toHaveBeenCalledWith('biz_w6log_wa_direct', expect.objectContaining({ to: APPROVER_PHONE }));
      expect(result.sent).toBe(false);
      return result.error ?? '';
    };

    // A provider body: the code, never the text.
    const twilio = await errorFor(JSON.stringify({ code: 21211, message: `The 'To' number whatsapp:${APPROVER_PHONE} is not a valid phone number.` }));
    expect(twilio).toContain('21211');
    expect(twilio).not.toContain('8685550142');
    expect(twilio).not.toContain('is not a valid phone number');
    const meta = await errorFor(JSON.stringify({ error: { code: 131030, message: 'Recipient phone number not in allowed list', error_data: { details: 'Recipient 18685550142' } } }));
    expect(meta).toContain('131030');
    expect(meta).not.toContain('8685550142');
    const noCode = await errorFor(JSON.stringify({ detail: `rejected ${APPROVER_PHONE}` }));
    expect(noCode).not.toContain('8685550142');
    expect(noCode).not.toContain('rejected');

    // Not a provider body: the words stay, every number and address in them is redacted.
    for (const spelling of [APPROVER_PHONE, 'whatsapp:+18685550142', '18685550142', '+1 (868) 555-0142', '868-555-0142']) {
      const text = await errorFor(`Bad gateway while sending to ${spelling} for approver.w6log@example.test`);
      expect(text).toContain('Bad gateway while sending to');
      expect(text).not.toMatch(/555.?0142/);
      expect(text).not.toContain('approver.w6log@example.test');
    }
    // WhatsAppService's own reasons carry no number and pass unchanged.
    expect(await errorFor('WhatsApp not configured')).toBe('WhatsApp not configured');
    expect(await errorFor('Invalid phone number')).toBe('Invalid phone number');
    // A refusal with no text still says so.
    expect(await errorFor(undefined)).toBeTruthy();
  });

  it('[9B-D2, SEC-W4HK-1] W5-SYSTEM-EMAIL-CALLERS: AiUsageAlertSchedulerService logs no provider text address when an alert email fails (:156), and names the alert id', async () => {
    const alert = {
      id: 'alert_w5sec_1',
      businessId: 'biz_w5sec_alert',
      type: 'budget_threshold',
      threshold: 80,
      metadata: { used: 80, limit: 100, pct: 80 },
      triggeredAt: new Date('2026-11-09T07:00:00.000Z'),
    };
    const prisma = {
      client: {
        aiUsageAlert: { findMany: vi.fn(async () => [alert]), update: vi.fn(async () => ({})) },
        business: { findUnique: vi.fn(async () => ({ name: 'Alert Test Biz', email: RECIPIENT, ownerId: null })) },
        user: { findUnique: vi.fn(async () => null) },
      },
    };
    const { service: rejecting, calls } = serviceWith(rejectQuotingAddress);
    const moduleRef = {
      get: (token: unknown) => {
        if (token === SystemEmailService) return rejecting;
        throw new Error('not provided in this spec');
      },
    };
    const scheduler = new AiUsageAlertSchedulerService(prisma as never, moduleRef as never);

    await expect(scheduler.tick()).resolves.toEqual({ dispatched: 1 });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ to: RECIPIENT });
    expectNoAddressLogged();
    expect(entries.some((e) => e.includes('Email notification failed for alert alert_w5sec_1'))).toBe(true);
  });

  it('[9B-D2, SEC-W4HK-1] W5-SYSTEM-EMAIL-CALLERS: FinancialBriefingScheduler logs no owner address after the Monday briefing send (:263, review finding SE-3), and names the business id', async () => {
    const { service: accepting, calls } = serviceWith(async () => ({ data: { id: 'resend_ok_briefing' }, error: null }));
    const { scheduler, prisma } = briefingSchedulerWith(accepting, 'biz_w5sec_briefing_ok');

    await Reflect.get(scheduler, 'checkAndRunBriefings').call(scheduler);

    expect(prisma.client.notification.create).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ to: RECIPIENT });
    expectNoAddressLogged();
    expect(entries.some((e) => e.includes('Email sent') && e.includes('biz_w5sec_briefing_ok'))).toBe(true);
  });

  it('[9B-D2, SEC-W4HK-1] W5-SYSTEM-EMAIL-CALLERS: FinancialBriefingScheduler logs no provider text address when the briefing email fails (:269), and names the business id', async () => {
    const { service: losing, calls } = serviceWith(loseQuotingAddress);
    const { scheduler, prisma } = briefingSchedulerWith(losing, 'biz_w5sec_briefing_fail');

    await Reflect.get(scheduler, 'checkAndRunBriefings').call(scheduler);

    // The in-app notification still lands; only the email failed.
    expect(prisma.client.notification.create).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expectNoAddressLogged();
    expect(entries.some((e) => e.includes('Email send failed for biz_w5sec_briefing_fail'))).toBe(true);
  });

  it('[9B-D2, SEC-W4HK-1] W5-SYSTEM-EMAIL-CALLERS: AccountantExportEmailService logs no recipient after the export send (:103, review finding SE-3), and names the business id; the response still names the recipient', async () => {
    const { service: accepting, calls } = serviceWith(async () => ({ data: { id: 'resend_ok_export' }, error: null }));
    const exporter = accountantExportWith(accepting, 'biz_w5sec_export_ok');

    const result = await exporter.send({
      businessId: 'biz_w5sec_export_ok',
      periodStart: new Date('2026-10-01T00:00:00.000Z'),
      periodEnd: new Date('2026-10-31T23:59:59.999Z'),
      to: RECIPIENT,
    });

    expect(result).toMatchObject({ to: RECIPIENT, messageId: 'resend_ok_export' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ to: RECIPIENT });
    expectNoAddressLogged();
    expect(entries.some((e) => e.includes('Sent accountant export') && e.includes('business=biz_w5sec_export_ok'))).toBe(true);
  });

  it('[9B-D2, SEC-W4HK-1] W5-SYSTEM-EMAIL-CALLERS: a failed accountant export send logs no provider text address on the 500 line or in the error registry (finance.controller.ts:1169, http-exception.filter.ts:71); the 500 body and the error class, outcome and code are unchanged', async () => {
    const businessId = 'biz_w5sec_export_fail';
    const { service: rejecting } = serviceWith(rejectQuotingAddress);
    const controller = Object.create(FinanceController.prototype) as FinanceController;
    Reflect.set(controller, 'prisma', { client: { business: { findFirst: vi.fn(async () => ({ id: businessId })) } } });
    Reflect.set(controller, 'accountantExportEmail', accountantExportWith(rejecting, businessId));

    const thrown = await controller
      .accountantExportEmailSend(
        businessId,
        { periodStart: '2026-10-01', periodEnd: '2026-10-31', to: RECIPIENT },
        { user: { id: 'user_w5sec_finance' } },
      )
      .catch((e: unknown) => e);
    expect(thrown).toMatchObject({ name: 'SystemEmailSendError', outcome: 'FAILED_CONFIRMED', providerCode: 'validation_error' });

    // What the route does with it: the global filter answers 500 and logs the stack.
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const req = {
      method: 'POST',
      url: `/finance/businesses/${businessId}/accountant-export/email`,
      route: { path: '/finance/businesses/:businessId/accountant-export/email' },
      correlationId: 'cid_w5sec_export',
    };
    const host = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }) };
    errorRegistry.reset();
    new GlobalHttpExceptionFilter().catch(thrown, host as never);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 500, code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' }),
    );
    expect(entries.some((e) => e.includes('Unhandled exception on POST /finance/businesses/:businessId/accountant-export/email'))).toBe(true);
    expectNoAddressLogged();
    const recorded = JSON.stringify(errorRegistry.snapshot());
    expect(recorded).toContain('is on the suppression list');
    expect(recorded).not.toContain(RECIPIENT);
    errorRegistry.reset();
  });
});
