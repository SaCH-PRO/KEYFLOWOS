import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  Param,
  UseGuards,
  Inject,
  ParseIntPipe,
  DefaultValuePipe,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Req,
} from '@nestjs/common';
import { BusinessGuard } from '../../core/auth/business.guard';
import { RequireModuleScope } from '../../core/auth/module-scope.guard';
import { LEVEL_RANK, defaultScopesForRole, rankOf } from '../../core/authority/module-vocabulary';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CatalogService } from '../catalog/catalog.service';

/** The caller as AuthMiddleware attaches it. */
type ActorRequest = { user?: { id?: string; role?: string } };

/**
 * W4-TRASH-D46 (owner ruling D-46): the trashable models that are revenue
 * records (an invoice, a quote, an invoice schedule the scheduler turns into
 * real invoices; the trash holds no payment model), with the subject a
 * non-member SUPER_ADMIN's refusal names, as the commerce writes name it.
 */
const REVENUE_TRASH_SUBJECT: Readonly<Record<string, 'invoice' | 'quote'>> = {
  invoice: 'invoice',
  quote: 'quote',
  recurringInvoice: 'invoice',
};

const TRASHABLE_MODELS = [
  'contact', 'deal', 'product', 'quote', 'invoice', 'booking',
  'project', 'projectTask', 'expense', 'automationFlow', 'account',
  'service', 'staffMember', 'socialPost', 'site', 'recurringInvoice',
  'emailCampaign', 'leadForm', 'landingPage', 'communityPost',
  'communityComment', 'opportunity',
] as const;

type TrashableModel = (typeof TRASHABLE_MODELS)[number];

function isTrashableModel(value: string): value is TrashableModel {
  return TRASHABLE_MODELS.includes(value as TrashableModel);
}

/**
 * W5-TRASH-LIST-500 (D46-S09g): the column a trashable model names its
 * business by, where it is not businessId. Opportunity names its business
 * posterBusinessId and has no businessId, so the listing's businessId filter
 * made Prisma refuse queryModel('opportunity') and GET trash with no model
 * answered 500 for every caller.
 */
const TENANT_COLUMN: Partial<Record<TrashableModel, 'posterBusinessId'>> = { opportunity: 'posterBusinessId' };

/** The listing's filter for `model`: its trashed rows in `businessId`, on the model's own tenant column. */
function trashedWhere(model: TrashableModel, businessId: string): Record<string, unknown> {
  return { [TENANT_COLUMN[model] ?? 'businessId']: businessId, deletedAt: { not: null } };
}

