import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { IngestionOrchestrator } from './ingestion-orchestrator.service';
import { IngestionItemInput } from '../../core/connectors/connector.interface';

export interface IngestionItemReceivedEvent {
  businessId: string;
  inputs: IngestionItemInput[];
}

@Injectable()
export class IngestionListener {
  private readonly logger = new Logger(IngestionListener.name);

  constructor(
    @Inject(IngestionOrchestrator) private readonly orchestrator: IngestionOrchestrator,
  ) {}

  @OnEvent('ingestion.item.received')
  async handleIngestionItemReceived(event: IngestionItemReceivedEvent) {
    for (const input of event.inputs) {
      try {
        await this.orchestrator.receive(input, event.businessId);
      } catch (err: any) {
        this.logger.error(
          `Failed to process ingestion item for business ${event.businessId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}
