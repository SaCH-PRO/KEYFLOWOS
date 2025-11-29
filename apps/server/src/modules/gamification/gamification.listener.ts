import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class GamificationListener {
  private readonly logger = new Logger(GamificationListener.name);

  @OnEvent('invoice.paid')
  handleInvoicePaid(payload: unknown) {
    this.logger.debug(`Gamification observed invoice.paid`, payload as any);
  }
}
