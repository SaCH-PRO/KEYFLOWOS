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
  ConflictException,
  ForbiddenException,
  NotFoundException,
  Req,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessGuard } from '../../core/auth/business.guard';
import { RequireModuleScope } from '../../core/auth/module-scope.guard';
import { LEVEL_RANK, defaultScopesForRole, rankOf, type CanonicalModule } from '../../core/authority/module-vocabulary';
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
 * W6-TRASH-MODULE-SCOPE (owner ruling D-95; review SEC-TL500-3): the module
 * each trash model belongs to, in one table. Restoring or permanently deleting
 * a trashed record needs write access to that module, and seeing it in the
 * trash needs its read access (ModuleScopeGuard's levels: the Membership's
 * scope map, else its role defaults). D-95 names CRM for contacts, accounts
 * and opportunities; revenue for invoices, quotes and recurring invoices;
 * people for staff; marketing for community posts and landing pages. People
 * and marketing are not module keys (core/authority/module-vocabulary.ts), so
 * they read as their canonical keys: team, the people module, and content, as
 * D-63 maps marketing rows (timeline-visibility.ts). Every other model takes
 * the module its own routes declare (deal: crm; product: revenue, its writes
 * need revenue:write; expense: expenses; automationFlow: automations), else
 * its product area (booking and service: bookings; project and projectTask:
 * projects; socialPost, emailCampaign, leadForm and communityComment: content,
 * the marketing area; site: settings, as D-63 maps site rows).
 */
const TRASH_MODULE: Readonly<Record<TrashableModel, CanonicalModule>> = {
  contact: 'crm',
  account: 'crm',
  opportunity: 'crm',
  deal: 'crm',
  invoice: 'revenue',
  quote: 'revenue',
  recurringInvoice: 'revenue',
  product: 'revenue',
  staffMember: 'team',
  communityPost: 'content',
  landingPage: 'content',
  communityComment: 'content',
  socialPost: 'content',
  emailCampaign: 'content',
  leadForm: 'content',
  booking: 'bookings',
  service: 'bookings',
  project: 'projects',
  projectTask: 'projects',
  expense: 'expenses',
  automationFlow: 'automations',
  site: 'settings',
};

/**
 * W6-TRASH-MODULE-SCOPE (W5-TRASH-LIST-500 it.todo D46-S09g follow-up): the
 * trash models the client's soft-delete extension covers (packages/db/src/
 * client.ts, softDelete([...])). Their findMany, count and findFirst overwrite
 * any deletedAt filter with null, so a Prisma read never sees their trashed
 * rows (the owner's listing showed no trashed invoice or quote): the trash
 * reads them raw (trashedSql). Their delete is rewritten into a soft delete,
 * so the trash cannot delete them permanently either (permanentDelete: 409).
 */
const CLIENT_SOFT_DELETED: ReadonlySet<TrashableModel> = new Set<TrashableModel>([
  'contact', 'product', 'quote', 'invoice', 'staffMember', 'service',
  'booking', 'socialPost', 'project', 'projectTask', 'site',
]);

/**
 * W5-TRASH-LIST-500 (D46-S09g): the column a trashable model names its
 * business by, where it is not businessId. Opportunity names its business
 * posterBusinessId and has no businessId, so the listing's businessId filter
 * made Prisma refuse queryModel('opportunity') and GET trash with no model
 * answered 500 for every caller.
 */
const TENANT_COLUMN: Partial<Record<TrashableModel, 'posterBusinessId'>> = { opportunity: 'posterBusinessId' };

/**
 * The trash's filter for `model`: its trashed rows in `businessId`, on the
 * model's own tenant column. The listing reads with it, and restore and
 * permanent delete look the row up with it (W5-TRASH-LIST-500 review repair
 * SEC-TL500-1 / CR-TL500-1): that lookup is the only tenant check, as the
 * write keys on the id alone.
 *
 * W5-TRASH-LIST-500 review repair SEC-TL500-2: the client's soft-delete
 * extension overwrites a top-level deletedAt with null for the models it
 * covers (Contact, Invoice, Quote and eight more), so { deletedAt: { not: null } }
 * alone matched their LIVE rows: ?model=contact listed every live contact,
 * PRIVATE ones included, to any member, and restore and delete acted on live
 * rows. The NOT clause carries the same condition where the extension leaves
 * it, so such a model matches no row (its trashed rows stay unreadable here
 * until packages/db offers an opt-out) instead of its live ones.
 */
