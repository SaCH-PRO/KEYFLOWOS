import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BookingCreatedPayload, InvoicePaidPayload, PostPublishedPayload, ProductCreatedPayload } from '../../core/event-bus/events.types';
import { PrismaService } from '../../core/prisma/prisma.service';
import { lockBusinessMeta } from '../../core/prisma/business-meta';

type GamificationFlag = 'firstSaleMade' | 'firstPostPublished' | 'firstBooking' | 'firstProductCreated';

@Injectable()
export class GamificationListener {
  private readonly logger = new Logger(GamificationListener.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * FOLLOW3-D13: whether `flag` still needs setting. The flags only ever go
   * from unset to true, so a business already flagged needs no lock; a
   * business not flagged yet is re-read under the row lock before the write.
   */
  private async needsFlag(businessId: string, flag: GamificationFlag): Promise<boolean> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });
    if (!business) return false;
    const metaData = (business.metaData as Record<string, unknown>) || {};
    return !metaData[flag];
  }

  /**
   * FOLLOW3-D13: invoice.paid sets metaData.firstSaleMade. metaData is read
   * and written under the business row lock (lockBusinessMeta), so a metaData
   * write that commits meanwhile (the owner's PATCH clearing a payment secret)
   * is not undone by this one's copy (RED-before: the cleared secret was
   * stored again).
   */
  @OnEvent('invoice.paid')
  async handleInvoicePaid(payload: InvoicePaidPayload) {
    this.logger.debug(`Gamification observed invoice.paid`, payload as any);
    if (!(await this.needsFlag(payload.businessId, 'firstSaleMade'))) return;
    const marked = await this.prisma.client.$transaction(async (tx) => {
      const business = await lockBusinessMeta(tx, payload.businessId);
      if (!business) return false;
      const metaData = (business.metaData as Record<string, unknown>) || {};
      if (metaData.firstSaleMade) return false;
      await tx.business.update({
        where: { id: payload.businessId },
        data: { metaData: { ...metaData, firstSaleMade: true } },
      });
      return true;
    });
    if (marked) this.logger.debug(`Gamification: marked firstSaleMade for business ${payload.businessId}`);
  }

  @OnEvent('post.published')
  async handlePostPublished(payload: PostPublishedPayload) {
    this.logger.debug(`Gamification observed post.published`, payload as any);
    if (!(await this.needsFlag(payload.businessId, 'firstPostPublished'))) return;
    const marked = await this.prisma.client.$transaction(async (tx) => {
      const business = await lockBusinessMeta(tx, payload.businessId);
      if (!business) return false;
      const metaData = (business.metaData as Record<string, unknown>) || {};
      if (metaData.firstPostPublished) return false;
      await tx.business.update({
        where: { id: payload.businessId },
        data: { metaData: { ...metaData, firstPostPublished: true } },
      });
      return true;
    });
    if (marked) this.logger.debug(`Gamification: marked firstPostPublished for business ${payload.businessId}`);
  }

  @OnEvent('booking.created')
  async handleFirstBooking(payload: BookingCreatedPayload) {
    this.logger.debug(`Gamification observed booking.created`, payload as any);
    if (!(await this.needsFlag(payload.businessId, 'firstBooking'))) return;
    const marked = await this.prisma.client.$transaction(async (tx) => {
      const business = await lockBusinessMeta(tx, payload.businessId);
      if (!business) return false;
      const metaData = (business.metaData as Record<string, unknown>) || {};
      if (metaData.firstBooking) return false;
      await tx.business.update({
        where: { id: payload.businessId },
        data: { metaData: { ...metaData, firstBooking: true } },
      });
      return true;
    });
    if (marked) this.logger.debug(`Gamification: marked firstBooking for business ${payload.businessId}`);
  }

  @OnEvent('product.created')
  async handleProductCreated(payload: ProductCreatedPayload) {
    this.logger.debug(`Gamification observed product.created`, payload as any);
    if (!(await this.needsFlag(payload.businessId, 'firstProductCreated'))) return;
    const marked = await this.prisma.client.$transaction(async (tx) => {
      const business = await lockBusinessMeta(tx, payload.businessId);
      if (!business) return false;
      const metaData = (business.metaData as Record<string, unknown>) || {};
      if (metaData.firstProductCreated) return false;
      await tx.business.update({
        where: { id: payload.businessId },
        data: { metaData: { ...metaData, firstProductCreated: true } },
      });
      return true;
    });
    if (marked) this.logger.debug(`Gamification: marked firstProductCreated for business ${payload.businessId}`);
  }
}
