import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class AiListener {
  private readonly logger = new Logger(AiListener.name);
  private readonly events: Array<{ event: string; payload: unknown }> = [];

  // Wildcard listener to observe all events for future AI memory/logging
  @OnEvent('**')
  handleAnyEvent(payload: unknown) {
    const eventName = (payload as any)?.eventName ?? 'unknown';
    this.events.push({ event: eventName, payload });
    this.logger.debug(`AI observed event ${eventName}`, payload as any);
  }

  getEvents() {
    return this.events;
  }
}
