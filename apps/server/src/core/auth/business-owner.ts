import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

/** The member a request acts for, as AuthMiddleware attaches it. */
export type OwnerActor = { id?: string; role?: string } | null | undefined;

/**
 * SWEEP-P0-FOLLOWUP (byokkeys ruling, recommended option): the owner rule for a business setting the owner keeps
 * whatever scopes are granted, in the shape every owner rule of the server takes (IdentityService
 * .assertBusinessOwner, assertGoogleConnectOwner, GmailService.assertConnectAuthority): an OWNER membership of this
 * business, or its recorded owner (Business.ownerId) while it holds that OWNER membership (owner rulings D-104,
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
  const membership = await prisma.client.membership.findUnique({
    where: { userId_businessId: { userId: actor.id, businessId } },
    select: { role: true },
  });
  if (membership?.role === 'OWNER') return;
  const owned = await prisma.client.business.findFirst({
    where: { id: businessId, ownerId: actor.id, members: { some: { userId: actor.id, role: 'OWNER' } } },
    select: { id: true },
  });
  if (owned) return;
  throw new ForbiddenException(refusal);
}

/** The BYOK refusal (byokkeys): the business's own AI provider keys are the owner's to enter, change or clear. */
export const BYOK_OWNER_ONLY = {
  code: 'BYOK_OWNER_ONLY',
  message: "Only the business owner can enter, change or remove the business's own AI provider keys",
} as const;
