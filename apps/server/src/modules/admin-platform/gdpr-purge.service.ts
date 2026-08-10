import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

/**
 * GDPR Article 17 erasure for a whole business.
 *
 * WHAT THIS REPLACED
 *
 * The previous implementation returned
 *
 *   { success: true, message: 'Business data purged per GDPR request.' }
 *
 * after setting `deletedAt` on SEVEN models and nulling six columns on
 * Business. Nothing was erased — a soft delete is a flag, and the row, with all
 * of its personal data, stayed in the table. The tenant set covers 302 models;
 * messages, call logs, documents, bank transactions, payments and cortex
 * memories were all untouched.
 *
 * So the endpoint answered a data-subject request with a sentence that was
 * false on every count. That is the same defect as a tool reporting an email it
 * never sent, except the false claim is a legal one.
 *
 * HOW ERASURE ACTUALLY HAPPENS HERE
 *
 * 267 of the 274 models that reference Business declare
 * `onDelete: Cascade`, so deleting the business row erases them in one
 * statement, in the database, in the right order, without this service needing
 * to know a topological sort of 302 tables.
 *
 * Seven models do not declare it. Prisma's default for a REQUIRED relation is
 * Restrict, so each of those would abort the delete with a foreign-key error —
 * safe, but the purge would simply fail. They are cleared first, by name, and
 * the list is asserted against the schema in test/gdpr-purge.integration.test.ts so that a new
 * non-cascading model fails the gate instead of silently blocking erasure.
 *
 * WHY IT VERIFIES ITSELF
 *
 * The whole reason this rewrite exists is that the old one said "purged"
 * without checking. So this one asks the database afterwards: every table in
 * the public schema that has a business_id column is counted, and if a single
 * row survives, the purge THROWS and names the tables. A GDPR erasure that
 * half-worked must not report success.
 */
@Injectable()
export class GdprPurgeService {
  private readonly logger = new Logger(GdprPurgeService.name);

  /**
   * Tables whose model does NOT declare `onDelete: Cascade` on its Business
   * relation, and which therefore block the cascade.
   *
   * Kept as table names rather than model names because they are used in raw
   * SQL. test/gdpr-purge.integration.test.ts derives the same list from schema.prisma and fails
   * if the two disagree.
   */
  private static readonly NON_CASCADING_TABLES = [
    'document_change_logs',
    'document_instances',
    'review_tasks',
    'output_templates',
    'org_standards',
    'business_profile_versions',
    'webhooks',
  ] as const;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Every table in the public schema carrying a business_id column. */
  private async tablesWithBusinessId(): Promise<string[]> {
    const rows = await this.prisma.client.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT c.table_name
         FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'public'
          AND c.column_name = 'business_id'
          AND t.table_type = 'BASE TABLE'
        ORDER BY c.table_name`,
    );
    return rows.map((r) => r.table_name);
  }

  /** Rows still referencing this business, per table. Empty means erased. */
  private async remainingRows(businessId: string): Promise<Array<{ table: string; rows: number }>> {
    const tables = await this.tablesWithBusinessId();
    const left: Array<{ table: string; rows: number }> = [];
    for (const table of tables) {
      const [{ count }] = await this.prisma.client.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count FROM "${table}" WHERE business_id = $1`,
        businessId,
      );
      const rows = Number(count);
      if (rows > 0) left.push({ table, rows });
    }
    return left;
  }

  /**
   * Erase a business and everything belonging to it.
   *
   * Returns what was actually removed, not an assurance that it was.
   */
  async purgeBusiness(businessId: string): Promise<{
    businessId: string;
    erased: true;
    tablesScanned: number;
    rowsBefore: number;
    blockersCleared: Record<string, number>;
  }> {
    // Raw SQL, not prisma.business.findUnique: Business is registered with the
    // soft-delete extension, so a business already soft-deleted by the OLD
    // implementation is invisible to the ORM — and those are exactly the ones
    // someone will come back to erase properly.
    const found = await this.prisma.client.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM businesses WHERE id = $1`,
      businessId,
    );
    if (!found.length) throw new NotFoundException('Business not found');

    const before = await this.remainingRows(businessId);
    const rowsBefore = before.reduce((n, t) => n + t.rows, 0);

    const blockersCleared: Record<string, number> = {};
    await this.prisma.client.$transaction(async (tx) => {
      // The seven that would otherwise abort the cascade with a foreign-key
      // error. Order matters within them: change logs reference instances.
      for (const table of GdprPurgeService.NON_CASCADING_TABLES) {
        const deleted = await tx.$executeRawUnsafe(
          `DELETE FROM "${table}" WHERE business_id = $1`,
          businessId,
        );
        if (deleted > 0) blockersCleared[table] = deleted;
      }

      // The other 267 go with it, by ON DELETE CASCADE, in the database.
      // Raw SQL because Business is soft-deleted by the extension, which would
      // turn prisma.business.delete into an UPDATE — the precise bug this
      // service exists to undo.
      await tx.$executeRawUnsafe(`DELETE FROM businesses WHERE id = $1`, businessId);
    });

    // The point of the whole rewrite. Ask, do not assume.
    const after = await this.remainingRows(businessId);
    if (after.length) {
      const detail = after.map((t) => `${t.table}(${t.rows})`).join(', ');
      this.logger.error(`[gdpr] purge incomplete for ${businessId}: ${detail}`);
      throw new Error(
        `GDPR erasure INCOMPLETE for ${businessId}. Rows still reference it in: ${detail}. ` +
          'Nothing has been reported as erased. Add these models to the cascade or to ' +
          'NON_CASCADING_TABLES.',
      );
    }

    const stillThere = await this.prisma.client.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM businesses WHERE id = $1`,
      businessId,
    );
    if (stillThere.length) {
      throw new Error(`GDPR erasure INCOMPLETE for ${businessId}: the business row survived.`);
    }

    this.logger.log(`[gdpr] erased business ${businessId}: ${rowsBefore} rows across its tables`);
    return {
      businessId,
      erased: true,
      tablesScanned: (await this.tablesWithBusinessId()).length,
      rowsBefore,
      blockersCleared,
    };
  }
}