function trashedWhere(model: TrashableModel, businessId: string): Record<string, unknown> {
  return { [TENANT_COLUMN[model] ?? 'businessId']: businessId, deletedAt: { not: null }, NOT: { deletedAt: null } };
}

/** A row with deletedAt set: trash. A row without it is a live record, never listed or acted on here. */
function isTrashed(row: { deletedAt?: unknown } | null | undefined): boolean {
  return row != null && row.deletedAt != null;
}

type TrashSql = { list: string; count: string; find: string };
const TRASH_SQL = new Map<TrashableModel, TrashSql>();

/**
 * W6-TRASH-MODULE-SCOPE (D46-S09g follow-up): the raw reads of `model`'s
 * trashed rows in one business ($1), for a model in CLIENT_SOFT_DELETED. The
 * table and its columns come from the Prisma datamodel, never from the
 * request; each column is aliased to its Prisma field name, so a row reads as
 * a Prisma read of the model answers it. Filtered on the model's own tenant
 * column and on deleted_at IS NOT NULL (the trash filter trashedWhere states).
 * `list` takes LIMIT $2 OFFSET $3, `find` the id as $2.
 */
function trashedSql(model: TrashableModel): TrashSql {
  const cached = TRASH_SQL.get(model);
  if (cached) return cached;
  const meta = Prisma.dmmf.datamodel.models.find((m) => m.name.charAt(0).toLowerCase() + m.name.slice(1) === model);
  if (!meta) throw new Error(`No datamodel for the trash model '${model}'`);
  const column = (field: string) => `"${meta.fields.find((f) => f.name === field)?.dbName ?? field}"`;
  const select = meta.fields
    .filter((f) => f.kind === 'scalar' || f.kind === 'enum')
    .map((f) => `${column(f.name)} AS "${f.name}"`)
    .join(', ');
  const from = `FROM "${meta.dbName ?? meta.name}" WHERE ${column(TENANT_COLUMN[model] ?? 'businessId')} = $1 AND ${column('deletedAt')} IS NOT NULL`;
  const sql: TrashSql = {
    list: `SELECT ${select} ${from} ORDER BY ${column('deletedAt')} DESC LIMIT $2 OFFSET $3`,
    count: `SELECT count(*)::int AS "n" ${from}`,
    find: `SELECT ${select} ${from} AND ${column('id')} = $2 LIMIT 1`,
  };
  TRASH_SQL.set(model, sql);
  return sql;
}

/** What a caller may read: every module (a SUPER_ADMIN), a Membership's scope map, or nothing (no Membership). */
type ReadAccess = 'all' | Record<string, string> | null;

/**
 * W6-TRASH-MODULE-SCOPE (owner ruling D-95): ModuleScopeGuard's read rule for
 * `model`'s module (TRASH_MODULE). The guard's refusal, or null when `access`
 * may read it: 'Not a member of this business' with no Membership; 'Insufficient
 * permissions: <module> requires read access (you have <level>)' below read.
 */
function readRefusal(access: ReadAccess, model: TrashableModel): string | null {
  if (access === 'all') return null;
  if (access === null) return 'Not a member of this business';
  const module = TRASH_MODULE[model];
  const level = access[module] || 'none';
  return rankOf(level) < LEVEL_RANK.read ? `Insufficient permissions: ${module} requires read access (you have ${level})` : null;
}

