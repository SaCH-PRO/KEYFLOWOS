import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import {
  RevenueAttributionService,
  type RevenueType,
  type RevenueSource,
} from './revenue-attribution.service';
import { TimeCostService, type TimeCostRefType } from './time-cost.service';
import { UpdateRevenueAttributionDto } from './dto/update-revenue-attribution.dto';
import { CreateTimeCostDto, UpdateTimeCostDto } from './dto/time-cost.dto';
import { PrismaService } from '../../core/prisma/prisma.service';

interface AuthedRequest {
  user?: { id?: string; sub?: string };
}

/**
 * R5 leverage endpoints — revenue attribution overrides + time-cost CRUD
 * + per-contact / business time rollups. Kept in a dedicated controller so
 * the existing CommerceController stays focused on invoices/quotes/products.
 */
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
@Controller('commerce/businesses/:businessId')
export class LeverageController {
  constructor(
    @Inject(RevenueAttributionService) private readonly attribution: RevenueAttributionService,
    @Inject(TimeCostService) private readonly time: TimeCostService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  // -------------------------- attribution --------------------------------

  @RequireModuleScope('revenue', 'read')
  @Get('revenue-attributions/:revenueType/:revenueId')
  async getAttribution(
    @Param('businessId') businessId: string,
    @Param('revenueType') revenueType: string,
    @Param('revenueId') revenueId: string,
  ) {
    const row = await this.attribution.findOne(businessId, revenueType.toUpperCase() as RevenueType, revenueId);
    return row ?? null;
  }

  @RequireModuleScope('revenue', 'write')
  @Patch('revenue-attributions/:revenueType/:revenueId')
  async updateAttribution(
    @Param('businessId') businessId: string,
    @Param('revenueType') revenueType: string,
    @Param('revenueId') revenueId: string,
    @Body() body: UpdateRevenueAttributionDto,
    @Req() req: AuthedRequest,
  ) {
    const editedBy = req.user?.id ?? req.user?.sub ?? null;
    const updated = await this.attribution.update(
      businessId,
      revenueType.toUpperCase() as RevenueType,
      revenueId,
      {
        source: body.source as RevenueSource | undefined,
        sourceDetail: body.sourceDetail,
        contactId: body.contactId,
        campaignId: body.campaignId,
        staffId: body.staffId,
        referralCode: body.referralCode,
        attributionPercent: body.attributionPercent,
        editedBy,
      },
    );
    return updated;
  }

  // -------------------------- time-cost ----------------------------------

  @RequireModuleScope('revenue', 'read')
  @Get('time-cost/by-ref/:refType/:refId')
  async listForRef(
    @Param('businessId') businessId: string,
    @Param('refType') refType: string,
    @Param('refId') refId: string,
  ) {
    const { entries, summary } = await this.time.listForRef(
      businessId,
      refType.toUpperCase() as TimeCostRefType,
      refId,
    );
    // Frontend widget consumes the array directly; summary is exposed as a
    // header-style field for callers that want totals without re-summing.
    return { entries, summary, ...summary };
  }

  @RequireModuleScope('revenue', 'write')
  @Post('time-cost')
  create(
    @Param('businessId') businessId: string,
    @Body() body: CreateTimeCostDto,
    @Req() req: AuthedRequest,
  ) {
    return this.time.create({
      businessId,
      refType: body.refType,
      refId: body.refId,
      minutes: body.minutes,
      contactId: body.contactId ?? null,
      staffId: body.staffId ?? null,
      userId: req.user?.id ?? req.user?.sub ?? null,
      costRate: body.costRate ?? null,
      currency: body.currency,
      notes: body.notes ?? null,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined,
    });
  }

  @RequireModuleScope('revenue', 'write')
  @Patch('time-cost/:id')
  update(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: UpdateTimeCostDto,
  ) {
    return this.time.update(businessId, id, {
      minutes: body.minutes,
      contactId: body.contactId,
      staffId: body.staffId,
      costRate: body.costRate,
      currency: body.currency,
      notes: body.notes,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined,
    });
  }

  @RequireModuleScope('revenue', 'write')
  @Delete('time-cost/:id')
  remove(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.time.remove(businessId, id);
  }

  @RequireModuleScope('revenue', 'read')
  @Get('time-cost/contact/:contactId')
  contactRollup(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.time.getContactTimeRollup(businessId, contactId);
  }

  // -------------------------- detail-drawer metrics ----------------------

  /**
   * Lightweight metrics surface for the invoice/quote detail drawer.
   * Returns the duration metrics (sent→paid, sent→accepted) plus any
   * margin snapshots written by the payment-received hook so the UI can
   * render a margin chip without a second round trip.
   */
  @RequireModuleScope('revenue', 'read')
  @Get('leverage/metrics/:type/:id')
  async leverageMetrics(
    @Param('businessId') businessId: string,
    @Param('type') type: string,
    @Param('id') id: string,
  ) {
    const t = type.toLowerCase();
    if (t === 'invoice') {
      const inv = await this.prisma.client.invoice.findFirst({
        where: { id, businessId, deletedAt: null },
        select: { id: true, sentAt: true, paidAt: true, status: true, currency: true },
      });
      if (!inv) return { type: 'invoice', notFound: true };
      const timeToPayMs =
        inv.sentAt && inv.paidAt ? inv.paidAt.getTime() - inv.sentAt.getTime() : null;
      const margins = await this.prisma.client.marginSnapshot.findMany({
        where: { invoiceId: id },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          productId: true,
          grossMargin: true,
          marginBand: true,
          grossProfit: true,
          quantity: true,
          currency: true,
          createdAt: true,
        },
      });
      const totalGrossProfit = margins.reduce(
        (s, m) => s + (typeof m.grossProfit === 'number' ? m.grossProfit : 0),
        0,
      );
      const avgMargin =
        margins.length > 0
          ? margins.reduce((s, m) => s + m.grossMargin, 0) / margins.length
          : null;
      return {
        type: 'invoice',
        sentAt: inv.sentAt?.toISOString() ?? null,
        paidAt: inv.paidAt?.toISOString() ?? null,
        timeToPayMs,
        currency: inv.currency,
        marginSnapshots: margins,
        totalGrossProfit: Math.round(totalGrossProfit * 100) / 100,
        avgMargin: avgMargin != null ? Math.round(avgMargin * 1000) / 1000 : null,
      };
    }
    if (t === 'quote') {
      const q = await this.prisma.client.quote.findFirst({
        where: { id, businessId, deletedAt: null },
        select: { id: true, sentAt: true, acceptedAt: true, rejectedAt: true, currency: true },
      });
      if (!q) return { type: 'quote', notFound: true };
      const timeToCloseMs =
        q.sentAt && q.acceptedAt ? q.acceptedAt.getTime() - q.sentAt.getTime() : null;
      return {
        type: 'quote',
        sentAt: q.sentAt?.toISOString() ?? null,
        acceptedAt: q.acceptedAt?.toISOString() ?? null,
        rejectedAt: q.rejectedAt?.toISOString() ?? null,
        timeToCloseMs,
        currency: q.currency,
      };
    }
    return { type: t, notFound: true };
  }

  @RequireModuleScope('revenue', 'read')
  @Get('time-cost/rollup')
  businessRollup(
    @Param('businessId') businessId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.time.getBusinessTimeRollup(businessId, {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }
}
