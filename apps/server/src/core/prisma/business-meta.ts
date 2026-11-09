import type { PrismaService } from './prisma.service';

/** The client an interactive `$transaction` hands its callback. */
export type BusinessMetaTx = Parameters<Parameters<PrismaService['client']['$transaction']>[0]>[0];

/**
 * FOLLOW3-D12-METADATA-LOCKED-WRITES: the first statement of every
 * Business.metaData read-modify-write.
 *
 * Business.metaData is one jsonb column that many writers read, change and
 * write back whole. A writer that reads it without a lock and writes its copy
 * back undoes every write that committed in between: the public storefront
 * event (SiteService.trackEvent) wrote an owner's cleared payment secret back
 * (R0-SEC2c review SEC2c-ST-1), and two events in flight together recorded
 * one. This takes the business row lock (SELECT ... FOR NO KEY UPDATE: the
 * lock IdentityService.updateBusiness and GmailService take on the same row,
 * and the one the UPDATE takes anyway; it does not block inserts that
 * reference the business) and then reads metaData, on the caller's
 * transaction client. A concurrent writer that also locks first waits for
 * this transaction to commit and then reads its result.
 *
 * Use it inside the transaction that writes, and spread the metaData it
 * returns (not an earlier read) into the write:
 *
 *   await this.prisma.client.$transaction(async (tx) => {
 *     const business = await lockBusinessMeta(tx, businessId);
 *     if (!business) throw new NotFoundException('Business not found');
 *     const meta = (business.metaData as Record<string, unknown> | null) ?? {};
 *     await tx.business.update({ where: { id: businessId }, data: { metaData: { ...meta, key: value } } });
 *   });
 *
 * The write stays at the caller, so the D-11 owner-writes guard
 * (core/config/d11-owner-writes.spec.ts) still reads each writer's metaData
 * keys there. core/prisma/business-meta-writers.spec.ts is the census of every
 * writer.
 *
 * Returns null when there is no such business (or, with `live`, when it is
 * soft-deleted); nothing is locked then.
 */
export async function lockBusinessMeta(
  tx: BusinessMetaTx,
  businessId: string,
  options: { live?: boolean } = {},
): Promise<{ metaData: unknown } | null> {
  await tx.$queryRaw`SELECT id FROM businesses WHERE id = ${businessId} FOR NO KEY UPDATE`;
  return tx.business.findFirst({
    where: options.live ? { id: businessId, deletedAt: null } : { id: businessId },
    select: { metaData: true },
  });
}
