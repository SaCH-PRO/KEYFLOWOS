import { Body, Controller, Delete, Get, Headers, Inject, Param, Post, Query, Req, UseGuards, Optional, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Request } from 'express';
import Stripe from 'stripe';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { StripeConnector } from '../../core/connectors/implementations/stripe.connector';
import { PaymentsService, STRIPE_LEGACY_REFUSED_PROVIDER } from '../payments/payments.service';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { randomBytes } from 'crypto';
import { checkWebhookUrl, WebhookUrlRefusedError } from './webhook-url';
import { maskWebhookUrl, webhookEventModule, webhookEventReads } from './webhook-events';
import { memberModuleLevel, type ModuleLevelActor } from '../../core/auth/member-module-level';
import { LEVEL_RANK, type AccessLevel } from '../../core/authority/module-vocabulary';
import { resolveCrmAccess } from '../crm/crm-permissions.helper';

/** The member a webhook route acts for (AuthMiddleware attaches it; AuthGuard requires it). */
type WebhookActorRequest = { user?: { id?: string; role?: string } };

/**
 * SWEEP-P0-SCOPES (BUG-001): the webhook fields a read answers. The signing secret is not one of
 * them: it is answered in the create answer and, in a read, only to a member with settings admin
 * (review CR-5: WEBHOOK_ADMIN_FIELDS).
 */