@Controller('api/businesses/:businessId/trash')
@UseGuards(BusinessGuard)
export class TrashController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  // W4-TRASH-D46 review repair SEC-TRASH-D46-1: a revenue model is listed only
  // to a caller its revenue:read rule admits (now readRefusal).
  // W5-TRASH-LIST-500 (D46-S09g): each model is filtered on its own tenant
  // column (trashedWhere), and the every-model listing lists trashed rows only.
  // W5-TRASH-LIST-500 review repair SEC-TL500-2 (D46-S09i): so does ?model=.
  // W6-TRASH-MODULE-SCOPE (owner ruling D-95): every model is listed only to a
  // caller holding read access to its module (TRASH_MODULE; readRefusal), and
  // the trashed rows of a model the client soft-deletes are read raw (readTrashed).
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
      const refusal = readRefusal(await this.readAccess(req, businessId), model);
      if (refusal) throw new ForbiddenException(refusal);
      const items = (await this.readTrashed(model, businessId, limit, offset)).filter(isTrashed);
      const total = await this.countTrashed(model, businessId);
      return { items, total, model };
    }

    // Every model: one lookup at most; a caller gets the models whose module
    // it may read (D-95) and none of the others'.
    const access = await this.readAccess(req, businessId);
    if (access === null) throw new ForbiddenException('Not a member of this business');
    const allItems: Array<Record<string, unknown>> = [];
    for (const m of TRASHABLE_MODELS) {
      if (readRefusal(access, m)) continue;
      const items = await this.readTrashed(m, businessId, 10, 0);
      // W5-TRASH-LIST-500 (D46-S09g): a row with no deletedAt is live, not
      // trash. The client's soft-delete extension rewrites the filter to
      // deletedAt null for the models it covers (Contact, Invoice, Quote and
      // eight more), so those answer live rows here; none is listed as trash.
      // (Since the review repair SEC-TL500-2 trashedWhere's NOT clause keeps
      // them from answering any row; since W6-TRASH-MODULE-SCOPE they are read
      // raw, trashed rows only; this check stays as the last word.)
      for (const item of items) {
        if (isTrashed(item)) allItems.push({ ...item, _model: m });
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
   * a trashed schedule never bills again on that call.
   *
   * W6-TRASH-MODULE-SCOPE (owner ruling D-95; review SEC-TL500-3): every other
   * trash model is held to write access to its own module (TRASH_MODULE), the
   * same rule and messages with that module named. A SUPER_ADMIN keeps
   * ModuleScopeGuard's admission there (no lookup); D-46 still refuses a
   * non-member SUPER_ADMIN on the revenue models above.
   */
  private async assertMayWrite(req: ActorRequest | undefined, businessId: string, model: TrashableModel): Promise<void> {
    const module = TRASH_MODULE[model];
    const subject = REVENUE_TRASH_SUBJECT[model];
    const user = req?.user;
    if (user?.role === 'SUPER_ADMIN' && !subject) return;
    const scopes = await this.memberScopes(user?.id, businessId);
    if (scopes === null) {
      throw new ForbiddenException(
        user?.role === 'SUPER_ADMIN' ? `Not authorized to update this ${subject}` : 'Not a member of this business',
      );
    }
    const level = scopes[module] || 'none';
    if (rankOf(level) < LEVEL_RANK.write) {
      throw new ForbiddenException(`Insufficient permissions: ${module} requires write access (you have ${level})`);
    }
  }

  /**
   * W4-TRASH-D46 review repair SEC-TRASH-D46-1 (revenue:read) and
   * W6-TRASH-MODULE-SCOPE (owner ruling D-95, every model): listing a trash
   * model is a read of its module, which that module's routes hold to read
   * access through ModuleScopeGuard. What the caller may read, as the guard
   * reads it: a SUPER_ADMIN every module with no lookup (the guard admits it to
   * every read; D-46 rules writes only); any other caller its Membership's
   * scope map (else role defaults), or null with no Membership (readRefusal).
   */
  private async readAccess(req: ActorRequest | undefined, businessId: string): Promise<ReadAccess> {
    const user = req?.user;
    if (user?.role === 'SUPER_ADMIN') return 'all';
    return this.memberScopes(user?.id, businessId);
  }

  /**
   * The scope map of `userId`'s Membership in `businessId`: its explicit map,
   * else its role defaults (ModuleScopeGuard's reading); null with no Membership.
   */
  private async memberScopes(userId: string | undefined, businessId: string): Promise<Record<string, string> | null> {
    const membership = userId
      ? await this.prisma.client.membership.findUnique({
          where: { userId_businessId: { userId, businessId } },
          select: { role: true, permissionScopes: true },
        })
      : null;
    if (!membership) return null;
    return membership.permissionScopes && typeof membership.permissionScopes === 'object'
      ? (membership.permissionScopes as Record<string, string>)
      : defaultScopesForRole(membership.role);
  }

  /**
   * W6-TRASH-MODULE-SCOPE (D46-S09g follow-up): the trashed rows of `model` in
   * `businessId`, newest first. A model the client soft-deletes is read raw
   * (trashedSql), its page bounded as the client's findMany bounds one.
   */
  private async readTrashed(model: TrashableModel, businessId: string, take: number, skip: number): Promise<Array<Record<string, unknown>>> {
    if (!CLIENT_SOFT_DELETED.has(model)) {
      return (await this.queryModel(model, trashedWhere(model, businessId), take, skip)) as Array<Record<string, unknown>>;
    }
    const rows = await this.prisma.client.$queryRawUnsafe<Array<Record<string, unknown>>>(
      trashedSql(model).list,
      businessId,
      Math.min(Math.max(take, 0), 1000),
      Math.max(skip, 0),
    );
    return rows ?? [];
  }

  /** W6-TRASH-MODULE-SCOPE: how many trashed rows `model` has in `businessId` (raw where readTrashed reads raw). */
  private async countTrashed(model: TrashableModel, businessId: string): Promise<number> {
    if (!CLIENT_SOFT_DELETED.has(model)) return this.countModel(model, trashedWhere(model, businessId));
    const rows = await this.prisma.client.$queryRawUnsafe<Array<{ n: number }>>(trashedSql(model).count, businessId);
    return Number(rows?.[0]?.n ?? 0);
  }

  /**
   * The trashed row `id` of `model` in `businessId`, or null (a live row, or
   * another business's, is never found). W5-TRASH-LIST-500 review repair
   * SEC-TL500-1: this lookup is the only tenant check before the write, which
   * keys on the id alone. W6-TRASH-MODULE-SCOPE: raw where readTrashed reads raw.
   */
  private async findTrashed(model: TrashableModel, businessId: string, id: string): Promise<Record<string, unknown> | null> {
    if (!CLIENT_SOFT_DELETED.has(model)) {
      return (await this.findUnique(model, { id, ...trashedWhere(model, businessId) })) as Record<string, unknown> | null;
    }
    const rows = await this.prisma.client.$queryRawUnsafe<Array<Record<string, unknown>>>(trashedSql(model).find, businessId, id);
    return rows?.[0] ?? null;
  }

  // W4-TRASH-D46 (D-46): a revenue model runs assertMayWrite first.
  // W5-TRASH-LIST-500 review repair SEC-TL500-1 / CR-TL500-1 (D46-S09h): the
  // row is looked up with the listing's filter (trashedWhere), so a trashed
  // opportunity (no businessId column) is restored instead of answering 500;
  // SEC-TL500-2 (D46-S09i): a live row is never acted on.
  // W6-TRASH-MODULE-SCOPE (owner ruling D-95): every model runs assertMayWrite
  // (write access to its module) first, and the trashed row of a model the
  // client soft-deletes is found (findTrashed reads it raw).
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
    await this.assertMayWrite(req, businessId, model);
    const existing = await this.findTrashed(model, businessId, id);
    if (!isTrashed(existing)) throw new NotFoundException(`Trashed ${model} not found`);

    let restored: any;
    // W6-TRASH-MODULE-SCOPE: CatalogService.updateProduct ignores deletedAt (the
    // restore answered restored while the product stayed in the trash) and
    // updateService cannot find a trashed service, so deletedAt is cleared here
    // and the catalog's update then runs with no change, for its events.
    if (model === 'product') {
      await this.updateModel(model, id, { deletedAt: null });
      restored = await this.catalog.updateProduct({ businessId, productId: id });
    } else if (model === 'service') {
      await this.updateModel(model, id, { deletedAt: null });
      restored = await this.catalog.updateService({ businessId, serviceId: id });
    } else {
      restored = await this.updateModel(model, id, { deletedAt: null } as any);
    }
    return { restored: true, model, id, item: restored };
  }

  // W4-TRASH-D46 (D-46): a revenue model runs assertMayWrite first.
  // W5-TRASH-LIST-500 review repair SEC-TL500-1 / CR-TL500-1 (D46-S09h): the
  // row is looked up with the listing's filter (trashedWhere), as restore does;
  // SEC-TL500-2 (D46-S09i): a live row is never deleted from here.
  // W6-TRASH-MODULE-SCOPE (owner ruling D-95): every model runs assertMayWrite
  // first. A model the client soft-deletes answers 409: the client rewrites its
  // delete into a soft delete, so the row stayed in the trash (re-stamped) while
  // this answered deleted. Such a record can only be restored from here.
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
    await this.assertMayWrite(req, businessId, model);
    const existing = await this.findTrashed(model, businessId, id);
    if (!isTrashed(existing)) throw new NotFoundException(`Trashed ${model} not found`);
    if (CLIENT_SOFT_DELETED.has(model)) {
      throw new ConflictException(`Permanent delete is not available for a trashed ${model}: it can only be restored`);
    }

    await this.deleteModel(model, id);
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
      // W6-TRASH-MODULE-SCOPE: the restore of a product or service clears deletedAt here (see restore).
      case 'product': return this.prisma.client.product.update({ where: { id }, data });
      case 'service': return this.prisma.client.service.update({ where: { id }, data });
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
