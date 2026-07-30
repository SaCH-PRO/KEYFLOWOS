/**
 * StoreLink / Portal / Presence Organ Adapter
 *
 * Plugs the public-facing virtual projection (storefront, presence page,
 * customer portal) into KEY's peripheral nervous system.
 */

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SiteService } from '../../site/site.service';
import { PortalService } from '../../portal/portal.service';
import { PortalContentService } from '../../portal/portal-content.service';
import { PromoCodeService } from '../../site/promo-code.service';
import { IntakeService } from '../../site/intake.service';
import { KeyOrganAdapter } from './key-organ-adapter.interface';
import {
  KeyCortexToolContext,
  KeyCortexToolDefinition,
  KeyCortexToolResult,
} from '../key-cortex-tool-registry.service';
import { KeyCortexEventBusService } from '../key-cortex-event-bus.service';

@Injectable()
export class StorelinkAdapterService extends KeyOrganAdapter {
  readonly organId = 'storelink';
  readonly organName = 'StoreLink & Portal';
  private readonly logger = new Logger(StorelinkAdapterService.name);

  constructor(
    private readonly site: SiteService,
    private readonly portal: PortalService,
    private readonly portalContent: PortalContentService,
    private readonly promoCode: PromoCodeService,
    private readonly intake: IntakeService,
    eventBus: KeyCortexEventBusService,
  ) {
    super();
    this.connect(eventBus);
  }

  async getState(businessId: string): Promise<import('./key-organ-adapter.interface').KeyOrganState> {
    try {
      const [config, portalTokens] = await Promise.all([
        this.site.getStorefrontConfig(businessId).catch(() => null),
        this.portal.list(businessId).catch(() => []),
      ]);
      return {
        healthy: true,
        status: 'Storefront & portal active',
        metadata: {
          hasStorefront: !!config,
          portalTokens: portalTokens.length,
        },
      };
    } catch (err: unknown) {
      this.logger.error(`getState failed: ${err instanceof Error ? err.message : String(err)}`);
      return { healthy: false, status: 'Storefront state unavailable', gaps: ['storefront_error'] };
    }
  }

  listTools(): KeyCortexToolDefinition[] {
    return [
      this.makeTool(
        'storelink.get_analytics',
        'Get storefront analytics',
        1,
        false,
        [],
        {
          days: { type: 'number' },
        },
        async (ctx, input) => {
          const analytics = await this.site.getAnalytics(ctx.businessId, (input.days as number) ?? 30);
          return { success: true, data: analytics };
        },
      ),
      this.makeTool(
        'storelink.get_conversion_funnel',
        'Get storefront conversion funnel',
        1,
        false,
        [],
        {},
        async (ctx) => {
          const funnel = await this.site.getConversionFunnel(ctx.businessId);
          return { success: true, data: funnel };
        },
      ),
      this.makeTool(
        'storelink.get_product_health',
        'Get storefront product health audit',
        1,
        false,
        [],
        {},
        async (ctx) => {
          const audit = await this.site.getProductHealthAudit(ctx.businessId);
          return { success: true, data: audit };
        },
      ),
      this.makeTool(
        'storelink.create_promo_code',
        'Create a promo code for the storefront',
        2,
        true,
        ['code', 'type', 'value'],
        {
          minOrderValue: { type: 'number' },
          maxUses: { type: 'number' },
          validFrom: { type: 'string' },
          validTo: { type: 'string' },
        },
        async (ctx, input) => {
          const promo = await this.promoCode.create({
            businessId: ctx.businessId,
            code: input.code as string,
            type: input.type as any,
            value: Number(input.value),
            minOrderValue: input.minOrderValue ? Number(input.minOrderValue) : undefined,
            maxUses: input.maxUses ? Number(input.maxUses) : undefined,
            validFrom: input.validFrom ? new Date(input.validFrom as string) : undefined,
            validTo: input.validTo ? new Date(input.validTo as string) : undefined,
          });
          return { success: true, data: { promoId: promo.id, code: promo.code } };
        },
      ),
      this.makeTool(
        'storelink.list_intakes',
        'List storefront intake submissions',
        1,
        false,
        [],
        {
          status: { type: 'string' },
          limit: { type: 'number' },
          offset: { type: 'number' },
        },
        async (ctx, input) => {
          const result = await this.intake.listForBusiness(ctx.businessId, {
            status: input.status as string,
            limit: input.limit as number,
            offset: input.offset as number,
          });
          return { success: true, data: result };
        },
      ),
      this.makeTool(
        'storelink.get_portal_dashboard',
        'Get a contact portal dashboard',
        1,
        false,
        ['contactId'],
        {},
        async (ctx, input) => {
          const dashboard = await this.portalContent.getDashboard(input.contactId as string, ctx.businessId);
          return { success: true, data: dashboard };
        },
      ),
      this.makeTool(
        'storelink.create_portal_access',
        'Create a customer portal access token',
        2,
        true,
        ['contactId'],
        {
          settings: { type: 'object' },
        },
        async (ctx, input) => {
          const access = await this.portal.createAccess(
            ctx.businessId,
            input.contactId as string,
            (input.settings as Record<string, boolean>) ?? {},
          );
          return { success: true, data: { accessId: access.id, token: access.token } };
        },
      ),
    ];
  }

  async executeTool(
    toolName: string,
    ctx: KeyCortexToolContext,
    input: Record<string, unknown>,
  ): Promise<KeyCortexToolResult> {
    const tool = this.listTools().find((t) => t.name === toolName);
    if (!tool) return { success: false, error: `Tool ${toolName} not found` };
    return tool.handler(ctx, input);
  }

  // ========================================================================
  // Event bridge
  // ========================================================================

  @OnEvent('storefront.order_created')
  async onOrderCreated(payload: { businessId: string; orderId: string }): Promise<void> {
    if (!this.bus) return;
    await this.bus.publish({
      source: this.organId,
      type: 'order.created',
      businessId: payload.businessId,
      payload,
      metadata: { entityType: 'MarketplaceOrder', entityId: payload.orderId },
    });
  }

  @OnEvent('lead_form.submitted')
  async onLeadFormSubmitted(payload: { businessId: string; submissionId: string }): Promise<void> {
    if (!this.bus) return;
    await this.bus.publish({
      source: this.organId,
      type: 'lead.submitted',
      businessId: payload.businessId,
      payload,
      metadata: { entityType: 'LeadFormSubmission', entityId: payload.submissionId },
    });
  }

  // ========================================================================
  // Helpers
  // ========================================================================

  private makeTool(
    name: string,
    description: string,
    riskTier: 1 | 2 | 3 | 4,
    requiresApproval: boolean,
    required: string[],
    properties: Record<string, unknown>,
    handler: KeyCortexToolDefinition['handler'],
  ): KeyCortexToolDefinition {
    return {
      name,
      module: this.organId,
      description,
      riskTier,
      requiresApproval,
      parameters: { type: 'object', properties, required },
      handler,
    };
  }
}
