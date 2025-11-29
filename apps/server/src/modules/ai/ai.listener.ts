import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class AiListener {
  private readonly logger = new Logger(AiListener.name);

  // Wildcard listener to observe all events for future AI memory/logging
  @OnEvent('*')
  handleAnyEvent(payload: unknown) {
    this.logger.debug(`AI observed event`, payload as any);
  }
}
