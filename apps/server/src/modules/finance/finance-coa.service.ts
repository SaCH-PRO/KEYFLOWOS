import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { getCurrentBusinessId } from '../../core/tenant/tenant-context';
import { ChartOfAccountsSeederService } from './chart-of-accounts-seeder.service';

const ALLOWED_TYPES = new Set(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'COGS', 'EXPENSE']);

export interface CreateCoaInput {
  name: string;
  type: string;
  subtype?: string | null;
  code?: string | null;
  parentId?: string | null;
}

export type UpdateCoaInput = Partial<Omit<CreateCoaInput, 'type'>> & { isActive?: boolean };

/** Namespace of the per-business advisory lock that serializes account-code writes. */
const COA_CODE_LOCK_NAMESPACE = 'coa-code:';

/**
 * The whitespace trimmed off a code, on both sides of the comparison: the SQL check trims the stored code
 * with this same set (rows written before this rule were stored verbatim), so the service and the database
 * agree on what a code is.
 */
const COA_CODE_WHITESPACE = ' \t\n\r\f\v';

function trimCoaCode(code: string): string {
  let start = 0;
  let end = code.length;
  while (start < end && COA_CODE_WHITESPACE.includes(code[start])) start++;
  while (end > start && COA_CODE_WHITESPACE.includes(code[end - 1])) end--;
  return code.slice(start, end);
}

/**
 * An account code as it is stored: text, trimmed; a blank code is no code (null). The body is not
 * validated before it reaches here, so a code that is not text (a JSON number, an object) is refused
 * 400 instead of reaching Prisma, where it raised a validation error (a 500).
 */
function normalizeCoaCode(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') throw new BadRequestException('Account code must be text');
  const code = trimCoaCode(raw);
  return code === '' ? null : code;
}

/** A stored code as it is compared: trimmed (a row written before this rule may not be); blank is no code. */
function storedCoaCode(code: string | null): string | null {
  const trimmed = trimCoaCode(code ?? '');
  return trimmed === '' ? null : trimmed;
}

/**
 * FIN5 — CRUD on ChartOfAccount. System rows (`isSystem=true`) are
 * read-only except for `isActive` toggling, which is also blocked for
 * accounts referenced by the system seed (they back the postings engine).
 *
 * V1-63 SWP-COA-UNIQUE-CODE (BUG-111; owner ruling D-167: the check stays in code, no unique index): a code
 * is used by at most one ACTIVE account of a business. create() and update() refuse a write that would make
 * a second one with 409 COA_CODE_TAKEN and write no account (the system chart may have been seeded first):
 *   - a create with a code, an update that changes the code (also on an account that is, or in the same
 *     request becomes, archived: no row is left one step from a duplicate) and an update that brings an
 *     archived account back are checked against the business's other active accounts, system accounts
 *     included (so the system chart is seeded first: a custom 6100 on a chart never listed would otherwise
 *     be joined by the seed's own 6100);
 *   - codes are compared trimmed and without letter case (as Postgres lower() folds it; the database alone
 *     decides a collision), and stored trimmed; a blank code is no code;
 *   - accounts without a code never collide, an archived account frees its code, and an account saved with
 *     the code it already has is not checked, so rows that shared a code before this rule can still be
 *     renamed and archived (nothing rewrites them);
 *   - a code that is not text, or an isActive that is not true or false, is refused 400: the body is not
 *     validated before it reaches here, and a Prisma operator object ({ set: true }) would otherwise be
 *     written without the check;
 *   - check and write run in one transaction under a per-business advisory lock: with no unique index, two
 *     concurrent writers would otherwise both pass the check.
 */
