import { BadRequestException, Inject, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../core/prisma/prisma.service';

/**
 * Customer-facing referral surface (S5).
 *
 * A customer who has a confirmed booking or paid order can mint a
 * personal, shareable referral link. The code is deterministically
 * derived from `(businessId, contact email)` so the same customer
 * always gets the same code — share it twice, attribute either click.
 *
 * Codes are NOT secrets: they're identifiers that route attribution
 * back to a contact when a new visitor lands with `?ref=<code>`. We
 * never expose contact internals to the public surface.
 */
@Injectable()
export class CustomerReferralService {
  private readonly logger = new Logger(CustomerReferralService.name);
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private codeFor(businessId: string, email: string): string {
    const norm = `${businessId}:${email.trim().toLowerCase()}`;
    // 10-char base32 of sha256 — short enough to share, long enough
    // to avoid collisions across the universe of customers.
    const digest = createHash('sha256').update(norm).digest('base64url');
    return digest.slice(0, 10).replace(/[^a-zA-Z0-9]/g, 'X').toUpperCase();
  }

  /**
   * Look up a customer by storefront slug + email and return their
   * referral metadata. Errors with 404 if no eligible booking/order
   * exists — only confirmed buyers can refer.
   */
  async getReferralForCustomer(slug: string, email: string) {
    if (!email || !email.trim()) throw new BadRequestException('Email is required');
    const business = await this.prisma.client.business.findFirst({
      where: { slug, deletedAt: null },
      select: { id: true, name: true, slug: true, logoUrl: true, primaryColor: true },
    });
    if (!business) throw new NotFoundException('Storefront not found');

    const normalizedEmail = email.trim().toLowerCase();

    const [paidOrders, completedBookings] = await Promise.all([
      this.prisma.client.marketplaceOrder.count({
        where: {
          businessId: business.id,
          customerEmail: { equals: normalizedEmail, mode: 'insensitive' },
          paymentStatus: { in: ['PAID', 'COMPLETED'] },
        },
      }),
      this.prisma.client.booking.count({
        where: {
          businessId: business.id,
          contact: { emailNormalized: normalizedEmail },
          status: { in: ['CONFIRMED', 'COMPLETED'] },
        },
      }),
    ]);

    if (paidOrders === 0 && completedBookings === 0) {
      throw new NotFoundException(
        'We could not find a confirmed booking or paid order for this email. Only verified customers can generate a referral link.',
      );
    }

    const code = this.codeFor(business.id, normalizedEmail);

    // Best-effort: stamp the code onto the contact so referral
    // attribution can credit the original customer when a new lead
    // lands carrying `?ref=<code>`.
    try {
      const contact = await this.prisma.client.contact.findFirst({
        where: { businessId: business.id, emailNormalized: normalizedEmail },
        select: { id: true, custom: true },
      });
      if (contact) {
        const next = { ...(contact.custom as Record<string, unknown> | null ?? {}), referralOwnerCode: code };
        await this.prisma.client.contact.update({ where: { id: contact.id }, data: { custom: next as never } });
      }
    } catch (err) {
        this.logger.warn(`— minting the code does not depend on the contact write.: ${err instanceof Error ? err.message : err}`);
      }

    return {
      business: {
        id: business.id,
        name: business.name,
        slug: business.slug,
        logoUrl: business.logoUrl,
        primaryColor: business.primaryColor,
      },
      code,
      shareUrl: `/site/${business.slug}?ref=${code}`,
      stats: {
        completedBookings,
        paidOrders,
      },
    };
  }
}
