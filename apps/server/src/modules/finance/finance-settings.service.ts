import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { isBusinessOwnerMember } from '../../core/auth/business-owner';
import { memberModuleLevel } from '../../core/auth/member-module-level';
import { LEVEL_RANK } from '../../core/authority/module-vocabulary';
import { ACCOUNTANT_EMAIL_EXPORT_TYPE, assertMaySetExportDestination } from '../../core/connectors/connector-exports';

/**
 * R0-09f (owner ruling D-11): the refusal a non-owner gets on
 * PATCH /finance/businesses/:businessId/settings for a defaultTaxRate change;
 * the code the concierge, genesis and template refusals answer (R0-09b, R0-09d).
 */
export const BUSINESS_PROFILE_OWNER_ONLY = 'BUSINESS_PROFILE_OWNER_ONLY';

export interface FinanceSettings {
  accountingBasis: 'CASH' | 'ACCRUAL';
  fiscalYearStartMonth: number;
  defaultTaxRate: number;
  defaultCashAccountId: string | null;
  defaultArAccountId: string | null;
  defaultApAccountId: string | null;
  defaultTaxAccountId: string | null;
  currency: string;
  accountantEmail: string | null;
}

export interface UpdateFinanceSettingsInput {
  accountingBasis?: 'CASH' | 'ACCRUAL';
  fiscalYearStartMonth?: number;
  defaultTaxRate?: number;
  defaultCashAccountId?: string | null;
  defaultArAccountId?: string | null;
  defaultApAccountId?: string | null;
  defaultTaxAccountId?: string | null;
  accountantEmail?: string | null;
}

/**
 * FU-FINANCE-SETTINGS-PATCH (V1-71, owner ruling D-205): what the caller may change in the finance settings, answered
 * beside them by GET and PATCH settings so the settings page offers only those fields and the accountant box knows,
 * before a send, whether "Remember this as the default recipient" will be allowed. Each hint is the check the write
 * runs, asked without writing: mayChangeAccountantEmail is assertMaySetExportDestination for the accountant export
 * (settings admin and revenue read; PATCH accountantEmail and the send's saveRecipient), mayChangeBooksSettings is
 * revenue write (the basis, the fiscal year and the four default accounts), mayChangeTaxRate is the D-11 owner test.
 * The server stays the enforcer: a hint decides what a screen offers, never what is written.
 */
export interface FinanceSettingsAccess {
  mayChangeAccountantEmail: boolean;
  mayChangeBooksSettings: boolean;
  mayChangeTaxRate: boolean;
}

/** D-205: the finance settings a change of which needs revenue write (the Books' module: D-57, PR195-BOOKS-DOORS). */
export const BOOKS_SETTINGS_FIELDS = [
  'accountingBasis',
  'fiscalYearStartMonth',
  'defaultCashAccountId',
  'defaultArAccountId',
  'defaultApAccountId',
  'defaultTaxAccountId',
] as const;
type BooksSettingsField = (typeof BOOKS_SETTINGS_FIELDS)[number];

/**
 * Whether a submitted finance setting is the value GET answers for it, so that submitting it changes nothing a reader
 * sees (the settings page saves the whole form with the values GET returned). Read as update writes it: a missing or
 * null basis or fiscal year is not written; an account id of '' is no account, as null is; an accountant email is
 * trimmed and '' is none. `current` is what get() answers.
 */
