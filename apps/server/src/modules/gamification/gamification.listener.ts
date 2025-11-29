import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InvoicePaidPayload } from '../../core/event-bus/events.types';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class GamificationListener {
  private readonly logger = new Logger(GamificationListener.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('invoice.paid')
  async handleInvoicePaid(payload: InvoicePaidPayload) {
    this.logger.debug(`Gamification observed invoice.paid`, payload as any);
    const business = await this.prisma.client.business.findUnique({
      where: { id: payload.businessId },
      select: { metaData: true },
    });

    if (!business) return;

    const metaData = (business.metaData as Record<string, unknown>) || {};
    if (!metaData.firstSaleMade) {
      await this.prisma.client.business.update({
        where: { id: payload.businessId },
        data: { metaData: { ...metaData, firstSaleMade: true } },
      });
      this.logger.debug(`Gamification: marked firstSaleMade for business ${payload.businessId}`);
    }
  }
}