@Controller('api/businesses/:businessId/trash')
@UseGuards(BusinessGuard)
export class TrashController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  // W4-TRASH-D46 review repair SEC-TRASH-D46-1: a revenue model is listed only
  // to a caller revenueReadRefusal admits.
  // W5-TRASH-LIST-500 (D46-S09g): each model is filtered on its own tenant
  // column (trashedWhere), and the every-model listing lists trashed rows only.
  @Get()
  @RequireModuleScope('settings')
  async listTrashed(
    @Param('businessId') businessId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('model') model?: string,
    @Req() req?: ActorRequest,
  ) {
    if (model) {
      if (!isTrashableModel(model)) {
        throw new BadRequestException(`Model '${model}' is not trashable`);
      }
      if (REVENUE_TRASH_SUBJECT[model]) {
        const refusal = await this.revenueReadRefusal(req, businessId);
        if (refusal) throw new ForbiddenException(refusal);
      }
      const where = trashedWhere(model, businessId);
      const items = await this.queryModel(model, where, limit, offset);
      const total = await this.countModel(model, where);
      return { items, total, model };
    }

    // Every model: one lookup at most; a caller below revenue:read gets the
    // other models' rows and none of the revenue models'.
    const mayReadRevenue = (await this.revenueReadRefusal(req, businessId)) === null;
    const allItems: Array<Record<string, unknown>> = [];
    for (const m of TRASHABLE_MODELS) {
      if (REVENUE_TRASH_SUBJECT[m] && !mayReadRevenue) continue;
      const items = await this.queryModel(m, trashedWhere(m, businessId), 10, 0);
      // W5-TRASH-LIST-500 (D46-S09g): a row with no deletedAt is live, not
      // trash. The client's soft-delete extension rewrites the filter to
      // deletedAt null for the models it covers (Contact, Invoice, Quote and
      // eight more), so those answer live rows here; none is listed as trash.
      for (const item of items) {
        if (item.deletedAt != null) allItems.push({ ...item, _model: m });
      }
    }
    allItems.sort((a, b) => {
      const aDate = new Date((a.deletedAt as string) || 0).getTime();
      const bDate = new Date((b.deletedAt as string) || 0).getTime();
      return bDate - aDate;
    });

    return { items: allItems.slice(offset, offset + limit), total: allItems.length };
  }

  /**
   * W4-TRASH-D46 (owner ruling D-46; review SEC-W3D46R-3, census D46-S09):
   * restoring or permanently deleting a revenue record is a revenue write.
   * This controller runs BusinessGuard alone (its @RequireModuleScope has no
   * ModuleScopeGuard to enforce it), and BusinessGuard admits a platform
   * SUPER_ADMIN to every tenant, so a non-member SUPER_ADMIN and a
   * revenue:read member brought a trashed ACTIVE schedule back (it then
   * billed again) or erased it. For a revenue model, every caller needs a
   * Membership in :businessId whose scope map (or, without one, the role
   * defaults) holds revenue:write, ModuleScopeGuard's rule restated:
   *   - a SUPER_ADMIN with no Membership: 403 'Not authorized to update this
   *     invoice|quote' (D-46, as CommerceController and
   *     RecurringInvoiceController answer it);
   *   - any other caller with no Membership: the guard's 'Not a member of
   *     this business';
   *   - a Membership below revenue:write: the guard's 'Insufficient
   *     permissions: revenue requires write access (you have <level>)'.
   * Checked before any read or write, so a refused call restores nothing and
   * a trashed schedule never bills again on that call. Every other trash model
   * is unchanged and costs no query.
   */
  private async assertMayWriteRevenue(req: ActorRequest | undefined, businessId: string, model: TrashableModel): Promise<void> {
    const subject = REVENUE_TRASH_SUBJECT[model];
    if (!subject) return;
    const user = req?.user;
    const level = await this.memberRevenueLevel(user?.id, businessId);
    if (level === null) {
      throw new ForbiddenException(
        user?.role === 'SUPER_ADMIN' ? `Not authorized to update this ${subject}` : 'Not a member of this business',
      );
    }
    if (rankOf(level) < LEVEL_RANK.write) {
      throw new ForbiddenException(`Insufficient permissions: revenue requires write access (you have ${level})`);
    }
  }

  /**
   * W4-TRASH-D46 review repair SEC-TRASH-D46-1 (revenue:read; owner ruling
   * D-46 rules writes only): listing the trash's revenue models (invoice,
   * quote, recurringInvoice) is a revenue read, which GET recurring-invoices,
   * invoices and quotes hold to revenue:read through ModuleScopeGuard. This
   * controller has no such guard, so a member whose revenue level is 'none'
   * read those rows here. ModuleScopeGuard's read rule, restated:
   *   - a SUPER_ADMIN is admitted with no lookup (the guard admits it to every
   *     read; D-46 refuses its writes, assertMayWriteRevenue above);
   *   - any other caller with no Membership: 'Not a member of this business';
   *   - a Membership below revenue:read: 'Insufficient permissions: revenue
   *     requires read access (you have <level>)'.
   * Returns that refusal, or null when the caller may read revenue.
   */
  private async revenueReadRefusal(req: ActorRequest | undefined, businessId: string): Promise<string | null> {
    const user = req?.user;
    if (user?.role === 'SUPER_ADMIN') return null;
    const level = await this.memberRevenueLevel(user?.id, businessId);
    if (level === null) return 'Not a member of this business';
    if (rankOf(level) < LEVEL_RANK.read) return `Insufficient permissions: revenue requires read access (you have ${level})`;
    return null;
  }

  /**
   * The revenue level of `userId`'s Membership in `businessId`: its scope map,
   * else its role defaults (ModuleScopeGuard's reading); null with no Membership.
   */
  private async memberRevenueLevel(userId: string | undefined, businessId: string): Promise<string | null> {
    const membership = userId
      ? await this.prisma.client.membership.findUnique({
          where: { userId_businessId: { userId, businessId } },
          select: { role: true, permissionScopes: true },
        })
      : null;
    if (!membership) return null;
    const scopes: Record<string, string> =
      membership.permissionScopes && typeof membership.permissionScopes === 'object'
        ? (membership.permissionScopes as Record<string, string>)
        : defaultScopesForRole(membership.role);
    return scopes.revenue || 'none';
  }

  // W4-TRASH-D46 (D-46): a revenue model runs assertMayWriteRevenue first.
  @Post(':model/:id/restore')
  @RequireModuleScope('settings')
  async restore(
    @Param('businessId') businessId: string,
    @Param('model') model: string,
    @Param('id') id: string,
    @Req() req?: ActorRequest,
  ) {
    if (!isTrashableModel(model)) {
      throw new BadRequestException(`Model '${model}' is not trashable`);
    }
    await this.assertMayWriteRevenue(req, businessId, model);
    const existing = await this.findUnique(model, { id, businessId, deletedAt: { not: null } });
    if (!existing) throw new NotFoundException(`Trashed ${model} not found`);

    let restored: any;
    if (model === 'product') {
      restored = await this.catalog.updateProduct({ businessId, productId: id, deletedAt: null } as any);
    } else if (model === 'service') {
      restored = await this.catalog.updateService({ businessId, serviceId: id, deletedAt: null } as any);
    } else {
      restored = await this.updateModel(model, id, { deletedAt: null } as any);
    }
    return { restored: true, model, id, item: restored };
  }

  // W4-TRASH-D46 (D-46): a revenue model runs assertMayWriteRevenue first.
  @Delete(':model/:id')
  @RequireModuleScope('settings')
  async permanentDelete(
    @Param('businessId') businessId: string,
    @Param('model') model: string,
    @Param('id') id: string,
    @Req() req?: ActorRequest,
  ) {
    if (!isTrashableModel(model)) {
      throw new BadRequestException(`Model '${model}' is not trashable`);
    }
    await this.assertMayWriteRevenue(req, businessId, model);
    const existing = await this.findUnique(model, { id, businessId, deletedAt: { not: null } });
    if (!existing) throw new NotFoundException(`Trashed ${model} not found`);

    if (model === 'product') {
      await this.catalog.deleteProduct(businessId, id);
    } else if (model === 'service') {
      await this.catalog.deleteService(businessId, id);
    } else {
      await this.deleteModel(model, id);
    }
    return { deleted: true, model, id };
  }

  private async queryModel(model: TrashableModel, where: Record<string, unknown>, take: number, skip: number) {
    const args = { where, take, skip, orderBy: { deletedAt: 'desc' as const } };
    switch (model) {
      case 'contact': return this.prisma.client.contact.findMany(args);
      case 'deal': return this.prisma.client.deal.findMany(args);
      case 'product': return this.prisma.client.product.findMany(args);
      case 'quote': return this.prisma.client.quote.findMany(args);
      case 'invoice': return this.prisma.client.invoice.findMany(args);
      case 'booking': return this.prisma.client.booking.findMany(args);
      case 'project': return this.prisma.client.project.findMany(args);
      case 'projectTask': return this.prisma.client.projectTask.findMany(args);
      case 'expense': return this.prisma.client.expense.findMany(args);
      case 'automationFlow': return this.prisma.client.automationFlow.findMany(args);
      case 'account': return this.prisma.client.account.findMany(args);
      case 'service': return this.prisma.client.service.findMany(args);
      case 'staffMember': return this.prisma.client.staffMember.findMany(args);
      case 'socialPost': return this.prisma.client.socialPost.findMany(args);
      case 'site': return this.prisma.client.site.findMany(args);
      case 'recurringInvoice': return this.prisma.client.recurringInvoice.findMany(args);
      case 'emailCampaign': return this.prisma.client.emailCampaign.findMany(args);
      case 'leadForm': return this.prisma.client.leadForm.findMany(args);
      case 'landingPage': return this.prisma.client.landingPage.findMany(args);
      case 'communityPost': return this.prisma.client.communityPost.findMany(args);
      case 'communityComment': return this.prisma.client.communityComment.findMany(args);
      case 'opportunity': return this.prisma.client.opportunity.findMany(args);
      default: return [];
    }
  }

  private async countModel(model: TrashableModel, where: Record<string, unknown>) {
    switch (model) {
      case 'contact': return this.prisma.client.contact.count({ where });
      case 'deal': return this.prisma.client.deal.count({ where });
      case 'product': return this.prisma.client.product.count({ where });
      case 'quote': return this.prisma.client.quote.count({ where });
      case 'invoice': return this.prisma.client.invoice.count({ where });
      case 'booking': return this.prisma.client.booking.count({ where });
      case 'project': return this.prisma.client.project.count({ where });
      case 'projectTask': return this.prisma.client.projectTask.count({ where });
      case 'expense': return this.prisma.client.expense.count({ where });
      case 'automationFlow': return this.prisma.client.automationFlow.count({ where });
      case 'account': return this.prisma.client.account.count({ where });
      case 'service': return this.prisma.client.service.count({ where });
      case 'staffMember': return this.prisma.client.staffMember.count({ where });
      case 'socialPost': return this.prisma.client.socialPost.count({ where });
      case 'site': return this.prisma.client.site.count({ where });
      case 'recurringInvoice': return this.prisma.client.recurringInvoice.count({ where });
      case 'emailCampaign': return this.prisma.client.emailCampaign.count({ where });
      case 'leadForm': return this.prisma.client.leadForm.count({ where });
      case 'landingPage': return this.prisma.client.landingPage.count({ where });
      case 'communityPost': return this.prisma.client.communityPost.count({ where });
      case 'communityComment': return this.prisma.client.communityComment.count({ where });
      case 'opportunity': return this.prisma.client.opportunity.count({ where });
      default: return 0;
    }
  }

  private async findUnique(model: TrashableModel, where: Record<string, unknown>) {
    switch (model) {
      case 'contact': return this.prisma.client.contact.findFirst({ where });
      case 'deal': return this.prisma.client.deal.findFirst({ where });
      case 'product': return this.prisma.client.product.findFirst({ where });
      case 'quote': return this.prisma.client.quote.findFirst({ where });
      case 'invoice': return this.prisma.client.invoice.findFirst({ where });
      case 'booking': return this.prisma.client.booking.findFirst({ where });
      case 'project': return this.prisma.client.project.findFirst({ where });
      case 'projectTask': return this.prisma.client.projectTask.findFirst({ where });
      case 'expense': return this.prisma.client.expense.findFirst({ where });
      case 'automationFlow': return this.prisma.client.automationFlow.findFirst({ where });
      case 'account': return this.prisma.client.account.findFirst({ where });
      case 'service': return this.prisma.client.service.findFirst({ where });
      case 'staffMember': return this.prisma.client.staffMember.findFirst({ where });
      case 'socialPost': return this.prisma.client.socialPost.findFirst({ where });
      case 'site': return this.prisma.client.site.findFirst({ where });
      case 'recurringInvoice': return this.prisma.client.recurringInvoice.findFirst({ where });
      case 'emailCampaign': return this.prisma.client.emailCampaign.findFirst({ where });
      case 'leadForm': return this.prisma.client.leadForm.findFirst({ where });
      case 'landingPage': return this.prisma.client.landingPage.findFirst({ where });
      case 'communityPost': return this.prisma.client.communityPost.findFirst({ where });
      case 'communityComment': return this.prisma.client.communityComment.findFirst({ where });
      case 'opportunity': return this.prisma.client.opportunity.findFirst({ where });
      default: return null;
    }
  }

  private async updateModel(model: TrashableModel, id: string, data: any) {
    switch (model) {
      case 'contact': return this.prisma.client.contact.update({ where: { id }, data });
      case 'deal': return this.prisma.client.deal.update({ where: { id }, data });
      case 'quote': return this.prisma.client.quote.update({ where: { id }, data });
      case 'invoice': return this.prisma.client.invoice.update({ where: { id }, data });
      case 'booking': return this.prisma.client.booking.update({ where: { id }, data });
      case 'project': return this.prisma.client.project.update({ where: { id }, data });
      case 'projectTask': return this.prisma.client.projectTask.update({ where: { id }, data });
      case 'expense': return this.prisma.client.expense.update({ where: { id }, data });
      case 'automationFlow': return this.prisma.client.automationFlow.update({ where: { id }, data });
      case 'account': return this.prisma.client.account.update({ where: { id }, data });
      case 'staffMember': return this.prisma.client.staffMember.update({ where: { id }, data });
      case 'socialPost': return this.prisma.client.socialPost.update({ where: { id }, data });
      case 'site': return this.prisma.client.site.update({ where: { id }, data });
      case 'recurringInvoice': return this.prisma.client.recurringInvoice.update({ where: { id }, data });
      case 'emailCampaign': return this.prisma.client.emailCampaign.update({ where: { id }, data });
      case 'leadForm': return this.prisma.client.leadForm.update({ where: { id }, data });
      case 'landingPage': return this.prisma.client.landingPage.update({ where: { id }, data });
      case 'communityPost': return this.prisma.client.communityPost.update({ where: { id }, data });
      case 'communityComment': return this.prisma.client.communityComment.update({ where: { id }, data });
      case 'opportunity': return this.prisma.client.opportunity.update({ where: { id }, data });
      default: return null;
    }
  }

  private async deleteModel(model: TrashableModel, id: string) {
    switch (model) {
      case 'contact': return this.prisma.client.contact.delete({ where: { id } });
      case 'deal': return this.prisma.client.deal.delete({ where: { id } });
      case 'quote': return this.prisma.client.quote.delete({ where: { id } });
      case 'invoice': return this.prisma.client.invoice.delete({ where: { id } });
      case 'booking': return this.prisma.client.booking.delete({ where: { id } });
      case 'project': return this.prisma.client.project.delete({ where: { id } });
      case 'projectTask': return this.prisma.client.projectTask.delete({ where: { id } });
      case 'expense': return this.prisma.client.expense.delete({ where: { id } });
      case 'automationFlow': return this.prisma.client.automationFlow.delete({ where: { id } });
      case 'account': return this.prisma.client.account.delete({ where: { id } });
      case 'staffMember': return this.prisma.client.staffMember.delete({ where: { id } });
      case 'socialPost': return this.prisma.client.socialPost.delete({ where: { id } });
      case 'site': return this.prisma.client.site.delete({ where: { id } });
      case 'recurringInvoice': return this.prisma.client.recurringInvoice.delete({ where: { id } });
      case 'emailCampaign': return this.prisma.client.emailCampaign.delete({ where: { id } });
      case 'leadForm': return this.prisma.client.leadForm.delete({ where: { id } });
      case 'landingPage': return this.prisma.client.landingPage.delete({ where: { id } });
      case 'communityPost': return this.prisma.client.communityPost.delete({ where: { id } });
      case 'communityComment': return this.prisma.client.communityComment.delete({ where: { id } });
      case 'opportunity': return this.prisma.client.opportunity.delete({ where: { id } });
      default: return null;
    }
  }
}
