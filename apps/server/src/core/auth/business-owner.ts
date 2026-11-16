import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

/** The member a request acts for, as AuthMiddleware attaches it. */
export type OwnerActor = { id?: string; role?: string } | null | undefined;

type PrismaTx = Parameters<Parameters<PrismaService['client']['$transaction']>[0]>[0];

/**
 * Any client that can read a membership: PrismaService.client, a transaction client, a service's own `db` getter.
 * The owner rule needs nothing else.
 */
export type MembershipReader = Pick<PrismaTx, 'membership'>;

/**
 * The one owner rule (W11-OWNER-HELPER-D11). Owner ruling D-11 made the business profile and its sibling
 * configuration writes OWNER only, regardless of granted scopes; owner ruling D-104 made membership the single rule
 * for business access; owner rulings D-116 and D-125 read the owner as "holds an OWNER membership of this business":
 * a co-owner holding OWNER is the owner, and Business.ownerId confers nothing by itself (a recorded owner holding
 * only ADMIN or STAFF is that role, and one holding no membership is no member).
 *
 * So the answer is the role of the member's membership row of the route's business, read by its (userId,
 * businessId) compound key, and nothing else is read: no Business row. An empty or missing userId is not the owner
 * and reads nothing. The SUPER_ADMIN platform bypass (the one BusinessGuard grants) is not part of this rule: each
 * caller keeps it where it stands. `db` is any client exposing membership.findUnique, so a check running inside a
 * transaction passes its transaction client.
 */
export async function isBusinessOwnerMember(
  db: MembershipReader,
  businessId: string,
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  const membership = await db.membership.findUnique({
    where: { userId_businessId: { userId, businessId } },
    select: { role: true },
  });
  return membership?.role === 'OWNER';
}

/**
 * SWEEP-P0-FOLLOWUP (byokkeys ruling, recommended option): the owner rule for a business setting the owner keeps
 * whatever scopes are granted: isBusinessOwnerMember (an OWNER membership of this business; owner rulings D-104,
 * D-116, D-125), with the SUPER_ADMIN bypass BusinessGuard already grants. Owning another business does not count.
 * No actor is 401; anyone else 403 `{ code, message }`. Run it first, before anything is read or written.
 */
export async function assertBusinessOwnerMember(
  prisma: PrismaService,
  businessId: string,
  actor: OwnerActor,
  refusal: { code: string; message: string },
): Promise<void> {
  if (!actor?.id) throw new UnauthorizedException('Authentication required');
  if (actor.role === 'SUPER_ADMIN') return;
  if (await isBusinessOwnerMember(prisma.client, businessId, actor.id)) return;
  throw new ForbiddenException(refusal);
}

/** The BYOK refusal (byokkeys): the business's own AI provider keys are the owner's to enter, change or clear. */
export const BYOK_OWNER_ONLY = {
  code: 'BYOK_OWNER_ONLY',
  message: "Only the business owner can enter, change or remove the business's own AI provider keys",
} as const;