export function isUnchangedFinanceSetting(
  field: BooksSettingsField | 'accountantEmail',
  submitted: unknown,
  current: FinanceSettings,
): boolean {
  switch (field) {
    case 'accountingBasis':
      return submitted == null || submitted === current.accountingBasis;
    case 'fiscalYearStartMonth':
      return submitted == null || Number(submitted) === current.fiscalYearStartMonth;
    case 'accountantEmail': {
      if (submitted != null && typeof submitted !== 'string') return false;
      const next = submitted == null ? null : submitted.trim() || null;
      return next === (current.accountantEmail ?? null);
    }
    default: {
      if (submitted != null && typeof submitted !== 'string') return false;
      return (submitted || null) === (current[field] || null);
    }
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * FIN5 — Single read/write surface over the seven business-level finance
 * preferences (basis, fiscal year, default accounts, default tax rate).
 */
@Injectable()
export class FinanceSettingsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async get(businessId: string): Promise<FinanceSettings> {
    const biz = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: {
        accountingBasis: true,
        fiscalYearStartMonth: true,
        defaultTaxRate: true,
        defaultCashAccountId: true,
        defaultArAccountId: true,
        defaultApAccountId: true,
        defaultTaxAccountId: true,
        currency: true,
        accountantEmail: true,
      },
    });
    if (!biz) throw new NotFoundException('Business not found');
    return {
      accountingBasis: ((biz.accountingBasis as 'CASH' | 'ACCRUAL' | null) ?? 'CASH'),
      fiscalYearStartMonth: biz.fiscalYearStartMonth ?? 1,
      defaultTaxRate: biz.defaultTaxRate ?? 0,
      defaultCashAccountId: biz.defaultCashAccountId ?? null,
      defaultArAccountId: biz.defaultArAccountId ?? null,
      defaultApAccountId: biz.defaultApAccountId ?? null,
      defaultTaxAccountId: biz.defaultTaxAccountId ?? null,
      currency: biz.currency ?? 'TTD',
      accountantEmail: biz.accountantEmail ?? null,
    };
  }

  /**
   * R0-09f-D11-FINANCE-TAX-AND-WEB, owner ruling D-11 (2026-10-31: editing the
   * business profile is OWNER only, regardless of granted scopes; found by the
   * R0-09d sweep). update writes Business.defaultTaxRate, the tax rate the
   * owner-only profile PATCH (PATCH /identity/businesses/:businessId, R0-09,
   * UpdateBusinessDto) writes, so a non-owner — STAFF or ADMIN, settings:write
   * included — who CHANGES it is refused the whole submission: 403
   * BUSINESS_PROFILE_OWNER_ONLY before anything is validated or written.
   *
   * Gated by field, not as a route: accountingBasis, fiscalYearStartMonth, the
   * four default account ids and accountantEmail are not owner-only fields:
   * they keep the route's rule and the scopes owner ruling D-205 gives each
   * (assertMayChangeSettings, run after this). The finance settings page
   * saves the whole form with the rate GET returned (get answers a stored NULL
   * as 0), so a non-owner's submission that carries the current rate is not a
   * change: it goes through with defaultTaxRate removed, and a non-owner never
   * writes the column. Returns the input update may write.
   *
   * The owner test is isProfileOwner.
   */
  async assertTaxRateOwner(
    businessId: string,
    input: UpdateFinanceSettingsInput,
    actor: { id?: string; role?: string } | undefined,
  ): Promise<UpdateFinanceSettingsInput> {
    if (input.defaultTaxRate == null) return input;
    if (await this.isProfileOwner(businessId, actor)) return input;
    const current = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { defaultTaxRate: true },
    });
    if (current && Number(input.defaultTaxRate) === (current.defaultTaxRate ?? 0)) {
      const rest: UpdateFinanceSettingsInput = { ...input };
      delete rest.defaultTaxRate;
      return rest;
    }
    throw new ForbiddenException({
      code: BUSINESS_PROFILE_OWNER_ONLY,
      message: 'Only the business owner can change the default tax rate.',
      fields: ['defaultTaxRate'],
    });
  }

  /**
   * Whether the actor is the business owner for owner ruling D-11
   * (R0-09f-D11-FINANCE-TAX-AND-WEB): an OWNER membership of the route's
   * business, the one owner rule core/auth/business-owner.ts
   * isBusinessOwnerMember states (owner rulings D-104, D-116, D-125:
   * Business.ownerId grants nothing on its own; W11-OWNER-HELPER-D11); a
   * SUPER_ADMIN keeps the platform bypass BusinessGuard grants. Consumers: the
   * tax rate on PATCH /finance/businesses/:id/settings and PATCH
   * /commerce/businesses/:id/document-templates (R0-09g; review CR-D116P-1).
   * The actor is the authenticated user AuthMiddleware attached (req.user);
   * none is not the owner (fails closed).
   */
  async isProfileOwner(businessId: string, actor: { id?: string; role?: string } | undefined): Promise<boolean> {
    if (!actor?.id) return false;
    if (actor.role === 'SUPER_ADMIN') return true;
    return isBusinessOwnerMember(this.prisma.client, businessId, actor.id);
  }

  /**
   * FU-FINANCE-SETTINGS-PATCH (V1-71, owner ruling D-205, 2026-11-16): who may change which finance setting through
   * PATCH /finance/businesses/:id/settings. The controller runs it after the route's revenue read (ModuleScopeGuard)
   * and after assertTaxRateOwner (D-11, unchanged and still first), before update. By field:
   *   - a change of accountantEmail (a new address, or clearing it) binds where the accountant export goes whenever a
   *     send names no `to`: settings admin and revenue read, the WH3-1 binding rule, through the same
   *     assertMaySetExportDestination(..., ACCOUNTANT_EMAIL_EXPORT_TYPE) the accountant box's saveRecipient runs
   *     (AccountantExportEmailService.send), so the two doors to Business.accountantEmail hold one rule;
   *   - a change of the basis, the fiscal year or a default account id (BOOKS_SETTINGS_FIELDS): revenue write, read as
   *     ModuleScopeGuard reads it (memberModuleLevel; a SUPER_ADMIN is admin), refused in its words.
   * A refusal is a 403 naming the refused fields (`fields`), before anything is validated or written. A submitted value
   * equal to the one GET answers is not a change (isUnchangedFinanceSetting; the settings page saves the whole form, as
   * assertTaxRateOwner already reads the rate): it is not refused, and a member who may not change that field does not
   * write it (it is removed from the returned input), so a stored NULL stays NULL and a submission with nothing they
   * may change writes nothing. Returns the input update may write.
   */
  async assertMayChangeSettings(
    businessId: string,
    input: UpdateFinanceSettingsInput,
    actor: { id?: string; role?: string } | undefined,
  ): Promise<UpdateFinanceSettingsInput> {
    const out: UpdateFinanceSettingsInput = { ...input };
    const present = (field: keyof UpdateFinanceSettingsInput) => Object.prototype.hasOwnProperty.call(input, field) && input[field] !== undefined;
    const books = BOOKS_SETTINGS_FIELDS.filter((f) => present(f));
    const address = present('accountantEmail');
    if (books.length === 0 && !address) return out;
    const current = await this.get(businessId);

    if (books.length > 0) {
      const changed = books.filter((f) => !isUnchangedFinanceSetting(f, input[f], current));
      const level = await memberModuleLevel(this.prisma, businessId, actor, 'revenue');
      const mayWrite = LEVEL_RANK[level] >= LEVEL_RANK.write;
      if (changed.length > 0 && !mayWrite) {
        throw new ForbiddenException({
          message: `Insufficient permissions: revenue requires write access (you have ${level})`,
          fields: changed,
        });
      }
      if (!mayWrite) for (const f of books) delete out[f];
    }

    if (address) {
      if (!isUnchangedFinanceSetting('accountantEmail', input.accountantEmail, current)) {
        try {
          await assertMaySetExportDestination(this.prisma, businessId, actor, ACCOUNTANT_EMAIL_EXPORT_TYPE);
        } catch (e) {
          if (e instanceof ForbiddenException) throw new ForbiddenException({ message: e.message, fields: ['accountantEmail'] });
          throw e;
        }
      } else if (!(await this.maySetAccountantEmail(businessId, actor))) {
        delete out.accountantEmail;
      }
    }
    return out;
  }

  /** FU-FINANCE-SETTINGS-PATCH: the caller's capability hints (FinanceSettingsAccess), each the check its write runs. */
  async access(businessId: string, actor: { id?: string; role?: string } | undefined): Promise<FinanceSettingsAccess> {
    const [revenue, mayChangeAccountantEmail, mayChangeTaxRate] = await Promise.all([
      memberModuleLevel(this.prisma, businessId, actor, 'revenue'),
      this.maySetAccountantEmail(businessId, actor),
      this.isProfileOwner(businessId, actor),
    ]);
    return { mayChangeAccountantEmail, mayChangeBooksSettings: LEVEL_RANK[revenue] >= LEVEL_RANK.write, mayChangeTaxRate };
  }

  /** The finance settings with the caller's capability hints: what GET and PATCH settings answer. */
  async getFor(
    businessId: string,
    actor: { id?: string; role?: string } | undefined,
  ): Promise<FinanceSettings & FinanceSettingsAccess> {
    const [settings, access] = await Promise.all([this.get(businessId), this.access(businessId, actor)]);
    return { ...settings, ...access };
  }

  /** Whether assertMaySetExportDestination admits the actor for the accountant export's address (a 403 is "no"). */
  private async maySetAccountantEmail(businessId: string, actor: { id?: string; role?: string } | undefined): Promise<boolean> {
    try {
      await assertMaySetExportDestination(this.prisma, businessId, actor, ACCOUNTANT_EMAIL_EXPORT_TYPE);
      return true;
    } catch (e) {
      if (e instanceof ForbiddenException) return false;
      throw e;
    }
  }

  /**
   * Owner-only (D-11) for defaultTaxRate: the controller runs assertTaxRateOwner first; D-205 for the other fields: then
   * assertMayChangeSettings (FU-FINANCE-SETTINGS-PATCH). update writes what they return.
   *
   * Review repair SEC-FSP-1: the input is the PATCH body as JSON parsed it (no DTO), and every value written goes to
   * business.update, which reads an object as a Prisma update operator ({set: v}, {increment: n}). So each value must be
   * of its field's type (null or absent where the field allows it) before anything is checked further or written, a 400
   * in the field's own words otherwise: the basis 'CASH' or 'ACCRUAL', the fiscal year a whole month 1-12, the tax rate a
   * finite number 0-100, a default account id text, the accountant email text. The ownership check then sees every
   * default account id that will be written, and nothing but plain values reaches the row.
   */
  async update(businessId: string, input: UpdateFinanceSettingsInput): Promise<FinanceSettings> {
    // The body is untyped JSON: read each value as what it is, not as UpdateFinanceSettingsInput says it is.
    const raw = input as Record<keyof UpdateFinanceSettingsInput, unknown>;
    if (raw.accountingBasis != null && raw.accountingBasis !== 'CASH' && raw.accountingBasis !== 'ACCRUAL') {
      throw new BadRequestException('Accounting basis must be CASH or ACCRUAL');
    }
    if (raw.fiscalYearStartMonth != null) {
      const month = raw.fiscalYearStartMonth;
      if (typeof month !== 'number' || !Number.isInteger(month) || month < 1 || month > 12) {
        throw new BadRequestException('Fiscal year start month must be 1-12');
      }
    }
    if (raw.defaultTaxRate != null) {
      const rate = raw.defaultTaxRate;
      if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 100) {
        throw new BadRequestException('Default tax rate must be between 0 and 100');
      }
    }

    // Validate any defaultXxxAccountId references belong to this business —
    // mis-pointed defaults silently corrupt postings downstream. A value that is
    // not text (an update operator, a list, a number) is no account of this
    // business either (SEC-FSP-1).
    const accountValues = [raw.defaultCashAccountId, raw.defaultArAccountId, raw.defaultApAccountId, raw.defaultTaxAccountId];
    if (accountValues.some((x) => x != null && typeof x !== 'string')) {
      throw new BadRequestException('One or more default accounts do not belong to this business');
    }
    const accountIds = accountValues.filter((x): x is string => typeof x === 'string' && x.length > 0);
    if (accountIds.length > 0) {
      const found = await this.prisma.client.financialAccount.count({
        where: { businessId, id: { in: accountIds } },
      });
      if (found !== new Set(accountIds).size) {
        throw new BadRequestException('One or more default accounts do not belong to this business');
      }
    }

    if (raw.accountantEmail != null && raw.accountantEmail !== '') {
      if (typeof raw.accountantEmail !== 'string' || !EMAIL_RE.test(raw.accountantEmail.trim())) {
        throw new BadRequestException('Accountant email is not a valid email address');
      }
    }

    const data: Record<string, unknown> = {};
    if (input.accountingBasis != null) data.accountingBasis = input.accountingBasis;
    if (input.fiscalYearStartMonth != null) data.fiscalYearStartMonth = input.fiscalYearStartMonth;
    if (input.defaultTaxRate != null) data.defaultTaxRate = input.defaultTaxRate;
    if (input.defaultCashAccountId !== undefined) data.defaultCashAccountId = input.defaultCashAccountId;
    if (input.defaultArAccountId !== undefined) data.defaultArAccountId = input.defaultArAccountId;
    if (input.defaultApAccountId !== undefined) data.defaultApAccountId = input.defaultApAccountId;
    if (input.defaultTaxAccountId !== undefined) data.defaultTaxAccountId = input.defaultTaxAccountId;
    if (input.accountantEmail !== undefined) {
      const v = input.accountantEmail == null ? null : input.accountantEmail.trim();
      data.accountantEmail = v && v.length > 0 ? v : null;
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.client.business.update({ where: { id: businessId }, data });
    }
    return this.get(businessId);
  }
}
