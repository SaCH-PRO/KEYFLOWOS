import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  resolveCrmAccess,
  visibilityClause,
  type CrmAccess,
} from '../crm/crm-permissions.helper';

/**
 * CalendarPermissionService
 *
 * Single source of truth for "who can see / mutate which CalendarEvent rows
 * for a business". Three concerns are folded together here:
 *
 *   1. Membership check — must already pass via BusinessGuard, but we also
 *      load the membership/role here so we can short-circuit owner/admin.
 *   2. CalendarEvent.visibility — PRIVATE rows are restricted to the
 *      assigned staff/owner; TEAM and SHARED are everyone-in-the-business.
 *   3. CRM contact-scoped events — for events whose contactId is set, we
 *      respect the CRM "my book" / private-contact rules from M7 (#452):
 *      if a STAFF user can't see the contact, they can't see the calendar
 *      row that points at it.
 */
@Injectable()
export class CalendarPermissionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  /**
   * Build the additional `where` clause that must be AND'd onto every
   * CalendarEvent query for a non-bypass user. Returns `null` when the
   * caller has unrestricted read access (OWNER, SUPER_ADMIN).
   */
  async buildVisibilityWhere(
    businessId: string,
    userId: string,
    userRole: string | undefined,
  ): Promise<{ where: Record<string, unknown> | null; access: CrmAccess }> {
    const access = await resolveCrmAccess(this.prisma, businessId, userId);

    if (userRole === 'SUPER_ADMIN' || access.isOwner || access.isSuperAdmin) {
      return { where: null, access };
    }

    // 1. Calendar visibility: PRIVATE rows are limited to owner/staff/assignee.
    const visibilityClauseForCalendar: Record<string, unknown> = {
      OR: [
        { visibility: { in: ['TEAM', 'PUBLIC'] } },
        { staffId: userId },
        { assigneeId: userId },
      ],
    };

    // 2. CRM ownership cascade for contact-scoped events.
    //    `CalendarEvent` has no Prisma `contact` relation, so we resolve
    //    the visible contact-id set up front and translate the CRM rule
    //    into a `contactId IN (...)` filter. Events with no contactId are
    //    always visible from the CRM-permission perspective.
    const contactClause = visibilityClause(access, userId);
    let contactScoped: Record<string, unknown>;
    if (!contactClause) {
      // viewAll + no PRIVATE restrictions — nothing to add.
      contactScoped = {};
    } else {
      const visibleContactIds = await this.resolveVisibleContactIds(
        businessId,
        contactClause as Record<string, unknown>,
      );
      contactScoped = {
        OR: [
          { contactId: null },
          { contactId: { in: visibleContactIds } },
        ],
      };
    }

    const combined: Record<string, unknown> = {
      AND: [visibilityClauseForCalendar, contactScoped].filter(
        (c) => c && Object.keys(c).length > 0,
      ),
    };

    return { where: combined, access };
  }

  /**
   * Translate the CRM visibility clause into a concrete list of contact ids
   * the caller can see. Bounded by the user's "book" so the IN-list stays
   * small in practice (typical staff have hundreds, not millions).
   */
  private async resolveVisibleContactIds(
    businessId: string,
    contactClause: Record<string, unknown>,
  ): Promise<string[]> {
    const rows = await this.prisma.client.contact.findMany({
      where: { businessId, ...contactClause },
      select: { id: true },
    });
    return rows.map((r: { id: string }) => r.id);
  }

  /**
   * Throw if the caller cannot mutate the given event. Editing requires:
   *   - OWNER / SUPER_ADMIN (always), or
   *   - The event is not PRIVATE OR the caller is the assignee/staff, AND
   *   - For contact-scoped events: caller has CRM edit access ('any' or
   *     'owned' on a contact they own) — STAFF without write scope cannot
   *     mutate calendar rows backed by the CRM module.
   */
  async assertCanMutate(
    businessId: string,
    userId: string,
    userRole: string | undefined,
    event: {
      visibility: string;
      module: string;
      staffId: string | null;
      assigneeId: string | null;
      contactId: string | null;
    },
  ): Promise<void> {
    if (userRole === 'SUPER_ADMIN') return;

    const access = await resolveCrmAccess(this.prisma, businessId, userId);
    if (access.isOwner || access.isSuperAdmin) return;

    // Visibility check
    if (event.visibility === 'PRIVATE') {
      const owns = event.staffId === userId || event.assigneeId === userId;
      if (!owns) {
        throw new ForbiddenException('Cannot edit a private event you do not own');
      }
    }

    // Contact-scoped events: enforce CRM edit scope for *any* event linked
    // to a contact, regardless of source module — the M7 ownership rule is
    // about the contact, not about which module produced the projection.
    if (event.contactId) {
      if (access.editScope === 'none') {
        throw new ForbiddenException(
          'Insufficient CRM permissions to edit this calendar event',
        );
      }
      if (access.editScope === 'owned') {
        const contact = await this.prisma.client.contact.findFirst({
          where: { id: event.contactId, businessId },
          select: { ownerId: true, shares: { where: { userId } } },
        });
        if (!contact) {
          throw new ForbiddenException('Contact not found');
        }
        const isOwned = contact.ownerId === userId || contact.shares.length > 0;
        if (!isOwned) {
          throw new ForbiddenException(
            'You can only edit calendar events for contacts you own',
          );
        }
      }
    }
  }
}