const WEBHOOK_PUBLIC_FIELDS = {
  id: true,
  businessId: true,
  name: true,
  url: true,
  events: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * SWEEP-P0-SCOPES review repair (CR-5): settings admin (the owner and ADMINs by role default) reads a
 * webhook's signing secret again, for a webhook whose events they may receive (second review SV-5).
 */
const WEBHOOK_ADMIN_FIELDS = { ...WEBHOOK_PUBLIC_FIELDS, secret: true } as const;

/**
 * The reads a member's webhook decisions take, memoised for one request: a module level (as
 * ModuleScopeGuard reads it) and whether every contact is in their view.
 */
interface WebhookEventReader {
  level(module: string): Promise<AccessLevel>;
  /** Why the member may not receive these events (the refusal's words), or null when they may. Events that are not webhook events are skipped. */
  refusal(events: readonly string[]): Promise<string | null>;
}

/** Every answer of the deprecated Stripe route names its replacement. */
const LEGACY_STRIPE_HINT = { deprecated: true, use: '/payments/stripe/webhook' } as const;

/**
 * The payment event types for which this route emits the Stripe connector's
 * 'payment.received' once the door has recorded them for an invoice (R0-20b
 * review CR-R020B-2). They are not a binding: the door binds every payment
 * event it is handed (R0-20d).
 */
const STRIPE_INVOICE_PAYMENT_EVENTS = new Set(['checkout.session.completed', 'charge.succeeded', 'payment_intent.succeeded']);

/** The fields of a Stripe session, charge or payment intent the connector event reads. */
type StripePaymentObject = {
  id?: string | null;
  metadata?: Record<string, string> | null;
  client_reference_id?: string | null;
};

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);
  private readonly stripe: Stripe | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(WebhookDispatcherService) private readonly dispatcher: WebhookDispatcherService,
    // R0-20b review (CR-R020B-2): the connector event 'payment.received' the route emitted before R0-20b.
    @Optional() @Inject(StripeConnector) private readonly stripeConnector?: StripeConnector,
  ) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (secretKey) {
      this.stripe = new Stripe(secretKey, { apiVersion: '2025-08-27.basil' });
    }
  }

  @Get('health')
  health() {
    return { status: 'ok', module: 'webhooks' };
  }

  @Post('stripe')
  async handleStripeWebhook(
    @Req() req: Request,
    @Headers('stripe-signature') signature: string,
  ) {
    // ─── DEPRECATED — consolidated into /payments/stripe/webhook ────────────
    // The legacy /webhooks/stripe endpoint has been superseded by
    // /payments/stripe/webhook. It stays live for Stripe Dashboard
    // configurations that still point here.
    //
    // R0-20b-LEGACY-STRIPE-WEBHOOK-DOOR (D-05, ruled 2026-11-02; RA-G16-01):
    // after the signature check below, the verified bytes go to the same
    // Stripe ledger door POST /payments/stripe/webhook runs
    // (PaymentsService.handleStripeWebhook: the binding of a payment event to
    // the invoice or storefront order it names, provider-event dedupe, one
    // SUCCESSFUL provider 'stripe' payment posted with it, the reconcile). An
    // event the binding accepts is recorded once, whether it reaches this
    // endpoint, the door's own endpoint or both; one it refuses is recorded by
    // neither. R0-20d (W3-STRIPE-LEGACY-BINDING): the door's binding
    // (bindStripePaymentEvent, R0-20c) is this route's only one; the copy this
    // controller kept (bindLegacyStripeEvent) is gone. A refusal is still kept
    // under this route's label, stripe-legacy-refused (R0-20b review
    // SEC-R020B-3), which the route hands the door. The route used to call
    // CommerceService.markInvoicePaid(invoiceId) with no actor and no tenant,
    // which recorded a 'manual' receipt for the remaining balance (posted Dr
    // CASH), checked nothing the session carried, and deduped only by the
    // invoice already being PAID.
    this.logger.warn(
      'Legacy /webhooks/stripe called — migrate Stripe Dashboard webhook URL to /payments/stripe/webhook',
    );

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      this.logger.error('STRIPE_WEBHOOK_SECRET is not configured');
      throw new BadRequestException('Webhook secret not configured');
    }

    if (!signature) {
      this.logger.warn('Stripe webhook received without signature header');
      throw new BadRequestException('Missing stripe-signature header');
    }

    const rawBody = (req as { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      this.logger.error('Stripe webhook called but rawBody is not available');
      throw new BadRequestException('Webhook payload unreadable');
    }

    let event: Stripe.Event;
    try {
      event = this.stripe!.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err: unknown) {
      this.logger.warn(`Stripe webhook signature verification failed: ${err instanceof Error ? err.message : String(err)}`);
      throw new BadRequestException(`Webhook signature verification failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    this.logger.debug(`Stripe webhook received: ${event.type}`);

    // Events the door ignores are acknowledged, as before; one its binding
    // refuses is a 400 (BadRequestException), with nothing recorded.
    const ack = await this.payments.handleStripeWebhook(rawBody.toString('utf8'), signature, {
      refusedProvider: STRIPE_LEGACY_REFUSED_PROVIDER,
    });
    // The door answers `processed` only for the first delivery of an event id
    // (its provider-event claim, shared with POST /payments/stripe/webhook).
    if (ack.processed && STRIPE_INVOICE_PAYMENT_EVENTS.has(event.type)) await this.emitStripePaymentReceived(event);
    return { ...ack, type: event.type, ...LEGACY_STRIPE_HINT };
  }

  /**
   * R0-20b review (CR-R020B-2): the Stripe connector's 'payment.received'
   * (the owner's in-app notification, the connector's activity), once, for
   * the payment the door just recorded for the invoice, with the amount and
   * currency it recorded. Never fails the delivery: the payment is committed.
   *
   * R0-20d: the invoice is the one the event names, read exactly as the door
   * reads it, and the recorded row must be that invoice's, in the business the
   * event names: the door's binding accepted the event only if that is the
   * invoice's business (a delivery of this route is platform-signed). A
   * storefront order's payment records no invoice row, so it emits nothing.
   */
  private async emitStripePaymentReceived(event: Stripe.Event): Promise<void> {
    if (!this.stripeConnector) return;
    const obj = (event.data?.object ?? {}) as StripePaymentObject;
    const invoiceId = obj.metadata?.invoiceId || obj.client_reference_id || obj.metadata?.invoice_id;
    // The door's provider payment id for this event (PaymentsService.processStripeChargeOrSession).
    const providerPaymentId = obj.id || event.id;
    if (!invoiceId || !providerPaymentId) return;
    try {
      const row = await this.prisma.client.payment.findUnique({
        where: { providerPaymentId },
        select: { invoiceId: true, businessId: true, provider: true, status: true, amount: true, currency: true },
      });
      if (
        !row ||
        row.provider !== 'stripe' ||
        row.status !== 'SUCCESSFUL' ||
        row.invoiceId !== invoiceId ||
        row.businessId !== obj.metadata?.businessId
      ) {
        return;
      }
      this.stripeConnector
        .emitPaymentReceived(row.businessId, {
          amount: Number(row.amount),
          currency: row.currency,
          invoiceId,
          externalId: providerPaymentId,
        })
        .catch((e: unknown) => this.logger.warn(`Stripe connector event emission failed: ${e instanceof Error ? e.message : String(e)}`));
    } catch (e: unknown) {
      this.logger.warn(`Stripe connector event for ${event.id} not emitted: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * SWEEP-P0-SCOPES (browser sweep BUG-001, blocker): webhook configuration is settings territory.
   * Every business route here ran AuthGuard and BusinessGuard only, so a STAFF member whose scope
   * map said settings 'none' listed every webhook WITH its signing secret and registered a webhook
   * sending invoice events to any URL. Now each route runs ModuleScopeGuard after BusinessGuard and
   * names the settings module on its handler (the guard reads handler metadata only): read to list
   * webhooks and read their delivery log, write to create, delete, enable/disable or test one. OWNER
   * and ADMIN hold settings admin by role default, STAFF none; an explicit map binds every role
   * (D-114, D-140).
   *
   * What a read answers depends on the reader's settings level (review repair CR-5, SEC-3): settings
   * admin gets each webhook with its signing secret (the owner can copy an existing webhook's secret
   * again); settings write gets the full receiver URL and no secret; settings read gets the
   * receiver's origin only (`urlMasked`), since for Slack, Zapier and Make hooks the URL path is
   * itself the credential. Before this packet every list answered every secret to every member.
   *
   * Second review repair (SV-5): and, per webhook, only to a reader who could have created it: one
   * who may receive its events (eventReader: the reads assertMayReceiveEvents requires). An ADMIN bound
   * by D-114 (revenue none) is refused creating an invoice.paid webhook, and read the owner's
   * invoice webhook's secret (signing forged invoice.paid deliveries to the owner's receiver with it)
   * and its full URL. Such a reader now gets neither: no secret, the receiver's origin only.
   */
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('settings', 'read')
  @Get('businesses/:businessId/webhooks')
  async list(@Param('businessId') businessId: string, @Req() req: WebhookActorRequest) {
    const reader = this.eventReader(businessId, req?.user);
    const level = await reader.level('settings');
    const rows: Array<{ url: string; events?: string[]; secret?: string }> = await this.prisma.client.webhook.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      select: LEVEL_RANK[level] >= LEVEL_RANK.admin ? WEBHOOK_ADMIN_FIELDS : WEBHOOK_PUBLIC_FIELDS,
    });
    const answered = [];
    for (const row of rows) {
      const receives = (await reader.refusal(row.events ?? [])) === null;
      const { secret, ...rest } = row;
      const shown = LEVEL_RANK[level] >= LEVEL_RANK.admin && receives && secret !== undefined ? { ...rest, secret } : rest;
      answered.push(LEVEL_RANK[level] >= LEVEL_RANK.write && receives ? shown : { ...shown, url: maskWebhookUrl(row.url), urlMasked: true });
    }
    return answered;
  }

  /**
   * Second review repair (SV-1, SV-5): the reads a member's webhook decisions take, memoised for one
   * request. A refusal names the first event whose records the member may not read: a module level
   * below read (ModuleScopeGuard's reading: an explicit map binds an ADMIN too, D-114; a JSON array
   * names no module, SV-4), for a crm event a view limited to their own contacts, and for a contact
   * event no revenue read (a contact row carries the stored money signals, D-100).
   */
  private eventReader(businessId: string, actor: ModuleLevelActor): WebhookEventReader {
    const levels = new Map<string, Promise<AccessLevel>>();
    let viewAll: Promise<boolean> | null = null;
    const level = (module: string) => {
      if (!levels.has(module)) levels.set(module, memberModuleLevel(this.prisma, businessId, actor, module));
      return levels.get(module)!;
    };
    const seesEveryContact = () => {
      viewAll ??= actor?.id ? resolveCrmAccess(this.prisma, businessId, actor.id).then((access) => access.viewAll) : Promise.resolve(false);
      return viewAll;
    };
    const refusal = async (events: readonly string[]): Promise<string | null> => {
      const checked = new Set<string>();
      for (const event of events) {
        for (const module of webhookEventReads(event) ?? []) {
          if (checked.has(module)) continue;
          checked.add(module);
          const held = await level(module);
          if (LEVEL_RANK[held] < LEVEL_RANK.read) {
            return `Insufficient permissions: a webhook sending ${event} needs ${module} read access (you have ${held})`;
          }
          if (module === 'crm' && !(await seesEveryContact())) {
            return `Insufficient permissions: a webhook sending ${event} sends every contact; you have crm read access to your own contacts only`;
          }
        }
      }
      return null;
    };
    return { level, refusal };
  }

  /**
   * SWEEP-P0-SCOPES review repair (finding SEC-2): a webhook delivers the full records of the
   * modules its events name (invoices for invoice.*, contact rows for contact.*, ...; see
   * webhook-events.ts), to a URL its creator chooses. So the member who subscribes a URL to an
   * event, or turns such a webhook back on, must read that module themselves: its level by
   * ModuleScopeGuard's reading (an explicit map binds an ADMIN too, D-114), and for contact events
   * every contact in view (crm_view 'all': a member limited to their own book is not sent everyone
   * else's). An event that is not a webhook event is a 400 (`unknown: 'refuse'`, at create); a stored
   * one is ignored when a webhook is turned back on (nothing delivers it).
   *
   * Second review repair (SV-1, D-100): a contact event also needs revenue read: the delivery is the
   * stored contact row with its money signals (webhook-events.ts, WEBHOOK_EVENT_FAMILY_EXTRA_READS).
   *
   * Not covered (no creator column; this packet makes no schema change): a webhook keeps delivering
   * after its creator's access is narrowed, until a member turns it off. Recorded in the census.
   */
  private async assertMayReceiveEvents(
    businessId: string,
    actor: ModuleLevelActor,
    events: string[],
    unknown: 'refuse' | 'ignore',
  ): Promise<void> {
    if (unknown === 'refuse') {
      const notAnEvent = events.find((event) => !webhookEventModule(event));
      if (notAnEvent !== undefined) throw new BadRequestException(`Unknown webhook event: ${notAnEvent}`);
    }
    const refusal = await this.eventReader(businessId, actor).refusal(events);
    if (refusal) throw new ForbiddenException(refusal);
  }

  /**
   * SWEEP-P0-SCOPES (BUG-001): settings write; the URL goes through the outbound-address guard
   * (checkWebhookUrl: http(s) to a public address only), and a refused URL or an empty event list
   * is a 400 with nothing written (it was a 201 carrying an `error`). The answer is the only one
   * that carries the new webhook's signing secret.
   */
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('settings', 'write')
  @Post('businesses/:businessId/webhooks')
  async create(
    @Param('businessId') businessId: string,
    @Body() body: { url: string; events: string[]; name?: string },
    @Req() req?: WebhookActorRequest,
  ) {
    let checkedUrl: string;
    try {
      checkedUrl = (await checkWebhookUrl(body?.url)).url.toString();
    } catch (err) {
      if (err instanceof WebhookUrlRefusedError) throw new BadRequestException(err.message);
      throw err;
    }
    const events = Array.isArray(body?.events) ? body.events.filter((e): e is string => typeof e === 'string' && e.trim() !== '') : [];
    if (events.length === 0) {
      throw new BadRequestException('At least one event must be selected');
    }
    // Review repair SEC-2: the creator reads the module of every event the webhook will deliver.
    await this.assertMayReceiveEvents(businessId, req?.user, events, 'refuse');
    const secret = randomBytes(32).toString('hex');
    return this.prisma.client.webhook.create({
      data: {
        businessId,
        url: checkedUrl,
        events,
        name: typeof body?.name === 'string' && body.name.trim() ? body.name : 'Webhook',
        secret,
        isActive: true,
      },
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('settings', 'write')
  @Delete('businesses/:businessId/webhooks/:webhookId')
  async remove(
    @Param('businessId') businessId: string,
    @Param('webhookId') webhookId: string,
  ) {
    const deleted = await this.prisma.client.webhook.deleteMany({
      where: { id: webhookId, businessId },
    });
    if (deleted.count === 0) {
      return { error: 'Webhook not found or not owned by this business' };
    }
    return { success: true };
  }

  /** SWEEP-P0-SCOPES (BUG-001): settings write; the delivery is checked and pinned like every other (WebhookDispatcherService). */
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('settings', 'write')
  @Post('businesses/:businessId/webhooks/:webhookId/test')
  async testWebhook(
    @Param('businessId') businessId: string,
    @Param('webhookId') webhookId: string,
  ) {
    const result = await this.dispatcher.sendTestEvent(webhookId, businessId);
    return result;
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('settings', 'read')
  @Get('businesses/:businessId/webhooks/:webhookId/deliveries')
  async deliveries(
    @Param('businessId') businessId: string,
    @Param('webhookId') webhookId: string,
    @Query('limit') limit?: string,
    @Req() req?: WebhookActorRequest,
  ) {
    const parsedLimit = limit ? Math.min(parseInt(limit, 10) || 50, 100) : 50;
    const logs = await this.dispatcher.getDeliveryLogs(businessId, webhookId, parsedLimit);
    if (!Array.isArray(logs)) return logs;
    // Review repair SEC-3: a settings read member sees each delivery's receiver origin only, as in the
    // list; second review SV-5: so does a member who may not receive the webhook's events.
    const reader = this.eventReader(businessId, req?.user);
    const level = await reader.level('settings');
    if (LEVEL_RANK[level] >= LEVEL_RANK.write) {
      const [webhook] = (await this.prisma.client.webhook.findMany({ where: { id: webhookId, businessId }, select: { id: true, events: true } }))
        .filter((w: { id: string }) => w.id === webhookId);
      const events = webhook ? webhook.events ?? [] : logs.map((log) => log.event).filter((e): e is string => typeof e === 'string');
      if ((await reader.refusal(events)) === null) return logs;
    }
    return logs.map((log) => ({ ...log, url: log.url ? maskWebhookUrl(log.url) : log.url }));
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('settings', 'write')
  @Post('businesses/:businessId/webhooks/:webhookId/toggle')
  async toggleWebhook(
    @Param('businessId') businessId: string,
    @Param('webhookId') webhookId: string,
    @Body() body: { isActive: boolean },
    @Req() req?: WebhookActorRequest,
  ) {
    // Review repair SEC-2: turning a webhook back on starts its deliveries again, so it needs the
    // reads its events need (turning one off needs settings write only).
    if (body?.isActive === true) {
      const webhook = await this.prisma.client.webhook.findFirst({ where: { id: webhookId, businessId }, select: { events: true } });
      if (webhook) await this.assertMayReceiveEvents(businessId, req?.user, webhook.events ?? [], 'ignore');
    }
    const updated = await this.prisma.client.webhook.updateMany({
      where: { id: webhookId, businessId },
      data: { isActive: body.isActive },
    });
    if (updated.count === 0) {
      return { error: 'Webhook not found or not owned by this business' };
    }
    return { success: true, isActive: body.isActive };
  }
}
