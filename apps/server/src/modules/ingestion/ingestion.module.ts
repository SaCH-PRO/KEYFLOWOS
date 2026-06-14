import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { ConnectorModule } from '../../core/connectors/connector.module';
import { AiModule } from '../ai/ai.module';
import { CommunicationsModule } from '../communications/communications.module';
import { CommerceModule } from '../commerce/commerce.module';
import { IngestionOrchestrator } from './ingestion-orchestrator.service';
import { IngestionListener } from './ingestion.listener';
import { KeyInboxService } from './key-inbox.service';
import { KeyInboxController } from './key-inbox.controller';

@Module({
  imports: [PrismaModule, ConnectorModule, AiModule, CommunicationsModule, CommerceModule],
  providers: [IngestionOrchestrator, IngestionListener, KeyInboxService],
  controllers: [KeyInboxController],
  exports: [IngestionOrchestrator, KeyInboxService],
})
export class IngestionModule {}
