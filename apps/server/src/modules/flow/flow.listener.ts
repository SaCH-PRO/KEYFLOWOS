import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class FlowListener {
  private readonly logger = new Logger(FlowListener.name);

  @OnEvent('invoice.paid')
  handleInvoicePaid(payload: unknown) {
    this.logger.debug(`Flow observed invoice.paid`, payload as any);
  }

  @OnEvent('booking.created')
  handleBookingCreated(payload: unknown) {
    this.logger.debug(`Flow observed booking.created`, payload as any);
  }
}
