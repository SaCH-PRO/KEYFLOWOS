import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DriveIntakeOrchestrator } from './drive-intake-orchestrator.service';

interface FileUploadedEvent {
  businessId: string;
  connectorType: string;
  externalId: string;
  fileName: string;
  mimeType: string;
  intakeId: string;
  result?: { confidence: number; documentType: string };
}

@Injectable()
export class DriveIntakeListener {
  private readonly logger = new Logger(DriveIntakeListener.name);

  constructor(
    @Inject(DriveIntakeOrchestrator) private readonly orchestrator: DriveIntakeOrchestrator,
  ) {}

  @OnEvent('file.uploaded')
  async handleFileUploaded(event: FileUploadedEvent) {
    if (event.connectorType !== 'google_drive') return;
    if (!event.intakeId) return;
    if ((event.result?.confidence ?? 0) < 0.5) return;
    if (event.result?.documentType === 'unknown') return;

    try {
      const plan = await this.orchestrator.buildPlan(event.businessId, event.intakeId);
      await this.orchestrator.createApprovalItem(event.businessId, plan);
      this.logger.log(`Created approval plan for Drive intake ${event.intakeId}`);
    } catch (err: any) {
      this.logger.warn(`Failed to build Drive intake plan for ${event.intakeId}: ${(err as Error).message}`);
    }
  }
}
