import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { IConnector, ConnectorMeta, ConnectorHealth, ConnectorSyncResult, ConnectorStatusSummary, ConnectorSmokeResult } from '../connector.interface';
import { IPaymentGatewayConnector, PaymentGatewayTransaction, PaymentLinkInput, PaymentLinkResult, RefundInput, RefundResult } from '../payment-gateway.interface';

@Injectable()
export class StripeConnector implements IConnector, IPaymentGatewayConnector {
  private readonly logger = new Logger(StripeConnector.name);

  readonly meta: ConnectorMeta = {
    type: 'stripe',
    name: 'Stripe',
    description: 'Accept global card payments and manage subscriptions via Stripe',
    category: 'payment',
    group: 'payments',
    icon: 'credit-card',
    supportsSync: false,
    supportsWebhook: true,
    authType: 'api_key',
    externalUrl: 'https://dashboard.stripe.com',
  };

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(EntityResolutionService) private readonly entityResolution: EntityResolutionService,
  ) {}

  async authenticate(businessId: string): Promise<{ connected: boolean; authUrl?: string }> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });
    const meta = (business?.metaData as Record<string, unknown>) ?? {};
    const connected = !!(meta.stripeSecretKey || process.env.STRIPE_SECRET_KEY);
    return { connected };
  }

  async healthCheck(businessId: string): Promise<ConnectorHealth> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });
    const meta = (business?.metaData as Record<string, unknown>) ?? {};
    const hasStripe = !!(meta.stripeSecretKey || process.env.STRIPE_SECRET_KEY);
    const realStatus = hasStripe ? 'connected' : 'disconnected';

    const stored = await this.getConnectorStatus(businessId);
    return {
      status: realStatus,
      lastSyncAt: stored?.lastSyncAt ?? null,
      lastErrorAt: stored?.lastErrorAt ?? null,
      lastError: stored?.lastError ?? null,
      errorCount: stored?.errorCount ?? 0,
      syncCount: stored?.syncCount ?? 0,
      connectedAt: stored?.connectedAt ?? null,
      connectedAccount: hasStripe ? (stored?.connectedAccount ?? 'Stripe Account') : null,
    };
  }

  async getStatus(businessId: string): Promise<ConnectorStatusSummary> {
    const health = await this.healthCheck(businessId);
    return {
      type: this.meta.type,
      name: this.meta.name,
      category: this.meta.category,
      status: health.status,
      connectedAccount: health.connectedAccount,
    };
  }

  async isConnected(businessId: string): Promise<boolean> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });
    const meta = (business?.metaData as Record<string, unknown>) ?? {};
    return !!(meta.stripeSecretKey || process.env.STRIPE_SECRET_KEY);
  }

  async sync(_businessId: string): Promise<ConnectorSyncResult> {
    // Provider pull sync is not yet implemented for this connector. It previously
    // counted local rows and returned success:true, misrepresenting a no-op as a
    // successful provider sync. Real pull sync is future work per connector.
    return {
      success: false,
      itemsSynced: 0,
      unsupported: true,
      code: 'PULL_SYNC_NOT_IMPLEMENTED',
      errors: ['Provider pull sync is not implemented for this connector.'],
      duration: 0,
    };
  }

  async smokeTest(businessId: string): Promise<ConnectorSmokeResult> {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return { success: false, error: 'STRIPE_SECRET_KEY is not set' };
    try {
      const res = await fetch('https://api.stripe.com/v1/balance', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { success: false, error: `Stripe API ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}` };
      }
      const data = (await res.json()) as { available?: Array<{ amount: number; currency: string }>; livemode?: boolean };
      await this.trackActivity(businessId);
      const top = data.available?.[0];
      return {
        success: true,
        action: 'Fetched Stripe /v1/balance',
        account: data.livemode ? 'Live mode' : 'Test mode',
        detail: top ? `Available: ${(top.amount / 100).toFixed(2)} ${top.currency.toUpperCase()}` : 'Zero balance',
      };
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  async disconnect(businessId: string): Promise<void> {
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'stripe' } },
      create: { businessId, connectorType: 'stripe', status: 'disconnected' },
      update: { status: 'disconnected' },
    });
  }

  async emitPaymentReceived(businessId: string, opts: { amount: number; currency: string; invoiceId?: string; customerEmail?: string; customerName?: string; stripeCustomerId?: string; externalId?: string }) {
    await this.trackActivity(businessId);

    let contactId: string | undefined;

    if (opts.customerEmail) {
      const resolved = await this.entityResolution.resolveContact(businessId, {
        source: 'stripe',
        externalId: opts.stripeCustomerId,
        email: opts.customerEmail,
        firstName: opts.customerName?.split(' ')[0],
        lastName: opts.customerName?.split(' ').slice(1).join(' ') || undefined,
      });
      contactId = resolved.contactId;

      this.events.emit('entity.resolved', {
        businessId,
        contactId: resolved.contactId,
        source: 'stripe',
        matchedOn: resolved.matchedOn,
        isNew: resolved.isNew,
        merged: resolved.merged,
      });
    }

    this.events.emit('payment.received', {
      connectorType: 'stripe' as const,
      externalId: opts.externalId ?? null,
      businessId,
      timestamp: new Date(),
      amount: opts.amount,
      currency: opts.currency,
      provider: 'stripe',
      invoiceId: opts.invoiceId,
      contactId,
    });
  }

  async emitPaymentFailed(businessId: string, opts: { amount: number; currency: string; error: string; invoiceId?: string; externalId?: string }) {
    await this.trackError(businessId, opts.error);

    this.events.emit('payment.failed', {
      connectorType: 'stripe' as const,
      externalId: opts.externalId ?? null,
      businessId,
      timestamp: new Date(),
      amount: opts.amount,
      currency: opts.currency,
      provider: 'stripe',
      error: opts.error,
      invoiceId: opts.invoiceId,
    });
  }

  private async trackActivity(businessId: string) {
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'stripe' } },
      create: { businessId, connectorType: 'stripe', status: 'connected', lastSyncAt: new Date(), syncCount: 1 },
      update: { lastSyncAt: new Date(), syncCount: { increment: 1 }, status: 'connected' },
    }).catch((e) => this.logger.warn(`Failed to track stripe activity: ${e instanceof Error ? e.message : String(e)}`));
  }

  private async trackError(businessId: string, error: string) {
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'stripe' } },
      create: { businessId, connectorType: 'stripe', status: 'error', lastErrorAt: new Date(), lastError: error, errorCount: 1 },
      update: { lastErrorAt: new Date(), lastError: error, errorCount: { increment: 1 } },
    }).catch((e) => this.logger.warn(`Failed to track stripe error: ${e instanceof Error ? e.message : String(e)}`));
  }

  private async getConnectorStatus(businessId: string) {
    return this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: 'stripe' } },
    });
  }

  /**
   * The key a per-tenant operation uses: the business's own, else the
   * deployment's STRIPE_SECRET_KEY. V1-15d-STRIPE-OPS-TENANCY (F1): `shared`
   * marks the deployment key, whose platform account holds the charges and
   * links of every business without its own key, so an operation on it acts
   * only on objects this business can show are its own (ownedIds, the
   * businessId tag on links), never on another tenant's.
   */
  private async resolveKey(businessId: string): Promise<{ key: string; shared: boolean }> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });
    const meta = (business?.metaData as Record<string, unknown>) ?? {};
    const own = meta.stripeSecretKey as string | undefined;
    if (own) return { key: own, shared: false };
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('Stripe is not configured for this business');
    return { key, shared: true };
  }

  /**
   * V1-15d-STRIPE-OPS-TENANCY (F1): of `ids` (Stripe charge, payment_intent,
   * session or refund ids), those this business's own Stripe Payment rows name
   * (providerPaymentId or reference) and no other business's row names.
   * Payment is outside the tenant extension (M31), so the read spans every
   * tenant; an id two businesses name is not provably either's (a tenant can
   * sign any reference for itself with its own webhook secret).
   */
  private async ownedIds(businessId: string, ids: Array<string | null | undefined>): Promise<Set<string>> {
    const wanted = [...new Set(ids.filter((v): v is string => typeof v === 'string' && v.length > 0))];
    if (wanted.length === 0) return new Set();
    const rows = await this.prisma.client.payment.findMany({
      where: { provider: 'stripe', OR: [{ providerPaymentId: { in: wanted } }, { reference: { in: wanted } }] },
      select: { businessId: true, providerPaymentId: true, reference: true },
    });
    const owners = new Map<string, Set<string>>();
    for (const r of rows) {
      for (const id of [r.providerPaymentId, r.reference]) {
        if (!id) continue;
        owners.set(id, (owners.get(id) ?? new Set<string>()).add(r.businessId));
      }
    }
    return new Set(wanted.filter((id) => {
      const by = owners.get(id);
      return !!by && by.size === 1 && by.has(businessId);
    }));
  }

  /**
   * V1-15d-STRIPE-OPS-TENANCY: the payment_intent of a charge (one read, with
   * this business's key), so a refund naming the charge of a payment recorded
   * under its Checkout Session or PaymentIntent id can be matched to that
   * payment. Null for an id that is not a charge, an unknown charge, a charge
   * with no payment_intent, or a failed read.
   */
  async paymentIntentOfCharge(businessId: string, chargeId: string): Promise<string | null> {
    if (!/^(ch|py)_/.test(chargeId)) return null;
    try {
      const { key } = await this.resolveKey(businessId);
      const charge = (await this.stripeRequest(key, 'GET', `/charges/${encodeURIComponent(chargeId)}`)) as { payment_intent?: unknown } | null;
      return typeof charge?.payment_intent === 'string' ? charge.payment_intent : null;
    } catch (err) {
      this.logger.warn(`Stripe charge lookup failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  private async stripeRequest(
    key: string,
    method: 'GET' | 'POST',
    path: string,
    body?: URLSearchParams,
  ): Promise<unknown> {
    const url = `https://api.stripe.com/v1${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: body?.toString(),
    });
    const text = await res.text();
    let parsed: unknown;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    if (!res.ok) {
      const msg = (parsed as { error?: { message?: string } } | null)?.error?.message || text || `HTTP ${res.status}`;
      throw new Error(`Stripe API error: ${msg}`);
    }
    return parsed;
  }

  async listRecentTransactions(businessId: string, limit = 50): Promise<PaymentGatewayTransaction[]> {
    // Local-first: webhooks (handlePaypalWebhook / handleStripeWebhook in
    // payments.service) keep the local Payment table in sync, so the dashboard
    // can render even when Stripe's API is slow or rate-limited. Live API data
    // is fetched best-effort and merged on top to enrich rows we don't yet
    // have locally and to surface activity that pre-dates webhook setup.
    const local = await this.fetchLocalStripeTransactions(businessId, limit);
    const byId = new Map<string, PaymentGatewayTransaction>();
    for (const row of local) byId.set(row.id, row);

    try {
      const live = await this.fetchLiveStripeTransactions(businessId, limit);
      for (const row of live) {
        const existing = byId.get(row.id);
        // Live data wins for enrichment (customer name/email/description) but
        // we keep the locally-known invoiceId if the live row is missing it.
        if (existing) {
          byId.set(row.id, { ...existing, ...row, invoiceId: row.invoiceId ?? existing.invoiceId });
        } else {
          byId.set(row.id, row);
        }
      }
      await this.trackActivity(businessId);
    } catch (err: any) {
      this.logger.warn(
        `Stripe live transaction fetch failed; serving ${local.length} local row(s): ${err instanceof Error ? err.message : err}`,
      );
    }

    return Array.from(byId.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  private async fetchLocalStripeTransactions(
    businessId: string,
    limit: number,
  ): Promise<PaymentGatewayTransaction[]> {
    const rows = await this.prisma.client.payment.findMany({
      where: { businessId, provider: 'stripe' },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit * 2, 200),
      include: {
        invoice: {
          select: { id: true, contact: { select: { firstName: true, lastName: true, email: true } } },
        },
      },
    }).catch(() => [] as Array<{
      id: string; amount: number; currency: string; status: string;
      providerPaymentId: string; createdAt: Date; invoiceId: string;
      reference: string | null; notes: string | null;
      invoice: { id: string; contact: { firstName: string | null; lastName: string | null; email: string | null } | null } | null;
    }>);
    return rows.map((p) => {
      const contact = p.invoice?.contact;
      const name = contact ? `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || null : null;
      const isRefund = p.status === 'REFUNDED';
      return {
        id: p.providerPaymentId,
        provider: 'stripe' as const,
        type: (isRefund ? 'refund' : 'charge') as 'charge' | 'refund',
        status: p.status.toLowerCase(),
        amount: Math.abs(Number(p.amount)),
        currency: p.currency,
        customerName: name,
        customerEmail: contact?.email ?? null,
        description: p.notes ?? (p.invoice?.id ? `Invoice ${p.invoice.id}` : null),
        invoiceId: p.invoiceId ?? null,
        externalUrl: isRefund
          ? `https://dashboard.stripe.com/refunds/${p.providerPaymentId}`
          : `https://dashboard.stripe.com/payments/${p.providerPaymentId}`,
        createdAt: p.createdAt,
      };
    });
  }

  private async fetchLiveStripeTransactions(
    businessId: string,
    limit: number,
  ): Promise<PaymentGatewayTransaction[]> {
    const { key, shared } = await this.resolveKey(businessId);
    const charges = (await this.stripeRequest(key, 'GET', `/charges?limit=${Math.min(limit, 100)}`)) as {
      data?: Array<{
        id: string;
        amount: number;
        amount_refunded?: number;
        currency: string;
        status: string;
        paid: boolean;
        refunded?: boolean;
        description?: string | null;
        billing_details?: { name?: string | null; email?: string | null };
        metadata?: { invoiceId?: string };
        payment_intent?: string | null;
        created: number;
      }>;
    };
    // V1-15d (F1): on the shared platform key the account holds every keyless
    // tenant's charges; only those this business's own Payment rows name (by
    // charge id, or by the payment_intent its Checkout / PaymentIntent row
    // holds) are its own. On its own key the whole account is its own.
    const owned = shared
      ? await this.ownedIds(businessId, (charges.data ?? []).flatMap((c) => [c.id, c.payment_intent]))
      : null;
    const out: PaymentGatewayTransaction[] = [];
    type StripeChargeRow = NonNullable<typeof charges.data>[number];
    const chargeById = new Map<string, StripeChargeRow>();
    for (const c of charges.data ?? []) {
      if (owned && !owned.has(c.id) && !(c.payment_intent && owned.has(c.payment_intent))) continue;
      chargeById.set(c.id, c);
      out.push({
        id: c.id,
        provider: 'stripe',
        type: 'charge',
        status: c.refunded ? 'refunded' : c.status,
        amount: c.amount / 100,
        currency: (c.currency || 'usd').toUpperCase(),
        customerName: c.billing_details?.name ?? null,
        customerEmail: c.billing_details?.email ?? null,
        description: c.description ?? null,
        invoiceId: c.metadata?.invoiceId ?? null,
        externalUrl: `https://dashboard.stripe.com/payments/${c.id}`,
        createdAt: new Date(c.created * 1000),
      });
    }
    try {
      const refunds = (await this.stripeRequest(key, 'GET', `/refunds?limit=${Math.min(limit, 100)}`)) as {
        data?: Array<{
          id: string; charge: string; amount: number; currency: string; status: string;
          payment_intent?: string | null; reason?: string | null; created: number;
        }>;
      };
      const ownedRefunds = shared
        ? await this.ownedIds(businessId, (refunds.data ?? []).flatMap((r) => [r.id, r.charge, r.payment_intent]))
        : null;
      for (const r of refunds.data ?? []) {
        if (
          ownedRefunds &&
          !chargeById.has(r.charge) &&
          ![r.id, r.charge, r.payment_intent].some((id) => !!id && ownedRefunds.has(id))
        ) {
          continue;
        }
        const c = chargeById.get(r.charge);
        out.push({
          id: r.id,
          provider: 'stripe',
          type: 'refund',
          status: r.status,
          amount: r.amount / 100,
          currency: (r.currency || c?.currency || 'usd').toUpperCase(),
          customerName: c?.billing_details?.name ?? null,
          customerEmail: c?.billing_details?.email ?? null,
          description: r.reason ?? (c?.description ? `Refund: ${c.description}` : 'Refund'),
          invoiceId: c?.metadata?.invoiceId ?? null,
          externalUrl: `https://dashboard.stripe.com/refunds/${r.id}`,
          createdAt: new Date(r.created * 1000),
        });
      }
    } catch (err: any) {
      this.logger.warn(`Stripe refunds list failed: ${err instanceof Error ? err.message : err}`);
    }
    return out;
  }

  async createPaymentLink(businessId: string, input: PaymentLinkInput): Promise<PaymentLinkResult> {
    const { key } = await this.resolveKey(businessId);
    const priceBody = new URLSearchParams();
    priceBody.append('currency', input.currency.toLowerCase());
    priceBody.append('unit_amount', String(Math.round(input.amount * 100)));
    priceBody.append('product_data[name]', input.description.slice(0, 250) || 'Payment');
    const price = (await this.stripeRequest(key, 'POST', '/prices', priceBody)) as { id: string };

    const linkBody = new URLSearchParams();
    linkBody.append('line_items[0][price]', price.id);
    linkBody.append('line_items[0][quantity]', '1');
    // V1-15d: the link names its business, so on the shared platform key it
    // is listed and revoked for that business only (listPaymentLinks,
    // revokePaymentLink).
    linkBody.append('metadata[businessId]', businessId);
    if (input.customerEmail) {
      linkBody.append('metadata[customerEmail]', input.customerEmail);
    }
    const link = (await this.stripeRequest(key, 'POST', '/payment_links', linkBody)) as {
      id: string; url: string; active: boolean; created: number;
    };
    await this.trackActivity(businessId);
    return {
      id: link.id,
      url: link.url,
      provider: 'stripe',
      amount: input.amount,
      currency: input.currency.toUpperCase(),
      description: input.description,
      active: link.active,
      createdAt: new Date(link.created * 1000),
    };
  }

  async listPaymentLinks(businessId: string): Promise<PaymentLinkResult[]> {
    const { key, shared } = await this.resolveKey(businessId);
    const list = (await this.stripeRequest(key, 'GET', '/payment_links?limit=50&active=true')) as {
      data?: Array<{
        id: string; url: string; active: boolean; created: number;
        metadata?: Record<string, string> | null;
        line_items?: { data?: Array<{ price?: { unit_amount?: number; currency?: string }; description?: string }> };
      }>;
    };
    const links: PaymentLinkResult[] = [];
    for (const l of list.data ?? []) {
      // V1-15d (F1): on the shared platform key, only the links tagged with
      // this business (createPaymentLink); an untagged link is no one's.
      if (shared && l.metadata?.businessId !== businessId) continue;
      let amount = 0;
      let currency = 'USD';
      let description = '';
      try {
        const li = (await this.stripeRequest(key, 'GET', `/payment_links/${l.id}/line_items?limit=1`)) as {
          data?: Array<{ amount_total?: number; currency?: string; description?: string }>;
        };
        const first = li.data?.[0];
        if (first) {
          amount = (first.amount_total ?? 0) / 100;
          currency = (first.currency || 'usd').toUpperCase();
          description = first.description || '';
        }
      } catch (err: any) {
          this.logger.warn(`Line item lookup failures: ${err instanceof Error ? err.message : err}`);
        }
      links.push({
        id: l.id,
        url: l.url,
        provider: 'stripe',
        amount,
        currency,
        description,
        active: l.active,
        createdAt: new Date(l.created * 1000),
      });
    }
    return links;
  }

  async revokePaymentLink(businessId: string, linkId: string): Promise<void> {
    const { key, shared } = await this.resolveKey(businessId);
    if (shared) {
      // V1-15d (F1): on the shared platform key, a link not tagged with this
      // business is answered like an unknown link, and nothing is written.
      const link = (await this.stripeRequest(key, 'GET', `/payment_links/${encodeURIComponent(linkId)}`).catch(() => null)) as {
        metadata?: Record<string, string> | null;
      } | null;
      if (link?.metadata?.businessId !== businessId) throw new NotFoundException('Payment link not found');
    }
    const body = new URLSearchParams();
    body.append('active', 'false');
    await this.stripeRequest(key, 'POST', `/payment_links/${linkId}`, body);
  }

  /**
   * The caller (PaymentsOpsService.refundCharge) names only a charge of one of
   * this business's own recorded payments (V1-15d); the key is its own, or
   * the platform key its customers paid into.
   */
  async refundCharge(businessId: string, input: RefundInput): Promise<RefundResult> {
    const { key } = await this.resolveKey(businessId);
    const body = new URLSearchParams();
    body.append('charge', input.chargeId);
    if (input.amount !== undefined) {
      body.append('amount', String(Math.round(input.amount * 100)));
    }
    if (input.reason) {
      const valid = ['duplicate', 'fraudulent', 'requested_by_customer'];
      if (valid.includes(input.reason)) body.append('reason', input.reason);
      else body.append('metadata[reason]', input.reason.slice(0, 500));
    }
    const refund = (await this.stripeRequest(key, 'POST', '/refunds', body)) as {
      id: string; amount: number; currency: string; status: string; charge: string; created: number;
    };
    await this.trackActivity(businessId);
    return {
      id: refund.id,
      chargeId: refund.charge,
      amount: refund.amount / 100,
      currency: (refund.currency || 'usd').toUpperCase(),
      status: refund.status,
      provider: 'stripe',
      createdAt: new Date(refund.created * 1000),
    };
  }
}