@Injectable()
export class FinanceCoaService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChartOfAccountsSeederService) private readonly seeder: ChartOfAccountsSeederService,
  ) {}

  async list(businessId: string) {
    await this.seeder.ensureDefaults(businessId);
    return this.prisma.client.chartOfAccount.findMany({
      where: { businessId },
      orderBy: [{ type: 'asc' }, { code: 'asc' }, { name: 'asc' }],
    });
  }

  async create(businessId: string, input: CreateCoaInput) {
    const name = (input.name ?? '').trim();
    if (!name) throw new BadRequestException('Name is required');
    if (!ALLOWED_TYPES.has(input.type)) {
      throw new BadRequestException(`Unknown account type: ${input.type}`);
    }
    if (input.parentId) {
      const parent = await this.prisma.client.chartOfAccount.findFirst({
        where: { id: input.parentId, businessId },
      });
      if (!parent) throw new BadRequestException('Parent account not found in this business');
    }
    const code = normalizeCoaCode(input.code);
    const data = {
      businessId,
      name,
      type: input.type,
      subtype: input.subtype ?? null,
      code,
      parentId: input.parentId ?? null,
      isSystem: false,
      isActive: true,
    };
    if (code === null) return this.prisma.client.chartOfAccount.create({ data });
    // The system accounts hold codes too (6100 is Marketing): they exist before the code is checked.
    await this.seeder.ensureDefaults(businessId);
    return this.withCodeLock(businessId, async (tx, tenant) => {
      await this.assertCodeFree(tx, tenant, code, null);
      return tx.chartOfAccount.create({ data });
    });
  }

  async update(businessId: string, id: string, input: UpdateCoaInput) {
    const existing = await this.prisma.client.chartOfAccount.findFirst({
      where: { id, businessId },
    });
    if (!existing) throw new NotFoundException('Account not found');
    if (existing.isSystem) {
      throw new ForbiddenException('System accounts are read-only');
    }

    // PR195-KEY-GATES review repair (review finding SEC-P195KG-4; as SEC-P195BW-6 did for financial accounts): a
    // parent is this business's own chart row, as create() requires. Before, update() wrote any parentId: a row of
    // another business linked under this one, and an id that exists nowhere answered a raw P2003 (a 500), so the
    // two answers told a member which ids exist in other businesses. Both now answer create()'s words.
    if (input.parentId) {
      const parent = await this.prisma.client.chartOfAccount.findFirst({
        where: { id: input.parentId, businessId },
        select: { id: true },
      });
      if (!parent) throw new BadRequestException('Parent account not found in this business');
    }

    const data: Record<string, unknown> = {};
    if (input.name != null) data.name = input.name.trim();
    if (input.subtype !== undefined) data.subtype = input.subtype;
    if (input.code !== undefined) data.code = normalizeCoaCode(input.code);
    if (input.parentId !== undefined) data.parentId = input.parentId;
    if (input.isActive != null) {
      if (typeof input.isActive !== 'boolean') throw new BadRequestException('isActive must be true or false');
      data.isActive = input.isActive;
    }

    // Only a write of the code, or one that brings the account back, can make a second active account on
    // a code. Anything else writes as before.
    if (input.code === undefined && input.isActive !== true) {
      return this.prisma.client.chartOfAccount.update({ where: { id }, data });
    }
    await this.seeder.ensureDefaults(businessId);
    return this.withCodeLock(businessId, async (tx, tenant) => {
      // Re-read under the lock: the code and the archived flag decide the check, and another writer of this
      // business's codes may have changed them since the read above.
      const current = await tx.chartOfAccount.findFirst({
        where: { id, businessId },
        select: { code: true, isActive: true, isSystem: true },
      });
      if (!current) throw new NotFoundException('Account not found');
      if (current.isSystem) throw new ForbiddenException('System accounts are read-only');
      const currentCode = storedCoaCode(current.code);
      const nextCode = input.code !== undefined ? (data.code as string | null) : currentCode;
      // Any difference, letter case included, is a change: only the database decides which codes collide
      // (the account itself is excepted there, so it may still change the case of its own code).
      const codeChanges = input.code !== undefined && nextCode !== currentCode;
      const comesBack = input.isActive === true && !current.isActive;
      if (nextCode !== null && (codeChanges || comesBack)) {
        await this.assertCodeFree(tx, tenant, nextCode, id);
      }
      return tx.chartOfAccount.update({ where: { id }, data });
    });
  }

  /**
   * Run `fn` in a transaction holding this business's account-code lock, so a check and the write it
   * allows are one step against every other create() and update() of the business's codes. `tenant` is the
   * business the transaction's Prisma calls act on: the active tenant when there is one (the `@keyflow/db`
   * extension rewrites every `where.businessId` and `create.businessId` to it), else the argument. The
   * raw-SQL check is not rewritten by the extension, so it is handed that same business.
   */
  private withCodeLock<T>(
    businessId: string,
    fn: (tx: Prisma.TransactionClient, tenant: string) => Promise<T>,
  ): Promise<T> {
    const tenant = getCurrentBusinessId() ?? businessId;
    return this.prisma.client.$transaction(async (rawTx) => {
      const tx = rawTx as unknown as Prisma.TransactionClient;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${COA_CODE_LOCK_NAMESPACE + tenant}))`;
      return fn(tx, tenant);
    });
  }

  /**
   * Refuse 409 COA_CODE_TAKEN when another ACTIVE account of the business holds `code` (already trimmed;
   * the stored side is trimmed of the same whitespace here, and letter case is folded by the database).
   * Raw SQL on purpose: Prisma's case-insensitive `equals` is an ILIKE, in which a
   * code's own '_' or '%' would match other codes. The message names the caller's own account only: the
   * query is bound to the one business.
   */
  private async assertCodeFree(
    tx: Prisma.TransactionClient,
    tenant: string,
    code: string,
    exceptId: string | null,
  ): Promise<void> {
    const holders = await tx.$queryRaw<Array<{ name: string }>>`
      SELECT name FROM chart_of_accounts
      WHERE business_id = ${tenant}
        AND is_active = true
        AND code IS NOT NULL
        AND lower(btrim(code, ${COA_CODE_WHITESPACE})) = lower(${code})
        AND id <> ${exceptId ?? ''}
      ORDER BY created_at ASC, id ASC
      LIMIT 1`;
    if (holders.length === 0) return;
    throw new ConflictException({
      code: 'COA_CODE_TAKEN',
      message: `Account code ${code} is already used by "${holders[0].name}". Choose a different code.`,
    });
  }

  async archive(businessId: string, id: string) {
    const existing = await this.prisma.client.chartOfAccount.findFirst({
      where: { id, businessId },
    });
    if (!existing) throw new NotFoundException('Account not found');
    if (existing.isSystem) throw new ForbiddenException('System accounts cannot be archived');
    return this.prisma.client.chartOfAccount.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
