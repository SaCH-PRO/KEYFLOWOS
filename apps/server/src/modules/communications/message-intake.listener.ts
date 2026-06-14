import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MessageIntakeOrchestrator, type InboundMessageEvent } from './message-intake-orchestrator.service';

@Injectable()
export class MessageIntakeListener {
  private readonly logger = new Logger(MessageIntakeListener.name);

  constructor(
    @Inject(MessageIntakeOrchestrator) private readonly orchestrator: MessageIntakeOrchestrator,
  ) {}

  @OnEvent('message.intake.received')
  async handleMessageIntake(event: InboundMessageEvent) {
    try {
      const result = await this.orchestrator.receive(event);
      this.logger.log(`Queued message intake ${result.intakeId} for contact ${result.contactId}`);
    } catch (err) {
      this.logger.error(`Failed to queue message intake: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
